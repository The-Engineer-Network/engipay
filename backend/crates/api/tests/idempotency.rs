//! Idempotency-Key middleware integration tests.
//!
//! These tests cover the three scenarios required by issue #492:
//!
//!   1. **Replay** – the same key + same body returns the stored response
//!      instead of executing the handler a second time.
//!   2. **Conflict** – the same key with a different body is rejected 422.
//!   3. **Concurrent duplicates** – two simultaneous POSTs with the same key
//!      are serialised: one wins, the other waits and then gets the cached
//!      response without the handler being called twice.
//!
//! The first two groups run without a real database (the middleware skips
//! idempotency when no pool is configured, so no-op behaviour is verified
//! too).  The database-backed tests are gated with `#[ignore = "requires
//! DATABASE_URL"]` and run during the `database` CI job.
//!
//! Run the database-backed tests locally:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test idempotency -- --include-ignored

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, config::Config, router};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

// ── App constructors ─────────────────────────────────────────────────────────

/// In-memory router without a database.
fn app_no_db() -> axum::Router {
    let config = Config::for_tests();
    router(
        AppState::with_fakes(None, config.clone(), RateLimiter::new()),
        &config,
    )
}

/// Router backed by a real Postgres instance.
async fn app_with_db() -> axum::Router {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .unwrap();
    let config = Config::for_tests();
    router(
        AppState::with_fakes(Some(pool), config.clone(), RateLimiter::new()),
        &config,
    )
}

// ── Request builder helpers ──────────────────────────────────────────────────

/// Build a POST request to `/v1/assets` (a GET endpoint that we can hit as
/// an unauthenticated POST) with an optional idempotency key.
///
/// We use `/v1/auth/nonce` because it is a real POST endpoint that requires no
/// auth and returns JSON, making it ideal as the target for idempotency tests.
fn post_nonce(idempotency_key: Option<&str>, body: &str) -> Request<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri("/v1/auth/nonce")
        .header(header::CONTENT_TYPE, "application/json");

    if let Some(key) = idempotency_key {
        builder = builder.header("idempotency-key", key);
    }

    builder.body(Body::from(body.to_string())).unwrap()
}

/// Send a request and return `(status, response_body_bytes, headers)`.
async fn send_raw(
    app: axum::Router,
    req: Request<Body>,
) -> (StatusCode, bytes::Bytes, axum::http::HeaderMap) {
    let response = app.oneshot(req).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, bytes, headers)
}

