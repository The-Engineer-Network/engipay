//! EngiPay standard payment request envelope.
//!
//! For EngiPay-to-EngiPay QR codes we wrap the payment intent in a JSON
//! envelope so that a scanning client can distinguish it from a plain
//! standard URI (e.g. an EIP-681 / SEP-0007 style `ethereum:` or `web+stellar:`
//! link). The envelope is intentionally self-describing and versioned.
//!
//! Shape (see `PLAN.md`):
//! ```json
//! {
//!   "v": 1,
//!   "type": "engipay.request",
//!   "chain": "base",
//!   "to": "0x...",
//!   "asset": "USDC",
//!   "amount": "25.00",
//!   "tag": "@user",
//!   "ref": "...",
//!   "uri": "..."
//! }
//! ```
//!
//! Money is always carried as a decimal string (never a float) and every
//! field is validated before an envelope is produced.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Current envelope schema version.
pub const ENVELOPE_VERSION: u8 = 1;

/// Envelope `type` discriminator for EngiPay payment requests.
pub const ENVELOPE_TYPE: &str = "engipay.request";

/// Default chain used when the caller does not specify one.
pub const DEFAULT_CHAIN: &str = "base";

/// Errors produced while building or validating a payment envelope.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum EnvelopeError {
    /// The recipient address was empty or malformed.
    #[error("invalid recipient address: {0}")]
    InvalidRecipient(String),
    /// The asset symbol was empty or malformed.
    #[error("invalid asset symbol: {0}")]
    InvalidAsset(String),
    /// The amount was not a valid positive decimal string.
    #[error("invalid amount: {0}")]
    InvalidAmount(String),
    /// The chain identifier was empty or malformed.
    #[error("invalid chain: {0}")]
    InvalidChain(String),
    /// The optional tag was present but malformed.
    #[error("invalid tag: {0}")]
    InvalidTag(String),
}

/// A validated EngiPay standard payment request envelope.
///
/// Construct one via [`PaymentEnvelope::new`] (or [`PaymentEnvelope::with_chain`])
/// so that all invariants are enforced before serialization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaymentEnvelope {
    /// Schema version.
    pub v: u8,
    /// Envelope type discriminator (`engipay.request`).
    #[serde(rename = "type")]
    pub kind: String,
    /// Chain identifier, e.g. `base`.
    pub chain: String,
    /// Recipient address.
    #[serde(rename = "to")]
    pub to: String,
    /// Asset symbol, e.g. `USDC`.
    pub asset: String,
    /// Amount as a decimal string (never a float).
    pub amount: String,
    /// Optional human-readable tag, e.g. `@user`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    /// Optional opaque reference for reconciliation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_: Option<String>,
    /// Fallback standard URI for clients that do not understand the envelope.
    pub uri: String,
}

impl PaymentEnvelope {
    /// Build a validated envelope on the default chain (`base`).
    pub fn new(
        to: impl Into<String>,
        asset: impl Into<String>,
        amount: impl Into<String>,
        tag: Option<String>,
        reference: Option<String>,
    ) -> Result<Self, EnvelopeError> {
        Self::with_chain(DEFAULT_CHAIN, to, asset, amount, tag, reference)
    }

    /// Build a validated envelope on an explicit chain.
    pub fn with_chain(
        chain: impl Into<String>,
        to: impl Into<String>,
        asset: impl Into<String>,
        amount: impl Into<String>,
        tag: Option<String>,
        reference: Option<String>,
    ) -> Result<Self, EnvelopeError> {
        let chain = chain.into();
        let to = to.into();
        let asset = asset.into();
        let amount = amount.into();

        validate_chain(&chain)?;
        validate_recipient(&to)?;
        validate_asset(&asset)?;
        validate_amount(&amount)?;
        if let Some(tag) = tag.as_deref() {
            validate_tag(tag)?;
        }

        let uri = fallback_uri(&chain, &to, &asset, &amount);

        Ok(Self {
            v: ENVELOPE_VERSION,
            kind: ENVELOPE_TYPE.to_string(),
            chain,
            to,
            asset,
            amount,
            tag,
            ref_: reference,
            uri,
        })
    }

    /// Serialize the envelope to its canonical JSON representation.
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("PaymentEnvelope is always serializable")
    }
}

/// Build the fallback standard URI embedded in the envelope.
///
/// The URI is a plain `ethereum:`-style link so that wallets which do not
/// understand the EngiPay envelope can still complete the transfer.
fn fallback_uri(chain: &str, to: &str, asset: &str, amount: &str) -> String {
    format!("ethereum:{to}@{chain}?value={amount}&asset={asset}")
}

fn validate_chain(chain: &str) -> Result<(), EnvelopeError> {
    if chain.is_empty() || !chain.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(EnvelopeError::InvalidChain(chain.to_string()));
    }
    Ok(())
}

