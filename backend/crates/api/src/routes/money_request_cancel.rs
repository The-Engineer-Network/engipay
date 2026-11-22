//! `POST /v1/money-requests/:id/cancel` — the requester withdraws a pending request (#695).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

/// What the requester may do with a request in a given state.
#[derive(Debug, PartialEq, Eq)]
pub enum CancelOutcome {
    Cancel,
    AlreadyCancelled,
    Refuse(String),
}

/// Decide the cancel outcome from the stored status.
pub fn cancel_outcome(status: &str) -> CancelOutcome {
    match status {
        "pending" => CancelOutcome::Cancel,
        "cancelled" => CancelOutcome::AlreadyCancelled,
        other => CancelOutcome::Refuse(format!("request is {other}")),
    }
}

pub async fn cancel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let row: Option<(Uuid, String)> =
        sqlx::query_as("SELECT requester_id, status FROM p2p_money_requests WHERE id = $1")
            .bind(id)
            .fetch_optional(&pool)
            .await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    let (requester_id, status) = row.ok_or(ApiError::NotFound)?;

    if requester_id != user_id.as_uuid() {
        return Err(ApiError::Forbidden);
    }

    match cancel_outcome(&status) {
        CancelOutcome::AlreadyCancelled => return Ok(StatusCode::OK),
        CancelOutcome::Refuse(msg) => return Err(ApiError::UnprocessableEntity(msg)),
        CancelOutcome::Cancel => {}
    }

    // The status guard makes this race-safe against a concurrent accept.
    let updated = sqlx::query(
        "UPDATE p2p_money_requests SET status = 'cancelled' \
         WHERE id = $1 AND status = 'pending'",
    )
    .bind(id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    if updated.rows_affected() == 0 {
        return Err(ApiError::UnprocessableEntity(
            "request could not be cancelled (already resolved)".into(),
        ));
    }
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_can_be_cancelled() {
        assert_eq!(cancel_outcome("pending"), CancelOutcome::Cancel);
    }

    #[test]
    fn cancelled_is_idempotent() {
        assert_eq!(cancel_outcome("cancelled"), CancelOutcome::AlreadyCancelled);
    }

    #[test]
    fn resolved_requests_are_refused() {
        for s in ["accepted", "declined", "expired"] {
            assert_eq!(cancel_outcome(s), CancelOutcome::Refuse(format!("request is {s}")));
        }
    }
}
