//! `GET /v1/receipts/verify` — verify a signed EngiPay receipt.
//!
//! The caller submits the receipt JSON body, the `kid`, and the hex signature
//! exactly as returned by the issuing endpoint. The server re-derives the
//! canonical JSON of the receipt, looks up the public key for `kid`, and
//! returns whether the signature is valid.
//!
//! This endpoint is public (no auth required) so third parties can verify
//! receipts without an EngiPay account.

use axum::Json;
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;

use crate::AppState;
use crate::receipts::{ReceiptVerifyError, VerifyRequest, VerifyResponse};

pub fn routes() -> Router<AppState> {
    Router::new().route("/receipts/verify", post(verify_receipt))
}

/// Verify a signed receipt.
///
/// Returns 200 with `{"valid": true}` when the signature checks out, or
/// `{"valid": false, "error": "…"}` when it does not (tampered, unknown kid,
/// bad signature format). An HTTP 200 is always returned when the request
/// itself is well-formed; a 400 is returned only when the request JSON is
/// malformed or required fields are missing.
async fn verify_receipt(
    State(state): State<AppState>,
    Json(req): Json<VerifyRequest>,
) -> (StatusCode, Json<VerifyResponse>) {
    // Look up the public key by kid.
    let verifier = match state.receipt_key_set.find(&req.kid) {
        Some(v) => v,
        None => {
            return (
                StatusCode::OK,
                Json(VerifyResponse {
                    valid: false,
                    error: Some(format!(
                        "unknown kid '{}'; key may not exist or may have been retired",
                        req.kid
                    )),
                }),
            );
        }
    };

    match verifier.verify(&req.receipt, &req.signature) {
        Ok(()) => (
            StatusCode::OK,
            Json(VerifyResponse {
                valid: true,
                error: None,
            }),
        ),
        Err(ReceiptVerifyError::Tampered) => (
            StatusCode::OK,
            Json(VerifyResponse {
                valid: false,
                error: Some(
                    "receipt has been tampered with or was not signed by the stated key"
                        .to_string(),
                ),
            }),
        ),
        Err(ReceiptVerifyError::InvalidSignatureFormat) => (
            StatusCode::OK,
            Json(VerifyResponse {
                valid: false,
                error: Some(
                    "signature is not a valid 64-byte hex-encoded Ed25519 signature".to_string(),
                ),
            }),
        ),
        Err(ReceiptVerifyError::UnknownKid(kid)) => (
            StatusCode::OK,
            Json(VerifyResponse {
                valid: false,
                error: Some(format!("unknown kid '{kid}'")),
            }),
        ),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use serde_json::json;
    use tower::ServiceExt;

    use crate::AppState;
    use crate::config::Config;
    use crate::middleware::rate_limit::RateLimiter;
    use crate::receipts::ReceiptSigner;

    fn state_with_key(seed_hex: &str) -> AppState {
        let mut config = Config::for_tests();
        config.receipt_signing_key = Some(seed_hex.to_owned());
        AppState::with_fakes(None, config, RateLimiter::new())
    }

    fn state_without_key() -> AppState {
        AppState::with_fakes(None, Config::for_tests(), RateLimiter::new())
    }

    async fn post_verify(app: axum::Router, body: serde_json::Value) -> serde_json::Value {
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/receipts/verify")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn valid_receipt_returns_valid_true() {
        let seed_hex = "01".repeat(32);
        let state = state_with_key(&seed_hex);
        let signer = ReceiptSigner::from_hex(&seed_hex).unwrap();

        let receipt = json!({"transaction_id": "txn-1", "amount": "100"});
        let signature = signer.sign(&receipt).unwrap();

        let app = super::routes().with_state(state);
        let result = post_verify(
            app,
            json!({
                "receipt": receipt,
                "kid": "v1",
                "signature": signature,
            }),
        )
        .await;

        assert_eq!(result["valid"], true);
        assert!(result["error"].is_null());
    }

    #[tokio::test]
    async fn tampered_receipt_returns_valid_false() {
        let seed_hex = "01".repeat(32);
        let state = state_with_key(&seed_hex);
        let signer = ReceiptSigner::from_hex(&seed_hex).unwrap();

        let original = json!({"amount": "100"});
        let signature = signer.sign(&original).unwrap();

        // Change the amount — tampered.
        let tampered = json!({"amount": "999999"});

        let app = super::routes().with_state(state);
        let result = post_verify(
            app,
            json!({
                "receipt": tampered,
                "kid": "v1",
                "signature": signature,
            }),
        )
        .await;

        assert_eq!(result["valid"], false);
        assert!(!result["error"].is_null());
    }

    #[tokio::test]
    async fn unknown_kid_returns_valid_false() {
        let seed_hex = "01".repeat(32);
        let state = state_with_key(&seed_hex);
        let signer = ReceiptSigner::from_hex(&seed_hex).unwrap();

        let receipt = json!({"amount": "100"});
        let signature = signer.sign(&receipt).unwrap();

        let app = super::routes().with_state(state);
        let result = post_verify(
            app,
            json!({
                "receipt": receipt,
                "kid": "unknown-kid",
                "signature": signature,
            }),
        )
        .await;

        assert_eq!(result["valid"], false);
        let error = result["error"].as_str().unwrap();
        assert!(error.contains("unknown kid"), "error was: {error}");
    }

    #[tokio::test]
    async fn no_signing_key_configured_returns_valid_false() {
        let state = state_without_key();
        let sig = "aa".repeat(64);

        let app = super::routes().with_state(state);
        let result = post_verify(
            app,
            json!({
                "receipt": {"amount": "100"},
                "kid": "v1",
                "signature": sig,
            }),
        )
        .await;

        // No key configured → kid lookup returns None → valid: false.
        assert_eq!(result["valid"], false);
    }

    #[tokio::test]
    async fn invalid_signature_format_returns_valid_false() {
        let seed_hex = "01".repeat(32);
        let state = state_with_key(&seed_hex);

        let app = super::routes().with_state(state);
        let result = post_verify(
            app,
            json!({
                "receipt": {"amount": "100"},
                "kid": "v1",
                "signature": "not-hex-at-all",
            }),
        )
        .await;

        assert_eq!(result["valid"], false);
    }
}
