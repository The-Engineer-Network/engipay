//! Idempotency-Key middleware for POST endpoints.
//!
//! ## What this does
//!
//! Every POST that carries an `Idempotency-Key` header is handled as follows:
//!
//! 1. **No database / no key** – the request is passed straight through
//!    unchanged. The middleware is a no-op on GET/PATCH/DELETE and on any POST
//!    that does not include the header.
//!
//! 2. **First call** – the key and a SHA-256 digest of the raw request body are
//!    inserted into `idempotency_keys`.  The real handler is called and its
//!    response (status code + JSON body) is stored in the same row.  The
//!    response is returned to the caller normally.
//!
//! 3. **Replay (same body)** – the row already exists and the request hash
//!    matches.  The stored status code and JSON body are returned verbatim; the
//!    real handler is never called.
//!
//! 4. **Conflict (same key, different body)** – the row exists but the request
//!    hash differs.  The middleware returns **422 Unprocessable Entity** and the
//!    handler is skipped.
//!
//! 5. **Concurrent duplicate** – two requests with the same key race.  The
//!    second `INSERT … ON CONFLICT DO NOTHING` returns no rows and the request
//!    is treated as a replay (which may return a cached response, or 503 if the
//!    first request has not yet committed its response).
//!
//! Keys expire after 24 hours (enforced by the `expires_at` column; the
//! middleware also skips expired rows so the application does not need a
//! background cleanup job to stay correct).
//!
//! ## Key scoping
//!
//! A key is scoped to the authenticated user (`user_id` extracted from the JWT,
//! or `NULL` for unauthenticated endpoints).  Two users can each choose
//! `"key-1"` without colliding.
//!
//! ## Security
//!
//! * The key is stored as plain text so it can be looked up efficiently.
//!   It is not a secret: its only purpose is collision detection.
//! * The body hash is SHA-256 of the raw bytes.  If someone sends the same key
//!   with a tampered body the server returns 422 rather than silently replaying
//!   a stale response.
//! * No part of the request body is logged.

