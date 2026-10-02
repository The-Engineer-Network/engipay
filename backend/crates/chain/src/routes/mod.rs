//! The chain service's internal HTTP API.
//!
//! Everything here is `/internal/*`: the surface the API service calls to reach
//! the one process that can talk to a network. It is not exposed to browsers,
//! and it is mounted separately from the public `/v1` API on purpose — a
//! compromise of the API service must not automatically become a compromise of
//! the fee quoter and, later, of the signer.

use std::sync::Arc;

use axum::Router;
use axum::routing::post;

pub mod estimate_fee;

use crate::routes::estimate_fee::FeeOracle;

/// State every internal route receives.
#[derive(Clone)]
pub struct ChainHttpState {
    /// Where live fee data comes from. Behind a trait object so the handler can
    /// be tested without a node or an indexer.
    pub fees: Arc<dyn FeeOracle>,
}

impl ChainHttpState {
    pub fn new(fees: Arc<dyn FeeOracle>) -> Self {
        Self { fees }
    }
}

/// The chain service's router.
pub fn router(fees: Arc<dyn FeeOracle>) -> Router {
    Router::new().merge(internal(ChainHttpState::new(fees)))
}

/// Routes only the API service may call.
fn internal(state: ChainHttpState) -> Router {
    Router::new()
        .route("/internal/estimate-fee", post(estimate_fee::estimate_fee))
        .with_state(state)
}
