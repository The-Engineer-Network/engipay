use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

use crate::state::AppState;

/// A signed receipt as serialized and shared outside the app.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    /// Identifier of the key used to sign this receipt.
    pub key_id: String,
    /// The receipt payload (canonicalized before signing/verifying).
    pub payload: Value,
    /// Base64-encoded Ed25519 signature over the canonical payload.
    pub signature: String,
}

/// Response for `GET /receipts/public-key`.
#[derive(Debug, Serialize)]
pub struct PublicKeyResponse {
    /// The current (active) signing key ID.
    pub current_key_id: String,
    /// Base64-encoded current public key.
    pub current_public_key: String,
    /// Historical keys so old receipts remain verifiable.
    pub historical_keys: Vec<HistoricalKey>,
}

#[derive(Debug, Serialize)]
pub struct HistoricalKey {
    pub key_id: String,
    pub public_key: String,
}

/// Request body for `POST /receipts/verify`.
#[derive(Debug, Deserialize)]
pub struct VerifyRequest {
    pub receipt: Receipt,
}

/// Response for `POST /receipts/verify`.
#[derive(Debug, Serialize)]
pub struct VerifyResponse {
    pub valid: bool,
}

/// Canonicalize a JSON value into a deterministic byte representation.
///
/// Object keys are sorted recursively so that logically identical payloads
/// produce identical bytes regardless of serialization order.
fn canonicalize(value: &Value) -> Vec<u8> {
    fn write_canonical(value: &Value, out: &mut Vec<u8>) {
        match value {
            Value::Null => out.extend_from_slice(b"null"),
            Value::Bool(b) => out.extend_from_slice(if *b { b"true" } else { b"false" }),
            Value::Number(n) => out.extend_from_slice(n.to_string().as_bytes()),
            Value::String(s) => {
                out.push(b'"');
                // Escape via serde_json to match JSON string encoding.
                let encoded = serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string());
                // Strip surrounding quotes added by serde_json.
                let inner = &encoded[1..encoded.len() - 1];
                out.extend_from_slice(inner.as_bytes());
                out.push(b'"');
            }
            Value::Array(arr) => {
                out.push(b'[');
                for (i, item) in arr.iter().enumerate() {
                    if i > 0 {
                        out.push(b',');
                    }
                    write_canonical(item, out);
                }
                out.push(b']');
            }
            Value::Object(map) => {
                out.push(b'{');
                let mut keys: Vec<&String> = map.keys().collect();
                keys.sort();
                for (i, key) in keys.iter().enumerate() {
                    if i > 0 {
                        out.push(b',');
                    }
                    let encoded = serde_json::to_string(key).unwrap_or_else(|_| "\"\"".to_string());
                    let inner = &encoded[1..encoded.len() - 1];
                    out.push(b'"');
                    out.extend_from_slice(inner.as_bytes());
                    out.push(b'"');
                    out.push(b':');
                    write_canonical(&map[*key], out);
                }
                out.push(b'}');
            }
        }
    }

    let mut out = Vec::new();
    write_canonical(value, &mut out);
    out
}

/// Look up a verifying key by ID from the app state.
fn lookup_verifying_key(state: &AppState, key_id: &str) -> Option<VerifyingKey> {
    let keys = state.receipt_signing_keys();
    let entry = keys.iter().find(|k| k.key_id == key_id)?;
    let bytes = BASE64.decode(&entry.public_key).ok()?;
    let arr: [u8; 32] = bytes.as_slice().try_into().ok()?;
    VerifyingKey::from_bytes(&arr).ok()
}

async fn get_public_key(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let keys = state.receipt_signing_keys();
    let current = match keys.iter().find(|k| k.is_current) {
        Some(k) => k,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "no signing key configured" })),
            )
                .into_response();
        }
    };

    let historical_keys = keys
        .iter()
        .filter(|k| !k.is_current)
        .map(|k| HistoricalKey {
            key_id: k.key_id.clone(),
            public_key: k.public_key.clone(),
        })
        .collect();

    Json(PublicKeyResponse {
        current_key_id: current.key_id.clone(),
        current_public_key: current.public_key.clone(),
        historical_keys,
    })
    .into_response()
}

async fn verify_receipt(
    State(state): State<Arc<AppState>>,
    Json(req): Json<VerifyRequest>,
) -> impl IntoResponse {
    let receipt = req.receipt;

    let verifying_key = match lookup_verifying_key(&state, &receipt.key_id) {
        Some(k) => k,
        None => {
            return Json(VerifyResponse { valid: false }).into_response();
        }
    };

    let signature_bytes = match BASE64.decode(&receipt.signature) {
        Ok(b) => b,
        Err(_) => return Json(VerifyResponse { valid: false }).into_response(),
    };

    let signature = match Signature::from_slice(&signature_bytes) {
        Ok(s) => s,
        Err(_) => return Json(VerifyResponse { valid: false }).into_response(),
    };

    let message = canonicalize(&receipt.payload);
    let valid = verifying_key.verify(&message, &signature).is_ok();

    Json(VerifyResponse { valid }).into_response()
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/receipts/public-key", get(get_public_key))
        .route("/receipts/verify", post(verify_receipt))
}