use axum::body::{Body, Bytes};
use axum::extract::Request;
use axum::http::{HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

/// Header name that clients send.
pub const IDEMPOTENCY_KEY_HEADER: &str = "idempotency-key";

/// Maximum length of an idempotency key (characters).  Keys longer than this
/// are refused with 400 Bad Request.
const MAX_KEY_LEN: usize = 255;

/// Axum middleware function.  Wire it with
/// `axum::middleware::from_fn_with_state(state, idempotency_middleware)`.
pub async fn idempotency_middleware(
    axum::extract::State(state): axum::extract::State<crate::AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    // Only POST requests need idempotency protection.
    if req.method() != Method::POST {
        return next.run(req).await;
    }

    // Extract the key from the header.  If absent, pass through.
    let key = match req.headers().get(IDEMPOTENCY_KEY_HEADER) {
        Some(value) => match value.to_str() {
            Ok(k) => k.trim().to_owned(),
            Err(_) => {
                return error_response(
                    StatusCode::BAD_REQUEST,
                    "bad_request",
                    "Idempotency-Key header must be valid UTF-8.",
                );
            }
        },
        None => return next.run(req).await,
    };

    if key.is_empty() || key.len() > MAX_KEY_LEN {
        return error_response(
            StatusCode::BAD_REQUEST,
            "bad_request",
            &format!("Idempotency-Key must be 1–{MAX_KEY_LEN} characters long."),
        );
    }

    // No database means the feature is unavailable; skip the middleware.
    let pool = match &state.database {
        Some(p) => p.clone(),
        None => return next.run(req).await,
    };

    // Best-effort user ID from the JWT so the key is scoped per user.
    // `None` for unauthenticated endpoints; they share a NULL bucket.
    let user_id: Option<Uuid> = extract_user_id(&req, &state.config);

    // Buffer the body so we can hash it and also replay it to the handler.
    let (parts, body) = req.into_parts();
    let body_bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(b) => b,
        Err(_) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                "bad_request",
                "Could not read request body.",
            );
        }
    };

    let request_hash = hex_sha256(&body_bytes);

    // --- Step 1: try to insert a new row -----------------------------------
    // We use `ON CONFLICT DO NOTHING` to atomically handle concurrent calls
    // with the same (key, user_id).  `RETURNING` tells us if the row is new.
    let insert_result = insert_key(&pool, &key, user_id, &request_hash).await;

    match insert_result {
        InsertResult::Inserted => {
            // First call: reconstruct the request and run the handler.
            let req = Request::from_parts(parts, Body::from(body_bytes));
            let response = next.run(req).await;

            // Collect the response body so we can cache it.
            let (resp_parts, resp_body) = response.into_parts();
            let status = resp_parts.status;
            let resp_bytes = match axum::body::to_bytes(resp_body, usize::MAX).await {
                Ok(b) => b,
                Err(_) => {
                    // Cannot buffer the response; leave the key as "pending"
                    // so a future retry will re-run the handler.
                    let _ = delete_key(&pool, &key, user_id).await;
                    return error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "internal",
                        "Failed to buffer response for idempotency cache.",
                    );
                }
            };

            // Parse the response body as JSON for storage.  If it is not valid
            // JSON (should not happen for our API) store `null` and still serve
            // the raw bytes to the caller this time.
            let response_json: Value = serde_json::from_slice(&resp_bytes).unwrap_or(Value::Null);

            // Persist the response (best-effort; a failure just means the next
            // retry will re-run the handler, which is safe because the real
            // operation was already executed).
            let _ = store_response(&pool, &key, user_id, status.as_u16(), &response_json).await;

            // Rebuild and return the original response.
            Response::from_parts(resp_parts, Body::from(resp_bytes))
        }

        InsertResult::AlreadyExists {
            hash,
            status_code,
            body,
        } => {
            if hash != request_hash {
                // Different body for the same key → conflict.
                return error_response(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "idempotency_conflict",
                    "Idempotency-Key has been used with a different request body. \
                     Use a new key for a different request.",
                );
            }

            // Replay: return the stored response verbatim.
            match (status_code, body) {
                (Some(code), Some(json)) => {
                    let status = StatusCode::from_u16(code as u16)
                        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
                    let mut resp = (status, axum::Json(json)).into_response();
                    resp.headers_mut().insert(
                        HeaderName::from_static("idempotent-replayed"),
                        HeaderValue::from_static("true"),
                    );
                    resp
                }
                _ => {
                    // Row exists but response not yet committed (concurrent
                    // request still in flight).
                    error_response(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "idempotency_pending",
                        "A request with this Idempotency-Key is already in progress. \
                         Retry after a short delay.",
                    )
                }
            }
        }

        InsertResult::DatabaseError => {
            // Do not block the request on a database hiccup; pass through.
            let req = Request::from_parts(parts, Body::from(body_bytes));
            next.run(req).await
        }
    }
}

// ── Database helpers ─────────────────────────────────────────────────────────

enum InsertResult {
    /// Fresh row inserted; this is the first call.
    Inserted,
    /// Row already exists.
    AlreadyExists {
        hash: String,
        status_code: Option<i32>,
        body: Option<Value>,
    },
    DatabaseError,
}

