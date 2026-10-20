use axum::extract::State;
use axum::{Json, Router, routing::post};
use serde::Serialize;
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;

/// How long a nonce can be used after it is issued.
pub const NONCE_LIFETIME: &str = "5 minutes";

#[derive(Debug, Serialize)]
pub struct NonceResponse {
    pub nonce: String,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/auth/nonce", post(issue_nonce))
}

/// POST /v1/auth/nonce - issue a single-use nonce for wallet sign-in.
/// The nonce is stored, so a sign-in can only use one that was issued here.
async fn issue_nonce(State(state): State<AppState>) -> Result<Json<NonceResponse>, ApiError> {
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let nonce = Uuid::new_v4().simple().to_string();
    sqlx::query("INSERT INTO auth_nonces (nonce, expires_at) VALUES ($1, now() + $2::interval)")
        .bind(&nonce)
        .bind(NONCE_LIFETIME)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to store nonce: {}", e)))?;

    Ok(Json(NonceResponse { nonce }))
}
