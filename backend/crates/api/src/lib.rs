//! EngiPay HTTP API.
//!
//! Routes live here rather than in `main.rs` so tests can drive the real router
//! without opening a socket.

pub mod auth;
pub mod config;
pub mod db_router;
pub mod error;
pub mod metrics;
pub mod middleware;
mod routes;
pub mod services;

use std::sync::Arc;

use axum::Router;
use axum::http::{HeaderName, HeaderValue, Method, header};
use sqlx::PgPool;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::middleware::logging::log_requests;
use crate::middleware::rate_limit::RateLimiter;
use crate::middleware::recovery::CatchPanicLayer;
use crate::services::bank_name_check::{BankNameCheck, FakeBankNameCheck};
use crate::services::destination_screen::{DestinationScreen, StaticBlockList};
use crate::services::kyc_provider::{FakeKycProvider, KycProvider};
use crate::services::price_source::{FakePriceSource, PriceSource};
use crate::services::receipts::ReceiptSigner;


#[derive(Clone)]
pub struct AppState {
    /// `None` only in local development without Postgres. Endpoints that need
    /// the database return 503 rather than pretending to work.
    pub database: Option<PgPool>,
    /// Optional read replica. `None` means all reads fall back to the primary
    /// database.
    pub replica_database: Option<PgPool>,
    pub config: Config,
    pub rate_limiter: RateLimiter,
    /// Conversion price source (fake in dev/test, real oracle in production).
    pub price_source: Arc<dyn PriceSource>,
    /// KYC provider (fake in dev/test, real partner in production).
    pub kyc_provider: Arc<dyn KycProvider>,
    /// Bank account name check (fake in dev/test, real partner in production).
    pub bank_name_check: Arc<dyn BankNameCheck>,
    /// Withdrawal destination screener (static list now; swap for a real AML
    /// API in production without touching the withdrawal handler).
    pub destination_screen: Arc<dyn DestinationScreen>,
    /// Ed25519 signer used to issue verifiable transaction receipts.
    pub receipt_signer: Arc<ReceiptSigner>,
    /// Names of providers that are fakes. Non-empty only when `with_fakes` was
    /// used. Checked at startup in production mode.
    pub fake_provider_names: Vec<&'static str>,
}

impl AppState {
    /// Convenience constructor used in tests and `main.rs` when no real
    /// provider credentials are configured.
    pub fn with_fakes(database: Option<PgPool>, config: Config, rate_limiter: RateLimiter) -> Self {
        let receipt_signer = Arc::new(ReceiptSigner::from_config_or_test(&config));
        Self {
            database,
            replica_database: None,
            config,
            rate_limiter,
            price_source: Arc::new(FakePriceSource),
            kyc_provider: Arc::new(FakeKycProvider),
            bank_name_check: Arc::new(FakeBankNameCheck),
            destination_screen: Arc::new(StaticBlockList::empty()),
            receipt_signer,
            fake_provider_names: vec![
                "price_source (FakePriceSource)",
                "kyc_provider (FakeKycProvider)",
                "bank_name_check (FakeBankNameCheck)",
            ],
        }
    }
}

pub fn router(state: AppState, config: &Config) -> Router {
    Router::new()
        .merge(routes::health::routes())
        .merge(routes::openapi::routes())
        // `/metrics` is outside `/v1` so it is never reachable through the
        // public API prefix.
        .merge(routes::metrics::routes())
        .nest("/v1", routes::v1())
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::idempotency::idempotency_middleware,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::rate_limit::rate_limit_middleware,
        ))
        .layer(cors(config))
        .layer(TraceLayer::new_for_http())
        // Track per-prefix request counts and latency for the /metrics endpoint.
        .layer(axum::middleware::from_fn(track_request_metrics))
        // Structured JSON request logging with correlation IDs. Placed inside
        // CatchPanic so panics are still converted to problem+json 500s, and
        // outside the routes so every request is logged exactly once.
        .layer(axum::middleware::from_fn(log_requests))
        // CatchPanic must be the outermost layer so it catches panics in all
        // inner layers and handlers. It returns RFC 7807 problem+json 500s.
        .layer(CatchPanicLayer::new())
        .with_state(state)
}

/// Middleware that increments per-prefix request counters and accumulates
/// latency so the `/metrics` endpoint has something to report.
async fn track_request_metrics(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use std::sync::atomic::Ordering;

    let is_v1 = request.uri().path().starts_with("/v1/");
    let route = request
        .extensions()
        .get::<axum::extract::MatchedPath>()
        .map_or_else(|| "unmatched".to_owned(), |path| path.as_str().to_owned());
    let method: &'static str = match request.method().as_str() {
        "GET" => "GET",
        "POST" => "POST",
        "PUT" => "PUT",
        "PATCH" => "PATCH",
        "DELETE" => "DELETE",
        _ => "OTHER",
    };
    let start = std::time::Instant::now();
    let response = next.run(request).await;
    let elapsed_us = u64::try_from(start.elapsed().as_micros()).unwrap_or(u64::MAX);

    metrics::record_route(&route, method, response.status().as_u16(), elapsed_us);

    if is_v1 {
        metrics::REQUESTS_V1.fetch_add(1, Ordering::Relaxed);
        metrics::DURATION_US_V1.fetch_add(elapsed_us, Ordering::Relaxed);
    } else {
        metrics::REQUESTS_OTHER.fetch_add(1, Ordering::Relaxed);
        metrics::DURATION_US_OTHER.fetch_add(elapsed_us, Ordering::Relaxed);
    }

    response
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
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            // Allow browser clients to include the idempotency key header.
            HeaderName::from_static(middleware::IDEMPOTENCY_KEY_HEADER),
        ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::middleware::rate_limit::RateLimiter;

    #[test]
    fn with_fakes_reports_all_three_fake_providers() {
        let state = AppState::with_fakes(None, Config::for_tests(), RateLimiter::new());
        assert_eq!(state.fake_provider_names.len(), 3);
        let all = state.fake_provider_names.join(", ");
        assert!(all.contains("FakePriceSource"), "{all}");
        assert!(all.contains("FakeKycProvider"), "{all}");
        assert!(all.contains("FakeBankNameCheck"), "{all}");
    }

    #[test]
    fn production_mode_with_fakes_would_be_rejected() {
        // Simulate what main() does: check fake_provider_names when in production.
        let mut config = Config::for_tests();
        config.production_mode = true;
        let state = AppState::with_fakes(None, config.clone(), RateLimiter::new());
        assert!(
            config.production_mode && !state.fake_provider_names.is_empty(),
            "production mode with fakes must be caught at startup"
        );
        let msg = format!(
            "refusing to start in production mode with fake providers: {}",
            state.fake_provider_names.join(", ")
        );
        assert!(msg.contains("FakePriceSource"));
        assert!(msg.contains("FakeKycProvider"));
        assert!(msg.contains("FakeBankNameCheck"));
    }
}
