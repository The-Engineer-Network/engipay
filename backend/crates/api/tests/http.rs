//! Drives the real router in memory, with no socket and no database.

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::{AppState, config::Config, router};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

fn app() -> axum::Router {
    let config = Config::for_tests();
    router(
        AppState {
            database: None,
            config: config.clone(),
        },
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

#[tokio::test]
async fn stellar_challenge_endpoint_returns_valid_transaction() {
    use stellar_strkey::ed25519;

    let account = ed25519::PublicKey([7; 32]).to_string();

    let (status, body) = get_json(&format!("/v1/auth/stellar/challenge?account={}", account)).await;
    assert_eq!(status, StatusCode::OK);

    assert!(body["transaction"].is_string());
    assert_eq!(
        body["network_passphrase"],
        "Test SDF Network ; September 2015"
    );

    // Verify the transaction XDR is valid
    let xdr = body["transaction"].as_str().unwrap();
    let result: Result<stellar_xdr::TransactionEnvelope, _> =
        stellar_xdr::ReadXdr::from_xdr_base64(xdr, stellar_xdr::Limits::none());
    assert!(result.is_ok());
}

#[tokio::test]
async fn stellar_challenge_rejects_invalid_account() {
    let (status, body) = get_json("/v1/auth/stellar/challenge?account=invalid").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"]["code"].is_string());
}

#[tokio::test]
async fn stellar_challenge_rejects_secret_key() {
    use stellar_strkey::ed25519;

    let secret = ed25519::PrivateKey([3; 32]);
    let secret_str = secret.as_unredacted().to_string();

    let (status, _body) = get_json(&format!(
        "/v1/auth/stellar/challenge?account={}",
        secret_str
    ))
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn evm_auth_requires_database() {
    use axum::body::Body;
    use http_body_util::BodyExt;

    let response = app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/auth/verify-evm")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"message":"test","signature":"0x00","address":"0x0000000000000000000000000000000000000000"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["error"]["code"], "database_unavailable");
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
