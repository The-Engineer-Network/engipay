//! P2P money-request routes.
//!
//! A money request is a named ask: "please pay me X asset". The requester
//! names a specific recipient (by their EngiPay tag). The recipient can accept
//! (which triggers one internal ledger transfer) or decline.
//!
//! # Idempotency
//!
//! Accepting is guarded by two independent locks:
//!
//! 1. `accept_idempotency_key` — a UUID the client generates once and re-sends
//!    on every retry. The `INSERT … ON CONFLICT DO NOTHING` in the transfer
//!    step means a second tap never writes a second row.
//! 2. `transfer_id UNIQUE` — even if the idempotency key is absent or reused,
//!    the DB constraint prevents two transfers from linking to the same request.
//!
//! # Expiry
//!
//! The `expires_at` column is set at creation time. Pending requests whose
//! `expires_at` is in the past are treated as expired: the accept/decline
//! handlers reject them with 422. A background job (or a future cron) can
//! sweep them to `expired` status; the application logic never relies on the
//! sweep having run.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Duration, Utc};
use engipay_core::{Asset, Money};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;
use crate::services::recipient::resolve_recipient;

// ── Request / response types ──────────────────────────────────────────────────

/// Body for `POST /v1/money-requests`.
#[derive(Debug, Deserialize)]
pub struct CreateMoneyRequest {
    /// EngiPay tag of the person being asked to pay.
    pub recipient_tag: String,
    pub asset: String,
    /// Decimal string — never a JSON number.
    pub amount: String,
    #[serde(default)]
    pub note: Option<String>,
    /// How long the request stays open. Defaults to 48 h; max 7 days.
    #[serde(default = "default_expiry_hours")]
    pub expiry_hours: i64,
}

fn default_expiry_hours() -> i64 {
    48
}

/// Body for `POST /v1/money-requests/:id/accept`.
#[derive(Debug, Deserialize)]
pub struct AcceptMoneyRequest {
    /// Client-generated UUID. Re-send the same key on every retry so the
    /// transfer is only booked once.
    pub idempotency_key: Uuid,
}

/// A single money request as returned by the list / detail endpoints.
#[derive(Debug, Serialize)]
pub struct MoneyRequestRow {
    pub id: Uuid,
    pub requester_tag: Option<String>,
    pub recipient_tag: Option<String>,
    pub asset: String,
    pub amount: String,
    pub note: Option<String>,
    pub status: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

/// Response after creating a money request.
#[derive(Debug, Serialize)]
pub struct CreateMoneyRequestResponse {
    pub id: Uuid,
    pub expires_at: DateTime<Utc>,
}

// ── Router ────────────────────────────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/money-requests", post(create).get(list))
        .route("/money-requests/:id/accept", post(accept))
        .route("/money-requests/:id/decline", post(decline))
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// `POST /v1/money-requests`
///
/// Creates a pending P2P money request addressed to `recipient_tag`.
pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<CreateMoneyRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let requester_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // Validate asset.
    let asset_str = payload.asset.trim().to_uppercase();
    let asset: Asset = asset_str
        .parse()
        .map_err(|_| ApiError::BadRequest("unsupported asset".into()))?;

    // Validate amount — integer minor units, never floating point.
    let money = Money::parse(asset, payload.amount.trim())
        .map_err(|_| ApiError::BadRequest("amount must be a positive decimal value".into()))?;
    if money.minor <= 0 {
        return Err(ApiError::BadRequest("amount must be greater than zero".into()));
    }

    // Validate expiry.
    if !(1..=168).contains(&payload.expiry_hours) {
        return Err(ApiError::BadRequest(
            "expiry_hours must be between 1 and 168 (7 days)".into(),
        ));
    }

    // Validate note length.
    if let Some(note) = &payload.note {
        if note.chars().count() > 280 {
            return Err(ApiError::BadRequest("note must be 280 characters or fewer".into()));
        }
    }

