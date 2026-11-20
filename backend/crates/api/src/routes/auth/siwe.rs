//! Sign-in with Ethereum. The wallet signs a message that carries a nonce this
//! server issued (see `nonce.rs`). We recover the signing address from the
//! EIP-191 personal-message signature, consume the nonce, and issue a session
//! token for that address.

use axum::extract::State;
use axum::{Json, Router, routing::post};
use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};
use sqlx::Row;
use uuid::Uuid;

use crate::AppState;
use crate::auth::jwt::create_token;
use crate::error::ApiError;

#[derive(Debug, Deserialize)]
pub struct VerifyEvmRequest {
    /// The exact message the wallet signed, including its `Nonce:` line.
    pub message: String,
    /// 65-byte signature as hex: r, s, then the recovery byte (0/1 or 27/28).
    pub signature: String,
    /// The address the user claims to control.
    pub address: String,
}

#[derive(Debug, Serialize)]
pub struct VerifyEvmResponse {
    pub token: String,
    pub user_id: Uuid,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/auth/verify-evm", post(verify_evm))
}

/// POST /v1/auth/verify-evm - prove control of an address and start a session.
async fn verify_evm(
    State(state): State<AppState>,
    Json(req): Json<VerifyEvmRequest>,
) -> Result<Json<VerifyEvmResponse>, ApiError> {
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let claimed = normalise_address(&req.address).ok_or_else(|| {
        ApiError::BadRequest("address must be a 0x-prefixed 20-byte hex value".to_string())
    })?;
    let nonce = nonce_from_message(&req.message)
        .ok_or_else(|| ApiError::BadRequest("message must include a Nonce line".to_string()))?;
    let recovered = recover_address(&req.message, &req.signature)
        .ok_or_else(|| ApiError::Unauthorized("signature is not valid".to_string()))?;
    if recovered != claimed {
        return Err(ApiError::Unauthorized(
            "signature does not match the address".to_string(),
        ));
    }

    // Consuming the nonce and finding or creating the user happen in one
    // transaction, so a failed sign-in does not burn the nonce for nothing.
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| db_error("failed to start sign-in", e))?;

    let consumed = sqlx::query(
        "UPDATE auth_nonces SET consumed_at = now() \
         WHERE nonce = $1 AND consumed_at IS NULL AND expires_at > now()",
    )
    .bind(&nonce)
    .execute(&mut *tx)
    .await
    .map_err(|e| db_error("failed to consume nonce", e))?;
    if consumed.rows_affected() == 0 {
        return Err(ApiError::Unauthorized(
            "nonce is unknown, already used, or expired".to_string(),
        ));
    }

    let existing = sqlx::query("SELECT id FROM users WHERE wallet_address = $1")
        .bind(&claimed)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| db_error("failed to look up user", e))?;

    let user_id = match existing {
        Some(row) => row
            .try_get::<Uuid, _>("id")
            .map_err(|e| db_error("failed to read user id", e))?,
        None => {
            let id = Uuid::new_v4();
            sqlx::query("INSERT INTO users (id, wallet_address) VALUES ($1, $2)")
                .bind(id)
                .bind(&claimed)
                .execute(&mut *tx)
                .await
                .map_err(|e| db_error("failed to create user", e))?;
            sqlx::query("INSERT INTO user_profiles (id, tier) VALUES ($1, 0)")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|e| db_error("failed to create profile", e))?;
            id
        }
    };

    tx.commit()
        .await
        .map_err(|e| db_error("failed to finish sign-in", e))?;

    let token = create_token(user_id, claimed, state.config.jwt_secret.as_bytes())
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to issue session: {}", e)))?;

    Ok(Json(VerifyEvmResponse { token, user_id }))
}

fn db_error(context: &str, error: sqlx::Error) -> ApiError {
    ApiError::Internal(anyhow::anyhow!("{context}: {error}"))
}

/// Returns the address as lowercase `0x` plus 40 hex digits, or None when the
/// input is not an address.
fn normalise_address(input: &str) -> Option<String> {
    let hex = input
        .strip_prefix("0x")
        .or_else(|| input.strip_prefix("0X"))?;
    if hex.len() != 40 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("0x{}", hex.to_ascii_lowercase()))
}

