//! Wallet sign-in.
//!
//! Live: sign-in with an Ethereum wallet (`nonce.rs` issues a single-use nonce,
//! `siwe.rs` verifies the signed message and issues a session token).
//!
//! Not live: `stellar.rs` (SEP-10) and the older `evm.rs` are out of the build.
//! They target an older `stellar-xdr` API and use `sqlx::query!` macros, which
//! need a live database at build time that CI does not provide. The files are
//! kept so the work is not lost; see issues #99-#105 for the rewrite.
mod nonce;
pub(crate) mod siwe;
mod user;

pub use user::AuthUser;

use crate::AppState;
use axum::Router;
use axum::http::StatusCode;
use axum::routing::post;

pub fn routes() -> Router<AppState> {
    Router::new()
        .merge(nonce::routes())
        .merge(siwe::routes())
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
