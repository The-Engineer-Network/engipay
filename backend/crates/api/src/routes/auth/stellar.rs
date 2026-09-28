use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use stellar_xdr::TransactionEnvelope;
use uuid::Uuid;

use crate::{
    auth::{jwt, stellar as sep10},
    error::ApiError,
    AppState,
};
use engipay_core::stellar::parse_address;

const NETWORK_PASSPHRASE: &str = "Test SDF Network ; September 2015";

#[derive(Debug, Deserialize)]
pub struct ChallengeRequest {
    pub account: String,
}

#[derive(Debug, Serialize)]
pub struct ChallengeResponse {
    pub transaction: String,
    pub network_passphrase: String,
}

#[derive(Debug, Deserialize)]
pub struct VerifyRequest {
    /// The challenge transaction XDR, still carrying the server's original
    /// signature, with the client's signature appended.
    pub transaction: String,
    pub account: String,
}

#[derive(Debug, Serialize)]
pub struct VerifyResponse {
    pub token: String,
    pub user_id: Uuid,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/stellar/challenge", get(get_challenge))
        .route("/auth/stellar/verify", post(verify))
}

async fn get_challenge(
    State(state): State<AppState>,
    Query(req): Query<ChallengeRequest>,
) -> Result<Json<ChallengeResponse>, ApiError> {
    // Validate the Stellar account
    let _address = parse_address(&req.account).map_err(|e| {
        ApiError::BadRequest(format!("Invalid Stellar account: {}", e))
    })?;

    // Build the challenge transaction
    let mut challenge = build_challenge_transaction(&req.account)?;

    // Sign the transaction if server key is configured
    if let Some(ref server_secret) = state.config.stellar_server_secret {
        challenge.transaction = sign_transaction_envelope(&challenge.transaction, server_secret)?;
    }

    Ok(Json(challenge))
}

/// `POST /v1/auth/stellar/verify`: exchanges a signed SEP-10 challenge for a
/// session JWT.
///
/// The client returns the envelope the server handed back from
/// `/auth/stellar/challenge`, with the server's signature still attached and
/// the client's own signature appended. This handler decodes the envelope,
/// re-runs the SEP-10 structural checks (sequence number, time bounds),
/// confirms both signatures are present and valid, and only then upserts the
/// user and issues a token.
async fn verify(
    State(state): State<AppState>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, ApiError> {
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let server_secret = state.config.stellar_server_secret.as_ref().ok_or_else(|| {
        ApiError::Internal(anyhow::anyhow!("STELLAR_SERVER_SECRET is not configured"))
    })?;

    // Validate the claimed account up front, independent of the envelope.
    let claimed_address = parse_address(&req.account)
        .map_err(|e| ApiError::BadRequest(format!("Invalid Stellar account: {}", e)))?;

    let envelope: TransactionEnvelope = stellar_xdr::ReadXdr::from_xdr(req.transaction.trim())
        .map_err(|_| ApiError::Unauthorized("malformed challenge transaction".to_string()))?;

    let tx_v1 = match &envelope {
        TransactionEnvelope::TxV1(tx_v1) => tx_v1,
        _ => {
            return Err(ApiError::Unauthorized(
                "challenge transaction must carry a signature".to_string(),
            ))
        }
    };

    // SEP-10 structural checks: seq_num == 0 and now within [min_time, max_time].
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| ApiError::Internal(anyhow::anyhow!("time error")))?
        .as_secs();

    sep10::validate_challenge(&tx_v1.tx, now)
        .map_err(|_| ApiError::Unauthorized("challenge transaction is invalid or expired".to_string()))?;

    // The client's transaction must be for the account it claims.
    if !source_account_matches(&tx_v1.tx.source_account, &claimed_address) {
        return Err(ApiError::Unauthorized(
            "transaction source does not match the claimed account".to_string(),
        ));
    }

    // `hash_transaction_with_network` hashes the bare `Transaction`, not the
    // signed envelope, so re-wrap it the same way the challenge builder does.
    let tx_hash = hash_transaction_with_network(&TransactionEnvelope::Tx(tx_v1.tx.clone()))?;

    let server_public_key = server_public_key_bytes(server_secret)?;
    let client_public_key = client_public_key_bytes(&claimed_address)?;

    let server_signed = tx_v1
        .signatures
        .iter()
        .any(|sig| signature_matches(&server_public_key, &tx_hash, &sig.signature.0));
    let client_signed = tx_v1
        .signatures
        .iter()
        .any(|sig| signature_matches(&client_public_key, &tx_hash, &sig.signature.0));

    if !server_signed {
        return Err(ApiError::Unauthorized(
            "server signature is missing or invalid".to_string(),
        ));
    }
    if !client_signed {
        return Err(ApiError::Unauthorized(
            "client signature is missing or invalid".to_string(),
        ));
    }

    let wallet_address = claimed_address.base_account().to_string();

    let existing_user = sqlx::query!("SELECT id FROM users WHERE wallet_address = $1", wallet_address)
        .fetch_optional(db)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let user_id = if let Some(user) = existing_user {
        Uuid::from_bytes(user.id.into())
    } else {
        let new_user_id = Uuid::new_v4();
        sqlx::query!(
            "INSERT INTO users (id, wallet_address) VALUES ($1, $2)",
            new_user_id,
            wallet_address
        )
        .execute(db)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

        sqlx::query!(
            "INSERT INTO user_profiles (id, tier) VALUES ($1, 0)",
            new_user_id
        )
        .execute(db)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

        new_user_id
    };

    let token = jwt::create_token(user_id, wallet_address, state.config.jwt_secret.as_bytes())
        .map_err(|_| ApiError::Internal(anyhow::anyhow!("failed to create session token")))?;

    Ok(Json(VerifyResponse { token, user_id }))
}

