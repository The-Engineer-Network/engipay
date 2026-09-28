mod evm;
mod user;
mod stellar;

pub use user::AuthUser;

use axum::Router;
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .merge(evm::routes())
        .merge(stellar::routes())
}
