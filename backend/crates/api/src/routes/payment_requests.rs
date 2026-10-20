use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

// ── Split helpers ─────────────────────────────────────────────────────────────

/// Split `total` minor units into `n` shares using the largest-remainder method.
///
/// The returned shares always sum exactly to `total`. When the split is uneven,
/// the first `total % n` shares receive one extra minor unit each.
pub fn split_equal(total: i128, n: usize) -> Vec<i128> {
    if n == 0 {
        return Vec::new();
    }
    let n_i = n as i128;
    let base = total / n_i;
    let remainder = total % n_i;
    (0..n)
        .map(|i| {
            if (i as i128) < remainder {
                base + 1
            } else {
                base
            }
        })
        .collect()
}

/// A single payer's share of a split payment request.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaymentShare {
    pub id: String,
    pub payer: String,
    /// Amount owed by this payer (minor units, string).
    pub amount: String,
    /// Amount this payer has paid so far (minor units, string).
    pub paid_amount: String,
    /// Derived status: pending | partially_paid | paid.
    pub status: String,
}

// ── Shared types ──────────────────────────────────────────────────────────────

/// A single payment recorded against a payment request.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaymentEntry {
    pub id: String,
    pub amount: String,
    pub asset: String,
    pub chain: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payer_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub created_at: String,
}

/// Full detail returned by GET /v1/payment-requests/{id}.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaymentRequestDetail {
    pub id: String,
    pub recipient_tag: Option<String>,
    /// Total originally requested amount (minor units, string).
    pub requested_amount: String,
    pub asset: String,
    /// Derived status: open | partially_paid | paid | expired.
    pub status: String,
    pub expires_at: String,
    pub settled_at: Option<String>,
    pub allow_partial: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_amount: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_amount: Option<String>,
    /// Sum of all payments received (minor units, string).
    pub amount_paid: String,
    /// Remaining balance to reach requested_amount (0 when paid).
    pub amount_remaining: String,
    /// Every payment recorded against this request.
    pub payments: Vec<PaymentEntry>,
    /// Per-payer shares when this request is a split (empty otherwise).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shares: Vec<PaymentShare>,
}

/// Summary row returned by GET /v1/payment-requests (merchant list).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaymentRequestSummary {
    pub id: String,
    pub requested_amount: String,
    pub asset: String,
    pub status: String,
    pub expires_at: String,
    pub settled_at: Option<String>,
    pub allow_partial: bool,
    pub amount_paid: String,
    pub amount_remaining: String,
    pub created_at: String,
    /// Per-payer shares when this request is a split (empty otherwise).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shares: Vec<PaymentShare>,
}

// ── Routes ────────────────────────────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/payment-requests/{id}", get(get_payment_request))
        .route("/payment-requests/{id}/pay", post(record_payment))
        .route("/payment-requests/{id}/split", post(create_split))
        .route(
            "/payment-requests/{id}/shares/{payer}/pay",
            post(pay_share),
        )
        .route("/payment-requests/{id}/cancel", post(cancel_payment_request))
        .route("/payment-requests", get(list_payment_requests))
}

// ── GET /v1/payment-requests/{id} ────────────────────────────────────────────

