//! Structured JSON request logging middleware with correlation IDs.
//!
//! Every request is logged as a single structured JSON line containing only
//! request metadata (never payloads, private keys, or auth signatures):
//! `correlation_id`, `method`, `path`, `status`, `duration_ms`, `user_id`
//! (when authenticated), and `client_ip`.
//!
//! The `correlation_id` is taken from the `X-Correlation-ID` request header
//! when present, otherwise a UUID is generated. It is echoed back on the
//! response via the `X-Correlation-ID` header so callers can trace requests.

use std::time::Instant;

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{HeaderName, HeaderValue, Request, Response},
    middleware::Next,
};
use std::net::SocketAddr;
use uuid::Uuid;

/// Header used to carry the correlation id in both directions.
pub const CORRELATION_ID_HEADER: &str = "x-correlation-id";

/// Extension inserted into the request so downstream handlers can read the
/// correlation id that was resolved for the current request.
#[derive(Clone, Debug)]
pub struct CorrelationId(pub String);

/// Resolve the correlation id for a request: reuse the inbound header when it
/// is a valid, non-empty value, otherwise generate a fresh UUID.
fn resolve_correlation_id(req: &Request<Body>) -> String {
    req.headers()
        .get(CORRELATION_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string())
}

/// Best-effort client IP extraction from the connection info extension.
fn client_ip(req: &Request<Body>) -> Option<String> {
    req.extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(addr)| addr.ip().to_string())
}

/// Best-effort authenticated user id extraction. Handlers that authenticate a
/// request insert a `user_id` string extension; when absent the field is
/// omitted from the log line.
fn user_id(req: &Request<Body>) -> Option<String> {
    req.extensions()
        .get::<UserId>()
        .map(|UserId(id)| id.clone())
}

/// Authenticated user id carried as a request extension.
#[derive(Clone, Debug)]
pub struct UserId(pub String);

/// Structured JSON request logging middleware.
///
/// Logs exactly one JSON object per request after the response is produced.
/// Only metadata is emitted; request bodies and headers are never logged.
pub async fn log_requests(mut req: Request<Body>, next: Next) -> Response<Body> {
    let start = Instant::now();
    let correlation_id = resolve_correlation_id(&req);
    let method = req.method().clone();
    let path = req.uri().path().to_owned();
    let ip = client_ip(&req);
    let user = user_id(&req);

    req.extensions_mut()
        .insert(CorrelationId(correlation_id.clone()));

    let mut response = next.run(req).await;

    let status = response.status().as_u16();
    let duration_ms = u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX);

    if let Ok(value) = HeaderValue::from_str(&correlation_id) {
        response
            .headers_mut()
            .insert(HeaderName::from_static(CORRELATION_ID_HEADER), value);
    }

    let event = serde_json::json!({
        "correlation_id": correlation_id,
        "method": method.as_str(),
        "path": path,
        "status": status,
        "duration_ms": duration_ms,
        "user_id": user,
        "client_ip": ip,
    });

    tracing::info!(target: "request", event = %event, "request completed");

    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;

    fn request_with_correlation(header: Option<&str>) -> Request<Body> {
        let mut builder = Request::builder().uri("/v1/transfers").method("POST");
        if let Some(value) = header {
            builder = builder.header(CORRELATION_ID_HEADER, value);
        }
        builder.body(Body::empty()).unwrap()
    }

    #[test]
    fn reuses_inbound_correlation_id() {
        let req = request_with_correlation(Some("abc-123"));
        assert_eq!(resolve_correlation_id(&req), "abc-123");
    }

    #[test]
    fn generates_correlation_id_when_absent() {
        let req = request_with_correlation(None);
        let id = resolve_correlation_id(&req);
        assert!(!id.is_empty());
        assert!(Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn generates_correlation_id_when_blank() {
        let req = request_with_correlation(Some("   "));
        let id = resolve_correlation_id(&req);
        assert!(Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn client_ip_is_none_without_connect_info() {
        let req = request_with_correlation(None);
        assert_eq!(client_ip(&req), None);
    }

    #[test]
    fn client_ip_is_extracted_from_connect_info() {
        let mut req = request_with_correlation(None);
        let addr: SocketAddr = "203.0.113.7:4242".parse().unwrap();
        req.extensions_mut().insert(ConnectInfo(addr));
        assert_eq!(client_ip(&req).as_deref(), Some("203.0.113.7"));
    }

    #[test]
    fn user_id_is_none_when_unauthenticated() {
        let req = request_with_correlation(None);
        assert_eq!(user_id(&req), None);
    }

    #[test]
    fn user_id_is_extracted_when_present() {
        let mut req = request_with_correlation(None);
        req.extensions_mut().insert(UserId("user-42".to_owned()));
        assert_eq!(user_id(&req).as_deref(), Some("user-42"));
    }

    #[test]
    fn log_event_contains_only_metadata_fields() {
        let event = serde_json::json!({
            "correlation_id": "abc-123",
            "method": "POST",
            "path": "/v1/transfers",
            "status": 200,
            "duration_ms": 12,
            "user_id": Option::<String>::None,
            "client_ip": Option::<String>::None,
        });
        let obj = event.as_object().unwrap();
        assert_eq!(obj.get("correlation_id").unwrap(), "abc-123");
        assert_eq!(obj.get("method").unwrap(), "POST");
        assert_eq!(obj.get("path").unwrap(), "/v1/transfers");
        assert_eq!(obj.get("status").unwrap(), 200);
        assert_eq!(obj.get("duration_ms").unwrap(), 12);
        assert!(obj.get("user_id").unwrap().is_null());
        assert!(obj.get("client_ip").unwrap().is_null());
        // No sensitive payload fields are ever emitted.
        assert!(obj.get("body").is_none());
        assert!(obj.get("private_key").is_none());
        assert!(obj.get("signature").is_none());
    }
}
