pub mod assets;
pub mod auth;
pub mod balances;
pub mod bank_accounts;
pub mod buy;
pub mod convert;
pub mod deposits;
pub mod health;
pub mod kyc;
pub mod me;
pub mod metrics;
pub mod notifications;
pub mod openapi;
pub mod payment_requests;
pub mod requests;
pub mod scheduled_transfers;
pub mod transactions;
pub mod transfers;
pub mod wallets;
pub mod withdrawals;

use axum::Router;

use crate::AppState;

/// Versioned routes. A breaking change becomes /v2 instead of surprising the app.
pub fn v1() -> Router<AppState> {
    Router::new()
        .merge(assets::routes())
        .merge(buy::routes())
        .merge(bank_accounts::routes())
        .merge(auth::routes())
        .merge(balances::routes())
        .merge(convert::routes())
        .merge(deposits::routes())
        .merge(kyc::routes())
        .merge(me::routes())
        .merge(notifications::routes())
        .merge(transactions::routes())
        .merge(requests::routes())
        .merge(payment_requests::routes())
        .merge(transfers::routes())
        .merge(scheduled_transfers::routes())
        .merge(wallets::routes())
        .merge(withdrawals::router())
}
