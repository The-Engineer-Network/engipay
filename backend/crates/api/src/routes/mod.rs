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
pub mod openapi;
pub mod payment_requests;
pub mod receipts_verify;
pub mod requests;
pub mod transactions;
pub mod transfers;
pub mod well_known;
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
        .merge(transactions::routes())
        .merge(requests::routes())
        .merge(payment_requests::routes())
        .merge(receipts_verify::routes())
        .merge(transfers::routes())
        .merge(well_known::routes())
        .merge(withdrawals::router())
}