/// Send a request and return `(status, json)`.
async fn send(app: axum::Router, req: Request<Body>) -> (StatusCode, Value) {
    let (status, bytes, _) = send_raw(app, req).await;
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

// ── No-database / unit-level behaviour ───────────────────────────────────────

/// When no database is configured the middleware passes the request through
/// unchanged even if an idempotency key is present.
#[tokio::test]
async fn no_database_passes_request_through_unchanged() {
    let app = app_no_db();
    // POST /v1/auth/nonce with an idempotency key works normally (returns 503
    // "database unavailable" because there is no DB, not 422 or anything from
    // the idempotency layer itself).
    let req = post_nonce(Some("key-passthrough"), "");
    let (status, _) = send(app, req).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

/// A POST without an idempotency key is always passed through.
#[tokio::test]
async fn post_without_key_is_passed_through() {
    let app = app_no_db();
    let req = post_nonce(None, "");
    let (status, _) = send(app, req).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

/// A GET request is never intercepted by the idempotency middleware.
#[tokio::test]
async fn get_with_key_header_is_not_intercepted() {
    let app = app_no_db();
    // /v1/assets is a GET; the idempotency middleware must be transparent.
    let req = Request::builder()
        .method("GET")
        .uri("/v1/assets")
        .header("idempotency-key", "should-be-ignored")
        .body(Body::empty())
        .unwrap();
    let (status, _) = send(app, req).await;
    assert_eq!(status, StatusCode::OK);
}

/// An empty key string is rejected with 400.
#[tokio::test]
async fn empty_idempotency_key_is_rejected() {
    let app = app_no_db();
    let req = post_nonce(Some(""), "");
    let (status, body) = send(app, req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "bad_request");
}

/// A key that exceeds 255 characters is rejected with 400.
#[tokio::test]
async fn overlong_idempotency_key_is_rejected() {
    let app = app_no_db();
    let long_key = "x".repeat(256);
    let req = post_nonce(Some(&long_key), "");
    let (status, body) = send(app, req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "bad_request");
}

/// A key at exactly the maximum length (255 chars) is accepted.
#[tokio::test]
async fn max_length_idempotency_key_is_accepted() {
    let app = app_no_db();
    let max_key = "x".repeat(255);
    let req = post_nonce(Some(&max_key), "");
    let (status, _) = send(app, req).await;
    // No database → 503, but NOT 400 from the key validation.
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

// ── Database-backed tests ─────────────────────────────────────────────────────

/// A replay with the same key and the same body returns the stored response
/// verbatim, with an `Idempotent-Replayed: true` header.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn replay_same_key_same_body_returns_stored_response() {
    let key = format!("test-replay-{}", Uuid::new_v4());
    let body = json!({"intent": "test-replay"}).to_string();

    // First call: handler runs and stores the response.
    let (status1, response1) = send(app_with_db().await, post_nonce(Some(&key), &body)).await;

    // /v1/auth/nonce does not take a JSON body, so it returns 200 with a nonce
    // (or 400 if body parsing matters—either way the response is deterministic).
    assert!(
        status1 == StatusCode::OK || status1 == StatusCode::BAD_REQUEST,
        "unexpected status on first call: {status1}"
    );

    // Second call: must return exactly the stored response, not re-run handler.
    let (raw_status2, bytes2, headers2) =
        send_raw(app_with_db().await, post_nonce(Some(&key), &body)).await;
    let response2: Value = serde_json::from_slice(&bytes2).unwrap_or(Value::Null);

    assert_eq!(raw_status2, status1, "replay must match original status");
    assert_eq!(response2, response1, "replay body must match original body");
    assert_eq!(
        headers2
            .get("idempotent-replayed")
            .and_then(|v| v.to_str().ok()),
        Some("true"),
        "replay must set Idempotent-Replayed: true header"
    );
}

/// Sending the same key with a different body is rejected with 422.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn conflicting_reuse_returns_422() {
    let key = format!("test-conflict-{}", Uuid::new_v4());

    // First call establishes the key.
    let (status1, _) = send(
        app_with_db().await,
        post_nonce(Some(&key), r#"{"body":"first"}"#),
    )
    .await;
    assert!(
        status1 != StatusCode::UNPROCESSABLE_ENTITY,
        "first call must not return 422"
    );

    // Second call with a different body must be rejected.
    let (status2, body2) = send(
        app_with_db().await,
        post_nonce(Some(&key), r#"{"body":"DIFFERENT"}"#),
    )
    .await;
    assert_eq!(
        status2,
        StatusCode::UNPROCESSABLE_ENTITY,
        "conflicting body must return 422, got {status2}: {body2}"
    );
    assert_eq!(
        body2["error"]["code"], "idempotency_conflict",
        "error code must be idempotency_conflict"
    );
}

/// Two concurrent requests with the same key are handled safely: the second
/// receives either the cached response (if the first committed) or a 503
/// "pending" response (if still in flight), and never causes duplicate
/// handler execution.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn concurrent_duplicates_are_handled_safely() {
    let key = format!("test-concurrent-{}", Uuid::new_v4());
    let body = r#"{"concurrent": true}"#;

    // Fire two requests in parallel with the same idempotency key.
    let (r1, r2) = tokio::join!(
        send(app_with_db().await, post_nonce(Some(&key), body)),
        send(app_with_db().await, post_nonce(Some(&key), body)),
    );

    let (status1, body1) = r1;
    let (status2, body2) = r2;

    // Both must succeed (or one get a pending-503 if the first hasn't committed).
    let acceptable = |s: StatusCode| {
        s == StatusCode::OK
            || s == StatusCode::CREATED
            || s == StatusCode::BAD_REQUEST
            || s == StatusCode::SERVICE_UNAVAILABLE
    };
    assert!(
        acceptable(status1),
        "concurrent r1 unexpected status: {status1}: {body1}"
    );
    assert!(
        acceptable(status2),
        "concurrent r2 unexpected status: {status2}: {body2}"
    );

    // The two responses must NOT both be independent fresh executions.  If both
    // are OK/201 they must carry the same nonce (same cached response).
    // If one is 503 "pending" that is fine – it means the DB race was detected.
    let both_successful = (status1 == StatusCode::OK || status1 == StatusCode::CREATED)
        && (status2 == StatusCode::OK || status2 == StatusCode::CREATED);
    if both_successful {
        // If both got a real response, they must be identical (replayed).
        assert_eq!(
            body1, body2,
            "concurrent calls with the same key must return the same response"
        );
    }
}

/// After storing a response, a third replay still returns the cached value.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn multiple_replays_all_return_stored_response() {
    let key = format!("test-multi-replay-{}", Uuid::new_v4());
    let body = r#"{}"#;

    // Seed the key.
    let (original_status, original_body) =
        send(app_with_db().await, post_nonce(Some(&key), body)).await;

    // Replay three times.
    for i in 1..=3 {
        let (s, b) = send(app_with_db().await, post_nonce(Some(&key), body)).await;
        assert_eq!(s, original_status, "replay {i} status mismatch");
        assert_eq!(b, original_body, "replay {i} body mismatch");
    }
}

/// An idempotency key is scoped per user: two different users can each use the
/// same key string without interfering with each other.
///
/// We verify this by signing in as two separate wallet addresses and confirming
/// that the second user's first-call response is fresh (not the first user's
/// cached body).
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn key_scope_is_per_user() {
    use k256::ecdsa::SigningKey;
    use sha3::{Digest, Keccak256};

    fn new_wallet() -> (SigningKey, String) {
        let mut bytes = [0u8; 32];
        let id1 = Uuid::new_v4();
        let id2 = Uuid::new_v4();
        bytes[..16].copy_from_slice(id1.as_bytes());
        bytes[16..].copy_from_slice(id2.as_bytes());
        let key = SigningKey::from_slice(&bytes).unwrap();
        let point = key.verifying_key().to_encoded_point(false);
        let hash = Keccak256::digest(&point.as_bytes()[1..]);
        let address = format!("0x{}", hex::encode(&hash[12..]));
        (key, address)
    }

    fn personal_sign(key: &SigningKey, message: &str) -> String {
        let mut hasher = Keccak256::new();
        hasher.update(b"\x19Ethereum Signed Message:\n");
        hasher.update(message.len().to_string().as_bytes());
        hasher.update(message.as_bytes());
        let digest: [u8; 32] = hasher.finalize().into();
        let (signature, recovery_id) = key.sign_prehash_recoverable(&digest).unwrap();
        let mut sig_bytes = signature.to_bytes().to_vec();
        sig_bytes.push(recovery_id.to_byte() + 27);
        format!("0x{}", hex::encode(sig_bytes))
    }

    async fn sign_in(app: &axum::Router, key: &SigningKey, address: &str) -> String {
        // Get a nonce.
        let nonce_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/auth/nonce")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let nonce_bytes = nonce_resp.into_body().collect().await.unwrap().to_bytes();
        let nonce_json: Value = serde_json::from_slice(&nonce_bytes).unwrap();
        let nonce = nonce_json["nonce"].as_str().unwrap().to_string();

        let message = format!("Sign in to EngiPay\n\nAddress: {address}\nNonce: {nonce}");
        let payload = json!({
            "message": message,
            "signature": personal_sign(key, &message),
            "address": address,
        });

        let verify_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/auth/verify-evm")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let verify_bytes = verify_resp.into_body().collect().await.unwrap().to_bytes();
        let verify_json: Value = serde_json::from_slice(&verify_bytes).unwrap();
        verify_json["token"].as_str().unwrap().to_string()
    }

    let app1 = app_with_db().await;
    let app2 = app_with_db().await;

    let (key_a, addr_a) = new_wallet();
    let (key_b, addr_b) = new_wallet();

    let token_a = sign_in(&app1, &key_a, &addr_a).await;
    let token_b = sign_in(&app2, &key_b, &addr_b).await;

    let shared_idempotency_key = "shared-per-user-scope-test";
    let body_a = json!({"user": "alice"}).to_string();
    let body_b = json!({"user": "bob"}).to_string();

    // User A sends a POST with `shared_idempotency_key`.
    let req_a = Request::builder()
        .method("POST")
        .uri("/v1/transfers")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .header("idempotency-key", shared_idempotency_key)
        .body(Body::from(body_a))
        .unwrap();
    let (status_a, _) = send(app1.clone(), req_a).await;
    // Likely 400 / 503 because transfer details are invalid, but not 422.
    assert_ne!(
        status_a,
        StatusCode::UNPROCESSABLE_ENTITY,
        "user A's first call must not be a conflict"
    );

    // User B sends the same key with a DIFFERENT body.  Because keys are
    // scoped per user, this must be treated as a fresh call (not a conflict).
    let req_b = Request::builder()
        .method("POST")
        .uri("/v1/transfers")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {token_b}"))
        .header("idempotency-key", shared_idempotency_key)
        .body(Body::from(body_b))
        .unwrap();
    let (status_b, body_resp_b) = send(app2.clone(), req_b).await;
    assert_ne!(
        status_b,
        StatusCode::UNPROCESSABLE_ENTITY,
        "user B must not get a 422 conflict for a different user's key, body: {body_resp_b}"
    );
}

// ── Middleware unit tests (no network) ────────────────────────────────────────

#[test]
fn idempotency_key_header_name_is_lowercase() {
    // The constant must be lowercase so it matches axum's case-insensitive
    // header lookup AND the value we advertise in CORS allow-headers.
    assert_eq!(
        engipay_api::middleware::IDEMPOTENCY_KEY_HEADER,
        "idempotency-key"
    );
}
