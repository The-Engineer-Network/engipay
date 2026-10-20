//! Signed, verifiable transaction receipts.
//!
//! Each receipt issued by the API is signed with an Ed25519 key so a holder
//! can later prove the receipt was issued by EngiPay and was not tampered with.
//!
//! # Key rotation
//! Each key is assigned a short, opaque identifier (`kid`). The `kid` is
//! embedded in every signed receipt. Old receipts remain verifiable as long as
//! the corresponding public key is still published at
//! `GET /v1/well-known/receipt-keys`.
//!
//! # Canonical form
//! The payload signed is the **canonical JSON** of the receipt body, sorted by
//! key name, with no trailing whitespace, encoded as UTF-8 bytes. The
//! signature is the raw 64-byte Ed25519 signature encoded as lowercase hex.

use std::collections::BTreeMap;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The key ID embedded in receipts. Short and opaque; rotate by changing the
/// environment variable and keeping the old public key in the published set.
pub const DEFAULT_KID: &str = "v1";

/// A signer loaded from a hex-encoded Ed25519 private seed (32 bytes, 64 hex
/// characters).
#[derive(Clone)]
pub struct ReceiptSigner {
    kid: String,
    signing_key: SigningKey,
}

impl std::fmt::Debug for ReceiptSigner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never expose key material in logs/debug output.
        f.debug_struct("ReceiptSigner")
            .field("kid", &self.kid)
            .field("signing_key", &"<redacted>")
            .finish()
    }
}

impl ReceiptSigner {
    /// Load from a hex-encoded 32-byte Ed25519 seed, optionally prefixed with
    /// a `kid:` component (`"v2:aabbcc…"`).
    ///
    /// Format accepted:
    /// - `<64 hex chars>` — uses [`DEFAULT_KID`]
    /// - `<kid>:<64 hex chars>` — uses the supplied kid
    pub fn from_hex(raw: &str) -> Result<Self, ReceiptKeyError> {
        let (kid, hex_seed) = if let Some((prefix, rest)) = raw.split_once(':') {
            // Make sure the prefix is a plausible kid, not a "0x…" hex prefix.
            if !prefix
                .chars()
                .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
            {
                return Err(ReceiptKeyError::InvalidFormat);
            }
            (prefix.to_owned(), rest)
        } else {
            (DEFAULT_KID.to_owned(), raw)
        };

        let bytes = hex::decode(hex_seed).map_err(|_| ReceiptKeyError::InvalidHex)?;
        let seed: [u8; 32] = bytes.try_into().map_err(|_| ReceiptKeyError::WrongLength)?;
        Ok(Self {
            kid,
            signing_key: SigningKey::from_bytes(&seed),
        })
    }

    /// The key id embedded in receipts signed by this key.
    pub fn kid(&self) -> &str {
        &self.kid
    }

    /// The public verification key, suitable for publishing.
    pub fn verifying_key(&self) -> VerifyingKey {
        self.signing_key.verifying_key()
    }

    /// Sign `payload` (any serializable value). Returns the signature as a
    /// lowercase hex string.
    ///
    /// The payload is first serialized to **canonical JSON** (keys sorted,
    /// ASCII-only escaping) before signing, so the signer and verifier always
    /// agree on the exact bytes.
    pub fn sign<T: Serialize>(&self, payload: &T) -> Result<String, ReceiptSignError> {
        let canonical = canonical_json(payload)?;
        let sig: Signature = self.signing_key.sign(canonical.as_bytes());
        Ok(hex::encode(sig.to_bytes()))
    }
}

/// A verifier loaded from a hex-encoded Ed25519 public key (32 bytes, 64 hex
/// characters).
#[derive(Clone)]
pub struct ReceiptVerifier {
    kid: String,
    verifying_key: VerifyingKey,
}

impl ReceiptVerifier {
    /// Load from a hex-encoded 32-byte Ed25519 public key with an explicit
    /// `kid`.
    pub fn from_hex(kid: impl Into<String>, hex_key: &str) -> Result<Self, ReceiptKeyError> {
        let bytes = hex::decode(hex_key).map_err(|_| ReceiptKeyError::InvalidHex)?;
        let key_bytes: [u8; 32] = bytes.try_into().map_err(|_| ReceiptKeyError::WrongLength)?;
        let verifying_key =
            VerifyingKey::from_bytes(&key_bytes).map_err(|_| ReceiptKeyError::InvalidKey)?;
        Ok(Self {
            kid: kid.into(),
            verifying_key,
        })
    }

