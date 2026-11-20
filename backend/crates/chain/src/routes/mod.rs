//! The chain service's internal HTTP API.
//!
//! Everything here is `/internal/*`: the surface the API service calls to reach
//! the one process that can talk to a network. It is not exposed to browsers,
//! and it is mounted separately from the public `/v1` API on purpose — a
//! compromise of the API service must not automatically become a compromise of
//! the fee quoter and, later, of the signer.
//!
//! These endpoints are not exposed to the public internet. They are called
//! by the API service over a private network channel (loopback or container
//! networking) so it can obtain chain-specific data — such as fee estimates
//! and deposit address derivation — without holding any signing keys itself.

use std::sync::Arc;

use axum::Router;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};

pub mod create_wallet;
pub mod estimate_fee;

use crate::routes::estimate_fee::FeeOracle;

/// State every internal route receives.
#[derive(Clone)]
pub struct ChainHttpState {
    /// Where live fee data comes from. Behind a trait object so the handler can
    /// be tested without a node or an indexer.
    pub fees: Arc<dyn FeeOracle>,
    /// Shared secret the caller must supply in the `X-Internal-Token` header.
    ///
    /// `None` means no credential is required — only acceptable when the
    /// listener is verified to be loopback-only before the server starts.
    pub internal_token: Option<Arc<str>>,
}

impl ChainHttpState {
    pub fn new(fees: Arc<dyn FeeOracle>) -> Self {
        Self {
            fees,
            internal_token: None,
        }
    }

    /// Attach a shared-secret credential.  Every request to `/internal/*` must
    /// carry a matching `X-Internal-Token` header, compared in constant time.
    pub fn with_token(mut self, token: impl Into<Arc<str>>) -> Self {
        self.internal_token = Some(token.into());
        self
    }
}

// ── Constant-time credential comparison ──────────────────────────────────────

