//! `POST /v1/payment-requests/{id}/cancel`: the owner cancels an open request.

use axum::Json;
use axum::extract::{Path, State};
use serde::Serialize;
use sqlx::Row;
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

#[derive(Debug, Serialize)]
pub struct CancelPaymentRequestResponse {
    pub id: String,
    pub status: String,
}

/// Whether a request in `status` may be cancelled; `Err` carries the reason.
pub fn check_cancellable(status: &str) -> Result<(), String> {
    match status {
        "pending" => Ok(()),
        "partially_paid" => {
            Err("payment request is partially paid and cannot be cancelled".to_string())
        }
        other => Err(format!("payment request is {other}, not open")),
    }
}

pub async fn cancel_payment_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<CancelPaymentRequestResponse>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;
    let db_err = |e: sqlx::Error| ApiError::Internal(anyhow::anyhow!(e.to_string()));

    // Atomic: only a pending (no payments yet) request owned by the caller flips.
    let updated = sqlx::query(
        "UPDATE payment_requests SET status = 'cancelled' \
         WHERE id = $1 AND user_id = $2 AND status = 'pending' AND expires_at >= now() \
         RETURNING id",
    )
    .bind(id)
    .bind(user_id.as_uuid())
    .fetch_optional(&pool)
    .await
    .map_err(db_err)?;

    if updated.is_some() {
        return Ok(Json(CancelPaymentRequestResponse {
            id: id.to_string(),
            status: "cancelled".to_string(),
        }));
    }

    // Not updated: distinguish missing/not-owner from not-cancellable.
    let row = sqlx::query("SELECT status, expires_at < now() AS expired FROM payment_requests WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id.as_uuid())
        .fetch_optional(&pool)
        .await
        .map_err(db_err)?
        .ok_or(ApiError::NotFound)?;
    let status: String = row.try_get("status").map_err(db_err)?;
    let expired: bool = row.try_get("expired").map_err(db_err)?;
    let status = if expired && status == "pending" { "expired".to_string() } else { status };
    match check_cancellable(&status) {
        Err(msg) => Err(ApiError::BadRequest(msg)),
        Ok(()) => Err(ApiError::Conflict("payment request could not be cancelled".to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_pending_requests_can_be_cancelled() {
        assert!(check_cancellable("pending").is_ok());
    }

    #[test]
    fn partially_paid_is_refused() {
        assert!(check_cancellable("partially_paid").unwrap_err().contains("partially paid"));
    }

    #[test]
    fn closed_states_are_refused() {
        for s in ["paid", "expired", "cancelled"] {
            assert!(check_cancellable(s).is_err());
        }
    }
}