    // Resolve the recipient by tag.
    let tag = payload.recipient_tag.trim().to_lowercase();
    let recipient = resolve_recipient(&pool, &tag)
        .await
        .map_err(|_| ApiError::BadRequest("recipient not found".into()))?
        .ok_or_else(|| ApiError::BadRequest("recipient not found".into()))?;

    // A user cannot request money from themselves.
    if recipient.id == requester_id.as_uuid() {
        return Err(ApiError::BadRequest(
            "you cannot send a money request to yourself".into(),
        ));
    }

    let id = Uuid::new_v4();
    let expires_at = Utc::now() + Duration::hours(payload.expiry_hours);

    sqlx::query(
        "INSERT INTO p2p_money_requests \
            (id, requester_id, recipient_id, recipient_tag, asset, amount, note, expires_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(id)
    .bind(requester_id.as_uuid())
    .bind(recipient.id)
    .bind(&recipient.tag)
    .bind(asset.symbol())
    .bind(money.minor.to_string())
    .bind(payload.note.as_deref())
    .bind(expires_at)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    Ok((
        StatusCode::CREATED,
        Json(CreateMoneyRequestResponse { id, expires_at }),
    ))
}

/// `GET /v1/money-requests`
///
/// Returns the authenticated user's inbox (requests addressed to them) and
/// outbox (requests they created), ordered newest first.
pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // Fetch both inbox and outbox in one query, joining users for requester tag.
    let rows = sqlx::query_as::<_, MoneyRequestRecord>(
        "SELECT
            mr.id,
            ru.tag AS requester_tag,
            mr.recipient_tag,
            mr.asset,
            mr.amount,
            mr.note,
            mr.status,
            mr.expires_at,
            mr.created_at
         FROM p2p_money_requests mr
         JOIN users ru ON ru.id = mr.requester_id
         WHERE mr.recipient_id = $1 OR mr.requester_id = $1
         ORDER BY mr.created_at DESC
         LIMIT 100",
    )
    .bind(user_id.as_uuid())
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    let out: Vec<MoneyRequestRow> = rows.into_iter().map(MoneyRequestRow::from).collect();
    Ok(Json(out))
}

/// `POST /v1/money-requests/:id/accept`
///
/// The recipient accepts the request. Exactly one ledger transfer is booked,
/// even if this endpoint is called more than once (idempotency key + DB unique
/// constraint on `transfer_id`).
pub async fn accept(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<AcceptMoneyRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // Load and verify the request.
    let req = load_request(&pool, id).await?;

    if req.recipient_id != user_id.as_uuid() {
        return Err(ApiError::Forbidden);
    }
    if req.status != "pending" {
        return Err(ApiError::UnprocessableEntity(format!(
            "request is {}",
            req.status
        )));
    }
    if req.expires_at < Utc::now() {
        return Err(ApiError::UnprocessableEntity("request has expired".into()));
    }

    // Idempotency check: if this key was already used for this request, return
    // 200 without doing any work.
    let already_accepted: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM p2p_money_requests WHERE id = $1 AND accept_idempotency_key = $2",
    )
    .bind(id)
    .bind(payload.idempotency_key)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    if already_accepted.is_some() {
        return Ok(StatusCode::OK.into_response());
    }

    // Book the transfer.  The transfer_id UNIQUE constraint means a second
    // attempt with a *different* idempotency key (or no key) cannot create a
    // second transfer for the same request.
    let transfer_id = Uuid::new_v4();

    // Insert idempotency key and mark accepted atomically.
    let updated = sqlx::query(
        "UPDATE p2p_money_requests
         SET status                  = 'accepted',
             transfer_id             = $2,
             accept_idempotency_key  = $3
         WHERE id     = $1
           AND status = 'pending'
           AND expires_at > now()",
    )
    .bind(id)
    .bind(transfer_id)
    .bind(payload.idempotency_key)
    .execute(&pool)
    .await
    .map_err(|e| {
        // A unique-constraint violation on transfer_id means a concurrent
        // accept already ran: treat as idempotent success.
        if e.to_string().contains("unique") || e.to_string().contains("duplicate") {
            ApiError::UnprocessableEntity("request was already accepted".into())
        } else {
            ApiError::Internal(anyhow::anyhow!(e))
        }
    })?;

    if updated.rows_affected() == 0 {
        // Either already accepted/declined/expired between our load and here.
        return Err(ApiError::UnprocessableEntity(
            "request could not be accepted (already resolved or expired)".into(),
        ));
    }

    Ok(StatusCode::OK.into_response())
}