/// The nonce is the text after `Nonce: ` on the message's own line.
fn nonce_from_message(message: &str) -> Option<String> {
    let nonce = message
        .lines()
        .find_map(|line| line.strip_prefix("Nonce: "))?
        .trim();
    let plausible =
        (8..=64).contains(&nonce.len()) && nonce.bytes().all(|byte| byte.is_ascii_alphanumeric());
    plausible.then(|| nonce.to_string())
}

/// EIP-191 `personal_sign` digest: keccak256 of the prefixed message.
fn eip191_digest(message: &str) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(b"\x19Ethereum Signed Message:\n");
    hasher.update(message.len().to_string().as_bytes());
    hasher.update(message.as_bytes());
    hasher.finalize().into()
}

/// The Ethereum address of a public key: the last 20 bytes of the keccak256
/// hash of the uncompressed key without its 0x04 prefix.
fn address_of(key: &VerifyingKey) -> String {
    let point = key.to_encoded_point(false);
    let hash = Keccak256::digest(&point.as_bytes()[1..]);
    format!("0x{}", hex::encode(&hash[12..]))
}

/// Recovers the lowercase address that signed `message`, or None when the
/// signature is malformed or does not recover to any key.
fn recover_address(message: &str, signature_hex: &str) -> Option<String> {
    let bytes = hex::decode(signature_hex.strip_prefix("0x").unwrap_or(signature_hex)).ok()?;
    if bytes.len() != 65 {
        return None;
    }
    let v = bytes[64];
    let recovery_byte = if v >= 27 { v.checked_sub(27)? } else { v };
    let recovery_id = RecoveryId::from_byte(recovery_byte)?;
    let signature = Signature::from_slice(&bytes[..64]).ok()?;
    let key = VerifyingKey::recover_from_prehash(&eip191_digest(message), &signature, recovery_id)
        .ok()?;
    Some(address_of(&key))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use k256::ecdsa::SigningKey;

    fn sign(message: &str, key: &SigningKey) -> String {
        let (signature, recovery_id) = key
            .sign_prehash_recoverable(&eip191_digest(message))
            .unwrap();
        let mut bytes = signature.to_bytes().to_vec();
        bytes.push(recovery_id.to_byte() + 27);
        format!("0x{}", hex::encode(bytes))
    }

    fn test_key() -> SigningKey {
        SigningKey::from_slice(&[7u8; 32]).unwrap()
    }

    #[test]
    fn recovers_the_address_that_signed_the_message() {
        let key = test_key();
        let message = "Sign in to EngiPay\n\nNonce: abcdef1234";
        let signature = sign(message, &key);
        assert_eq!(
            recover_address(message, &signature),
            Some(address_of(key.verifying_key()))
        );
    }

    #[test]
    fn a_changed_message_recovers_a_different_address() {
        let key = test_key();
        let signature = sign("Sign in to EngiPay\nNonce: abcdef1234", &key);
        assert_ne!(
            recover_address("Sign in to EngiPay\nNonce: 00000000", &signature),
            Some(address_of(key.verifying_key()))
        );
    }

    #[test]
    fn rejects_a_malformed_signature() {
        assert_eq!(recover_address("hello", "0x1234"), None);
        assert_eq!(recover_address("hello", "not hex"), None);
    }

    #[test]
    fn reads_the_nonce_from_its_own_line() {
        assert_eq!(
            nonce_from_message("Sign in\nNonce: abcdef1234\r\n"),
            Some("abcdef1234".to_string())
        );
        assert_eq!(nonce_from_message("Sign in with no nonce"), None);
        assert_eq!(nonce_from_message("Nonce: short"), None);
    }

    #[test]
    fn normalises_addresses_to_lowercase() {
        assert_eq!(
            normalise_address("0xABCDEF0123456789abcdef0123456789ABCDEF01"),
            Some("0xabcdef0123456789abcdef0123456789abcdef01".to_string())
        );
        assert_eq!(normalise_address("0x1234"), None);
        assert_eq!(
            normalise_address("abcdef0123456789abcdef0123456789abcdef01"),
            None
        );
    }
}
