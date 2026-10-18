//! Wallet sign-in.

mod evm;
mod nonce;
mod stellar;
mod user;

pub use user::AuthUser;

use crate::AppState;
use axum::Router;

pub fn routes() -> Router<AppState> {
    Router::new()
        .merge(nonce::routes())
        .merge(evm::routes())
        .merge(stellar::routes())
}
