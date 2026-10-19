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

use std::sync::Arc;

use axum::Router;
use axum::http::{HeaderValue, Method, header};
use sqlx::PgPool;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::middleware::logging::log_requests;
use crate::middleware::recovery::CatchPanicLayer;
use crate::middleware::rate_limit::RateLimiter;
use crate::services::bank_name_check::{BankNameCheck, FakeBankNameCheck};
use crate::services::kyc_provider::{FakeKycProvider, KycProvider};
use crate::services::price_source::{FakePriceSource, PriceSource};

#[derive(Clone)]
pub struct AppState {
    /// `None` only in local development without Postgres. Endpoints that need
    /// the database return 503 rather than pretending to work.
    pub database: Option<PgPool>,
    pub config: Config,
    pub rate_limiter: RateLimiter,
    /// Conversion price source (fake in dev/test, real oracle in production).
    pub price_source: Arc<dyn PriceSource>,
    /// KYC provider (fake in dev/test, real partner in production).
    pub kyc_provider: Arc<dyn KycProvider>,
    /// Bank account name check (fake in dev/test, real partner in production).
    pub bank_name_check: Arc<dyn BankNameCheck>,
}

impl AppState {
    /// Convenience constructor used in tests and `main.rs` when no real
    /// provider credentials are configured.
    pub fn with_fakes(database: Option<PgPool>, config: Config, rate_limiter: RateLimiter) -> Self {
        Self {
            database,
            config,
            rate_limiter,
            price_source: Arc::new(FakePriceSource),
            kyc_provider: Arc::new(FakeKycProvider),
            bank_name_check: Arc::new(FakeBankNameCheck),
        }
    }
}

pub fn router(state: AppState, config: &Config) -> Router {
    Router::new()
        .merge(routes::health::routes())
        .merge(routes::openapi::routes())
        .nest("/v1", routes::v1())
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::rate_limit::rate_limit_middleware,
        ))
        .layer(cors(config))
        .layer(TraceLayer::new_for_http())
        // Structured JSON request logging with correlation IDs. Placed inside
        // CatchPanic so panics are still converted to problem+json 500s, and
        // outside the routes so every request is logged exactly once.
        .layer(axum::middleware::from_fn(log_requests))
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
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
}
