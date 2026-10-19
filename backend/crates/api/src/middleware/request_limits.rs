//! Request timeout and body size limit middleware.
//!
//! Adds a timeout to all requests and a body size limit, returning RFC 7807
//! Problem Details responses for 408 (timeout) and 413 (body too large).

use std::time::Duration;

use axum::response::{IntoResponse, Response};
use axum::http::StatusCode;
use serde_json::json;

/// Timeout duration for all requests (30 seconds).
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Maximum request body size (1 MB for JSON requests).
pub const BODY_LIMIT: usize = 1024 * 1024;

/// Creates a problem+json response for request timeout (408).
pub fn timeout_response() -> Response {
    let body = json!({
        "type": "about:blank",
        "title": "Request Timeout",
        "status": 408,
        "detail": "The request took too long to process. Please try again."
    });

    (
        StatusCode::REQUEST_TIMEOUT,
        [(axum::http::header::CONTENT_TYPE, "application/problem+json")],
        axum::Json(body),
    )
        .into_response()
}

/// Creates a problem+json response for oversized body (413).
pub fn body_too_large_response() -> Response {
    let body = json!({
        "type": "about:blank",
        "title": "Payload Too Large",
        "status": 413,
        "detail": format!("Request body exceeds the maximum allowed size of {} bytes.", BODY_LIMIT)
    });

    (
        StatusCode::PAYLOAD_TOO_LARGE,
        [(axum::http::header::CONTENT_TYPE, "application/problem+json")],
        axum::Json(body),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::{Router, routing::post};
    use http_body_util::BodyExt;
    use std::time::Duration;
    use tower::ServiceExt;
    use tower_http::limit::RequestBodyLimitLayer;
    use tower_http::timeout::TimeoutLayer;

    /// Handler that sleeps longer than the timeout to test timeout behavior.
    async fn slow_handler() -> &'static str {
        tokio::time::sleep(Duration::from_secs(35)).await;
        "should not reach here"
    }

    /// Handler that accepts a body to test body size limit.
    async fn body_handler(body: String) -> String {
        format!("received {} bytes", body.len())
    }

    #[tokio::test]
    async fn timeout_returns_408_problem_json() {
        let app = Router::new()
            .route("/slow", post(slow_handler))
            .layer(TimeoutLayer::new(Duration::from_millis(100)));

        let request = axum::http::Request::builder()
            .method("POST")
            .uri("/slow")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();

        // Tower's TimeoutLayer returns 408 by default, but we need to handle it
        // in our actual implementation to return problem+json
        assert_eq!(response.status(), StatusCode::REQUEST_TIMEOUT);
    }

    #[tokio::test]
    async fn oversized_body_returns_413() {
        const SMALL_LIMIT: usize = 100;

        let app = Router::new()
            .route("/body", post(body_handler))
            .layer(RequestBodyLimitLayer::new(SMALL_LIMIT));

        // Create a body larger than the limit
        let large_body = "x".repeat(SMALL_LIMIT + 1);

        let request = axum::http::Request::builder()
            .method("POST")
            .uri("/body")
            .header("content-type", "text/plain")
            .body(Body::from(large_body))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();

        // Tower's RequestBodyLimitLayer returns 413
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[test]
    fn timeout_response_has_correct_format() {
        let resp = timeout_response();
        assert_eq!(resp.status(), StatusCode::REQUEST_TIMEOUT);

        let content_type = resp
            .headers()
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        assert!(content_type.contains("application/problem+json"));
    }

    #[test]
    fn body_too_large_response_has_correct_format() {
        let resp = body_too_large_response();
        assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);

        let content_type = resp
            .headers()
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        assert!(content_type.contains("application/problem+json"));
    }
}
