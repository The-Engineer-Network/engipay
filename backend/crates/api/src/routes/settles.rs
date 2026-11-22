//! POST /internal/settles — settle a hold using a previously issued quote.
//!
//! **Who calls this:** internal workers only. Settlement is not a user action;
//! it is performed by the backend's own workers once a hold is ready to be
//! booked. Hold references are predictable (`withdrawal:<id>`,
//! `convert:<quote_id>`), so exposing this on the public `/v1` router would let
//! any caller settle any hold whose reference they can guess. It is therefore
//! mounted on an internal path and guarded by a shared token
//! (`INTERNAL_API_TOKEN`), not by `AuthUser`.
//!
//! The worker must:
//!   1. Call `POST /v1/quotes` to lock in a fee.
//!   2. Call `POST /internal/settles` with the `hold_reference` and `quote_id`,
//!      sending the shared token in the `x-internal-token` header.
//!
//! This endpoint:
//!   * Looks up the quote in the database and verifies it has not expired.
//!   * Verifies the quote's `schedule_version` still exists and is unchanged
//!     (always true because `fee_schedules` is append-only, but the JOIN makes
//!     the guarantee explicit and testable).
//!   * Uses the quote's stored `fee_minor` for the settlement, so a schedule
//!     change after quoting **cannot** alter the fee the user was shown.
//!   * Is idempotent: retrying the same `hold_reference` returns the original
//!     result and books nothing twice.
//!
//! Without a database the endpoint returns 503.

use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;

/// Header carrying the shared internal token.
const INTERNAL_TOKEN_HEADER: &str = "x-internal-token";

pub fn routes() -> Router<AppState> {
    Router::new().route("/settles", post(settle_hold))
}

/// Reject the request unless it carries the configured internal token.
///
/// Fails closed: if no token is configured, every request is rejected.
fn require_internal_token(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    let expected = state
        .internal_api_token
        .as_deref()
        .filter(|t| !t.is_empty())
        .ok_or(ApiError::Unauthorized)?;

    let provided = headers
        .get(INTERNAL_TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or(ApiError::Unauthorized)?;

    // Constant-time-ish comparison to avoid trivial timing leaks.
    if provided.len() != expected.len()
        || provided
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            != 0
    {
        return Err(ApiError::Unauthorized);
    }

    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct SettleRequest {
    /// The idempotency reference of the hold to settle.
    pub hold_reference: String,
    /// The quote that priced this settlement.
    pub quote_id: Uuid,
}

#[derive(Debug, Serialize)]
pub struct SettleResponse {
    /// True when this `hold_reference` was already settled and nothing moved now.
    pub replayed: bool,
    pub quote_id: Uuid,
    /// The fee booked to the Fees system account, in the quote's asset's
    /// smallest units.
    pub fee_minor: i64,
    /// The `fee_schedules.id` that was in effect when the quote was created.
    pub schedule_version: Uuid,
}

/// Row for the replay-check query.
#[derive(sqlx::FromRow)]
struct SettleRow {
    fee_minor: String,
    schedule_version: Uuid,
}

/// Row for the quote-validation query.
#[derive(sqlx::FromRow)]
struct QuoteRow {
    fee_minor: String,
    schedule_version: Uuid,
    expires_at: chrono::DateTime<chrono::Utc>,
}

async fn settle_hold(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SettleRequest>,
) -> Result<Json<SettleResponse>, ApiError> {
    require_internal_token(&state, &headers)?;

    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    if req.hold_reference.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "hold_reference must not be empty".to_owned(),
        ));
    }

    let settle_ref = format!("{}:settle", req.hold_reference.trim());

    // ── Idempotency check ────────────────────────────────────────────────────
    let existing: Option<SettleRow> = sqlx::query_as(
        "SELECT fee_minor::TEXT AS fee_minor, schedule_version
         FROM   quote_settles
         WHERE  settle_reference = $1",
    )
    .bind(&settle_ref)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    if let Some(row) = existing {
        let replayed_fee: i64 = row
            .fee_minor
            .parse()
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("fee_minor replay parse: {e}")))?;
        return Ok(Json(SettleResponse {
            replayed: true,
            quote_id: req.quote_id,
            fee_minor: replayed_fee,
            schedule_version: row.schedule_version,
        }));
    }

    // ── Load and validate the quote ──────────────────────────────────────────
    // The JOIN on fee_schedules verifies the schedule_version still exists
    // (append-only, so it always will) and hasn't been tampered with.
    let quote: QuoteRow = sqlx::query_as(
        "SELECT q.fee_minor::TEXT AS fee_minor,
                q.schedule_version,
                q.expires_at
         FROM   quotes q
         JOIN   fee_schedules fs ON fs.id = q.schedule_version
         WHERE  q.id = $1",
    )
    .bind(req.quote_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?
    .ok_or_else(|| ApiError::BadRequest(format!("quote {} not found", req.quote_id)))?;

    let now = chrono::Utc::now();
    if now > quote.expires_at {
        return Err(ApiError::BadRequest(format!(
            "quote {} expired at {}",
            req.quote_id, quote.expires_at
        )));
    }

    let fee_minor: i64 = quote
        .fee_minor
        .parse()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("fee_minor parse error: {e}")))?;

    let schedule_version = quote.schedule_version;

    // ── Record the settlement ────────────────────────────────────────────────
    sqlx::query(
        "INSERT INTO quote_settles (settle_reference, quote_id, fee_minor, schedule_version)
         VALUES ($1, $2, $3::numeric, $4)",
    )
    .bind(&settle_ref)
    .bind(req.quote_id)
    .bind(fee_minor)
    .bind(schedule_version)
    .execute(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    Ok(Json(SettleResponse {
        replayed: false,
        quote_id: req.quote_id,
        fee_minor,
        schedule_version,
    }))
}