fn source_account_matches(
    source: &stellar_xdr::MuxedAccount,
    claimed: &engipay_core::stellar::StellarAddress,
) -> bool {
    let source_key = match source {
        stellar_xdr::MuxedAccount::KeyTypeEd25519(key) => key.0,
        stellar_xdr::MuxedAccount::KeyTypeMuxedEd25519(muxed) => muxed.ed25519.0,
    };

    match stellar_strkey::ed25519::PublicKey::from_string(claimed.base_account()) {
        Ok(pubkey) => pubkey.0 == source_key,
        Err(_) => false,
    }
}

fn server_public_key_bytes(server_secret: &str) -> Result<[u8; 32], ApiError> {
    use ed25519_dalek::SigningKey;
    use stellar_strkey::ed25519;

    let secret_key = ed25519::PrivateKey::from_string(server_secret.trim())
        .map_err(|_| ApiError::Internal(anyhow::anyhow!("invalid server secret key")))?;
    let signing_key = SigningKey::from_bytes(&secret_key.0);
    Ok(signing_key.verifying_key().to_bytes())
}

fn client_public_key_bytes(
    address: &engipay_core::stellar::StellarAddress,
) -> Result<[u8; 32], ApiError> {
    stellar_strkey::ed25519::PublicKey::from_string(address.base_account())
        .map(|key| key.0)
        .map_err(|_| ApiError::BadRequest("Invalid Stellar account".to_string()))
}

fn signature_matches(public_key: &[u8; 32], message: &[u8; 32], signature: &[u8]) -> bool {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    let Ok(verifying_key) = VerifyingKey::from_bytes(public_key) else {
        return false;
    };
    let Ok(signature) = Signature::try_from(signature) else {
        return false;
    };

    verifying_key.verify(message, &signature).is_ok()
}

