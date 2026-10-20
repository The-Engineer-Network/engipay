//! `.well-known` endpoints.
//!
//! `GET /v1/well-known/receipt-keys` publishes the current and all retired
//! Ed25519 public keys used to sign transaction receipts. Verifiers look up
//! the key whose `kid` matches the `receipt_sig.kid` embedded in a receipt.

use axum::Json;
use axum::Router;
use axum::extract::State;
use axum::routing::get;
use serde::Serialize;

use crate::AppState;
use crate::receipts::PublishedKey;

#[derive(Debug, Serialize)]
pub struct ReceiptKeysResponse {
    /// All known signing public keys, current first.
    pub keys: Vec<PublishedKey>,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/well-known/receipt-keys", get(receipt_keys))
}

/// Return all published receipt-signing public keys.
///
/// When no `RECEIPT_SIGNING_KEY` is configured the list is empty. Callers
/// should treat an empty list as "signing is not enabled" rather than an error.
async fn receipt_keys(State(state): State<AppState>) -> Json<ReceiptKeysResponse> {
    let keys = state
        .receipt_key_set
        .all()
        .iter()
        .map(PublishedKey::from_verifier)
        .collect();
    Json(ReceiptKeysResponse { keys })
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use crate::AppState;
    use crate::build_receipt_components;
    use crate::config::Config;
    use crate::middleware::rate_limit::RateLimiter;
    use crate::receipts::ReceiptSigner;

    fn state_without_key() -> AppState {
        AppState::with_fakes(None, Config::for_tests(), RateLimiter::new())
    }

    fn state_with_key(hex: &str) -> AppState {
        let mut config = Config::for_tests();
        config.receipt_signing_key = Some(hex.to_owned());
        AppState::with_fakes(None, config, RateLimiter::new())
    }

    #[tokio::test]
    async fn returns_empty_list_when_no_key_configured() {
        let state = state_without_key();
        let app = super::routes().with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/well-known/receipt-keys")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["keys"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn returns_key_entry_when_configured() {
        let seed_hex = "01".repeat(32);
        let state = state_with_key(&seed_hex);
        let app = super::routes().with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/well-known/receipt-keys")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        let keys = json["keys"].as_array().unwrap();
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0]["kid"], "v1");
        assert_eq!(keys[0]["algorithm"], "Ed25519");
        assert_eq!(keys[0]["public_key_hex"].as_str().unwrap().len(), 64);
    }

    #[tokio::test]
    async fn public_key_hex_matches_derived_from_seed() {
        let seed_hex = "01".repeat(32);
        let signer = ReceiptSigner::from_hex(&seed_hex).unwrap();
        let expected_pub_hex = hex::encode(signer.verifying_key().as_bytes());

        let (_, key_set) = build_receipt_components(Some(&seed_hex), &[]);
        let verifier = key_set.find("v1").unwrap();
        assert_eq!(verifier.public_key_hex(), expected_pub_hex);
    }

    #[tokio::test]
    async fn returns_current_and_retired_keys_when_both_configured() {
        let current_seed = format!("v2:{}", "02".repeat(32));
        let retired_seed = "01".repeat(32);
        let retired_signer = ReceiptSigner::from_hex(&retired_seed).unwrap();
        let retired_pub_hex = hex::encode(retired_signer.verifying_key().as_bytes());

        let mut config = Config::for_tests();
        config.receipt_signing_key = Some(current_seed.clone());
        config.receipt_retired_keys = vec![format!("v1:{retired_pub_hex}")];
        let state = AppState::with_fakes(None, config, RateLimiter::new());
        let app = super::routes().with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/well-known/receipt-keys")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        let keys = json["keys"].as_array().unwrap();
        assert_eq!(keys.len(), 2, "should list both current and retired key");

        let kids: Vec<&str> = keys.iter().map(|k| k["kid"].as_str().unwrap()).collect();
        assert!(kids.contains(&"v2"), "current key v2 must appear");
        assert!(kids.contains(&"v1"), "retired key v1 must appear");
    }
}
