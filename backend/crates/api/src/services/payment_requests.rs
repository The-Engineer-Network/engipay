use sqlx::PgPool;
use sqlx::Row;
use uuid::Uuid;

use crate::error::ApiError;

/// Settlement service for payment requests (#130).
/// When a transfer references a payment_request_id, mark it as settled.
pub async fn settle_payment_request(
    pool: &PgPool,
    payment_request_id: Uuid,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        UPDATE payment_requests
        SET status = 'paid', settled_at = now()
        WHERE id = $1 AND status = 'pending'
        "#,
    )
    .bind(payment_request_id)
    .execute(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    Ok(())
}

/// Expiry verification service for background cleanup task (#129).
/// Mark all stale (expired) payment requests as expired.
pub async fn mark_stale_requests_expired(pool: &PgPool) -> Result<u64, ApiError> {
    let result = sqlx::query(
        r#"
        UPDATE payment_requests
        SET status = 'expired'
        WHERE status = 'pending' AND expires_at < now()
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    Ok(result.rows_affected())
}

/// Verify that expired requests cannot be settled.
/// Returns true if request is still settleable (not expired or already paid).
pub async fn is_settleable(pool: &PgPool, payment_request_id: Uuid) -> Result<bool, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT status, expires_at FROM payment_requests
        WHERE id = $1
        "#,
    )
    .bind(payment_request_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    match row {
        Some(row) => {
            let expires_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> = row
                .try_get("expires_at")
                .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
            let is_expired = expires_at < sqlx::types::chrono::Utc::now();
            let is_pending: bool = row
                .try_get::<String, _>("status")
                .map(|status| status == "pending")
                .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
            Ok(is_pending && !is_expired)
        }
        None => Ok(false),
    }
}
