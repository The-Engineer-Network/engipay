pub mod assets;
pub mod auth;
pub mod balances;
pub mod bank_accounts;
pub mod buy;
pub mod convert;
pub mod deposits;
pub mod health;
pub mod quotes;
pub mod settles;

use axum::Router;

use crate::AppState;

/// Versioned routes. A breaking change becomes /v2 instead of surprising the app.
pub fn v1() -> Router<AppState> {
    Router::new()
        .merge(assets::routes())
        .merge(quotes::routes())
        .merge(settles::routes())
}
