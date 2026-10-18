//! Wallet sign-in.
//!
//! `evm.rs` and `stellar.rs` are temporarily out of the build. They were merged
//! without compiling: they target an older `stellar-xdr` API (`TxV1`,
//! `MemoNone`, `KeyTypeEd25519`, `Transaction::time_bounds`), misuse
//! `ed25519-dalek` and `k256`, and use `sqlx::query!` macros, which need a live
//! database at build time that CI does not provide. The files are kept so the
//! work is not lost; see issues #99-#105 for the rewrite.
mod nonce;
mod user;

pub use user::AuthUser;

use crate::AppState;
use axum::http::StatusCode;
use axum::routing::post;
use axum::Router;

pub fn routes() -> Router<AppState> {
    Router::new()
        .merge(nonce::routes())
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