fn validate_recipient(to: &str) -> Result<(), EnvelopeError> {
    let trimmed = to.trim();
    if trimmed.is_empty() || trimmed != to {
        return Err(EnvelopeError::InvalidRecipient(to.to_string()));
    }
    // EVM-style addresses are 0x-prefixed hex; other chains use opaque ids.
    if let Some(hex) = to.strip_prefix("0x") {
        if hex.len() != 40 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(EnvelopeError::InvalidRecipient(to.to_string()));
        }
    }
    Ok(())
}

fn validate_asset(asset: &str) -> Result<(), EnvelopeError> {
    if asset.is_empty()
        || asset.len() > 16
        || !asset.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err(EnvelopeError::InvalidAsset(asset.to_string()));
    }
    Ok(())
}

/// Validate a decimal amount string without ever parsing it as a float.
///
/// Accepts an optional single `.` with at most 18 fractional digits and
/// requires the value to be strictly positive.
fn validate_amount(amount: &str) -> Result<(), EnvelopeError> {
    let invalid = || EnvelopeError::InvalidAmount(amount.to_string());

    if amount.is_empty() {
        return Err(invalid());
    }

    let mut parts = amount.split('.');
    let int_part = parts.next().unwrap_or("");
    let frac_part = parts.next();
    if parts.next().is_some() {
        return Err(invalid());
    }

    if int_part.is_empty() || !int_part.chars().all(|c| c.is_ascii_digit()) {
        return Err(invalid());
    }
    if let Some(frac) = frac_part {
        if frac.is_empty() || frac.len() > 18 || !frac.chars().all(|c| c.is_ascii_digit()) {
            return Err(invalid());
        }
    }

    // Reject zero / all-zero amounts.
    let all_zero = int_part.chars().all(|c| c == '0')
        && frac_part.map_or(true, |f| f.chars().all(|c| c == '0'));
    if all_zero {
        return Err(invalid());
    }

    Ok(())
}

fn validate_tag(tag: &str) -> Result<(), EnvelopeError> {
    if tag.is_empty() || tag.len() > 64 || tag.chars().any(|c| c.is_whitespace()) {
        return Err(EnvelopeError::InvalidTag(tag.to_string()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const TO: &str = "0x1234567890abcdef1234567890abcdef12345678";

    #[test]
    fn generates_schema_compliant_envelope() {
        let env = PaymentEnvelope::new(TO, "USDC", "25.00", Some("@user".into()), Some("ref-1".into()))
            .expect("valid envelope");

        let json: Value = serde_json::from_str(&env.to_json()).expect("valid json");

        assert_eq!(json["v"], 1);
        assert_eq!(json["type"], "engipay.request");
        assert_eq!(json["chain"], "base");
        assert_eq!(json["to"], TO);
        assert_eq!(json["asset"], "USDC");
        assert_eq!(json["amount"], "25.00");
        assert_eq!(json["tag"], "@user");
        assert_eq!(json["ref"], "ref-1");
        assert!(json["uri"].is_string());
    }

    #[test]
    fn amount_is_serialized_as_string_not_number() {
        let env = PaymentEnvelope::new(TO, "USDC", "25.00", None, None).unwrap();
        let json: Value = serde_json::from_str(&env.to_json()).unwrap();
        assert!(json["amount"].is_string(), "amount must never be a float");
    }

    #[test]
    fn includes_fallback_standard_uri() {
        let env = PaymentEnvelope::new(TO, "USDC", "25.00", None, None).unwrap();
        assert_eq!(env.uri, format!("ethereum:{TO}@base?value=25.00&asset=USDC"));
        assert!(env.uri.starts_with("ethereum:"));
    }

    #[test]
    fn optional_fields_are_omitted_when_absent() {
        let env = PaymentEnvelope::new(TO, "USDC", "1", None, None).unwrap();
        let json: Value = serde_json::from_str(&env.to_json()).unwrap();
        assert!(json.get("tag").is_none());
        assert!(json.get("ref").is_none());
    }

    #[test]
    fn rejects_invalid_amounts() {
        for bad in ["", "0", "0.00", "-1", "1.2.3", "abc", "1.", ".5", "1e3"] {
            assert!(
                PaymentEnvelope::new(TO, "USDC", bad, None, None).is_err(),
                "amount {bad:?} should be rejected"
            );
        }
    }

    #[test]
    fn rejects_invalid_recipient_and_asset() {
        assert!(PaymentEnvelope::new("", "USDC", "1", None, None).is_err());
        assert!(PaymentEnvelope::new("0xnothex", "USDC", "1", None, None).is_err());
        assert!(PaymentEnvelope::new(TO, "", "1", None, None).is_err());
        assert!(PaymentEnvelope::new(TO, "US DC", "1", None, None).is_err());
    }

    #[test]
    fn rejects_invalid_tag() {
        assert!(PaymentEnvelope::new(TO, "USDC", "1", Some("bad tag".into()), None).is_err());
        assert!(PaymentEnvelope::new(TO, "USDC", "1", Some(String::new()), None).is_err());
    }

    #[test]
    fn supports_explicit_chain() {
        let env = PaymentEnvelope::with_chain("stellar", TO, "USDC", "5", None, None).unwrap();
        assert_eq!(env.chain, "stellar");
        assert!(env.uri.contains("@stellar"));
    }
}
