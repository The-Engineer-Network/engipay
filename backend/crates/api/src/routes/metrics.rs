//! `GET /metrics` — Prometheus text exposition of API service metrics.
//!
//! This endpoint is mounted at the top level, outside `/v1`, so it is never
//! reachable through the public API prefix and is not included in the OpenAPI
//! spec.  It is intended for internal scraping by Prometheus or a compatible
//! system.

use axum::Router;
use axum::response::IntoResponse;
use axum::routing::get;

use crate::AppState;

/// Registers the `GET /metrics` route.
pub fn routes() -> Router<AppState> {
    Router::new().route("/metrics", get(handler))
}

async fn handler() -> impl IntoResponse {
    (
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        crate::metrics::render(),
    )
}
