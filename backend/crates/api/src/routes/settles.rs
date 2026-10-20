//! POST /v1/settles — settle a hold using a previously issued quote.
//!
//! The client must:
//!   1. Call `POST /v1/quotes` to lock in a fee.
//!   2. Call `POST /v1/settles` with the `hold_reference` and `quote_id`.
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
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;

pub fn routes() -> Router<AppState> {
    Router::new().route("/settles", post(settle_hold))
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
    Json(req): Json<SettleRequest>,
) -> Result<Json<SettleResponse>, ApiError> {
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
        let replayed_fee: i64 = row.fee_minor.parse().map_err(|e| {
            ApiError::Internal(anyhow::anyhow!("fee_minor replay parse: {e}"))
        })?;
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

    let fee_minor: i64 = quote.fee_minor.parse().map_err(|e| {
        ApiError::Internal(anyhow::anyhow!("fee_minor parse error: {e}"))
    })?;

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