/// Get a payment request by ID with current status and all recorded payments.
/// No authentication required so external payers can inspect invoice details.
async fn get_payment_request(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<PaymentRequestDetail>, ApiError> {
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let detail = load_payment_request_detail(&pool, id).await?;
    Ok(Json(detail))
}

/// Load full payment request detail and auto-expire stale requests.
pub(crate) async fn load_payment_request_detail(
    pool: &sqlx::PgPool,
    id: Uuid,
) -> Result<PaymentRequestDetail, ApiError> {
    let db_err = |e: sqlx::Error| ApiError::Internal(anyhow::anyhow!(e.to_string()));

    // Auto-expire: flip any pending/partially_paid request whose expiry has passed.
    sqlx::query(
        r#"
        UPDATE payment_requests
        SET status = 'expired'
        WHERE id = $1
          AND status IN ('pending', 'partially_paid')
          AND expires_at < now()
        "#,
    )
    .bind(id)
    .execute(pool)
    .await
    .map_err(db_err)?;

    let row = sqlx::query(
        r#"
        SELECT
            pr.id,
            pr.recipient_tag,
            pr.requested_amount::text AS requested_amount,
            pr.asset,
            pr.status,
            pr.expires_at,
            pr.settled_at,
            pr.allow_partial,
            pr.min_amount::text    AS min_amount,
            pr.max_amount::text    AS max_amount,
            COALESCE(SUM(pp.amount), 0)::text AS amount_paid
        FROM payment_requests pr
        LEFT JOIN payment_request_payments pp ON pp.payment_request_id = pr.id
        WHERE pr.id = $1
        GROUP BY pr.id
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(db_err)?
    .ok_or(ApiError::NotFound)?;

    let row_id: Uuid = row.try_get("id").map_err(db_err)?;
    let recipient_tag: Option<String> = row.try_get("recipient_tag").map_err(db_err)?;
    let requested_amount: i128 = row
        .try_get::<Option<String>, _>("requested_amount")
        .map_err(db_err)?
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("payment request has no amount")))?
        .parse()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid requested_amount: {e}")))?;
    let asset: String = row.try_get("asset").map_err(db_err)?;
    let status: String = row.try_get("status").map_err(db_err)?;
    let expires_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
        row.try_get("expires_at").map_err(db_err)?;
    let settled_at: Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>> =
        row.try_get("settled_at").map_err(db_err)?;
    let allow_partial: bool = row.try_get("allow_partial").map_err(db_err)?;
    let min_amount: Option<String> = row.try_get("min_amount").map_err(db_err)?;
    let max_amount: Option<String> = row.try_get("max_amount").map_err(db_err)?;
    let amount_paid: i128 = row
        .try_get::<String, _>("amount_paid")
        .map_err(db_err)?
        .parse()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid amount_paid: {e}")))?;

    let amount_remaining = if requested_amount > amount_paid {
        requested_amount - amount_paid
    } else {
        0
    };

    // Load individual payments.
    let payment_rows = sqlx::query(
        r#"
        SELECT id, amount::text AS amount, asset, chain, tx_hash, payer_address, note, created_at
        FROM payment_request_payments
        WHERE payment_request_id = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .map_err(db_err)?;

    let payments: Vec<PaymentEntry> = payment_rows
        .iter()
        .map(|r| {
            let entry_id: Uuid = r.try_get("id").map_err(db_err)?;
            let amount: String = r.try_get("amount").map_err(db_err)?;
            let entry_asset: String = r.try_get("asset").map_err(db_err)?;
            let chain: String = r.try_get("chain").map_err(db_err)?;
            let tx_hash: Option<String> = r.try_get("tx_hash").map_err(db_err)?;
            let payer_address: Option<String> = r.try_get("payer_address").map_err(db_err)?;
            let note: Option<String> = r.try_get("note").map_err(db_err)?;
            let created_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
                r.try_get("created_at").map_err(db_err)?;
            Ok(PaymentEntry {
                id: entry_id.to_string(),
                amount,
                asset: entry_asset,
                chain,
                tx_hash,
                payer_address,
                note,
                created_at: created_at.to_rfc3339(),
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    let shares = load_shares(pool, id).await?;

    Ok(PaymentRequestDetail {
        id: row_id.to_string(),
        recipient_tag,
        requested_amount: requested_amount.to_string(),
        asset,
        status,
        expires_at: expires_at.to_rfc3339(),
        settled_at: settled_at.map(|dt| dt.to_rfc3339()),
        allow_partial,
        min_amount,
        max_amount,
        amount_paid: amount_paid.to_string(),
        amount_remaining: amount_remaining.to_string(),
        payments,
        shares,
    })
}

/// Load all shares for a payment request, deriving per-share status.
async fn load_shares(pool: &sqlx::PgPool, id: Uuid) -> Result<Vec<PaymentShare>, ApiError> {
    let db_err = |e: sqlx::Error| ApiError::Internal(anyhow::anyhow!(e.to_string()));

    let rows = sqlx::query(
        r#"
        SELECT
            s.id,
            s.payer,
            s.amount::text AS amount,
            COALESCE(SUM(sp.amount), 0)::text AS paid_amount
        FROM payment_request_shares s
        LEFT JOIN payment_request_share_payments sp ON sp.share_id = s.id
        WHERE s.payment_request_id = $1
        GROUP BY s.id
        ORDER BY s.created_at ASC
        "#,
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .map_err(db_err)?;

    rows.iter()
        .map(|r| {
            let share_id: Uuid = r.try_get("id").map_err(db_err)?;
            let payer: String = r.try_get("payer").map_err(db_err)?;
            let amount: i128 = r
                .try_get::<String, _>("amount")
                .map_err(db_err)?
                .parse()
                .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid share amount: {e}")))?;
            let paid_amount: i128 = r
                .try_get::<String, _>("paid_amount")
                .map_err(db_err)?
                .parse()
                .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid paid_amount: {e}")))?;
            let status = if paid_amount >= amount {
                "paid"
            } else if paid_amount > 0 {
                "partially_paid"
            } else {
                "pending"
            };
            Ok(PaymentShare {
                id: share_id.to_string(),
                payer,
                amount: amount.to_string(),
                paid_amount: paid_amount.to_string(),
                status: status.to_string(),
            })
        })
        .collect()
}

// ── POST /v1/payment-requests/{id}/pay ───────────────────────────────────────

/// Request body for recording a payment against a payment request.
#[derive(Debug, Deserialize)]
pub struct RecordPaymentRequest {
    /// Amount being paid, as a decimal string in the request's asset.
    pub amount: String,
    /// Chain identifier: 'stellar', 'base', 'bitcoin', or 'internal'.
    pub chain: String,
    /// On-chain transaction hash (required for chain payments, omit for internal).
    #[serde(default)]
    pub tx_hash: Option<String>,
    /// Payer's wallet address or user tag (optional).
    #[serde(default)]
    pub payer_address: Option<String>,
    /// Free-text note (optional).
    #[serde(default)]
    pub note: Option<String>,
}

/// Response returned after a payment is recorded.
#[derive(Debug, Serialize)]
pub struct RecordPaymentResponse {
    pub payment_id: String,
    pub payment_request_id: String,
    /// Updated request status after this payment.
    pub request_status: String,
    pub amount_paid: String,
    pub amount_remaining: String,
}

/// POST /v1/payment-requests/{id}/pay
///
/// Records a payment (on-chain or internal) against a payment request.
/// Validates:
/// - Request is open (pending or partially_paid) and not expired.
/// - Amount >= min_amount (if set).
/// - Amount <= max_amount (if set).
/// - If allow_partial is false, amount must equal the outstanding balance.
/// - Total paid must not exceed requested_amount.
///
/// On success updates the request status to partially_paid or paid.
async fn record_payment(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<RecordPaymentRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let db_err = |e: sqlx::Error| ApiError::Internal(anyhow::anyhow!(e.to_string()));

    // Fetch request, auto-expiring if necessary.
    let row = sqlx::query(
        r#"
        SELECT
            pr.requested_amount::text AS requested_amount,
            pr.asset,
            pr.status,
            pr.expires_at,
            pr.allow_partial,
            pr.min_amount::text AS min_amount,
            pr.max_amount::text AS max_amount,
            COALESCE(SUM(pp.amount), 0)::text AS amount_paid
        FROM payment_requests pr
        LEFT JOIN payment_request_payments pp ON pp.payment_request_id = pr.id
        WHERE pr.id = $1
        GROUP BY pr.id
        "#,
    )
    .bind(id)
    .fetch_optional(&pool)
    .await
    .map_err(db_err)?
    .ok_or(ApiError::NotFound)?;

    let status: String = row.try_get("status").map_err(db_err)?;
    let expires_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
        row.try_get("expires_at").map_err(db_err)?;

    // Auto-expire check.
    if (status == "pending" || status == "partially_paid")
        && expires_at < sqlx::types::chrono::Utc::now()
    {
        sqlx::query(
            "UPDATE payment_requests SET status = 'expired' \
             WHERE id = $1 AND status IN ('pending', 'partially_paid') AND expires_at < now()",
        )
        .bind(id)
        .execute(&pool)
        .await
        .map_err(db_err)?;
        return Err(ApiError::BadRequest(
            "payment request has expired".to_string(),
        ));
    }

    if status != "pending" && status != "partially_paid" {
        return Err(ApiError::BadRequest(format!(
            "payment request is {status}, not open"
        )));
    }

    let asset_str: String = row.try_get("asset").map_err(db_err)?;
    let asset: engipay_core::Asset = asset_str
        .parse()
        .map_err(|_| ApiError::Internal(anyhow::anyhow!("invalid asset in payment request")))?;

    let requested_amount: i128 = row
        .try_get::<String, _>("requested_amount")
        .map_err(db_err)?
        .parse()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid requested_amount: {e}")))?;

    let amount_paid_so_far: i128 = row
        .try_get::<String, _>("amount_paid")
        .map_err(db_err)?
        .parse()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid amount_paid: {e}")))?;

    let allow_partial: bool = row.try_get("allow_partial").map_err(db_err)?;
    let min_amount: Option<i128> = row
        .try_get::<Option<String>, _>("min_amount")
        .map_err(db_err)?
        .map(|s| s.parse::<i128>())
        .transpose()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid min_amount: {e}")))?;
    let max_amount: Option<i128> = row
        .try_get::<Option<String>, _>("max_amount")
        .map_err(db_err)?
        .map(|s| s.parse::<i128>())
        .transpose()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid max_amount: {e}")))?;

    // Parse the payment amount.
    let payment_money = engipay_core::Money::parse(asset, payload.amount.trim())
        .map_err(|_| ApiError::BadRequest("amount must be a positive decimal value".to_string()))?;
    if payment_money.minor <= 0 {
        return Err(ApiError::BadRequest(
            "payment amount must be greater than zero".to_string(),
        ));
    }
    let payment_amount = payment_money.minor;

    let outstanding = requested_amount.saturating_sub(amount_paid_so_far);

    // Reject over-payment.
    if payment_amount > outstanding {
        return Err(ApiError::BadRequest(format!(
            "payment of {payment_amount} would exceed outstanding balance of {outstanding}"
        )));
    }

    // Enforce min_amount.
    if let Some(min) = min_amount {
        if payment_amount < min {
            return Err(ApiError::BadRequest(format!(
                "payment of {payment_amount} is below the minimum of {min}"
            )));
        }
    }

    // Enforce max_amount.
    if let Some(max) = max_amount {
        if payment_amount > max {
            return Err(ApiError::BadRequest(format!(
                "payment of {payment_amount} exceeds the maximum of {max}"
            )));
        }
    }

    // If partial payments are not allowed, the payment must cover the full outstanding balance.
    if !allow_partial && payment_amount != outstanding {
        return Err(ApiError::BadRequest(format!(
            "payment of {payment_amount} does not match the outstanding balance of {outstanding}; \
             partial payments are not allowed for this request"
        )));
    }

    // Validate chain field.
    let chain = payload.chain.trim();
    if chain.is_empty() {
        return Err(ApiError::BadRequest("chain must not be empty".to_string()));
    }

    // tx_hash uniqueness is enforced by the DB unique index, but validate presence
    // for non-internal chains.
    let tx_hash = payload.tx_hash.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if chain != "internal" && tx_hash.is_none() {
        return Err(ApiError::BadRequest(
            "tx_hash is required for on-chain payments".to_string(),
        ));
    }

    let new_amount_paid = amount_paid_so_far + payment_amount;
    let new_status = if new_amount_paid >= requested_amount {
        "paid"
    } else {
        "partially_paid"
    };

    // Insert payment and update request status atomically.
    let payment_id = Uuid::new_v4();
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("begin tx: {e}")))?;

    sqlx::query(
        r#"
        INSERT INTO payment_request_payments
            (id, payment_request_id, amount, asset, chain, tx_hash, payer_address, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(payment_id)
    .bind(id)
    .bind(payment_amount.to_string())
    .bind(&asset_str)
    .bind(chain)
    .bind(tx_hash)
    .bind(payload.payer_address.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(payload.note.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        if e.to_string().contains("idx_payment_request_payments_tx_hash") {
            ApiError::Conflict("a payment with this tx_hash has already been recorded".to_string())
        } else {
            ApiError::Internal(anyhow::anyhow!(e.to_string()))
        }
    })?;

    sqlx::query(
        r#"
        UPDATE payment_requests
        SET status     = $2,
            settled_at = CASE WHEN $2 = 'paid' THEN now() ELSE settled_at END
        WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(new_status)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("commit: {e}")))?;

    let amount_remaining = requested_amount
        .saturating_sub(new_amount_paid)
        .max(0);

    Ok((
        StatusCode::CREATED,
        Json(RecordPaymentResponse {
            payment_id: payment_id.to_string(),
            payment_request_id: id.to_string(),
            request_status: new_status.to_string(),
            amount_paid: new_amount_paid.to_string(),
            amount_remaining: amount_remaining.to_string(),
        }),
    ))
}

// ── POST /v1/payment-requests/{id}/split ─────────────────────────────────────

/// A single payer entry in a split request.
#[derive(Debug, Deserialize)]
pub struct SplitPayer {
    /// Payer identifier (wallet address or user tag).
    pub identifier: String,
    /// Custom amount (minor units, string). Required for custom mode, ignored for equal.
    #[serde(default)]
    pub amount: Option<String>,
}

/// Request body for creating a split.
#[derive(Debug, Deserialize)]
pub struct CreateSplitRequest {
    /// "equal" or "custom".
    pub mode: String,
    pub payers: Vec<SplitPayer>,
}

/// Response returned after a split is created.
#[derive(Debug, Serialize)]
pub struct CreateSplitResponse {
    pub payment_request_id: String,
    pub shares: Vec<PaymentShare>,
}

/// POST /v1/payment-requests/{id}/split
///
/// Splits a payment request across several payers. Only the creator may split.
/// In `equal` mode the total is divided with the largest-remainder method so
/// shares always sum exactly to the requested amount. In `custom` mode the
/// supplied amounts must sum exactly to the requested amount.
async fn create_split(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    auth: AuthUser,
    Json(payload): Json<CreateSplitRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let db_err = |e: sqlx::Error| ApiError::Internal(anyhow::anyhow!(e.to_string()));

    let row = sqlx::query(
        r#"
        SELECT
            pr.user_id,
            pr.requested_amount::text AS requested_amount,
            pr.status,
            COALESCE(SUM(pp.amount), 0)::text AS amount_paid
        FROM payment_requests pr
        LEFT JOIN payment_request_payments pp ON pp.payment_request_id = pr.id
        WHERE pr.id = $1
        GROUP BY pr.id
        "#,
    )
    .bind(id)
    .fetch_optional(&pool)
    .await
    .map_err(db_err)?
    .ok_or(ApiError::NotFound)?;

    let owner: Uuid = row.try_get("user_id").map_err(db_err)?;
    if owner != user_id.as_uuid() {
        return Err(ApiError::Forbidden);
    }

    let status: String = row.try_get("status").map_err(db_err)?;
    if status != "pending" {
        return Err(ApiError::BadRequest(format!(
            "payment request is {status}, cannot be split"
        )));
    }

    let amount_paid: i128 = row
        .try_get::<String, _>("amount_paid")
        .map_err(db_err)?
        .parse()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid amount_paid: {e}")))?;
    if amount_paid > 0 {
        return Err(ApiError::BadRequest(
            "cannot split a payment request that already has payments".to_string(),
        ));
    }

    let total: i128 = row
        .try_get::<String, _>("requested_amount")
        .map_err(db_err)?
        .parse()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid requested_amount: {e}")))?;

    if payload.payers.is_empty() {
        return Err(ApiError::BadRequest(
            "at least one payer is required".to_string(),
        ));
    }

    // Build (payer, amount) pairs.
    let mut shares: Vec<(String, i128)> = Vec::with_capacity(payload.payers.len());
    match payload.mode.trim() {
        "equal" => {
            let amounts = split_equal(total, payload.payers.len());
            for (p, amt) in payload.payers.iter().zip(amounts) {
                let ident = p.identifier.trim();
                if ident.is_empty() {
                    return Err(ApiError::BadRequest(
                        "payer identifier must not be empty".to_string(),
                    ));
                }
                shares.push((ident.to_string(), amt));
            }
        }
        "custom" => {
            let mut sum: i128 = 0;
            for p in &payload.payers {
                let ident = p.identifier.trim();
                if ident.is_empty() {
                    return Err(ApiError::BadRequest(
                        "payer identifier must not be empty".to_string(),
                    ));
                }
                let raw = p.amount.as_deref().ok_or_else(|| {
                    ApiError::BadRequest("custom mode requires an amount per payer".to_string())
                })?;
                let amt: i128 = raw.trim().parse().map_err(|_| {
                    ApiError::BadRequest(format!("invalid amount for payer {ident}"))
                })?;
                if amt <= 0 {
                    return Err(ApiError::BadRequest(format!(
                        "amount for payer {ident} must be greater than zero"
                    )));
                }
                sum += amt;
                shares.push((ident.to_string(), amt));
            }
            if sum != total {
                return Err(ApiError::BadRequest(format!(
                    "custom shares sum to {sum} but must equal the requested amount of {total}"
                )));
            }
        }
        other => {
            return Err(ApiError::BadRequest(format!(
                "invalid mode '{other}'; expected 'equal' or 'custom'"
            )));
        }
    }

    // Reject duplicate payers.
    {
        let mut seen = std::collections::HashSet::new();
        for (ident, _) in &shares {
            if !seen.insert(ident.clone()) {
                return Err(ApiError::BadRequest(format!(
                    "duplicate payer '{ident}'"
                )));
            }
        }
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("begin tx: {e}")))?;

    // Replace any existing shares.
    sqlx::query("DELETE FROM payment_request_shares WHERE payment_request_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;

    for (payer, amount) in &shares {
        sqlx::query(
            r#"
            INSERT INTO payment_request_shares
                (id, payment_request_id, payer, amount)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(id)
        .bind(payer)
        .bind(amount.to_string())
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("commit: {e}")))?;

    let persisted = load_shares(&pool, id).await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateSplitResponse {
            payment_request_id: id.to_string(),
            shares: persisted,
        }),
    ))
}

// ── POST /v1/payment-requests/{id}/shares/{payer}/pay ────────────────────────

/// Request body for paying a share.
#[derive(Debug, Deserialize)]
pub struct PayShareRequest {
    /// Amount being paid toward this share (minor units, string).
    pub amount: String,
    #[serde(default)]
    pub chain: Option<String>,
    #[serde(default)]
    pub tx_hash: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Response returned after a share payment is recorded.
#[derive(Debug, Serialize)]
pub struct PayShareResponse {
    pub share: PaymentShare,
    /// Overall request status after this payment.
    pub request_status: String,
    pub amount_paid: String,
    pub amount_remaining: String,
}

/// POST /v1/payment-requests/{id}/shares/{payer}/pay
///
/// Records a payment toward a single payer's share. When every share is fully
/// paid the parent request is marked `paid`.
async fn pay_share(
    State(state): State<AppState>,
    Path((id, payer)): Path<(Uuid, String)>,
    Json(payload): Json<PayShareRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let db_err = |e: sqlx::Error| ApiError::Internal(anyhow::anyhow!(e.to_string()));

    let req_row = sqlx::query(
        r#"
        SELECT requested_amount::text AS requested_amount, status
        FROM payment_requests
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(&pool)
    .await
    .map_err(db_err)?
    .ok_or(ApiError::NotFound)?;

    let status: String = req_row.try_get("status").map_err(db_err)?;
    if status != "pending" && status != "partially_paid" {
        return Err(ApiError::BadRequest(format!(
            "payment request is {status}, not open"
        )));
    }
    let requested_amount: i128 = req_row
        .try_get::<String, _>("requested_amount")
        .map_err(db_err)?
        .parse()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid requested_amount: {e}")))?;

    let share_row = sqlx::query(
        r#"
        SELECT
            s.id,
            s.amount::text AS amount,
            COALESCE(SUM(sp.amount), 0)::text AS paid_amount
        FROM payment_request_shares s
        LEFT JOIN payment_request_share_payments sp ON sp.share_id = s.id
        WHERE s.payment_request_id = $1 AND s.payer = $2
        GROUP BY s.id
        "#,
    )
    .bind(id)
    .bind(payer.trim())
    .fetch_optional(&pool)
    .await
    .map_err(db_err)?
    .ok_or(ApiError::NotFound)?;

    let share_id: Uuid = share_row.try_get("id").map_err(db_err)?;
    let share_amount: i128 = share_row
        .try_get::<String, _>("amount")
        .map_err(db_err)?
        .parse()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid share amount: {e}")))?;
    let share_paid: i128 = share_row
        .try_get::<String, _>("paid_amount")
        .map_err(db_err)?
        .parse()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid paid_amount: {e}")))?;

    let payment_amount: i128 = payload
        .amount
        .trim()
        .parse()
        .map_err(|_| ApiError::BadRequest("amount must be a positive integer".to_string()))?;
    if payment_amount <= 0 {
        return Err(ApiError::BadRequest(
            "payment amount must be greater than zero".to_string(),
        ));
    }

    let share_outstanding = share_amount.saturating_sub(share_paid);
    if payment_amount > share_outstanding {
        return Err(ApiError::BadRequest(format!(
            "payment of {payment_amount} would exceed this share's outstanding balance of {share_outstanding}"
        )));
    }

    let chain = payload
        .chain
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("internal");
    let tx_hash = payload
        .tx_hash
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("begin tx: {e}")))?;

    sqlx::query(
        r#"
        INSERT INTO payment_request_share_payments
            (id, share_id, amount, chain, tx_hash, note)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(share_id)
    .bind(payment_amount.to_string())
    .bind(chain)
    .bind(tx_hash)
    .bind(payload.note.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;

    // Recompute totals across all shares.
    let totals = sqlx::query(
        r#"
        SELECT
            COALESCE(SUM(s.amount), 0)::text AS total_amount,
            COALESCE(SUM(sp.amount), 0)::text AS total_paid
        FROM payment_request_shares s
        LEFT JOIN payment_request_share_payments sp ON sp.share_id = s.id
        WHERE s.payment_request_id = $1
        "#,
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;

    let total_paid: i128 = totals
        .try_get::<String, _>("total_paid")
        .map_err(db_err)?
        .parse()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid total_paid: {e}")))?;

    let all_paid = total_paid >= requested_amount;
    let new_status = if all_paid { "paid" } else { "partially_paid" };

    sqlx::query(
        r#"
        UPDATE payment_requests
        SET status     = $2,
            settled_at = CASE WHEN $2 = 'paid' THEN now() ELSE settled_at END
        WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(new_status)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("commit: {e}")))?;

    let new_share_paid = share_paid + payment_amount;
    let share_status = if new_share_paid >= share_amount {
        "paid"
    } else if new_share_paid > 0 {
        "partially_paid"
    } else {
        "pending"
    };

    let amount_remaining = requested_amount.saturating_sub(total_paid).max(0);

    Ok((
        StatusCode::CREATED,
        Json(PayShareResponse {
            share: PaymentShare {
                id: share_id.to_string(),
                payer: payer.trim().to_string(),
                amount: share_amount.to_string(),
                paid_amount: new_share_paid.to_string(),
                status: share_status.to_string(),
            },
            request_status: new_status.to_string(),
            amount_paid: total_paid.to_string(),
            amount_remaining: amount_remaining.to_string(),
        }),
    ))
}

// ── POST /v1/payment-requests/{id}/cancel ────────────────────────────────────

/// Response returned after cancelling a split request.
#[derive(Debug, Serialize)]
pub struct CancelPaymentRequestResponse {
    pub payment_request_id: String,
    pub status: String,
    /// Total amount refunded to payers who had already paid their shares.
    pub refunded_amount: String,
}

/// POST /v1/payment-requests/{id}/cancel
///
/// Creator-only. Cancels a split request, refunds any partial share payments,
/// and marks the request expired.
async fn cancel_payment_request(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    auth: AuthUser,
) -> Result<Json<CancelPaymentRequestResponse>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let db_err = |e: sqlx::Error| ApiError::Internal(anyhow::anyhow!(e.to_string()));

    let row = sqlx::query("SELECT user_id, status FROM payment_requests WHERE id = $1")
        .bind(id)
        .fetch_optional(&pool)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::NotFound)?;

    let owner: Uuid = row.try_get("user_id").map_err(db_err)?;
    if owner != user_id.as_uuid() {
        return Err(ApiError::Forbidden);
    }

    let status: String = row.try_get("status").map_err(db_err)?;
    if status == "paid" {
        return Err(ApiError::BadRequest(
            "cannot cancel a fully paid request".to_string(),
        ));
    }
    if status == "expired" || status == "cancelled" {
        return Err(ApiError::BadRequest(format!(
            "payment request is already {status}"
        )));
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("begin tx: {e}")))?;

    let refund_row = sqlx::query(
        r#"
        SELECT COALESCE(SUM(sp.amount), 0)::text AS refunded
        FROM payment_request_shares s
        JOIN payment_request_share_payments sp ON sp.share_id = s.id
        WHERE s.payment_request_id = $1
        "#,
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;

    let refunded: i128 = refund_row
        .try_get::<String, _>("refunded")
        .map_err(db_err)?
        .parse()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid refunded amount: {e}")))?;

    sqlx::query(
        r#"
        UPDATE payment_requests
        SET status = 'expired'
        WHERE id = $1
        "#,
    )
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("commit: {e}")))?;

    Ok(Json(CancelPaymentRequestResponse {
        payment_request_id: id.to_string(),
        status: "expired".to_string(),
        refunded_amount: refunded.to_string(),
    }))
}

