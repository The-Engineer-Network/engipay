use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::Row;
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

    let row = sqlx::query(
        r#"
        SELECT id, recipient_tag, requested_amount, asset, status, expires_at, settled_at
        FROM payment_requests
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?
    .ok_or(ApiError::NotFound)?;

    let db_err = |e: sqlx::Error| ApiError::Internal(anyhow::anyhow!(e.to_string()));

    let row_id: Uuid = row.try_get("id").map_err(db_err)?;
    let recipient_tag: Option<String> = row.try_get("recipient_tag").map_err(db_err)?;
    let requested_amount: i128 = row.try_get("requested_amount").map_err(db_err)?;
    let asset: String = row.try_get("asset").map_err(db_err)?;
    let row_status: String = row.try_get("status").map_err(db_err)?;
    let expires_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
        row.try_get("expires_at").map_err(db_err)?;
    let settled_at: Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>> =
        row.try_get("settled_at").map_err(db_err)?;

    // Check if request has expired and update status if necessary (#129)
    let status = if row_status == "pending" && expires_at < sqlx::types::chrono::Utc::now() {
        sqlx::query(
            r#"
            UPDATE payment_requests
            SET status = 'expired'
            WHERE id = $1 AND status = 'pending' AND expires_at < now()
            "#,
        )
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
        "expired".to_string()
    } else {
        row_status
    };

    Ok(Json(PaymentRequestResponse {
        id: row_id,
        recipient_tag,
        requested_amount: requested_amount.to_string(),
        asset,
        status,
        expires_at: expires_at.to_rfc3339(),
        settled_at: settled_at.map(|dt| dt.to_rfc3339()),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests skipped as per user request
}
