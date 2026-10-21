use axum::{extract::State, routing::post, Json, Router};
use k256::ecdsa::{RecoveryId, Signature};
use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::jwt::create_token;
use crate::{error::ApiError, AppState};

#[derive(Debug, Deserialize)]
pub struct VerifyEvmRequest {
    pub message: String,
    pub signature: String,
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

async fn verify_evm(
    State(state): State<AppState>,
    Json(req): Json<VerifyEvmRequest>,
) -> Result<Json<VerifyEvmResponse>, ApiError> {
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // Verify the signature and recover the address
    let recovered = recover_address(&req.message, &req.signature)
        .ok_or_else(|| ApiError::Unauthorized("signature is not valid".to_string()))?;

    let claimed = normalise_address(&req.address)
        .ok_or_else(|| ApiError::BadRequest("address must be a valid Ethereum address".to_string()))?;

    if recovered != claimed {
        return Err(ApiError::Unauthorized("signature does not match the address".to_string()));
    }

    // Find or create user and issue token in one transaction
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to start transaction: {}", e)))?;

    let existing_user = sqlx::query_as::<_, (Uuid,)>("SELECT id FROM users WHERE wallet_address = $1")
        .bind(&claimed)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to query user: {}", e)))?;

    let user_id = if let Some((id,)) = existing_user {
        id
    } else {
        let new_id = Uuid::new_v4();
        sqlx::query("INSERT INTO users (id, wallet_address) VALUES ($1, $2)")
            .bind(new_id)
            .bind(&claimed)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to create user: {}", e)))?;

        sqlx::query("INSERT INTO user_profiles (id, tier) VALUES ($1, 0)")
            .bind(new_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to create profile: {}", e)))?;

        new_id
    };

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to commit transaction: {}", e)))?;

    let token = create_token(user_id, &state.config.jwt_secret)
        .map_err(|e| ApiError::Internal(e))?;

    Ok(Json(VerifyEvmResponse { token, user_id }))
}

fn normalise_address(address: &str) -> Option<String> {
    let addr = address.trim_start_matches("0x");
    if addr.len() != 40 {
        return None;
    }
    if !addr.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("0x{}", addr.to_lowercase()))
}

fn recover_address(message: &str, signature: &str) -> Option<String> {
    // Decode signature from hex (with optional 0x prefix)
    let sig_hex = signature.trim_start_matches("0x");
    let sig_bytes = hex::decode(sig_hex).ok()?;

    if sig_bytes.len() != 65 {
        return None;
    }

    // Split signature into r, s, and recovery_id
    let recovery_id = RecoveryId::try_from(sig_bytes[64]).ok()?;
    let sig = Signature::from_bytes((&sig_bytes[..64]).into());

    // Hash the message with EIP-191 prefix using Keccak-256
    let message_hash = hash_eip191_message(message);

    // Recover public key from signature
    use k256::PublicKey;
    let public_key = PublicKey::recover_from_digest(&message_hash, &sig, recovery_id).ok()?;

    // Derive Ethereum address from public key
    Some(public_key_to_address(&public_key))
}

fn hash_eip191_message(message: &str) -> [u8; 32] {
    let prefix = format!("\x19Ethereum Signed Message:\n{}", message.len());
    let full_message = format!("{}{}", prefix, message);

    let mut hasher = Keccak256::new();
    hasher.update(full_message.as_bytes());
    let result = hasher.finalize();

    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result[..]);
    hash
}

fn public_key_to_address(public_key: &k256::PublicKey) -> String {
    // Get uncompressed public key bytes (skip the first byte which is 0x04)
    let uncompressed = public_key.to_encoded_point(false);
    let public_key_bytes = &uncompressed.as_bytes()[1..];

    // Keccak-256 hash of the public key
    let mut hasher = Keccak256::new();
    hasher.update(public_key_bytes);
    let hash = hasher.finalize();

    // Take the last 20 bytes and format as address with 0x prefix
    format!("0x{}", hex::encode(&hash[12..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn valid_evm_signature_recovers_correct_address() {
        use k256::ecdsa::SigningKey;
        use sha2::Digest;

        // Known test private key
        let signing_key = SigningKey::from_bytes(&hex::decode("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef").unwrap().try_into().unwrap()).unwrap();
        let public_key = signing_key.verifying_key();
        let expected_address = public_key_to_address(&public_key.into());

        // Create a test message
        let message = "Test message";

        // Sign the message
        let message_hash = hash_eip191_message(message);
        let (sig, recovery_id) = signing_key.sign_digest_recoverable(&message_hash).unwrap();

        // Encode signature with recovery id
        let mut sig_bytes = sig.to_bytes().to_vec();
        sig_bytes.push(recovery_id.to_byte());
        let sig_hex = hex::encode(&sig_bytes);

        // Verify
        let result = verify_signature(message, &sig_hex, &expected_address);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().to_lowercase(), expected_address.to_lowercase());
    }

    #[tokio::test]
    async fn invalid_signature_fails_verification() {
        let message = "Test message";
        let invalid_sig = "0x" + &"00".repeat(65);
        let address = "0x0000000000000000000000000000000000000000";

        let result = verify_signature(message, &invalid_sig, address);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn signature_mismatch_fails_verification() {
        use k256::ecdsa::SigningKey;

        let signing_key = SigningKey::from_bytes(&hex::decode("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef").unwrap().try_into().unwrap()).unwrap();
        let message = "Test message";

        let message_hash = hash_eip191_message(message);
        let (sig, recovery_id) = signing_key.sign_digest_recoverable(&message_hash).unwrap();

        let mut sig_bytes = sig.to_bytes().to_vec();
        sig_bytes.push(recovery_id.to_byte());
        let sig_hex = hex::encode(&sig_bytes);

        // Wrong address
        let wrong_address = "0x0000000000000000000000000000000000000000";

        let result = verify_signature(message, &sig_hex, wrong_address);
        assert!(result.is_err());
    }
}
