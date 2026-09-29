pub mod assets;
pub mod auth;
pub mod balances;
pub mod health;
pub mod me;

use axum::Router;

use crate::AppState;

/// Versioned routes. A breaking change becomes /v2 instead of surprising the app.
pub fn v1() -> Router<AppState> {
    Router::new()
        .merge(assets::routes())
        .merge(auth::routes())
        .merge(balances::routes())
}