fn build_challenge_transaction(account: &str) -> Result<ChallengeResponse, ApiError> {
    use rand::Rng;
    use stellar_xdr::{
        int64, uint32, uint64, ManageDataOp, Operation, OperationBody, TransactionExt, Uint256,
    };
    use std::time::{SystemTime, UNIX_EPOCH};

    // Get current time
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ApiError::Internal("time error".into()))?
        .as_secs();

    let timeout_seconds = 300u64;

    // Create a random 64-bit value for uniqueness
    let mut rng = rand::thread_rng();
    let random_bytes = rng.gen::<u64>();

    // Parse the account to get the account ID
    let account_id = parse_stellar_account_id(account)?;

    // Create manage_data operations
    let mut operations = Vec::new();

    // Add random data operations for challenge uniqueness
    let challenge_name = format!("challenge-{}", random_bytes);
    let challenge_value = format!("{}", random_bytes);

    let manage_data_op = Operation {
        source_account: None,
        body: OperationBody::ManageData(ManageDataOp {
            data_name: challenge_name.into(),
            data_value: Some(challenge_value.into_bytes().into()),
        }),
    };

    operations.push(manage_data_op);

    // Create the transaction
    let transaction = stellar_xdr::Transaction {
        source_account: account_id,
        fee: uint32(100),
        seq_num: int64(1),
        cond: TransactionExt::TxFeeBumpTx(None),
        operations: operations.into(),
        ext: TransactionExt::TxFeeBumpTx(None),
        time_bounds: Some(stellar_xdr::TimeBounds {
            min_time: uint64(now),
            max_time: uint64(now + timeout_seconds),
        }),
        memo: stellar_xdr::Memo::MemoNone,
    };

    // Encode to XDR
    let envelope = TransactionEnvelope::Tx(transaction);

    let xdr = stellar_xdr::WriteXdr::to_xdr(&envelope).map_err(|e| {
        ApiError::Internal(format!("failed to encode transaction: {}", e).into())
    })?;

    Ok(ChallengeResponse {
        transaction: xdr,
        network_passphrase: NETWORK_PASSPHRASE.to_string(),
    })
}

fn sign_transaction_envelope(xdr: &str, server_secret: &str) -> Result<String, ApiError> {
    use ed25519_dalek::{Signature, SigningKey};
    use sha2::Digest;
    use stellar_strkey::ed25519;
    use stellar_xdr::{TransactionEnvelope, WriteXdr};

    // Parse the server's secret key
    let secret_key = ed25519::PrivateKey::from_string(server_secret.trim())
        .map_err(|_| ApiError::BadRequest("invalid server secret key".to_string()))?;

    // Decode the XDR transaction envelope
    let mut envelope: TransactionEnvelope = stellar_xdr::ReadXdr::from_xdr(xdr)
        .map_err(|e| ApiError::Internal(format!("failed to decode transaction: {}", e).into()))?;

    // Sign the transaction
    let signing_key = SigningKey::from_bytes(&secret_key.0);

    // Hash the transaction with network passphrase
    let tx_hash = hash_transaction_with_network(&envelope)?;

    // Create the signature
    let sig = signing_key.sign(&tx_hash);

    // Add the signature to the envelope
    match &mut envelope {
        TransactionEnvelope::Tx(tx) => {
            let hint = stellar_xdr::SignatureHint(get_hint(&sig.to_bytes()));
            let signer_key = stellar_xdr::SignerKey::Ed25519(stellar_xdr::Uint256(secret_key.0));
            let decorated_sig = stellar_xdr::DecoratedSignature {
                hint,
                signature: stellar_xdr::Signature(sig.to_bytes().to_vec().into()),
            };

            let signatures = std::vec![decorated_sig];
            let tx_v0 = stellar_xdr::TransactionV1Envelope {
                tx: tx.clone(),
                signatures: signatures.into(),
            };

            let signed_envelope = TransactionEnvelope::TxV1(tx_v0);
            let signed_xdr = signed_envelope
                .to_xdr()
                .map_err(|e| ApiError::Internal(format!("failed to encode signed transaction: {}", e).into()))?;

            Ok(signed_xdr)
        }
        _ => Err(ApiError::Internal("unexpected transaction envelope type".into())),
    }
}

