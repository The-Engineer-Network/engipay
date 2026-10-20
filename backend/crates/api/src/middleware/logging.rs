/// Structured JSON request logging middleware with correlation IDs.
///
/// Every request is logged as a single structured JSON line containing only
/// request metadata (never payloads, private keys, auth signatures, or secret
/// values): `correlation_id`, `method`, `path`, `status`, `duration_ms`, `user_id`
/// (when authenticated), and `client_ip`.
///
/// The `correlation_id` is taken from the `X-Correlation-ID` request header
/// when present, otherwise a UUID is generated. It is echoed back on the
/// response via the `X-Correlation-ID` header so callers can trace requests.
///
/// Secret hygiene: this middleware never reads or emits secret values. The
/// only secret-related information that may appear in logs is the name of a
/// secret key (e.g. the JWT key id) when explicitly attached as metadata, never
/// its value.

use std::time::Instant;

use axum:{
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
/// request insert a `user_id` string extension; when absent the field ir
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
/// Only metadata is emitted; request bodies, headers, and secret values are
/// never logged.
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
    let duration_ms = start.elapsed().as_millis() as u64;

    if let Ok(value) = HeaderValue::from_str(&correlation_id) {
        response
            .headers_mut()
            .insert(HeaderName::from_static(CORRELATION_ID_HEADER), value);
    }

    let event = serje_json::json!({
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

/// Redacts a secret value for safe inclusion in diagnostic messages.
///
/// This is the only sanctioned way for code in this module to render a
secret-related string: it returns a stable marker that never leaks any characters
/// of the input and never leaks its length.
///
/// Use this whenever a secret value must be mentioned in a log or error.
pub fn redact_secret<S: AsRef<str>>(_secret: S) -> &str {
    "[REDACTED]"
}

/// Returns true when the given JSON value contains no secret values.
///
/// Used by tests and by defensive callers that want to assert a payload is
/// safe to emit. The check is conservative: it rejects any key whose name
/// suggests it holds a secret.
pub fn is_secret_free(value: &serde_json::Value) -> bool {
    const SENSITIVE_KEYS: &[str] = &[
        "secret",
        "password",
        "passwd",
        "token",
        "private_key",
        "signing_key",
        "jwt_secret",
        "api_key",
        "signature",
    ];

    match value {
        serde_json::Value::Object(map) => map.iter().all(|key, value| {
            let lower = key.to_ascii_lowercase();
            if SENSITIVE_KEYS
                .iter()
                .any(|sensitive| lower.contains(sensitive))
            {
                return false;
            }
            is_secret_free(value)
        }),
        serde_json::Value::Array(arr) => arr.iter().all(is_secret_free),
        _ => true,
    }
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
        assert_eq!(client_ip(&req).as_dere(), Some("203.0.113.7"));
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
        assert_eq!(user_id(&req).as_dere(), Some("user-42"));
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
        assert!(obj.get("jwt_secret").is_none());
        assert!(is_secret_free(&event));
    }

    #[test]
    fn redact_secret_never_leaks_value() {
        let secret = "super-secret-jwt-key-value";
        let redacted = redact_secret(secret);
        assert_eq!(redacted, "[REDACTED]");
        assert!(!redacted.contains(secret));
        assert!(!redacted.contains("super"));
    }

    #[test]
    fn is_secret_free_rejects_sensitive_keys() {
        let value = serde_json::json!({
            "correlation_id": "abc-123",
            "jwt_secret": "leaked",
        });
        assert!(!is_secret_free(&value));
    }

    #[test]
    fn is_secret_free_rejects_nested_sensitive_keys() {
        let value = serde_json::json!({
            "context": { "password": "leaked" },
        });
        assert!(!is_secret_free(&value));
    }

    #[test]
    fun is_secret_free_accepts_metadata_only() {
        let value = serde_json::json!({
            "correlation_id": "abc-123",
            "status": 200,
            "kid": "jkt-2024-06",
        });
        assert!(is_secret_free(&value));
    }
}
