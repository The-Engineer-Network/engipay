//! Panic recovery middleware.
//!
//! If a request handler panics, Tower/Axum would normally drop the TCP
//! connection without sending a response. [`CatchPanic`] catches the panic,
//! logs it with [`tracing`], and returns an RFC 7807 Problem Details JSON body
//! with status `500 Internal Server Error` so the client always gets a clean
//! response.
//!
//! # Usage
//!
//! ```rust,ignore
//! use engipay_api::middleware::recovery::CatchPanicLayer;
//!
//! let app = Router::new()
//!     .route("/", get(handler))
//!     .layer(CatchPanicLayer::new());
//! ```

use std::any::Any;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::pin::Pin;
use std::task::{Context, Poll};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::FutureExt;
use serde_json::json;
use tower::{Layer, Service};

// ── Layer ────────────────────────────────────────────────────────────────────

/// Tower [`Layer`] that wraps each service with [`CatchPanic`].
#[derive(Debug, Clone, Default)]
pub struct CatchPanicLayer;

impl CatchPanicLayer {
    pub fn new() -> Self {
        Self
    }
}

impl<S> Layer<S> for CatchPanicLayer {
    type Service = CatchPanic<S>;

    fn layer(&self, inner: S) -> Self::Service {
        CatchPanic { inner }
    }
}

// ── Service ──────────────────────────────────────────────────────────────────

/// Catches panics in the wrapped service and converts them into RFC 7807
/// `500 Internal Server Error` responses.
#[derive(Debug, Clone)]
pub struct CatchPanic<S> {
    inner: S,
}

impl<S> Service<Request<Body>> for CatchPanic<S>
where
    S: Service<Request<Body>, Response = Response> + Send + Clone + 'static,
    S::Future: Send + 'static,
    S::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    type Response = Response;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Response, S::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<Body>) -> Self::Future {
        // `catch_unwind` must wrap the future itself, not its construction:
        // a handler that panics does so when its future is *polled*, so
        // wrapping `|| future` would only catch panics raised eagerly by the
        // service. `AssertUnwindSafe` lets us poll an arbitrary service future
        // inside the unwind boundary.
        let future = self.inner.call(req);

        Box::pin(async move {
            match AssertUnwindSafe(future).catch_unwind().await {
                Ok(response) => response,
                Err(panic_payload) => Ok(panic_response(panic_payload)),
            }
        })
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Extracts a human-readable message from the panic payload, logs it, and
/// builds an RFC 7807 problem details response.
fn panic_response(panic: Box<dyn Any + Send>) -> Response {
    let message: String = if let Some(s) = panic.downcast_ref::<&str>() {
        (*s).to_owned()
    } else if let Some(s) = panic.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic payload".to_owned()
    };

    tracing::error!(panic_message = %message, "request handler panicked");

    // RFC 7807 Problem Details — the client gets no internal detail, only a
    // stable type URI and a generic title. The raw panic message never leaves
    // the process.
    let body = json!({
        "type":   "about:blank",
        "title":  "Internal Server Error",
        "status": 500,
        "detail": "An unexpected error occurred. Please try again later."
    });

    (
        StatusCode::INTERNAL_SERVER_ERROR,
        [(axum::http::header::CONTENT_TYPE, "application/problem+json")],
        axum::Json(body),
    )
        .into_response()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use axum::Router;
    use axum::routing::get;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::*;

    /// A handler that always panics — used to verify the middleware catches it.
    async fn panicking_handler() -> &'static str {
        panic!("deliberate test panic")
    }

    /// A handler that returns normally — verifies the happy path is not broken.
    async fn ok_handler() -> &'static str {
        "ok"
    }

    fn app() -> Router {
        Router::new()
            .route("/panic", get(panicking_handler))
            .route("/ok", get(ok_handler))
            .layer(CatchPanicLayer::new())
    }

    #[tokio::test]
    async fn panicking_handler_returns_500_problem_json() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/panic")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

        let content_type = response
            .headers()
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        assert!(
            content_type.contains("application/problem+json"),
            "expected application/problem+json, got {content_type:?}"
        );

        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body["status"], 500);
        assert_eq!(body["title"], "Internal Server Error");
        // The detail must NOT expose the raw Rust panic message.
        assert_ne!(body["detail"], "deliberate test panic");
    }

    #[tokio::test]
    async fn normal_handler_is_not_affected() {
        let response = app()
            .oneshot(Request::builder().uri("/ok").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&bytes[..], b"ok");
    }

    #[test]
    fn panic_response_has_correct_status() {
        let resp = panic_response(Box::new("test panic".to_owned()));
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