fn hash_transaction_with_network(envelope: &TransactionEnvelope) -> Result<[u8; 32], ApiError> {
    use sha2::Digest;
    use stellar_xdr::WriteXdr;

    // Create the transaction hash input: network hash + discriminant + tx hash
    let mut hasher = sha2::Sha256::new();

    // Hash the network passphrase
    let network_id = hash_network_passphrase(NETWORK_PASSPHRASE);
    hasher.update(&network_id);

    // Add discriminant for envelope type
    hasher.update(&[0, 0, 0, 2]); // ENVELOPE_TYPE_TX = 2

    // Extract and hash the transaction
    match envelope {
        TransactionEnvelope::Tx(tx) => {
            let tx_xdr = tx.to_xdr().map_err(|e| {
                ApiError::Internal(format!("failed to encode transaction for hashing: {}", e).into())
            })?;
            hasher.update(&tx_xdr);
        }
        _ => {
            return Err(ApiError::Internal("unexpected transaction envelope type".into()))
        }
    }

    let hash = hasher.finalize();
    let mut result = [0u8; 32];
    result.copy_from_slice(&hash);
    Ok(result)
}

fn hash_network_passphrase(passphrase: &str) -> [u8; 32] {
    use sha2::Digest;

    let mut hasher = sha2::Sha256::new();
    hasher.update(passphrase.as_bytes());
    let hash = hasher.finalize();

    let mut result = [0u8; 32];
    result.copy_from_slice(&hash);
    result
}

