//! HTTP-level tests for the receipt public-key and verify endpoints (#641).
//!
//! Drives the real router in memory with no socket and no database.
//! Signs a receipt with the test signer, verifies it through the endpoint,
//! then tampers with one field and expects failure.

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, config::Config, router};
use http_body_util::BodyExt;
use serde_json::{Value, json};
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
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn post_json(path: &str, body: Value) -> (StatusCode, Value) {
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
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

// ── GET /receipts/public-key ──────────────────────────────────────────────────

#[tokio::test]
async fn public_key_endpoint_returns_key_id_and_base64_key() {
    let (status, body) = get_json("/receipts/public-key").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["current_key_id"].is_string(), "missing current_key_id");
    let key_b64 = body["current_public_key"].as_str().expect("current_public_key must be a string");
    // A valid base64-encoded Ed25519 public key is 44 chars (32 bytes → 44 chars with padding).
    let decoded = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, key_b64)
        .expect("current_public_key must be valid base64");
    assert_eq!(decoded.len(), 32, "Ed25519 public key must be 32 bytes");
    assert!(body["historical_keys"].is_array(), "missing historical_keys array");
}

// ── POST /receipts/verify ─────────────────────────────────────────────────────

/// Signs a receipt with the signer embedded in AppState and verifies it via HTTP.
#[tokio::test]
async fn signed_receipt_verifies_through_http_endpoint() {
    // 1. Fetch the current key id from the endpoint.
    let (_, pk_body) = get_json("/receipts/public-key").await;
    let key_id = pk_body["current_key_id"].as_str().unwrap().to_owned();

    // 2. Build a receipt and sign it using the service directly.
    use engipay_api::services::receipts::{Receipt, ReceiptSigner};
    use engipay_api::config::Config;
    let config = Config::for_tests();
    let signer = ReceiptSigner::from_config_or_test(&config);

    let receipt = Receipt {
        key_id: key_id.clone(),
        payload: json!({ "txn_id": "txn-001", "amount": "100.0000000", "asset": "USDC" }),
        signature: String::new(),
    };
    let signed = signer.sign(receipt).expect("signing should succeed");

    // 3. Verify via HTTP.
    let (status, body) = post_json(
        "/receipts/verify",
        json!({ "receipt": { "key_id": signed.key_id, "payload": signed.payload, "signature": signed.signature } }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["valid"], true, "valid receipt must return valid:true");
}

/// Tampers with one payload field and expects the verify endpoint to reject it.
#[tokio::test]
async fn tampered_receipt_fails_verification() {
    use engipay_api::services::receipts::{Receipt, ReceiptSigner};
    use engipay_api::config::Config;
    let config = Config::for_tests();
    let signer = ReceiptSigner::from_config_or_test(&config);

    let receipt = Receipt {
        key_id: signer.key_id().to_owned(),
        payload: json!({ "txn_id": "txn-002", "amount": "50.0000000", "asset": "USDC" }),
        signature: String::new(),
    };
    let signed = signer.sign(receipt).expect("signing should succeed");

    // Tamper: change the amount in the payload.
    let mut tampered_payload = signed.payload.clone();
    tampered_payload["amount"] = json!("999.0000000");

    let (status, body) = post_json(
        "/receipts/verify",
        json!({ "receipt": { "key_id": signed.key_id, "payload": tampered_payload, "signature": signed.signature } }),
    )
    .await;
    // Either 400 (signature parse error) or 200 with valid:false are acceptable.
    if status == StatusCode::OK {
        assert_eq!(body["valid"], false, "tampered receipt must be invalid");
    } else {
        assert!(
            status.is_client_error(),
            "expected 4xx for tampered receipt, got {status}"
        );
    }
}

/// A completely fabricated signature must not verify.
#[tokio::test]
async fn fabricated_signature_fails_verification() {
    let (_, pk_body) = get_json("/receipts/public-key").await;
    let key_id = pk_body["current_key_id"].as_str().unwrap();

    // A 64-byte all-zeroes "signature", base64-encoded.
    let fake_sig = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &[0u8; 64],
    );

    let (status, body) = post_json(
        "/receipts/verify",
        json!({
            "receipt": {
                "key_id": key_id,
                "payload": { "txn_id": "txn-fake" },
                "signature": fake_sig
            }
        }),
    )
    .await;
    if status == StatusCode::OK {
        assert_eq!(body["valid"], false, "all-zero signature must be invalid");
    } else {
        assert!(status.is_client_error(), "expected 4xx, got {status}");
    }
}
