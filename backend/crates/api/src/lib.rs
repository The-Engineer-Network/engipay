//! EngiPay HTTP API.
//!
//! Routes live here rather than in `main.rs` so tests can drive the real router
//! without opening a socket.

pub mod auth;
pub mod config;
pub mod error;
pub mod metrics;
pub mod middleware;
pub mod receipts;
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
use crate::middleware::rate_limit::RateLimiter;
use crate::middleware::recovery::CatchPanicLayer;
use crate::receipts::{ReceiptKeySet, ReceiptSigner, ReceiptVerifier};
use crate::services::bank_name_check::{BankNameCheck, FakeBankNameCheck};
use crate::services::destination_screen::{DestinationScreen, StaticBlockList};
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
    /// Ed25519 receipt signing key. `None` when `RECEIPT_SIGNING_KEY` is unset;
    /// receipts are unsigned in that case.
    pub receipt_signer: Option<Arc<ReceiptSigner>>,
    /// Published verification keys (current + retired) for the
    /// `GET /v1/well-known/receipt-keys` endpoint.
    pub receipt_key_set: Arc<ReceiptKeySet>,
    /// Withdrawal destination screener (static list now; swap for a real AML
    /// API in production without touching the withdrawal handler).
    pub destination_screen: Arc<dyn DestinationScreen>,
}

impl AppState {
    /// Convenience constructor used in tests and `main.rs` when no real
    /// provider credentials are configured.
    pub fn with_fakes(database: Option<PgPool>, config: Config, rate_limiter: RateLimiter) -> Self {
        let (receipt_signer, receipt_key_set) = build_receipt_components(
            config.receipt_signing_key.as_deref(),
            &config.receipt_retired_keys,
        );
        Self {
            database,
            config,
            rate_limiter,
            price_source: Arc::new(FakePriceSource),
            kyc_provider: Arc::new(FakeKycProvider),
            bank_name_check: Arc::new(FakeBankNameCheck),
            receipt_signer,
            receipt_key_set,
        }
    }
}

/// Parse `RECEIPT_SIGNING_KEY` (and optionally `RECEIPT_RETIRED_KEYS`) into a
/// signer and matching key set.
///
/// Returns `(None, empty_set)` when the key is not configured. This is
/// intentional: the API runs without signing, returning unsigned receipts, so
/// local development doesn't require generating a key.
///
/// `retired_keys` is a slice of `"kid:hex_public_key"` strings, e.g.
/// `["v1:aabb…", "v0:ccdd…"]`. Each is added to the key set as a retired
/// verifier so that receipts signed before the last rotation remain verifiable.
pub fn build_receipt_components(
    key_hex: Option<&str>,
    retired_keys: &[String],
) -> (Option<Arc<ReceiptSigner>>, Arc<ReceiptKeySet>) {
    let mut key_set = match key_hex.filter(|s| !s.trim().is_empty()) {
        Some(hex) => match ReceiptSigner::from_hex(hex.trim()) {
            Ok(signer) => {
                let ks = ReceiptKeySet::from_signer(&signer);
                return build_with_retired(Some(Arc::new(signer)), ks, retired_keys);
            }
            Err(err) => {
                tracing::warn!(error = %err, "RECEIPT_SIGNING_KEY is set but could not be parsed; receipts will be unsigned");
                ReceiptKeySet::new()
            }
        },
        None => ReceiptKeySet::new(),
    };

    // No active signer; still add retired keys so old receipts are verifiable.
    add_retired_keys(&mut key_set, retired_keys);
    (None, Arc::new(key_set))
}

fn build_with_retired(
    signer: Option<Arc<ReceiptSigner>>,
    mut key_set: ReceiptKeySet,
    retired_keys: &[String],
) -> (Option<Arc<ReceiptSigner>>, Arc<ReceiptKeySet>) {
    add_retired_keys(&mut key_set, retired_keys);
    (signer, Arc::new(key_set))
}

