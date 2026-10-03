use axum::{extract::State, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::{error::ApiError, AppState};

#[derive(Debug, Deserialize)]
pub struct VerifyEvmRequest {
    pub message: String,
    pub signature: String,
    pub address: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub user_id: Uuid,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/auth/verify-evm", post(verify_evm))
}

async fn verify_evm(
    State(state): State<AppState>,
    Json(req): Json<VerifyEvmRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // Verify the signature
    let address = verify_signature(&req.message, &req.signature, &req.address)?;

    // Normalize the address to lowercase for consistent storage
    let wallet_address = address.to_lowercase();

    // Check if user exists
    let existing_user = sqlx::query("SELECT id FROM users WHERE wallet_address = $1")
        .bind(&wallet_address)
        .fetch_optional(db)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let user_id = if let Some(user) = existing_user {
        let id: Uuid = user.try_get("id").map_err(|e| ApiError::Internal(e.into()))?;
        id
    } else {
        // Create new user
        let new_user_id = Uuid::new_v4();
        sqlx::query("INSERT INTO users (id, wallet_address) VALUES ($1, $2)")
            .bind(new_user_id)
            .bind(&wallet_address)
            .execute(db)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

        // Create user profile
        sqlx::query("INSERT INTO user_profiles (id, tier) VALUES ($1, 0)")
            .bind(new_user_id)
            .execute(db)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

        new_user_id
    };

    Ok(Json(AuthResponse { user_id }))
}

fn verify_signature(message: &str, signature: &str, claimed_address: &str) -> Result<String, ApiError> {
    use k256::ecdsa::{RecoveryId, Signature};
    use k256::PublicKey;

    // Decode the signature from hex
    let sig_bytes = hex::decode(signature.trim_start_matches("0x"))
        .map_err(|_| ApiError::BadRequest("invalid signature encoding".to_string()))?;

    if sig_bytes.len() != 65 {
        return Err(ApiError::BadRequest(
            "signature must be 65 bytes".to_string(),
        ));
    }

    let recovery_id = RecoveryId::try_from(sig_bytes[64])
        .map_err(|_| ApiError::BadRequest("invalid recovery id".to_string()))?;

    let signature = Signature::from_bytes((&sig_bytes[..64]).into());

    // Hash the message with EIP-191 prefix
    let message_hash = hash_eip191_message(message);

    // Recover the public key
    let public_key =
        PublicKey::recover_from_digest(&message_hash, &signature, recovery_id).map_err(|_| {
            ApiError::BadRequest("signature verification failed".to_string())
        })?;

    // Get the address from the public key
    let recovered_address = public_key_to_address(&public_key);

    // Compare with claimed address (case-insensitive)
    if recovered_address.to_lowercase() != claimed_address.to_lowercase() {
        return Err(ApiError::BadRequest(
            "signature does not match address".to_string(),
        ));
    }

    Ok(recovered_address)
}

fn hash_eip191_message(message: &str) -> sha2::digest::Output<sha2::Sha256> {
    use sha2::Digest;

    let prefix = format!("\x19Ethereum Signed Message:\n{}", message.len());
    let full_message = format!("{}{}", prefix, message);

    let mut hasher = sha2::Sha256::new();
    hasher.update(full_message.as_bytes());
    hasher.finalize()
}

fn public_key_to_address(public_key: &k256::PublicKey) -> String {
    use sha3::Digest;

    // Get uncompressed public key bytes (skip the first byte which is 0x04)
    let uncompressed = public_key.to_encoded_point(false);
    let public_key_bytes = &uncompressed.as_bytes()[1..];

    // Keccak-256 hash of the public key
    let mut hasher = sha3::Keccak256::new();
    hasher.update(public_key_bytes);
    let hash = hasher.finalize();

    // Take the last 20 bytes and format as address
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
