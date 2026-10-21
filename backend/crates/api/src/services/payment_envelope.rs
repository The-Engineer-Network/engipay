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
    /// The slippage bound was outside the accepted range.
    #[error("invalid slippage (bps): {0}")]
    InvalidSlippage(u32),
    /// The quote id was present but malformed.
    #[error("invalid quote id: {0}")]
    InvalidQuoteId(String),
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
    #[serde(rename = "ref", skip_serializing_if = "Option::is_none")]
    pub ref_: Option<String>,
    /// Optional slippage bound (in basis points) the user agreed to for a
    /// cross-asset path payment. Only meaningful on chains that support path
    /// payments (e.g. `stellar`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slippage_bps: Option<u32>,
    /// Optional identifier of the quote the slippage bound was derived from.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quote_id: Option<String>,
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
            slippage_bps: None,
            quote_id: None,
            uri,
        })
    }

    /// Attach a slippage bound (in basis points) and the quote it came from.
    ///
    /// Used for cross-asset path payments where the sender's asset differs
    /// from the recipient's asset. The bound is validated to be within
    /// `0..=MAX_SLIPPAGE_BPS`; an empty `quote_id` is rejected.
    pub fn with_slippage(
        mut self,
        slippage_bps: u32,
        quote_id: impl Into<String>,
    ) -> Result<Self, EnvelopeError> {
        let quote_id = quote_id.into();
        validate_slippage(slippage_bps)?;
        validate_quote_id(&quote_id)?;
        self.slippage_bps = Some(slippage_bps);
        self.quote_id = Some(quote_id);
        Ok(self)
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
    if chain.is_empty()
        || !chain
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
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
    if asset.is_empty() || asset.len() > 16 || !asset.chars().all(|c| c.is_ascii_alphanumeric()) {
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
    let all_zero =
        int_part.chars().all(|c| c == '0') && frac_part.is_none_or(|f| f.chars().all(|c| c == '0'));
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

/// Maximum accepted slippage bound, in basis points (50%).
pub const MAX_SLIPPAGE_BPS: u32 = 5_000;

fn validate_slippage(slippage_bps: u32) -> Result<(), EnvelopeError> {
    if slippage_bps > MAX_SLIPPAGE_BPS {
        return Err(EnvelopeError::InvalidSlippage(slippage_bps));
    }
    Ok(())
}

fn validate_quote_id(quote_id: &str) -> Result<(), EnvelopeError> {
    if quote_id.is_empty() || quote_id.len() > 128 || quote_id.chars().any(|c| c.is_whitespace()) {
        return Err(EnvelopeError::InvalidQuoteId(quote_id.to_string()));
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
        let env = PaymentEnvelope::new(
            TO,
            "USDC",
            "25.00",
            Some("@user".into()),
            Some("ref-1".into()),
        )
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
        assert_eq!(
            env.uri,
            format!("ethereum:{TO}@base?value=25.00&asset=USDC")
        );
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

    #[test]
    fn slippage_fields_are_omitted_by_default() {
        let env = PaymentEnvelope::new(TO, "USDC", "1", None, None).unwrap();
        let json: Value = serde_json::from_str(&env.to_json()).unwrap();
        assert!(json.get("slippage_bps").is_none());
        assert!(json.get("quote_id").is_none());
    }

    #[test]
    fn carries_slippage_and_quote_id() {
        let env = PaymentEnvelope::with_chain("stellar", TO, "USDC", "5", None, None)
            .unwrap()
            .with_slippage(50, "quote-abc")
            .expect("valid slippage");
        let json: Value = serde_json::from_str(&env.to_json()).unwrap();
        assert_eq!(json["slippage_bps"], 50);
        assert_eq!(json["quote_id"], "quote-abc");
    }

    #[test]
    fn rejects_invalid_slippage_and_quote_id() {
        let env = PaymentEnvelope::with_chain("stellar", TO, "USDC", "5", None, None).unwrap();
        assert_eq!(
            env.clone().with_slippage(MAX_SLIPPAGE_BPS + 1, "q"),
            Err(EnvelopeError::InvalidSlippage(MAX_SLIPPAGE_BPS + 1))
        );
        assert_eq!(
            env.clone().with_slippage(10, ""),
            Err(EnvelopeError::InvalidQuoteId(String::new()))
        );
        assert!(env.with_slippage(10, "bad quote").is_err());
    }
}
