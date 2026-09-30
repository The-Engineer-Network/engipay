//! EngiPay HTTP API.
//!
//! Routes live here rather than in `main.rs` so tests can drive the real router
//! without opening a socket.

pub mod auth;
pub mod config;
pub mod error;
pub mod middleware;
mod routes;
pub mod services;

pub use routes::me::{ValidationError as TagValidationError, validate_tag};

use axum::Router;
use axum::http::{HeaderValue, Method, header};
use sqlx::PgPool;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::middleware::recovery::CatchPanicLayer;

#[derive(Clone)]
pub struct AppState {
    /// `None` only in local development without Postgres. Endpoints that need
    /// the database return 503 rather than pretending to work.
    pub database: Option<PgPool>,
    pub config: Config,
}

pub fn router(state: AppState, config: &Config) -> Router {
    Router::new()
        .merge(routes::health::routes())
        .nest("/v1", routes::v1())
        .layer(cors(config))
        .layer(TraceLayer::new_for_http())
        // CatchPanic must be the outermost layer so it catches panics in all
        // inner layers and handlers. It returns RFC 7807 problem+json 500s.
        .layer(CatchPanicLayer::new())
        .with_state(state)
}

/// Only the configured web origins may call the API from a browser.
fn cors(config: &Config) -> CorsLayer {
    let origins: Vec<HeaderValue> = config
        .allowed_origins
        .iter()
        .filter_map(|origin| origin.parse().ok())
        .collect();

    CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
}
