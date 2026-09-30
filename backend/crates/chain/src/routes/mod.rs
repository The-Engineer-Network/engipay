//! Internal HTTP routes served by the chain service.
//!
//! These endpoints are not exposed to the public internet. They are called
//! by the API service over a private network channel (loopback or container
//! networking) so it can obtain chain-specific data — such as fee estimates —
//! without holding any signing keys itself.

pub mod estimate_fee;

use axum::Router;

/// Mounts all internal routes under `/internal`.
pub fn internal() -> Router {
    Router::new().merge(estimate_fee::routes())
}
