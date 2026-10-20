//! Ed25519-signed transaction receipts.
//!
//! Receipts allow a user to share proof of a transfer, withdrawal or order
//! outside the app and have it independently verified against the server's
//! published public key. Receipts are signed over a canonical JSON
//! representation of the [`Receipt`] struct so that any tampering with the
//! payload invalidates the signature.
//!
//! Key rotation is supported: each receipt records the `key_id` used to sign
//! it, and the signer keeps a map of historical public keys keyed by ID so
//! that old receipts remain verifiable after the signing key is rotated.

use std::collections::HashMap;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// The kind of transaction a receipt covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReceiptType {
    Transfer,
    Withdrawal,
    Order,
}

/// A signed, verifiable transaction receipt.
///
/// The struct is deliberately limited to non-sensitive data: it identifies the
/// ledger transaction and the amount/asset so it can be reconciled with the
/// ledger, but never exposes other users' data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receipt {
    /// Unique identifier for this receipt.
    pub receipt_id: String,
    /// What kind of transaction this receipt covers.
    pub receipt_type: ReceiptType,
    /// The ledger transaction this receipt reconciles against.
    pub ledger_transaction_id: String,
    /// Amount in minor units, encoded as a string to avoid precision loss.
    pub amount_minor: String,
    /// Asset code (e.g. `BTC`, `USD`).
    pub asset: String,
    /// RFC 3339 timestamp of when the receipt was issued.
    pub timestamp: String,
    /// Identifier of the signing key used to produce the signature.
    pub key_id: String,
    /// Non-sensitive metadata (e.g. counterparty reference, memo).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub metadata: HashMap<String, String>,
}

/// A receipt together with its detached signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedReceipt {
    /// The receipt payload.
    pub receipt: Receipt,
    /// Base64-encoded Ed25519 signature over the canonical receipt bytes.
    pub signature: String,
}

/// Errors that can occur while signing or verifying receipts.
#[derive(Debug, thiserror::Error)]
pub enum ReceiptError {
    #[error("invalid signing key: {0}")]
    InvalidSigningKey(String),
    #[error("invalid public key for key id {0}")]
    InvalidPublicKey(String),
    #[error("unknown key id: {0}")]
    UnknownKeyId(String),
    #[error("failed to serialize receipt: {0}")]
    Serialization(String),
    #[error("invalid signature encoding: {0}")]
    InvalidSignatureEncoding(String),
    #[error("signature verification failed")]
    VerificationFailed,
}

/// Signs and verifies receipts using Ed25519.
///
/// The signer holds the current signing key plus a map of historical public
/// keys (keyed by key ID) so that receipts signed before a rotation remain
/// verifiable.
pub struct ReceiptSigner {
    key_id: String,
    signing_key: SigningKey,
    /// Public keys for all known key IDs, including the current one.
    public_keys: HashMap<String, VerifyingKey>,
}

impl ReceiptSigner {
    /// Build a new signer.
    ///
    /// * `key_id` — identifier for the current signing key.
    /// * `secret` — the current Ed25519 secret key, base64 or hex encoded.
    /// * `historical_public_keys` — map of key ID to base64/hex encoded public
    ///   key for previously used keys (and optionally the current key).
    pub fn new(
        key_id: impl Into<String>,
        secret: &str,
        historical_public_keys: HashMap<String, String>,
    ) -> Result<Self, ReceiptError> {
        let key_id = key_id.into();
        let secret_bytes = decode_key(secret)
            .map_err(|e| ReceiptError::InvalidSigningKey(e))?;

        let signing_key = match secret_bytes.len() {
            32 => {
                let mut bytes = [0u8; 32];
                bytes.copy_from_slice(&secret_bytes);
                SigningKey::from_bytes(&bytes)
            }
            64 => SigningKey::from_keypair_bytes(
                secret_bytes
                    .as_slice()
                    .try_into()
                    .map_err(|_| ReceiptError::InvalidSigningKey("bad key length".into()))?,
            )
            .map_err(|e| ReceiptError::InvalidSigningKey(e.to_string()))?,
            n => {
                return Err(ReceiptError::InvalidSigningKey(format!(
                    "unexpected key length {n}"
                )))
            }
        };

        let mut public_keys = HashMap::new();
        // Always register the current key's public key.
        public_keys.insert(key_id.clone(), signing_key.verifying_key());

        for (id, encoded) in historical_public_keys {
            let bytes = decode_key(&encoded)
                .map_err(|_| ReceiptError::InvalidPublicKey(id.clone()))?;
            let bytes: [u8; 32] = bytes
                .as_slice()
                .try_into()
                .map_err(|_| ReceiptError::InvalidPublicKey(id.clone()))?;
            let vk = VerifyingKey::from_bytes(&bytes)
                .map_err(|_| ReceiptError::InvalidPublicKey(id.clone()))?;
            public_keys.insert(id, vk);
        }

        Ok(Self {
            key_id,
            signing_key,
            public_keys,
        })
    }