    /// Construct directly from a [`ReceiptSigner`]'s public component.
    pub fn from_signer(signer: &ReceiptSigner) -> Self {
        Self {
            kid: signer.kid.clone(),
            verifying_key: signer.verifying_key(),
        }
    }

    /// The key id this verifier covers.
    pub fn kid(&self) -> &str {
        &self.kid
    }

    /// Hex-encoded 32-byte public key, for publishing.
    pub fn public_key_hex(&self) -> String {
        hex::encode(self.verifying_key.as_bytes())
    }

    /// Verify `payload` against `hex_signature`. Returns `Ok(())` when the
    /// signature is valid, `Err` otherwise.
    pub fn verify<T: Serialize>(
        &self,
        payload: &T,
        hex_signature: &str,
    ) -> Result<(), ReceiptVerifyError> {
        let canonical = canonical_json(payload).map_err(|_| ReceiptVerifyError::Tampered)?;

        let sig_bytes =
            hex::decode(hex_signature).map_err(|_| ReceiptVerifyError::InvalidSignatureFormat)?;
        let sig_array: [u8; 64] = sig_bytes
            .try_into()
            .map_err(|_| ReceiptVerifyError::InvalidSignatureFormat)?;
        let sig = Signature::from_bytes(&sig_array);

        self.verifying_key
            .verify(canonical.as_bytes(), &sig)
            .map_err(|_| ReceiptVerifyError::Tampered)
    }
}

/// A registry of verifiers keyed by `kid`, used to look up the right key for
/// old receipts after rotation.
#[derive(Default, Clone)]
pub struct ReceiptKeySet {
    /// All known verifiers: current first, then retired keys in order.
    keys: Vec<ReceiptVerifier>,
}

impl ReceiptKeySet {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a verifier. The first one added is the *current* key.
    pub fn add(&mut self, verifier: ReceiptVerifier) {
        self.keys.push(verifier);
    }

    /// Find a verifier by `kid`, or `None` if unknown.
    pub fn find(&self, kid: &str) -> Option<&ReceiptVerifier> {
        self.keys.iter().find(|v| v.kid() == kid)
    }

    /// All registered verifiers (current + retired), for publication.
    pub fn all(&self) -> &[ReceiptVerifier] {
        &self.keys
    }

    /// Build a key set from the primary signer.
    pub fn from_signer(signer: &ReceiptSigner) -> Self {
        let mut ks = Self::new();
        ks.add(ReceiptVerifier::from_signer(signer));
        ks
    }
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ReceiptKeyError {
    #[error("key material must be a 64-character hex string, optionally prefixed with 'kid:'")]
    InvalidFormat,
    #[error("key material is not valid hex")]
    InvalidHex,
    #[error("key must be exactly 32 bytes (64 hex characters)")]
    WrongLength,
    #[error("public key bytes are not a valid Ed25519 point")]
    InvalidKey,
}

#[derive(Debug, thiserror::Error)]
pub enum ReceiptSignError {
    #[error("failed to serialize receipt payload to canonical JSON")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ReceiptVerifyError {
    #[error("signature format is invalid")]
    InvalidSignatureFormat,
    #[error("receipt has been tampered with or was not signed by this key")]
    Tampered,
    #[error("kid '{0}' is unknown; key may have been retired beyond the retention window")]
    UnknownKid(String),
}

// ── Canonical JSON ────────────────────────────────────────────────────────────

/// Serialize `value` to a deterministic JSON string with keys sorted
/// lexicographically at every nesting level.
///
/// The key sort is applied recursively so nested objects are also stable.
/// Arrays preserve insertion order (sorting arrays would change semantics).
fn canonical_json<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    let v: Value = serde_json::to_value(value)?;
    Ok(canonical_value(&v))
}

fn canonical_value(v: &Value) -> String {
    match v {
        Value::Object(map) => {
            // Collect into a BTreeMap so keys are sorted.
            let sorted: BTreeMap<&str, &Value> = map.iter().map(|(k, v)| (k.as_str(), v)).collect();
            let pairs: Vec<String> = sorted
                .iter()
                .map(|(k, v)| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(k).unwrap_or_default(),
                        canonical_value(v)
                    )
                })
                .collect();
            format!("{{{}}}", pairs.join(","))
        }
        Value::Array(arr) => {
            let items: Vec<String> = arr.iter().map(canonical_value).collect();
            format!("[{}]", items.join(","))
        }
        other => serde_json::to_string(other).unwrap_or_else(|_| "null".to_owned()),
    }
}

