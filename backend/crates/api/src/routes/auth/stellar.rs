use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use stellar_xdr::TransactionEnvelope;

use crate::{error::ApiError, AppState};
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

pub fn routes() -> Router<AppState> {
    Router::new().route("/auth/stellar/challenge", get(get_challenge))
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