/// Parse each `"kid:hex_public_key"` entry and add it to `key_set` as a
/// retired verifier. Entries that fail to parse are logged and skipped.
fn add_retired_keys(key_set: &mut ReceiptKeySet, retired_keys: &[String]) {
    for entry in retired_keys {
        let Some((kid, hex)) = entry.split_once(':') else {
            tracing::warn!(entry = %entry, "RECEIPT_RETIRED_KEYS entry is missing 'kid:' prefix; skipping");
            continue;
        };
        match ReceiptVerifier::from_hex(kid, hex) {
            Ok(verifier) => key_set.add(verifier),
            Err(err) => {
                tracing::warn!(error = %err, entry = %entry, "RECEIPT_RETIRED_KEYS entry could not be parsed; skipping");
            }
            destination_screen: Arc::new(StaticBlockList::empty()),
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
    let start = std::time::Instant::now();
    let response = next.run(request).await;
    let elapsed_us = u64::try_from(start.elapsed().as_micros()).unwrap_or(u64::MAX);

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
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::receipts::{ReceiptSigner, ReceiptVerifyError};
    use serde_json::json;

    /// Primary (current) signing key seed — 32 bytes of 0x02.
    fn current_seed_hex() -> String {
        "02".repeat(32)
    }

    /// Retired signing key seed — 32 bytes of 0x01.
    fn retired_seed_hex() -> String {
        "01".repeat(32)
    }

    /// Derive the public key hex from a seed hex.
    fn public_key_hex_from_seed(seed_hex: &str) -> String {
        let signer = ReceiptSigner::from_hex(seed_hex).unwrap();
        hex::encode(signer.verifying_key().as_bytes())
    }

    // ── build_receipt_components ──────────────────────────────────────────────

    #[test]
    fn no_key_returns_none_signer_and_empty_set() {
        let (signer, key_set) = build_receipt_components(None, &[]);
        assert!(signer.is_none());
        assert_eq!(key_set.all().len(), 0);
    }

    #[test]
    fn active_key_registered_in_key_set() {
        let seed = current_seed_hex();
        let (signer, key_set) = build_receipt_components(Some(&seed), &[]);
        assert!(signer.is_some());
        assert_eq!(key_set.all().len(), 1);
        assert!(key_set.find("v1").is_some());
    }

    #[test]
    fn retired_key_is_added_to_key_set_alongside_current() {
        let current_seed = format!("v2:{}", current_seed_hex());
        let retired_pub = public_key_hex_from_seed(&retired_seed_hex());
        let retired_entry = format!("v1:{retired_pub}");

        let (signer, key_set) = build_receipt_components(Some(&current_seed), &[retired_entry]);

        assert!(signer.is_some());
        assert_eq!(key_set.all().len(), 2, "current + retired");
        assert!(key_set.find("v2").is_some(), "current key must be present");
        assert!(key_set.find("v1").is_some(), "retired key must be present");
    }

    #[test]
    fn old_receipt_verifies_with_retired_key_after_rotation() {
        // An old receipt was signed with the retired key.
        let retired_signer = ReceiptSigner::from_hex(&retired_seed_hex()).unwrap();
        let payload = json!({"amount": "500", "ref": "old-receipt"});
        let old_sig = retired_signer.sign(&payload).unwrap();

        // Build a new key set: v2 is active, v1 is retired.
        let current_seed = format!("v2:{}", current_seed_hex());
        let retired_pub = public_key_hex_from_seed(&retired_seed_hex());
        let retired_entry = format!("v1:{retired_pub}");
        let (_, key_set) = build_receipt_components(Some(&current_seed), &[retired_entry]);

        // The receipt carries kid="v1"; look up and verify.
        let verifier = key_set.find("v1").expect("retired key must be in set");
        assert!(
            verifier.verify(&payload, &old_sig).is_ok(),
            "old receipt must still verify after key rotation"
        );
    }

    #[test]
    fn tampered_old_receipt_fails_verification() {
        let retired_signer = ReceiptSigner::from_hex(&retired_seed_hex()).unwrap();
        let original = json!({"amount": "500"});
        let old_sig = retired_signer.sign(&original).unwrap();

        let current_seed = format!("v2:{}", current_seed_hex());
        let retired_pub = public_key_hex_from_seed(&retired_seed_hex());
        let retired_entry = format!("v1:{retired_pub}");
        let (_, key_set) = build_receipt_components(Some(&current_seed), &[retired_entry]);

        let verifier = key_set.find("v1").unwrap();
        let tampered = json!({"amount": "999999"});
        assert_eq!(
            verifier.verify(&tampered, &old_sig),
            Err(ReceiptVerifyError::Tampered)
        );
    }

    #[test]
    fn malformed_retired_key_entry_is_skipped_gracefully() {
        // Missing kid: prefix — should be ignored without panicking.
        let bad_entry = "01".repeat(32); // no "kid:" prefix
        let (signer, key_set) = build_receipt_components(Some(&current_seed_hex()), &[bad_entry]);
        assert!(signer.is_some());
        // Only the current key — the bad retired entry was skipped.
        assert_eq!(key_set.all().len(), 1);
    }

    #[test]
    fn multiple_retired_keys_all_registered() {
        let pub1 = public_key_hex_from_seed(&"01".repeat(32));
        let pub2 = public_key_hex_from_seed(&"03".repeat(32));
        let retired = vec![format!("v0:{pub1}"), format!("v-old:{pub2}")];
        let current = format!("v2:{}", current_seed_hex());

        let (_, key_set) = build_receipt_components(Some(&current), &retired);
        assert_eq!(key_set.all().len(), 3);
        assert!(key_set.find("v2").is_some());
        assert!(key_set.find("v0").is_some());
        assert!(key_set.find("v-old").is_some());
    }

    #[test]
    fn retired_keys_without_active_signer_are_still_registered() {
        // Even when RECEIPT_SIGNING_KEY is not set, retired keys can still
        // be used for verifying existing receipts.
        let retired_pub = public_key_hex_from_seed(&retired_seed_hex());
        let retired_entry = format!("v1:{retired_pub}");

        let (signer, key_set) = build_receipt_components(None, &[retired_entry]);
        assert!(signer.is_none(), "no active signer");
        assert_eq!(
            key_set.all().len(),
            1,
            "retired verifier must still be present"
        );
        assert!(key_set.find("v1").is_some());
    }
}