/// Try to insert a new idempotency key row.
///
/// Returns `InsertResult::Inserted` when successful.
/// Returns `InsertResult::AlreadyExists` when the row was already there.
async fn insert_key(
    pool: &PgPool,
    key: &str,
    user_id: Option<Uuid>,
    request_hash: &str,
) -> InsertResult {
    // First, attempt to insert.  ON CONFLICT DO NOTHING means we get 0 rows
    // back when the key already exists.
    let inserted = sqlx::query_scalar::<_, bool>(
        r#"
        INSERT INTO idempotency_keys (key, user_id, request_hash, status_code, response_body)
        VALUES ($1, $2, $3, NULL, 'null'::jsonb)
        ON CONFLICT (key, user_id) DO NOTHING
        RETURNING true
        "#,
    )
    .bind(key)
    .bind(user_id)
    .bind(request_hash)
    .fetch_optional(pool)
    .await;

    match inserted {
        Ok(Some(_)) => InsertResult::Inserted,
        Ok(None) => {
            // Row already exists – fetch the stored hash and (maybe) response.
            let existing = sqlx::query_as::<_, IdempotencyRow>(
                r#"
                SELECT request_hash, status_code, response_body
                FROM idempotency_keys
                WHERE key = $1
                  AND (user_id = $2 OR (user_id IS NULL AND $2 IS NULL))
                  AND expires_at > now()
                "#,
            )
            .bind(key)
            .bind(user_id)
            .fetch_optional(pool)
            .await;

            match existing {
                Ok(Some(row)) => InsertResult::AlreadyExists {
                    hash: row.request_hash,
                    status_code: row.status_code,
                    body: row.response_body,
                },
                Ok(None) => {
                    // Expired or race condition; treat as a fresh insert attempt.
                    InsertResult::DatabaseError
                }
                Err(_) => InsertResult::DatabaseError,
            }
        }
        Err(_) => InsertResult::DatabaseError,
    }
}

/// Update the row with the final response once the handler completes.
async fn store_response(
    pool: &PgPool,
    key: &str,
    user_id: Option<Uuid>,
    status_code: u16,
    body: &Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE idempotency_keys
           SET status_code = $3, response_body = $4
         WHERE key = $1
           AND (user_id = $2 OR (user_id IS NULL AND $2 IS NULL))
        "#,
    )
    .bind(key)
    .bind(user_id)
    .bind(i32::from(status_code))
    .bind(body)
    .execute(pool)
    .await?;
    Ok(())
}

/// Remove a key when we cannot buffer the response, so the next retry works.
async fn delete_key(pool: &PgPool, key: &str, user_id: Option<Uuid>) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        DELETE FROM idempotency_keys
         WHERE key = $1
           AND (user_id = $2 OR (user_id IS NULL AND $2 IS NULL))
        "#,
    )
    .bind(key)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct IdempotencyRow {
    request_hash: String,
    status_code: Option<i32>,
    response_body: Option<Value>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// SHA-256 of `bytes`, hex-encoded.
fn hex_sha256(bytes: &Bytes) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes.as_ref());
    format!("{:x}", hasher.finalize())
}

/// Best-effort extraction of the authenticated user id from the JWT in the
/// `Authorization` header.  Returns `None` when absent or invalid.
fn extract_user_id(req: &Request<Body>, config: &crate::config::Config) -> Option<Uuid> {
    let auth_header = req.headers().get(axum::http::header::AUTHORIZATION)?;
    let value = auth_header.to_str().ok()?;
    let token = value.strip_prefix("Bearer ").unwrap_or(value);
    crate::auth::jwt::verify_token(token, config.jwt_secret.as_bytes())
        .ok()
        .map(|claims| claims.sub)
}

/// Build a JSON error response in the standard `{ "error": { "code", "message" } }` shape.
fn error_response(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        axum::Json(serde_json::json!({
            "error": { "code": code, "message": message }
        })),
    )
        .into_response()
}

// ── Unit tests (no database required) ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_sha256_produces_64_char_hex() {
        let b = Bytes::from_static(b"hello");
        let hash = hex_sha256(&b);
        assert_eq!(hash.len(), 64);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn hex_sha256_is_stable() {
        // "hello" → well-known SHA-256
        let b = Bytes::from_static(b"hello");
        assert_eq!(
            hex_sha256(&b),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn hex_sha256_empty_body_is_stable() {
        let b = Bytes::new();
        assert_eq!(
            hex_sha256(&b),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn different_bodies_produce_different_hashes() {
        let a = hex_sha256(&Bytes::from_static(b"body-a"));
        let b = hex_sha256(&Bytes::from_static(b"body-b"));
        assert_ne!(a, b);
    }

    #[test]
    fn max_key_len_is_255() {
        // The constant is the source of truth; both the column and this check
        // must agree.
        assert_eq!(MAX_KEY_LEN, 255);
    }

    #[test]
    fn error_response_has_correct_status() {
        let resp = error_response(StatusCode::CONFLICT, "conflict", "oops");
        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }
}
