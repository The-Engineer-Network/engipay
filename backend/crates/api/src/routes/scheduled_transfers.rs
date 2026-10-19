//! Scheduled and recurring transfers, as seen by the signed-in sender.
//!
//! - `POST   /v1/scheduled-transfers`      create a one-off, weekly or monthly schedule
//! - `GET    /v1/scheduled-transfers`      list the caller's active schedules
//! - `DELETE /v1/scheduled-transfers/{id}` cancel one of the caller's schedules
//!
//! Sends happen in the scheduler (`services::scheduled_transfers::run_due`),
//! not here. A schedule can only be created for or cancelled by its sender.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use chrono::NaiveDate;
use engipay_core::{Asset, Money, UserId};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;
use crate::services::recipient::resolve_recipient;
use crate::services::scheduled_transfers::{self as sched, Cadence, ScheduleError};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/scheduled-transfers",
            post(create_schedule).get(list_schedules),
        )
        .route(
            "/scheduled-transfers/{id}",
            axum::routing::delete(cancel_schedule),
        )
}

#[derive(Debug, Deserialize)]
pub struct CreateScheduleRequest {
    /// Recipient, as for `POST /v1/transfers` (tag, email, id or wallet).
    pub recipient: String,
    pub asset: Asset,
    /// Amount as a decimal string, e.g. "12.5".
    pub amount: String,
    /// "once", "weekly" or "monthly".
    pub cadence: String,
    /// First occurrence, `YYYY-MM-DD`. Defaults to today (UTC).
    pub start_on: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ScheduleResponse {
    pub id: Uuid,
    pub recipient: String,
    pub asset: Asset,
    pub amount: String,
    pub cadence: String,
    pub next_run_on: String,
    pub status: String,
}

fn db_error(error: sqlx::Error) -> ApiError {
    ApiError::Internal(anyhow::anyhow!(
        "scheduled transfer database error: {error}"
    ))
}

fn schedule_error(error: ScheduleError) -> ApiError {
    match error {
        ScheduleError::Database(e) => db_error(e),
        other => ApiError::BadRequest(other.to_string()),
    }
}

async fn create_schedule(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateScheduleRequest>,
) -> Result<(StatusCode, Json<Uuid>), ApiError> {
    let sender = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let cadence = Cadence::parse(req.cadence.trim()).ok_or_else(|| {
        ApiError::BadRequest("cadence must be once, weekly or monthly".to_string())
    })?;
    let money = Money::parse(req.asset, req.amount.trim())
        .map_err(|_| ApiError::BadRequest("invalid amount".to_string()))?;

    let today = sched::today_utc();
    let start_on = match req.start_on.as_deref() {
        None => today,
        Some(text) => NaiveDate::parse_from_str(text.trim(), "%Y-%m-%d")
            .map_err(|_| ApiError::BadRequest("start_on must be YYYY-MM-DD".to_string()))?,
    };

    let recipient = resolve_recipient(pool, req.recipient.trim())
        .await
        .map_err(|_| ApiError::BadRequest("recipient not found".to_string()))?;

    let id = sched::create(
        pool,
        sender,
        UserId::from_uuid(recipient),
        money,
        cadence,
        start_on,
        today,
    )
    .await
    .map_err(schedule_error)?;

    Ok((StatusCode::CREATED, Json(id)))
}

async fn list_schedules(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<ScheduleResponse>>, ApiError> {
    let sender = auth.user_id(state.config.jwt_secret.as_bytes())?.as_uuid();
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let rows = sqlx::query(
        "SELECT id, recipient_id, asset, amount_minor::text AS amount, cadence, \
                next_run_on, status \
         FROM scheduled_transfers \
         WHERE sender_id = $1 AND status = 'active' \
         ORDER BY next_run_on, created_at",
    )
    .bind(sender)
    .fetch_all(pool)
    .await
    .map_err(db_error)?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let asset_text: String = row.try_get("asset").map_err(db_error)?;
        let asset = Asset::ALL
            .into_iter()
            .find(|a| a.symbol() == asset_text)
            .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("unknown asset {asset_text}")))?;
        let next: NaiveDate = row.try_get("next_run_on").map_err(db_error)?;
        out.push(ScheduleResponse {
            id: row.try_get("id").map_err(db_error)?,
            recipient: row
                .try_get::<Uuid, _>("recipient_id")
                .map_err(db_error)?
                .to_string(),
            asset,
            amount: row.try_get("amount").map_err(db_error)?,
            cadence: row.try_get("cadence").map_err(db_error)?,
            next_run_on: next.to_string(),
            status: row.try_get("status").map_err(db_error)?,
        });
    }
    Ok(Json(out))
}

async fn cancel_schedule(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let sender = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    if sched::cancel(pool, sender, id).await.map_err(db_error)? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cadence_parses_only_the_three_known_values() {
        assert_eq!(Cadence::parse("weekly"), Some(Cadence::Weekly));
        assert_eq!(Cadence::parse("daily"), None);
        assert_eq!(Cadence::parse(""), None);
    }
}
