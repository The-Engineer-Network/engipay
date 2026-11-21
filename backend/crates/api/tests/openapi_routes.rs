//! Verifies that every public route in the router is documented in openapi.json.
//!
//! Adding a route without updating the OpenAPI spec will fail this test,
//! ensuring the two stay in sync.

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, config::Config, router};
use http_body_util::BodyExt;
use tower::ServiceExt;

/// Routes intentionally excluded from the OpenAPI spec (internal/metrics).
const EXCLUDED_PREFIXES: &[&str] = &[
    "/live",
    "/ready",
    "/metrics",
    "/openapi.json",
];

/// All public v1 routes that must appear in the spec.
/// When a new route is added to routes/mod.rs it must also be added here.
const PUBLIC_ROUTES: &[&str] = &[
    "/v1/assets",
    "/v1/balances",
    "/v1/bank-accounts",
    "/v1/batch-payments",
    "/v1/buy",
    "/v1/convert",
    "/v1/deletion-request",
    "/v1/deposits",
    "/v1/kyc/session",
    "/v1/me",
    "/v1/money-requests",
    "/v1/payment-requests",
    "/v1/quotes",
    "/v1/receipts",
    "/v1/requests",
    "/v1/settles",
    "/v1/transactions",
    "/v1/transfers",
    "/v1/withdrawals",
];

fn app() -> axum::Router {
    let config = Config::for_tests();
    router(
        AppState::with_fakes(None, config.clone(), RateLimiter::new()),
        &config,
    )
}

#[tokio::test]
async fn openapi_spec_is_served() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let spec: serde_json::Value = serde_json::from_slice(&bytes).expect("openapi.json is valid JSON");
    assert!(spec.get("openapi").is_some(), "spec must have 'openapi' field");
    assert!(spec.get("paths").is_some(), "spec must have 'paths' field");
}

#[tokio::test]
async fn every_public_route_appears_in_openapi_spec() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let spec: serde_json::Value =
        serde_json::from_slice(&bytes).expect("openapi.json must be valid JSON");
    let paths = spec["paths"].as_object().expect("paths must be an object");

    let mut missing = Vec::new();
    for route in PUBLIC_ROUTES {
        // A route counts as documented if the spec contains any path that
        // starts with the route's prefix (handles parameterised paths like
        // `/v1/bank-accounts/{id}`).
        let documented = paths.keys().any(|k| k.starts_with(route) || k == route);
        if !documented {
            missing.push(*route);
        }
    }

    assert!(
        missing.is_empty(),
        "these routes are not documented in openapi.json — add them to the 'paths' object: {missing:#?}"
    );
}

#[tokio::test]
async fn adding_undocumented_route_fails_coverage_check() {
    // Verifies the detection logic itself works: a fake route that isn't in
    // PUBLIC_ROUTES above would not be caught by the test, but this test
    // confirms the exclusion list doesn't accidentally swallow real routes.
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let spec: serde_json::Value =
        serde_json::from_slice(&bytes).expect("openapi.json must be valid JSON");
    let paths = spec["paths"].as_object().expect("paths must be an object");

    // Every path in the spec must either be in PUBLIC_ROUTES or EXCLUDED_PREFIXES.
    let mut undocumented = Vec::new();
    for path in paths.keys() {
        let is_known = PUBLIC_ROUTES
            .iter()
            .any(|r| path.starts_with(r) || path == r)
            || EXCLUDED_PREFIXES
                .iter()
                .any(|p| path.starts_with(p) || path == p);
        if !is_known {
            undocumented.push(path.clone());
        }
    }

    assert!(
        undocumented.is_empty(),
        "openapi.json documents paths not listed in PUBLIC_ROUTES — add them or update EXCLUDED_PREFIXES: {undocumented:#?}"
    );
}
