use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaymentRequestResponse {
    pub id: Uuid,
    pub recipient_tag: Option<String>,
    pub requested_amount: String,
    pub asset: String,
    pub status: String,
    pub expires_at: String,
    pub settled_at: Option<String>,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/payment-requests/:id", get(get_payment_request))
}

/// Get a payment request by ID. No authentication required so external payers
/// can inspect invoice details. Checks if the request has expired.
async fn get_payment_request(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<PaymentRequestResponse>, ApiError> {
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let row = sqlx::query!(
        r#"
        SELECT id, recipient_tag, requested_amount, asset, status, expires_at, settled_at
        FROM payment_requests
        WHERE id = $1
        "#,
        id
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
    .ok_or(ApiError::NotFound)?;

    // Check if request has expired and update status if necessary (#129)
    let status = if row.status == "pending" && row.expires_at < sqlx::types::chrono::Utc::now() {
        sqlx::query!(
            r#"
            UPDATE payment_requests
            SET status = 'expired'
            WHERE id = $1 AND status = 'pending' AND expires_at < now()
            "#,
            id
        )
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
        "expired".to_string()
    } else {
        row.status
    };

    Ok(Json(PaymentRequestResponse {
        id: row.id,
        recipient_tag: row.recipient_tag,
        requested_amount: row.requested_amount.to_string(),
        asset: row.asset,
        status,
        expires_at: row.expires_at.to_rfc3339(),
        settled_at: row.settled_at.map(|dt| dt.to_rfc3339()),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests skipped as per user request
}
