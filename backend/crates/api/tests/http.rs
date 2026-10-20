//! Drives the real router in memory, with no socket and no database.

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, config::Config, router};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

fn app() -> axum::Router {
    let config = Config::for_tests();
    router(
        AppState::with_fakes(None, config.clone(), RateLimiter::new()),
        &config,
    )
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
async fn sign_in_endpoints_report_no_database_instead_of_pretending() {
    let verify_body = r#"{"message":"Sign in\nNonce: abcdef1234","signature":"0x00","address":"0x0000000000000000000000000000000000000001"}"#;
    for (path, body) in [("/v1/auth/nonce", ""), ("/v1/auth/verify-evm", verify_body)] {
        let response = app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE, "{path}");
    }
}

#[tokio::test]
async fn me_requires_a_bearer_token() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/v1/me")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
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

/// SEP-7: `web+stellar:pay?destination=<account>`.
fn stellar_payment_uri(destination: &str) -> String {
    format!("web+stellar:pay?destination={destination}")
}

/// EIP-681: `ethereum:<address>@<chain_id>`.
fn base_payment_uri(address: &str) -> String {
    format!("ethereum:{address}@8453")
}

/// BIP-21: `bitcoin:<address>`.
fn bitcoin_payment_uri(address: &str) -> String {
    format!("bitcoin:{address}")
}

#[test]
fn stellar_payment_uri_follows_sep7() {
    let uri = stellar_payment_uri("GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ");
    assert!(uri.starts_with("web+stellar:pay?"));
    assert_eq!(
        uri,
        "web+stellar:pay?destination=GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ"
    );
}

#[test]
fn base_payment_uri_follows_eip681() {
    let uri = base_payment_uri("0x4200000000000000000000000000000000000006");
    assert!(uri.starts_with("ethereum:0x"));
    assert!(uri.ends_with("@8453"));
    assert_eq!(
        uri,
        "ethereum:0x4200000000000000000000000000000000000006@8453"
    );
}

#[test]
fn bitcoin_payment_uri_follows_bip21() {
    let uri = bitcoin_payment_uri("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
    assert!(uri.starts_with("bitcoin:"));
    assert_eq!(uri, "bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
}

#[tokio::test]
async fn buy_quotes_require_a_bearer_token() {
    let response = app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/buy/quotes")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"naira_amount":"5000","asset":"USDC"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

/// A signed bearer token for the fake in-memory user.
fn bearer_token() -> String {
    let config = Config::for_tests();
    engipay_api::auth::jwt::create_token(
        uuid::Uuid::new_v4(),
        String::new(),
        config.jwt_secret.as_bytes(),
    )
    .unwrap()
}

#[tokio::test]
async fn contacts_require_a_bearer_token() {
    for (method, path) in [
        ("GET", "/v1/contacts"),
        ("POST", "/v1/contacts"),
        ("GET", "/v1/recipients/risk?address=0x0000000000000000000000000000000000000001"),
    ] {
        let response = app()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{method} {path}");
    }
}

#[tokio::test]
async fn contacts_report_no_database_instead_of_pretending() {
    let token = bearer_token();
    let response = app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/contacts")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"label":"Alice","address":"0x0000000000000000000000000000000000000001","chain":"base"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
#[ignore = "requires a database"]
async fn creates_and_lists_a_saved_contact() {
    let token = bearer_token();
    let created = app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/contacts")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"label":"Alice","address":"0x0000000000000000000000000000000000000001","chain":"base"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);

    let response = app()
        .oneshot(
            Request::builder()
                .uri("/v1/contacts")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    let contacts = body.as_array().unwrap();
    assert_eq!(contacts.len(), 1);
    assert_eq!(contacts[0]["label"], "Alice");
    assert_eq!(
        contacts[0]["address"],
        "0x0000000000000000000000000000000000000001"
    );
}

#[tokio::test]
#[ignore = "requires a database"]
async fn flags_a_look_alike_address_but_not_an_exact_match() {
    let token = bearer_token();
    let saved = "0x0000000000000000000000000000000000000001";
    let look_alike = "0x0000000000000000000000000000000000000002";

    let created = app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/contacts")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"label":"Alice","address":"{saved}","chain":"base"}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);

    let risk = |address: &str| {
        let token = token.clone();
        let path = format!("/v1/recipients/risk?address={address}&chain=base");
        async move {
            let response = app()
                .oneshot(
                    Request::builder()
                        .uri(path)
                        .header(header::AUTHORIZATION, format!("Bearer {token}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let bytes = response.into_body().collect().await.unwrap().to_bytes();
            serde_json::from_slice::<Value>(&bytes).unwrap()
        }
    };

    let exact = risk(saved).await;
    assert_eq!(exact["first_time"], false);
    assert_eq!(exact["look_alike"], false);

    let similar = risk(look_alike).await;
    assert_eq!(similar["look_alike"], true);

    let unknown = risk("0x00000000000000000000000000000000000000ff").await;
    assert_eq!(unknown["first_time"], true);
}

#[tokio::test]
async fn buy_quotes_report_no_database_instead_of_pretending() {
    // Without pricing configured, the check is the same: no quote is invented.
    // The database check comes after auth, so use a signed token here.
    let config = Config::for_tests();
    let token = engipay_api::auth::jwt::create_token(
        uuid::Uuid::new_v4(),
        String::new(),
        config.jwt_secret.as_bytes(),
    )
    .unwrap();
    let response = app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/buy/quotes")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"naira_amount":"5000","asset":"USDC"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}
