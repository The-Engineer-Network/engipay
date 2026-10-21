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
}

// ── Routes ────────────────────────────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/payment-requests/{id}", get(get_payment_request))
        .route("/payment-requests/{id}/pay", post(record_payment))
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
    })
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
    let tx_hash = payload
        .tx_hash
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
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
    .bind(
        payload
            .payer_address
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(
        payload
            .note
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        if e.to_string()
            .contains("idx_payment_request_payments_tx_hash")
        {
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

    let amount_remaining = requested_amount.saturating_sub(new_amount_paid).max(0);

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
                .ok_or_else(|| {
                    ApiError::Internal(anyhow::anyhow!("payment request has no amount"))
                })?;
            let requested_minor: i128 = requested_amount.parse().map_err(|e| {
                ApiError::Internal(anyhow::anyhow!("invalid requested_amount: {e}"))
            })?;
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
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

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
}