// ── GET /v1/payment-requests ──────────────────────────────────────────────────

/// GET /v1/payment-requests
///
/// List the authenticated merchant's payment requests, most recent first.
/// Automatically expires any stale requests before returning.
async fn list_payment_requests(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<PaymentRequestSummary>>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let db_err = |e: sqlx::Error| ApiError::Internal(anyhow::anyhow!(e.to_string()));

    // Auto-expire all stale requests for this user in one shot.
    sqlx::query(
        r#"
        UPDATE payment_requests
        SET status = 'expired'
        WHERE user_id = $1
          AND status IN ('pending', 'partially_paid')
          AND expires_at < now()
        "#,
    )
    .bind(user_id.as_uuid())
    .execute(&pool)
    .await
    .map_err(db_err)?;

    let rows = sqlx::query(
        r#"
        SELECT
            pr.id,
            pr.requested_amount::text AS requested_amount,
            pr.asset,
            pr.status,
            pr.expires_at,
            pr.settled_at,
            pr.allow_partial,
            pr.created_at,
            COALESCE(SUM(pp.amount), 0)::text AS amount_paid
        FROM payment_requests pr
        LEFT JOIN payment_request_payments pp ON pp.payment_request_id = pr.id
        WHERE pr.user_id = $1
        GROUP BY pr.id
        ORDER BY pr.created_at DESC
        "#,
    )
    .bind(user_id.as_uuid())
    .fetch_all(&pool)
    .await
    .map_err(db_err)?;

    let summaries: Vec<PaymentRequestSummary> = rows
        .iter()
        .map(|row| {
            let row_id: Uuid = row.try_get("id").map_err(db_err)?;
            let requested_amount: String = row
                .try_get::<Option<String>, _>("requested_amount")
                .map_err(db_err)?
                .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("payment request has no amount")))?;
            let requested_minor: i128 = requested_amount
                .parse()
                .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid requested_amount: {e}")))?;
            let asset: String = row.try_get("asset").map_err(db_err)?;
            let status: String = row.try_get("status").map_err(db_err)?;
            let expires_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
                row.try_get("expires_at").map_err(db_err)?;
            let settled_at: Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>> =
                row.try_get("settled_at").map_err(db_err)?;
            let allow_partial: bool = row.try_get("allow_partial").map_err(db_err)?;
            let created_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
                row.try_get("created_at").map_err(db_err)?;
            let amount_paid: i128 = row
                .try_get::<String, _>("amount_paid")
                .map_err(db_err)?
                .parse()
                .map_err(|e| ApiError::Internal(anyhow::anyhow!("invalid amount_paid: {e}")))?;
            let amount_remaining = requested_minor.saturating_sub(amount_paid).max(0);

            Ok(PaymentRequestSummary {
                id: row_id.to_string(),
                requested_amount,
                asset,
                status,
                expires_at: expires_at.to_rfc3339(),
                settled_at: settled_at.map(|dt| dt.to_rfc3339()),
                allow_partial,
                amount_paid: amount_paid.to_string(),
                amount_remaining: amount_remaining.to_string(),
                created_at: created_at.to_rfc3339(),
                shares: Vec::new(),
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    // Attach shares for each summary.
    let mut summaries = summaries;
    for summary in &mut summaries {
        if let Ok(parsed) = Uuid::parse_str(&summary.id) {
            summary.shares = load_shares(&pool, parsed).await?;
        }
    }

    Ok(Json(summaries))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payment_entry_skips_none_fields_in_json() {
        let entry = PaymentEntry {
            id: "abc".to_string(),
            amount: "1000".to_string(),
            asset: "USDC".to_string(),
            chain: "internal".to_string(),
            tx_hash: None,
            payer_address: None,
            note: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert!(json.get("tx_hash").is_none());
        assert!(json.get("payer_address").is_none());
        assert!(json.get("note").is_none());
    }

    #[test]
    fn payment_entry_includes_optional_fields_when_set() {
        let entry = PaymentEntry {
            id: "abc".to_string(),
            amount: "1000".to_string(),
            asset: "USDC".to_string(),
            chain: "stellar".to_string(),
            tx_hash: Some("tx123".to_string()),
            payer_address: Some("GX...".to_string()),
            note: Some("payment for order 42".to_string()),
            created_at: "2024-01-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["tx_hash"], "tx123");
        assert_eq!(json["payer_address"], "GX...");
        assert_eq!(json["note"], "payment for order 42");
    }

    #[test]
    fn amount_remaining_never_goes_negative() {
        // Over-payment guard: saturating subtraction ensures 0 floor.
        let requested: i128 = 1000;
        let paid: i128 = 1500; // hypothetical
        let remaining = requested.saturating_sub(paid).max(0);
        assert_eq!(remaining, 0);
    }

    #[test]
    fn split_equal_evenly_divisible() {
        let shares = split_equal(1000, 4);
        assert_eq!(shares, vec![250, 250, 250, 250]);
        assert_eq!(shares.iter().sum::<i128>(), 1000);
    }

    #[test]
    fn split_equal_uneven_uses_largest_remainder() {
        // 1000 / 3 = 333 remainder 1 → first share gets the extra unit.
        let shares = split_equal(1000, 3);
        assert_eq!(shares, vec![334, 333, 333]);
        assert_eq!(shares.iter().sum::<i128>(), 1000);
    }

    #[test]
    fn split_equal_remainder_distributed_to_leading_shares() {
        // 10 / 4 = 2 remainder 2 → first two shares get +1.
        let shares = split_equal(10, 4);
        assert_eq!(shares, vec![3, 3, 2, 2]);
        assert_eq!(shares.iter().sum::<i128>(), 10);
    }

    #[test]
    fn split_equal_shares_always_sum_to_total() {
        for total in [1i128, 7, 99, 100, 12345] {
            for n in 1..=7usize {
                let shares = split_equal(total, n);
                assert_eq!(shares.len(), n);
                assert_eq!(
                    shares.iter().sum::<i128>(),
                    total,
                    "total={total} n={n} shares={shares:?}"
                );
            }
        }
    }

    #[test]
    fn split_equal_zero_payers_returns_empty() {
        assert!(split_equal(1000, 0).is_empty());
    }
}
