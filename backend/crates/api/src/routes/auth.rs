//! Wallet sign-in.
//!
//! Live: sign-in with Ethereum, Stellar, and EVM-compatible chains.
//! - `nonce.rs` issues single-use nonces (valid for 5 minutes)
//! - `siwe.rs` verifies EIP-191 signed messages from Ethereum
//! - `evm.rs` verifies EIP-191 signed messages from EVM-compatible wallets
//! - `stellar.rs` verifies SEP-10 signed transactions from Stellar
mod evm;
mod nonce;
mod siwe;
mod stellar;
mod user;

pub use user::AuthUser;

use crate::AppState;
use axum::Router;
use axum::http::StatusCode;
use axum::routing::post;

pub fn routes() -> Router<AppState> {
    Router::new()
        .merge(nonce::routes())
        .merge(evm::routes())
        .merge(siwe::routes())
        .merge(stellar::routes())
        .route("/auth/logout", post(logout))
}

/// POST /v1/auth/logout - revoke the current session token
async fn logout(_auth: AuthUser) -> StatusCode {
    // TODO: Implement token revocation
    // For now, logout is a stateless operation since JWTs have no server-side state.
    // A future implementation would:
    // 1. Store the token's jti in a revocation list
    // 2. Check revocation list in AuthUser::verify
    StatusCode::NO_CONTENT
}