// ── Published key record ──────────────────────────────────────────────────────

/// A single entry in the `GET /v1/well-known/receipt-keys` response.
#[derive(Debug, Serialize, Deserialize)]
pub struct PublishedKey {
    pub kid: String,
    pub public_key_hex: String,
    /// Algorithm, always `"Ed25519"`.
    pub algorithm: &'static str,
}

impl PublishedKey {
    pub fn from_verifier(v: &ReceiptVerifier) -> Self {
        Self {
            kid: v.kid().to_owned(),
            public_key_hex: v.public_key_hex(),
            algorithm: "Ed25519",
        }
    }
}

// ── Request/response for the verify endpoint ──────────────────────────────────

/// Body accepted by `GET /v1/receipts/verify`.
#[derive(Debug, Deserialize)]
pub struct VerifyRequest {
    /// The receipt JSON exactly as received (the object to verify).
    pub receipt: Value,
    /// The `kid` from the receipt's `receipt_sig.kid` field.
    pub kid: String,
    /// The hex signature from the receipt's `receipt_sig.signature` field.
    pub signature: String,
}

/// Response from `GET /v1/receipts/verify`.
#[derive(Debug, Serialize)]
pub struct VerifyResponse {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Envelope attached to every signed receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiptSig {
    /// Which signing key was used; lets verifiers find the right public key.
    pub kid: String,
    /// Lowercase hex Ed25519 signature over the canonical JSON of the receipt
    /// body (without this `receipt_sig` field).
    pub signature: String,
}

// ── base64url helper (for future JWT-style embedding) ─────────────────────────
#[allow(dead_code)]
fn b64url_encode(data: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(data)
}

// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Generate a deterministic test key (not random, reproducible in tests).
    fn test_signer() -> ReceiptSigner {
        // 32 bytes, all 0x01.
        let seed_hex = "01".repeat(32);
        ReceiptSigner::from_hex(&seed_hex).unwrap()
    }

    fn test_signer_v2() -> ReceiptSigner {
        let seed_hex = format!("v2:{}", "02".repeat(32));
        ReceiptSigner::from_hex(&seed_hex).unwrap()
    }

    // ── ReceiptSigner::from_hex ───────────────────────────────────────────────

    #[test]
    fn loads_signer_from_64_hex_chars() {
        let s = test_signer();
        assert_eq!(s.kid(), DEFAULT_KID);
    }

    #[test]
    fn loads_signer_with_kid_prefix() {
        let s = test_signer_v2();
        assert_eq!(s.kid(), "v2");
    }

    #[test]
    fn rejects_non_hex_seed() {
        let err = ReceiptSigner::from_hex("zz".repeat(32).as_str()).unwrap_err();
        assert_eq!(err, ReceiptKeyError::InvalidHex);
    }

    #[test]
    fn rejects_seed_of_wrong_length() {
        let err = ReceiptSigner::from_hex("aabbcc").unwrap_err();
        assert_eq!(err, ReceiptKeyError::WrongLength);
    }

    // ── sign / verify round-trip ──────────────────────────────────────────────

    #[test]
    fn sign_then_verify_succeeds() {
        let signer = test_signer();
        let verifier = ReceiptVerifier::from_signer(&signer);

        let payload = json!({"transaction_id": "txn-1", "amount": "1000000"});
        let sig = signer.sign(&payload).unwrap();
        assert!(verifier.verify(&payload, &sig).is_ok());
    }

    #[test]
    fn verification_fails_for_tampered_payload() {
        let signer = test_signer();
        let verifier = ReceiptVerifier::from_signer(&signer);

        let original = json!({"amount": "100", "recipient": "alice"});
        let sig = signer.sign(&original).unwrap();

        // Change one field — signature must not verify.
        let tampered = json!({"amount": "999999", "recipient": "alice"});
        let err = verifier.verify(&tampered, &sig).unwrap_err();
        assert_eq!(err, ReceiptVerifyError::Tampered);
    }

    #[test]
    fn verification_fails_for_key_mismatch() {
        let signer_a = test_signer();
        let signer_b = test_signer_v2();
        let verifier_b = ReceiptVerifier::from_signer(&signer_b);

        let payload = json!({"amount": "100"});
        let sig_a = signer_a.sign(&payload).unwrap();

        // Signed with key A but verified with key B.
        let err = verifier_b.verify(&payload, &sig_a).unwrap_err();
        assert_eq!(err, ReceiptVerifyError::Tampered);
    }