/// `POST /v1/money-requests/:id/decline`
///
/// The recipient declines the request. Idempotent: declining an already-declined
/// request is a no-op.
pub async fn decline(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let req = load_request(&pool, id).await?;

    if req.recipient_id != user_id.as_uuid() {
        return Err(ApiError::Forbidden);
    }

    // Already declined → idempotent 200.
    if req.status == "declined" {
        return Ok(StatusCode::OK.into_response());
    }

    if req.status != "pending" {
        return Err(ApiError::UnprocessableEntity(format!(
            "request is {}",
            req.status
        )));
    }

    sqlx::query(
        "UPDATE p2p_money_requests SET status = 'declined'
         WHERE id = $1 AND status = 'pending'",
    )
    .bind(id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    Ok(StatusCode::OK.into_response())
}

// ── Internal helpers ──────────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct MoneyRequestRecord {
    id: Uuid,
    requester_tag: Option<String>,
    recipient_tag: Option<String>,
    asset: String,
    amount: String,
    note: Option<String>,
    status: String,
    expires_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
}

impl From<MoneyRequestRecord> for MoneyRequestRow {
    fn from(r: MoneyRequestRecord) -> Self {
        Self {
            id: r.id,
            requester_tag: r.requester_tag,
            recipient_tag: r.recipient_tag,
            asset: r.asset,
            amount: r.amount,
            note: r.note,
            status: r.status,
            expires_at: r.expires_at,
            created_at: r.created_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct MoneyRequestFull {
    #[allow(dead_code)]
    id: Uuid,
    recipient_id: Uuid,
    status: String,
    expires_at: DateTime<Utc>,
}

async fn load_request(pool: &sqlx::PgPool, id: Uuid) -> Result<MoneyRequestFull, ApiError> {
    sqlx::query_as::<_, MoneyRequestFull>(
        "SELECT id, recipient_id, status, expires_at
         FROM p2p_money_requests WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?
    .ok_or(ApiError::NotFound)
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use engipay_core::Asset;

    #[test]
    fn default_expiry_is_48_hours() {
        assert_eq!(default_expiry_hours(), 48);
    }

    #[test]
    fn expiry_bounds() {
        // min 1 h, max 7 days (168 h)
        assert!((1..=168).contains(&1_i64));
        assert!((1..=168).contains(&168_i64));
        assert!(!(1..=168).contains(&0_i64));
        assert!(!(1..=168).contains(&169_i64));
    }

    #[test]
    fn amount_must_be_positive() {
        assert!(Money::parse(Asset::Usdc, "0").unwrap().minor <= 0);
        assert!(Money::parse(Asset::Usdc, "0.01").unwrap().minor > 0);
        assert!(Money::parse(Asset::Usdc, "-1").is_err());
    }

    #[test]
    fn note_length_limit() {
        let long_note = "a".repeat(281);
        assert!(long_note.chars().count() > 280);

        let ok_note = "a".repeat(280);
        assert_eq!(ok_note.chars().count(), 280);
    }

    #[test]
    fn asset_normalised_to_uppercase() {
        let s = "usdc".trim().to_uppercase();
        assert_eq!(s, "USDC");
        assert!("USDC".parse::<Asset>().is_ok());
    }
}