/// Compares two byte slices in constant time to resist timing attacks.
///
/// Returns `true` only when both slices are identical. A length difference is
/// not a timing leak here because a credential with the wrong length is refused
/// before its bytes are compared.
fn ct_eq(expected: &[u8], provided: &[u8]) -> bool {
    if expected.len() != provided.len() {
        return false;
    }
    expected
        .iter()
        .zip(provided)
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

// ── Auth middleware ───────────────────────────────────────────────────────────

async fn auth(
    axum::extract::State(state): axum::extract::State<ChainHttpState>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    if let Some(expected) = &state.internal_token {
        let provided = request
            .headers()
            .get("x-internal-token")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if !ct_eq(expected.as_bytes(), provided.as_bytes()) {
            return (
                StatusCode::UNAUTHORIZED,
                axum::Json(serde_json::json!({
                    "error": { "code": "unauthorized", "message": "missing or invalid X-Internal-Token" }
                })),
            )
                .into_response();
        }
    }
    next.run(request).await
}

// ── Metrics handler ───────────────────────────────────────────────────────────

async fn metrics_handler() -> impl IntoResponse {
    (
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        crate::metrics::render(),
    )
}

// ── Metrics middleware (per-route instrumentation) ────────────────────────────

async fn track_request_metrics(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use std::sync::atomic::Ordering;

    let path = request.uri().path().to_owned();
    let start = std::time::Instant::now();
    let response = next.run(request).await;
    let elapsed_us = u64::try_from(start.elapsed().as_micros()).unwrap_or(u64::MAX);

    match path.as_str() {
        "/internal/estimate-fee" => {
            crate::metrics::REQUESTS_ESTIMATE_FEE.fetch_add(1, Ordering::Relaxed);
            crate::metrics::DURATION_US_ESTIMATE_FEE.fetch_add(elapsed_us, Ordering::Relaxed);
        }
        "/internal/create-wallet" => {
            crate::metrics::REQUESTS_CREATE_WALLET.fetch_add(1, Ordering::Relaxed);
            crate::metrics::DURATION_US_CREATE_WALLET.fetch_add(elapsed_us, Ordering::Relaxed);
        }
        _ => {}
    }

    response
}

// ── Public router constructors ────────────────────────────────────────────────

/// The chain service's router, with no credential requirement.
///
/// Used in tests and as a convenience wrapper when the listener is verified to
/// be loopback-only.  For production use in `serve()` and `watch()`, prefer
/// [`router_with_state`] so a token can be attached.
pub fn router(fees: Arc<dyn FeeOracle>) -> Router {
    router_with_state(ChainHttpState::new(fees))
}

/// The chain service's router built from a fully-configured [`ChainHttpState`].
///
/// The `/metrics` endpoint is always available and requires no credential.
/// The `/internal/*` routes are guarded by the token in `state` when one is
/// set.
pub fn router_with_state(state: ChainHttpState) -> Router {
    Router::new()
        .route("/metrics", get(metrics_handler))
        .merge(internal(state))
}

/// Routes only the API service may call.
fn internal(state: ChainHttpState) -> Router {
    Router::new()
        .route("/internal/estimate-fee", post(estimate_fee::estimate_fee))
        .merge(create_wallet::routes())
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth))
        .layer(axum::middleware::from_fn(track_request_metrics))
        .with_state(state)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use std::sync::Arc;

    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use super::*;
    use crate::ChainError;
    use crate::routes::estimate_fee::{FeeOracle, NetworkFeeData, STELLAR_MINIMUM_BASE_RESERVE};
    use crate::stellar::payment::BASE_FEE;
    use engipay_core::Chain;

    struct FakeStellarOracle;

    impl FeeOracle for FakeStellarOracle {
        fn fees(
            &self,
            _chain: Chain,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<NetworkFeeData, ChainError>> + Send + '_>,
        > {
            Box::pin(async {
                Ok(NetworkFeeData::Stellar {
                    base_reserve_minor: STELLAR_MINIMUM_BASE_RESERVE,
                    base_fee_per_operation_minor: i128::from(BASE_FEE),
                })
            })
        }
    }

    async fn get_metrics(app: Router) -> (StatusCode, String) {
        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/metrics")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    async fn post_estimate_fee(app: Router, token: Option<&str>) -> StatusCode {
        let mut builder = Request::builder()
            .method("POST")
            .uri("/internal/estimate-fee")
            .header("content-type", "application/json");
        if let Some(t) = token {
            builder = builder.header("x-internal-token", t);
        }
        let request = builder
            .body(Body::from(
                serde_json::json!({
                    "chain": "stellar",
                    "asset": "XLM",
                    "amount": "1",
                    // The strkey of the ed25519 public key [1u8; 32].
                    "destination": "GAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHV4",
                })
                .to_string(),
            ))
            .unwrap();
        app.oneshot(request).await.unwrap().status()
    }

    #[tokio::test]
    async fn metrics_endpoint_is_always_reachable_with_no_token() {
        let app = router(Arc::new(FakeStellarOracle));
        let (status, body) = get_metrics(app).await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("chain_http_requests_total"));
    }

    #[tokio::test]
    async fn metrics_endpoint_requires_no_credential_even_when_auth_is_on() {
        let state = ChainHttpState::new(Arc::new(FakeStellarOracle)).with_token("secret");
        let app = router_with_state(state);
        let (status, _) = get_metrics(app).await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn request_without_token_is_accepted_when_no_token_configured() {
        let app = router(Arc::new(FakeStellarOracle));
        let status = post_estimate_fee(app, None).await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn request_without_token_is_rejected_when_token_configured() {
        let state = ChainHttpState::new(Arc::new(FakeStellarOracle)).with_token("secret");
        let app = router_with_state(state);
        let status = post_estimate_fee(app, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn request_with_wrong_token_is_rejected() {
        let state = ChainHttpState::new(Arc::new(FakeStellarOracle)).with_token("secret");
        let app = router_with_state(state);
        let status = post_estimate_fee(app, Some("wrong")).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn request_with_correct_token_is_accepted() {
        let state = ChainHttpState::new(Arc::new(FakeStellarOracle)).with_token("correct-secret");
        let app = router_with_state(state);
        let status = post_estimate_fee(app, Some("correct-secret")).await;
        assert_eq!(status, StatusCode::OK);
    }
}