    /// The key ID used for newly issued receipts.
    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    /// The current public key, base64 encoded.
    pub fn current_public_key_base64(&self) -> String {
        BASE64.encode(self.signing_key.verifying_key().to_bytes())
    }

    /// Look up a public key by key ID, base64 encoded.
    pub fn public_key_base64(&self, key_id: &str) -> Option<String> {
        self.public_keys
            .get(key_id)
            .map(|vk| BASE64.encode(vk.to_bytes()))
    }

    /// Sign a receipt, producing a [`SignedReceipt`].
    pub fn sign(&self, mut receipt: Receipt) -> Result<SignedReceipt, ReceiptError> {
        // Stamp the receipt with the key that will sign it.
        receipt.key_id = self.key_id.clone();
        let bytes = canonical_bytes(&receipt)?;
        let signature = self.signing_key.sign(&bytes);
        Ok(SignedReceipt {
            receipt,
            signature: BASE64.encode(signature.to_bytes()),
        })
    }

    /// Verify a signed receipt.
    ///
    /// Looks up the public key for the receipt's `key_id`, then checks the
    /// signature over the canonical receipt bytes.
    pub fn verify(&self, signed: &SignedReceipt) -> Result<(), ReceiptError> {
        let key_id = &signed.receipt.key_id;
        let verifying_key = self
            .public_keys
            .get(key_id)
            .ok_or_else(|| ReceiptError::UnknownKeyId(key_id.clone()))?;

        let sig_bytes = BASE64
            .decode(signed.signature.as_bytes())
            .map_err(|e| ReceiptError::InvalidSignatureEncoding(e.to_string()))?;
        let sig_bytes: [u8; 64] = sig_bytes
            .as_slice()
            .try_into()
            .map_err(|_| ReceiptError::InvalidSignatureEncoding("bad signature length".into()))?;
        let signature = Signature::from_bytes(&sig_bytes);

        let bytes = canonical_bytes(&signed.receipt)?;
        verifying_key
            .verify(&bytes, &signature)
            .map_err(|_| ReceiptError::VerificationFailed)
    }
}

/// Serialize a receipt to canonical JSON bytes.
///
/// `serde_json` serializes struct fields in declaration order and maps with
/// sorted keys (via the default `BTreeMap`-like ordering used for `HashMap`
/// serialization is not guaranteed, so we sort metadata explicitly by
/// round-tripping through a sorted representation).
fn canonical_bytes(receipt: &Receipt) -> Result<Vec<u8>, ReceiptError> {
    // Build a canonical form with metadata keys sorted to ensure deterministic
    // bytes regardless of HashMap iteration order.
    let mut metadata: Vec<(&String, &String)> = receipt.metadata.iter().collect();
    metadata.sort_by(|a, b| a.0.cmp(b.0));

    #[derive(Serialize)]
    struct Canonical<'a> {
        receipt_id: &'a str,
        receipt_type: ReceiptType,
        ledger_transaction_id: &'a str,
        amount_minor: &'a str,
        asset: &'a str,
        timestamp: &'a str,
        key_id: &'a str,
        metadata: Vec<(&'a String, &'a String)>,
    }

    let canonical = Canonical {
        receipt_id: &receipt.receipt_id,
        receipt_type: receipt.receipt_type,
        ledger_transaction_id: &receipt.ledger_transaction_id,
        amount_minor: &receipt.amount_minor,
        asset: &receipt.asset,
        timestamp: &receipt.timestamp,
        key_id: &receipt.key_id,
        metadata,
    };

    serde_json::to_vec(&canonical).map_err(|e| ReceiptError::Serialization(e.to_string()))
}

