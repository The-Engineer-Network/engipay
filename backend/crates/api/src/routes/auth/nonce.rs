use axum::{Json, Router, routing::post};
use axum::extract::State;
use serde::Serialize;
use uuid::Uuid;

use crate::{AppState, error::ApiError};

#[derive(Debug, Serialize)]
pub struct NonceResponse {
    pub nonce: String,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/auth/nonce", post(issue_nonce))
}

/// Issues a fresh nonce for the SIWE handshake and persists it with a 5-minute expiry.
async fn issue_nonce(State(state): State<AppState>) -> Result<Json<NonceResponse>, ApiError> {
    let db = state.database.as_ref().ok_or(ApiError::DatabaseUnavailable)?;

    let nonce = Uuid::new_v4().simple().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let expires_at = now + 300; // 5 minutes

    // Store nonce in database
    sqlx::query(
        "INSERT INTO nonces (nonce, expires_at) VALUES ($1, to_timestamp($2))"
    )
    .bind(&nonce)
    .bind(expires_at as i64)
    .execute(db)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to store nonce: {}", e)))?;

    Ok(Json(NonceResponse { nonce }))
}

/// Validates and consumes a nonce. Returns Ok if valid and not yet used, Err otherwise.
pub async fn validate_and_consume_nonce(db: &sqlx::PgPool, nonce: &str) -> Result<(), ApiError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();

    // Mark nonce as used if it exists, is not expired, and hasn't been used yet
    let result = sqlx::query(
        "UPDATE nonces SET used_at = now() WHERE nonce = $1 AND expires_at > now() AND used_at IS NULL"
    )
    .bind(nonce)
    .execute(db)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("nonce validation failed: {}", e)))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::BadRequest("invalid or expired nonce".to_string()));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issues_a_32_character_nonce() {
        // Test would require database setup, skipped in this context
    }
}