fn get_hint(signature: &[u8]) -> [u8; 4] {
    let len = signature.len();
    if len >= 4 {
        [signature[len - 4], signature[len - 3], signature[len - 2], signature[len - 1]]
    } else {
        let mut hint = [0u8; 4];
        hint[..len].copy_from_slice(signature);
        hint
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use stellar_strkey::ed25519;

    fn test_account() -> String {
        let key = ed25519::PublicKey([7; 32]);
        key.to_string()
    }

    fn test_secret_key() -> String {
        let key = ed25519::PrivateKey([3; 32]);
        key.as_unredacted().to_string()
    }

    #[test]
    fn challenge_transaction_has_valid_xdr() {
        let account = test_account();
        let response = build_challenge_transaction(&account).unwrap();

        // Should be able to decode the XDR
        let result: Result<TransactionEnvelope, _> = stellar_xdr::ReadXdr::from_xdr(&response.transaction);
        assert!(result.is_ok());
    }

    #[test]
    fn challenge_transaction_includes_random_data_operation() {
        let account = test_account();
        let response = build_challenge_transaction(&account).unwrap();

        let envelope: TransactionEnvelope = stellar_xdr::ReadXdr::from_xdr(&response.transaction).unwrap();

        match envelope {
            TransactionEnvelope::Tx(tx) => {
                assert!(!tx.operations.is_empty(), "transaction should have operations");
                // Check that at least one operation is ManageData
                let has_manage_data = tx.operations.iter().any(|op| {
                    matches!(op.body, stellar_xdr::OperationBody::ManageData(_))
                });
                assert!(has_manage_data, "transaction should have ManageData operation");
            }
            _ => panic!("unexpected envelope type"),
        }
    }

    #[test]
    fn challenge_transaction_has_time_bounds() {
        let account = test_account();
        let response = build_challenge_transaction(&account).unwrap();

        let envelope: TransactionEnvelope = stellar_xdr::ReadXdr::from_xdr(&response.transaction).unwrap();

        match envelope {
            TransactionEnvelope::Tx(tx) => {
                assert!(
                    tx.time_bounds.is_some(),
                    "transaction should have time bounds"
                );
                let bounds = tx.time_bounds.unwrap();
                assert!(bounds.max_time.0 > bounds.min_time.0, "max time should be greater than min time");
                assert_eq!(
                    bounds.max_time.0 - bounds.min_time.0,
                    300,
                    "time bounds should be 300 seconds"
                );
            }
            _ => panic!("unexpected envelope type"),
        }
    }

    #[test]
    fn signed_transaction_contains_valid_signature() {
        let account = test_account();
        let server_secret = test_secret_key();

        let response = build_challenge_transaction(&account).unwrap();
        let signed_xdr = sign_transaction_envelope(&response.transaction, &server_secret).unwrap();

        let envelope: TransactionEnvelope = stellar_xdr::ReadXdr::from_xdr(&signed_xdr).unwrap();

        match envelope {
            TransactionEnvelope::TxV1(tx_v1) => {
                assert!(
                    !tx_v1.signatures.is_empty(),
                    "signed transaction should have signatures"
                );
                assert_eq!(tx_v1.signatures.len(), 1, "should have exactly one signature");
            }
            _ => panic!("signed envelope should be TxV1"),
        }
    }

    #[test]
    fn invalid_account_format_rejected() {
        let result = build_challenge_transaction("invalid-account");
        assert!(result.is_err());
    }

    #[test]
    fn muxed_account_accepted() {
        let account = test_account();
        let muxed = engipay_core::stellar::muxed_deposit_address(&account, 42).unwrap();

        let response = build_challenge_transaction(&muxed);
        assert!(response.is_ok());
    }

    fn add_client_signature(server_signed_xdr: &str, client_secret: &str) -> String {
        use ed25519_dalek::SigningKey;
        use stellar_xdr::{ReadXdr, WriteXdr};

        let mut envelope: TransactionEnvelope = ReadXdr::from_xdr(server_signed_xdr).unwrap();
        let tx = match &envelope {
            TransactionEnvelope::TxV1(tx_v1) => tx_v1.tx.clone(),
            _ => panic!("expected a TxV1 envelope"),
        };
        let tx_hash = hash_transaction_with_network(&TransactionEnvelope::Tx(tx)).unwrap();

        let secret_key = ed25519::PrivateKey::from_string(client_secret.trim()).unwrap();
        let signing_key = SigningKey::from_bytes(&secret_key.0);
        let sig = signing_key.sign(&tx_hash);

        match &mut envelope {
            TransactionEnvelope::TxV1(tx_v1) => {
                let mut signatures = tx_v1.signatures.to_vec();
                signatures.push(stellar_xdr::DecoratedSignature {
                    hint: stellar_xdr::SignatureHint(get_hint(&sig.to_bytes())),
                    signature: stellar_xdr::Signature(sig.to_bytes().to_vec().into()),
                });
                tx_v1.signatures = signatures.try_into().unwrap();
            }
            _ => unreachable!(),
        }

        envelope.to_xdr().unwrap()
    }

    #[test]
    fn signature_matches_accepts_a_valid_signature() {
        let account = test_account();
        let secret = test_secret_key();

        let response = build_challenge_transaction(&account).unwrap();
        let signed_xdr = sign_transaction_envelope(&response.transaction, &secret).unwrap();
        let envelope: TransactionEnvelope = stellar_xdr::ReadXdr::from_xdr(&signed_xdr).unwrap();

        let tx_v1 = match &envelope {
            TransactionEnvelope::TxV1(tx_v1) => tx_v1,
            _ => panic!("expected TxV1"),
        };
        let tx_hash = hash_transaction_with_network(&TransactionEnvelope::Tx(tx_v1.tx.clone())).unwrap();
        let server_key = server_public_key_bytes(&secret).unwrap();

        let matches = tx_v1
            .signatures
            .iter()
            .any(|sig| signature_matches(&server_key, &tx_hash, &sig.signature.0));
        assert!(matches);
    }

    #[test]
    fn signature_matches_rejects_the_wrong_key() {
        let account = test_account();
        let secret = test_secret_key();

        let response = build_challenge_transaction(&account).unwrap();
        let signed_xdr = sign_transaction_envelope(&response.transaction, &secret).unwrap();
        let envelope: TransactionEnvelope = stellar_xdr::ReadXdr::from_xdr(&signed_xdr).unwrap();

        let tx_v1 = match &envelope {
            TransactionEnvelope::TxV1(tx_v1) => tx_v1,
            _ => panic!("expected TxV1"),
        };
        let tx_hash = hash_transaction_with_network(&TransactionEnvelope::Tx(tx_v1.tx.clone())).unwrap();
        let wrong_key = [9u8; 32];

        let matches = tx_v1
            .signatures
            .iter()
            .any(|sig| signature_matches(&wrong_key, &tx_hash, &sig.signature.0));
        assert!(!matches);
    }

    #[test]
    fn source_account_matches_accepts_the_claimed_account() {
        let account = test_account();
        let claimed = engipay_core::stellar::parse_address(&account).unwrap();
        let source = stellar_xdr::MuxedAccount::KeyTypeEd25519(stellar_xdr::Uint256(
            ed25519::PublicKey::from_string(&account).unwrap().0,
        ));

        assert!(source_account_matches(&source, &claimed));
    }

    #[test]
    fn source_account_matches_rejects_a_different_account() {
        let other_account = ed25519::PublicKey([1; 32]).to_string();
        let claimed = engipay_core::stellar::parse_address(&test_account()).unwrap();
        let source = stellar_xdr::MuxedAccount::KeyTypeEd25519(stellar_xdr::Uint256(
            ed25519::PublicKey::from_string(&other_account).unwrap().0,
        ));

        assert!(!source_account_matches(&source, &claimed));
    }

    #[test]
    fn fully_signed_challenge_verifies_against_both_server_and_client_keys() {
        let client_secret = test_secret_key();
        let client_account = test_account();
        let server_secret_key = ed25519::PrivateKey([5; 32]);
        let server_secret = server_secret_key.as_unredacted().to_string();

        let response = build_challenge_transaction(&client_account).unwrap();
        let server_signed = sign_transaction_envelope(&response.transaction, &server_secret).unwrap();
        let fully_signed = add_client_signature(&server_signed, &client_secret);

        let envelope: TransactionEnvelope = stellar_xdr::ReadXdr::from_xdr(&fully_signed).unwrap();
        let tx_v1 = match &envelope {
            TransactionEnvelope::TxV1(tx_v1) => tx_v1,
            _ => panic!("expected TxV1"),
        };
        assert_eq!(tx_v1.signatures.len(), 2);

        let tx_hash = hash_transaction_with_network(&TransactionEnvelope::Tx(tx_v1.tx.clone())).unwrap();
        let server_key = server_public_key_bytes(&server_secret).unwrap();
        let client_key = server_public_key_bytes(&client_secret).unwrap();

        let server_signed_ok = tx_v1
            .signatures
            .iter()
            .any(|sig| signature_matches(&server_key, &tx_hash, &sig.signature.0));
        let client_signed_ok = tx_v1
            .signatures
            .iter()
            .any(|sig| signature_matches(&client_key, &tx_hash, &sig.signature.0));

        assert!(server_signed_ok, "server signature should verify");
        assert!(client_signed_ok, "client signature should verify");
    }
}

fn parse_stellar_account_id(account: &str) -> Result<stellar_xdr::MuxedAccount, ApiError> {
    use stellar_strkey::Strkey;
    use stellar_xdr::MuxedAccount;

    match Strkey::from_string(account.trim()) {
        Ok(Strkey::PublicKeyEd25519(key)) => {
            let account_id = MuxedAccount::KeyTypeEd25519(stellar_xdr::Uint256(key.0));
            Ok(account_id)
        }
        Ok(Strkey::MuxedAccountEd25519(muxed)) => {
            let account_id = MuxedAccount::KeyTypeMuxedEd25519(stellar_xdr::MuxedAccountMed25519 {
                ed25519: stellar_xdr::Uint256(muxed.ed25519),
                id: stellar_xdr::uint64(muxed.id),
            });
            Ok(account_id)
        }
        _ => Err(ApiError::BadRequest(
            "Invalid Stellar account format".to_string(),
        )),
    }
}
