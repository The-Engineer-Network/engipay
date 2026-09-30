pub mod assets;
pub mod auth;
pub mod balances;
pub mod deposits;
pub mod health;
pub mod me;
pub mod requests;
pub mod transactions;
pub mod transfers;

use axum::Router;

use crate::AppState;

/// Versioned routes. A breaking change becomes /v2 instead of surprising the app.
pub fn v1() -> Router<AppState> {
    Router::new()
        .merge(assets::routes())
        .merge(auth::routes())
        .merge(balances::routes())
        .merge(transactions::routes())
        .merge(deposits::routes())
        .merge(requests::routes())
        .merge(transfers::routes())
}
