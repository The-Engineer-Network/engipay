//! Drives the real router in memory, with no socket and no database.

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::{AppState, config::Config, router};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

fn app() -> axum::Router {
    router(AppState { database: None }, &Config::for_tests())
}

async fn get_json(path: &str) -> (StatusCode, Value) {
    let response = app()
        .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

#[tokio::test]
async fn health_reports_ok_without_a_database() {
    let (status, body) = get_json("/healthz").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
    assert_eq!(body["database"], "not_configured");
}

#[tokio::test]
async fn lists_exactly_the_supported_assets() {
    let (status, body) = get_json("/v1/assets").await;
    assert_eq!(status, StatusCode::OK);
    let symbols: Vec<&str> = body
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["symbol"].as_str().unwrap())
        .collect();
    assert_eq!(symbols, ["ETH", "USDC", "BTC", "XLM"]);

    // USDC: one balance at ledger precision, reachable on two networks with
    // their own on-chain precision.
    let usdc = &body[1];
    assert_eq!(usdc["decimals"], 7);
    assert_eq!(usdc["networks"][0]["chain"], "base");
    assert_eq!(usdc["networks"][0]["decimals"], 6);
    assert_eq!(usdc["networks"][1]["chain"], "stellar");
    assert_eq!(usdc["networks"][1]["decimals"], 7);

    assert_eq!(body[2]["networks"][0]["chain"], "bitcoin");
    assert_eq!(body[3]["networks"][0]["chain"], "stellar");
}

#[tokio::test]
async fn unknown_routes_are_404() {
    let (status, _) = get_json("/v1/nope").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn only_the_configured_web_origin_is_allowed() {
    let preflight = |origin: &'static str| {
        Request::builder()
            .method("OPTIONS")
            .uri("/v1/assets")
            .header(header::ORIGIN, origin)
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
            .body(Body::empty())
            .unwrap()
    };

    let allowed = app()
        .oneshot(preflight("http://localhost:3000"))
        .await
        .unwrap();
    assert_eq!(
        allowed
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .map(|v| v.to_str().unwrap()),
        Some("http://localhost:3000")
    );

    let refused = app()
        .oneshot(preflight("https://evil.example"))
        .await
        .unwrap();
    assert!(
        refused
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none()
    );
}