    #[test]
    fn invalid_hex_signature_is_rejected() {
        let signer = test_signer();
        let verifier = ReceiptVerifier::from_signer(&signer);
        let payload = json!({"x": 1});
        let err = verifier.verify(&payload, "not-hex!!").unwrap_err();
        assert_eq!(err, ReceiptVerifyError::InvalidSignatureFormat);
    }

    #[test]
    fn signature_of_wrong_byte_length_is_rejected() {
        let signer = test_signer();
        let verifier = ReceiptVerifier::from_signer(&signer);
        let payload = json!({"x": 1});
        // 63 bytes (126 hex chars) instead of 64.
        let short_sig = "aa".repeat(63);
        let err = verifier.verify(&payload, &short_sig).unwrap_err();
        assert_eq!(err, ReceiptVerifyError::InvalidSignatureFormat);
    }

    // ── canonical_json ────────────────────────────────────────────────────────

    #[test]
    fn canonical_json_sorts_keys() {
        let v = json!({"z": 1, "a": 2, "m": 3});
        let s = canonical_json(&v).unwrap();
        assert_eq!(s, r#"{"a":2,"m":3,"z":1}"#);
    }

    #[test]
    fn canonical_json_sorts_nested_keys() {
        let v = json!({"outer": {"z": 1, "a": 2}});
        let s = canonical_json(&v).unwrap();
        assert_eq!(s, r#"{"outer":{"a":2,"z":1}}"#);
    }

    #[test]
    fn canonical_json_preserves_array_order() {
        let v = json!({"items": [3, 1, 2]});
        let s = canonical_json(&v).unwrap();
        assert_eq!(s, r#"{"items":[3,1,2]}"#);
    }

    #[test]
    fn canonical_json_is_deterministic_across_insertion_order() {
        let a = json!({"b": 2, "a": 1});
        let b = json!({"a": 1, "b": 2});
        assert_eq!(canonical_json(&a).unwrap(), canonical_json(&b).unwrap());
    }

    // ── key rotation ─────────────────────────────────────────────────────────

    #[test]
    fn keyset_finds_current_key() {
        let s = test_signer();
        let ks = ReceiptKeySet::from_signer(&s);
        assert!(ks.find(DEFAULT_KID).is_some());
    }

    #[test]
    fn keyset_finds_retired_key_by_kid() {
        let current = test_signer_v2();
        let retired_hex = "01".repeat(32);
        let retired_verifier = ReceiptVerifier::from_hex(DEFAULT_KID, &retired_hex).unwrap();

        let mut ks = ReceiptKeySet::from_signer(&current);
        ks.add(retired_verifier);

        assert!(ks.find("v2").is_some(), "should find current key v2");
        assert!(ks.find(DEFAULT_KID).is_some(), "should find retired key v1");
    }

    #[test]
    fn keyset_old_receipts_verify_with_retired_key() {
        // Receipt signed with the old key v1.
        let old_signer = test_signer();
        let payload = json!({"amount": "500", "ref": "old-receipt"});
        let old_sig = old_signer.sign(&payload).unwrap();

        // Key set now has v2 as current plus v1 as retired.
        let new_signer = test_signer_v2();
        let mut ks = ReceiptKeySet::from_signer(&new_signer);
        ks.add(ReceiptVerifier::from_signer(&old_signer));

        // Look up verifier by the kid in the receipt.
        let verifier = ks
            .find(old_signer.kid())
            .expect("retired key must be in set");
        assert!(verifier.verify(&payload, &old_sig).is_ok());
    }

    #[test]
    fn keyset_unknown_kid_returns_none() {
        let ks = ReceiptKeySet::from_signer(&test_signer());
        assert!(ks.find("unknown-kid").is_none());
    }

    // ── PublishedKey ─────────────────────────────────────────────────────────

    #[test]
    fn published_key_has_expected_algorithm() {
        let s = test_signer();
        let v = ReceiptVerifier::from_signer(&s);
        let pk = PublishedKey::from_verifier(&v);
        assert_eq!(pk.algorithm, "Ed25519");
        assert_eq!(pk.kid, DEFAULT_KID);
        // Public key is 64 hex chars (32 bytes).
        assert_eq!(pk.public_key_hex.len(), 64);
    }
}
