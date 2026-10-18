//! Wallet sign-in and profile, end to end against a real Postgres.
//!
//! Needs DATABASE_URL pointing at a database with every migration applied, so
//! it is ignored by default. Run it with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test sign_in_db -- --ignored

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, config::Config, router};
use http_body_util::BodyExt;
use k256::ecdsa::SigningKey;
use serde_json::{Value, json};
use sha3::{Digest, Keccak256};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

async fn app() -> axum::Router {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .unwrap();
    let config = Config::for_tests();
    router(
        AppState {
            database: Some(pool),
            config: config.clone(),
            rate_limiter: RateLimiter::new(),
        },
        &config,
    )
}

async fn send(
    app: &axum::Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let request = match body {
        Some(body) => builder
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// A fresh wallet per run, so repeated runs never collide on address.
fn new_wallet() -> (SigningKey, String) {
    let mut bytes = [0u8; 32];
    bytes[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    bytes[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    let key = SigningKey::from_slice(&bytes).unwrap();
    let point = key.verifying_key().to_encoded_point(false);
    let hash = Keccak256::digest(&point.as_bytes()[1..]);
    let address = format!("0x{}", hex::encode(&hash[12..]));
    (key, address)
}

/// Signs `message` the way a wallet's personal_sign does (EIP-191).
fn personal_sign(key: &SigningKey, message: &str) -> String {
    let mut hasher = Keccak256::new();
    hasher.update(b"\x19Ethereum Signed Message:\n");
    hasher.update(message.len().to_string().as_bytes());
    hasher.update(message.as_bytes());
    let digest: [u8; 32] = hasher.finalize().into();
    let (signature, recovery_id) = key.sign_prehash_recoverable(&digest).unwrap();
    let mut bytes = signature.to_bytes().to_vec();
    bytes.push(recovery_id.to_byte() + 27);
    format!("0x{}", hex::encode(bytes))
}

/// Runs the full sign-in for `key`, returning the session token.
async fn sign_in(app: &axum::Router, key: &SigningKey, address: &str) -> String {
    let (status, nonce_body) = send(app, "POST", "/v1/auth/nonce", None, None).await;
    assert_eq!(status, StatusCode::OK);
    let nonce = nonce_body["nonce"].as_str().unwrap().to_string();

    let message = format!("Sign in to EngiPay\n\nAddress: {address}\nNonce: {nonce}");
    let (status, body) = send(
        app,
        "POST",
        "/v1/auth/verify-evm",
        None,
        Some(json!({
            "message": message,
            "signature": personal_sign(key, &message),
            "address": address,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "sign-in failed: {body}");
    body["token"].as_str().unwrap().to_string()
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn wallet_sign_in_then_profile_and_tag() {
    let app = app().await;
    let (key, address) = new_wallet();

    // Signing in issues a token, and the nonce cannot be used twice.
    let token = sign_in(&app, &key, &address).await;

    let (status, profile) = send(&app, "GET", "/v1/me", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(profile["tag"], Value::Null);
    assert_eq!(profile["tier"], 0);
    assert_eq!(profile["daily_limit"], "500 USDC");

    // A tag is saved, and the profile shows it without the @.
    let tag = format!("t{}", &Uuid::new_v4().simple().to_string()[..10]);
    let (status, _) = send(
        &app,
        "PATCH",
        "/v1/me",
        Some(&token),
        Some(json!({ "tag": format!("@{tag}") })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, profile) = send(&app, "GET", "/v1/me", Some(&token), None).await;
    assert_eq!(profile["tag"], tag.as_str());

    // A second wallet cannot take the same tag.
    let (other_key, other_address) = new_wallet();
    let other_token = sign_in(&app, &other_key, &other_address).await;
    let (status, body) = send(
        &app,
        "PATCH",
        "/v1/me",
        Some(&other_token),
        Some(json!({ "tag": tag })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("already taken")
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_nonce_cannot_be_used_twice() {
    let app = app().await;
    let (key, address) = new_wallet();

    let (_, nonce_body) = send(&app, "POST", "/v1/auth/nonce", None, None).await;
    let nonce = nonce_body["nonce"].as_str().unwrap().to_string();
    let message = format!("Sign in to EngiPay\n\nAddress: {address}\nNonce: {nonce}");
    let payload = json!({
        "message": message,
        "signature": personal_sign(&key, &message),
        "address": address,
    });

    let (first, _) = send(
        &app,
        "POST",
        "/v1/auth/verify-evm",
        None,
        Some(payload.clone()),
    )
    .await;
    assert_eq!(first, StatusCode::OK);
    let (replay, _) = send(&app, "POST", "/v1/auth/verify-evm", None, Some(payload)).await;
    assert_eq!(replay, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_signature_from_another_wallet_is_refused() {
    let app = app().await;
    let (_, claimed) = new_wallet();
    let (impostor, _) = new_wallet();

    let (_, nonce_body) = send(&app, "POST", "/v1/auth/nonce", None, None).await;
    let nonce = nonce_body["nonce"].as_str().unwrap().to_string();
    let message = format!("Sign in to EngiPay\n\nAddress: {claimed}\nNonce: {nonce}");

    let (status, _) = send(
        &app,
        "POST",
        "/v1/auth/verify-evm",
        None,
        Some(json!({
            "message": message,
            "signature": personal_sign(&impostor, &message),
            "address": claimed,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