/// Decode a key that may be base64 or hex encoded.
fn decode_key(input: &str) -> Result<Vec<u8>, String> {
    let trimmed = input.trim();
    if let Ok(bytes) = BASE64.decode(trimmed.as_bytes()) {
        return Ok(bytes);
    }
    if let Ok(bytes) = hex::decode(trimmed) {
        return Ok(bytes);
    }
    Err("key is neither valid base64 nor hex".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_receipt() -> Receipt {
        let mut metadata = HashMap::new();
        metadata.insert("memo".to_string(), "invoice-42".to_string());
        Receipt {
            receipt_id: "rcpt_123".to_string(),
            receipt_type: ReceiptType::Transfer,
            ledger_transaction_id: "txn_456".to_string(),
            amount_minor: "100000".to_string(),
            asset: "USD".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            key_id: String::new(),
            metadata,
        }
    }

    fn keypair(seed: u8) -> (SigningKey, String) {
        let signing_key = SigningKey::from_bytes(&[seed; 32]);
        let secret_b64 = BASE64.encode(signing_key.to_bytes());
        (signing_key, secret_b64)
    }

    #[test]
    fn signed_receipt_verifies() {
        let (_sk, secret) = keypair(1);
        let signer = ReceiptSigner::new("key-1", &secret, HashMap::new()).unwrap();
        let signed = signer.sign(sample_receipt()).unwrap();
        assert_eq!(signed.receipt.key_id, "key-1");
        signer.verify(&signed).unwrap();
    }

    #[test]
    fn tampered_receipt_fails() {
        let (_sk, secret) = keypair(2);
        let signer = ReceiptSigner::new("key-1", &secret, HashMap::new()).unwrap();
        let mut signed = signer.sign(sample_receipt()).unwrap();
        // Tamper with the amount.
        signed.receipt.amount_minor = "999999".to_string();
        assert!(matches!(
            signer.verify(&signed),
            Err(ReceiptError::VerificationFailed)
        ));
    }

    #[test]
    fn old_key_receipt_verifies_after_rotation() {
        // Old key signs a receipt.
        let (old_sk, old_secret) = keypair(3);
        let old_signer = ReceiptSigner::new("key-old", &old_secret, HashMap::new()).unwrap();
        let signed = old_signer.sign(sample_receipt()).unwrap();

        // Rotate: new signer with a new secret, but old public key retained.
        let (_new_sk, new_secret) = keypair(4);
        let mut historical = HashMap::new();
        historical.insert(
            "key-old".to_string(),
            BASE64.encode(old_sk.verifying_key().to_bytes()),
        );
        let rotated = ReceiptSigner::new("key-new", &new_secret, historical).unwrap();

        // Old receipt still verifies under the rotated signer.
        rotated.verify(&signed).unwrap();

        // New receipts are signed with the new key.
        let new_signed = rotated.sign(sample_receipt()).unwrap();
        assert_eq!(new_signed.receipt.key_id, "key-new");
        rotated.verify(&new_signed).unwrap();
    }

    #[test]
    fn unknown_key_id_fails() {
        let (_sk, secret) = keypair(5);
        let signer = ReceiptSigner::new("key-1", &secret, HashMap::new()).unwrap();
        let mut signed = signer.sign(sample_receipt()).unwrap();
        signed.receipt.key_id = "key-unknown".to_string();
        assert!(matches!(
            signer.verify(&signed),
            Err(ReceiptError::UnknownKeyId(_))
        ));
    }

    #[test]
    fn hex_secret_is_accepted() {
        let sk = SigningKey::from_bytes(&[6u8; 32]);
        let secret_hex = hex::encode(sk.to_bytes());
        let signer = ReceiptSigner::new("key-hex", &secret_hex, HashMap::new()).unwrap();
        let signed = signer.sign(sample_receipt()).unwrap();
        signer.verify(&signed).unwrap();
    }
}