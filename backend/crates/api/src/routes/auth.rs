//! Wallet sign-in.
//!
//! Live: sign-in with Ethereum, Stellar, and EVM-compatible chains.
//! - `nonce.rs` issues single-use nonces (valid for 5 minutes)
//! - `siwe.rs` verifies EIP-191 signed messages from Ethereum and EVM-compatible wallets
//! - `stellar.rs` verifies SEP-10 signed transactions from Stellar
mod nonce;
mod siwe;
mod stellar;
mod user;

pub use user::AuthUser;

use crate::AppState;
use crate::error::ApiError;
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;

pub fn routes() -> Router<AppState> {
    Router::new()
        .merge(nonce::routes())
        .merge(siwe::routes())
        .merge(stellar::routes())
        .route("/auth/logout", post(logout))
}

/// POST /v1/auth/logout — add the token's `jti` to the revocation list.
///
/// After this call the same bearer token will be rejected with 401 on every
/// subsequent authenticated request, regardless of its remaining lifetime.
async fn logout(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<StatusCode, ApiError> {
    let claims = auth.verify(state.config.jwt_secret.as_bytes())?;

    if let (Some(jti), Some(ref pool)) = (claims.jti, state.database.as_ref()) {
        // Prune already-expired rows on each insert to avoid unbounded growth.
        sqlx::query("DELETE FROM revoked_tokens WHERE expires_at < NOW()")
            .execute(pool)
            .await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("revocation cleanup failed: {e}")))?;

        let expires_at = chrono::DateTime::<chrono::Utc>::from_timestamp(claims.exp, 0)
            .unwrap_or_else(chrono::Utc::now);
        sqlx::query("INSERT INTO revoked_tokens (jti, expires_at) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(jti.to_string())
            .bind(expires_at)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("token revocation failed: {e}")))?;
    }

    Ok(StatusCode::NO_CONTENT)
}