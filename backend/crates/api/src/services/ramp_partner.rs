//! Naira ramp partner trait, types, and in-memory fake.
//!
//! A ramp partner converts between NGN (Naira) and a crypto asset. The trait
//! is the stable interface; partners are wired in at startup. The in-memory
//! fake is used in tests and in development when no real partner is configured.
//!
//! ## Candidate partners
//!
//! | Partner        | Mechanism              | Notes                                           |
//! |----------------|------------------------|-------------------------------------------------|
//! | Flutterwave    | Bank transfer → USDC   | Widely used in Nigeria; REST + webhook          |
//! | Monnify        | Bank transfer → NGN    | Moniepoint subsidiary; REST + webhook           |
//! | Yellow Card    | P2P / bank → crypto    | Multi-asset; REST + webhook; KYC required       |
//! | Chipper Cash   | Mobile money → crypto  | Cross-border Africa; REST + webhook             |
//!
//! None of these are integrated here. The first integration should implement
//! this trait and be wired into `AppState` without modifying routes or handlers.
//!
//! ## Design decisions
//!
//! * **Amounts as exact integers.** `crypto_minor` is in the asset's smallest
//!   unit and `ngn_kobo` is in kobo (1/100 Naira), matching the rest of the
//!   codebase. Partners that use decimal strings or floats must convert on the
//!   way in and out.
//! * **Webhook verification is part of the trait.** The handler extracts the
//!   raw body bytes and partner-specific headers, then calls
//!   `verify_webhook_signature`. This keeps all partner-specific crypto inside
//!   the implementation and out of the generic route.
//! * **Direction enum.** `OnRamp` (NGN → crypto) and `OffRamp` (crypto → NGN)
//!   map directly to `ramp_orders.direction`.

use std::collections::HashMap;
use std::sync::Mutex;

use engipay_core::Asset;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Types ─────────────────────────────────────────────────────────────────────

/// Whether the user is buying or selling crypto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    /// Naira → crypto.
    OnRamp,
    /// Crypto → Naira.
    OffRamp,
}

impl Direction {
    /// The string stored in `ramp_orders.direction`.
    pub fn as_db_str(self) -> &'static str {
        match self {
            Direction::OnRamp => "on_ramp",
            Direction::OffRamp => "off_ramp",
        }
    }
}

/// A live price from the partner, valid until `expires_at`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RampQuote {
    /// Opaque reference returned by the partner (stored for traceability).
    pub partner_quote_id: String,
    pub direction: Direction,
    pub asset: Asset,
    /// Crypto the user receives (on-ramp) or sends (off-ramp), in the asset's
    /// smallest unit.
    pub crypto_minor: i64,
    /// Naira the user pays (on-ramp) or receives (off-ramp), in kobo.
    pub ngn_kobo: i64,
    /// Exchange rate: kobo per whole unit of the asset.
    pub rate_kobo_per_unit: i64,
    /// Fee in the asset's smallest unit (deducted from `crypto_minor`).
    pub fee_minor: i64,
    /// Unix timestamp (seconds) after which this quote must not be used.
    pub expires_at: i64,
}

/// A ramp order created with the partner, awaiting payment or processing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RampOrder {
    /// EngiPay's internal order id.
    pub id: Uuid,
    /// Opaque reference the partner assigns to this order.
    pub partner_ref: String,
    pub status: RampOrderStatus,
    /// Payment instructions for the user (on-ramp): bank account number,
    /// sort code, or a payment URL. `None` for off-ramp orders.
    pub payment_instructions: Option<String>,
}

/// Current lifecycle state of a ramp order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RampOrderStatus {
    /// Order placed, waiting for the user to pay (on-ramp) or for crypto to
    /// arrive (off-ramp).
    AwaitingPayment,
    /// Payment received; partner is processing the conversion.
    Processing,
    /// Conversion complete. Crypto has been credited (on-ramp) or Naira has
    /// been sent (off-ramp).
    Completed,
    /// Order failed; no money moved.
    Failed,
    /// Order refunded (user did not pay within the time window, etc.).
    Refunded,
}

impl RampOrderStatus {
    /// The string stored in `ramp_orders.status`.
    pub fn as_db_str(self) -> &'static str {
        match self {
            RampOrderStatus::AwaitingPayment => "awaiting_payment",
            RampOrderStatus::Processing => "processing",
            RampOrderStatus::Completed => "completed",
            RampOrderStatus::Failed => "failed",
            RampOrderStatus::Refunded => "refunded",
        }
    }
}

/// Decoded content of a partner webhook event, after signature verification.
#[derive(Debug, Clone)]
pub struct WebhookEvent {
    /// Unique event identifier from the partner. Used to de-duplicate.
    pub event_id: String,
    /// The order this event refers to (by `partner_ref`).
    pub partner_ref: String,
    pub new_status: RampOrderStatus,
    /// Raw JSON payload, stored verbatim for auditability.
    pub raw_payload: serde_json::Value,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RampError {
    /// The asset is not supported by this partner for the given direction.
    #[error("asset {asset} is not supported for {direction:?}")]
    UnsupportedAsset { asset: Asset, direction: Direction },
    /// The partner refused the quote or order (e.g. amount too small/large).
    #[error("partner rejected the request: {0}")]
    PartnerRejected(String),
    /// Network or protocol error talking to the partner.
    #[error("partner is unavailable: {0}")]
    PartnerUnavailable(String),
    /// The webhook signature does not match.
    #[error("webhook signature is invalid")]
    InvalidSignature,
    /// The webhook payload could not be parsed.
    #[error("webhook payload is malformed: {0}")]
    MalformedPayload(String),
}

// ── Trait ─────────────────────────────────────────────────────────────────────

/// A Naira on/off ramp partner.
///
/// Implementations are `Send + Sync` so they can be stored in `Arc<dyn
/// RampPartner>` and shared across Tokio tasks.
pub trait RampPartner: Send + Sync {
    /// Human-readable partner name stored in `ramp_orders.partner`.
    fn name(&self) -> &'static str;

    /// Returns a price quote for `crypto_minor` units of `asset` in direction
    /// `direction`.
    fn quote(
        &self,
        direction: Direction,
        asset: Asset,
        crypto_minor: i64,
    ) -> Result<RampQuote, RampError>;

    /// Creates an order from a live quote. The caller must check `quote.expires_at`
    /// before calling.
    fn create_order(
        &self,
        order_id: Uuid,
        quote: &RampQuote,
    ) -> Result<RampOrder, RampError>;

    /// Returns the current status of an order by partner reference.
    fn order_status(&self, partner_ref: &str) -> Result<RampOrderStatus, RampError>;

    /// Verifies the partner-specific signature over `raw_body` using
    /// `header_value` (the raw value of whichever HTTP header the partner uses,
    /// e.g. `X-Flutterwave-Signature`).
    ///
    /// Returns the decoded event on success, [`RampError::InvalidSignature`] on
    /// a bad signature, and [`RampError::MalformedPayload`] if the body cannot
    /// be parsed.
    fn verify_webhook_signature(
        &self,
        raw_body: &[u8],
        header_value: &str,
    ) -> Result<WebhookEvent, RampError>;
}

// ── HMAC-SHA256 helper ────────────────────────────────────────────────────────

/// Compute HMAC-SHA256 over `data` with `key` and return the lowercase hex
/// string. Uses the raw `sha2` crate (already a workspace dependency) without
/// pulling in the `hmac` crate.
///
/// This function is `pub` so the webhook handler can reproduce the expected
/// signature for custom partners without duplicating the implementation.
pub fn hmac_sha256_hex(key: &[u8], data: &[u8]) -> String {
    use sha2::Digest;

    const BLOCK: usize = 64;
    // Derive the block-sized key.
    let mut k = [0u8; BLOCK];
    if key.len() <= BLOCK {
        k[..key.len()].copy_from_slice(key);
    } else {
        let h = sha2::Sha256::digest(key);
        k[..h.len()].copy_from_slice(&h);
    }

    let mut ipad = k;
    let mut opad = k;
    for i in 0..BLOCK {
        ipad[i] ^= 0x36;
        opad[i] ^= 0x5c;
    }

    let mut inner = sha2::Sha256::new();
    inner.update(ipad);
    inner.update(data);
    let inner_hash = inner.finalize();

    let mut outer = sha2::Sha256::new();
    outer.update(opad);
    outer.update(inner_hash);
    hex::encode(outer.finalize())
}

/// Constant-time byte comparison to prevent timing side-channels.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

// ── In-memory fake ────────────────────────────────────────────────────────────

/// Fixed parameters the fake quotes with.
#[derive(Debug, Clone)]
pub struct FakeRampPartnerTerms {
    /// Kobo per whole unit of any supported asset.
    pub rate_kobo_per_unit: i64,
    /// Fee in the asset's smallest unit.
    pub fee_minor: i64,
    /// Seconds until the returned quote expires (relative to a fake epoch of 0).
    pub quote_ttl_secs: i64,
}

impl Default for FakeRampPartnerTerms {
    fn default() -> Self {
        Self {
            rate_kobo_per_unit: 150_000, // ₦1,500 per USDC
            fee_minor: 100_000,          // 0.01 USDC fee
            quote_ttl_secs: 120,         // 2 minutes
        }
    }
}

/// In-memory ramp partner for unit tests and local development.
///
/// Only USDC on-ramp is supported. Webhook signatures are HMAC-SHA256 with the
/// configured `webhook_secret`. All state (orders) lives in memory.
pub struct FakeRampPartner {
    pub terms: FakeRampPartnerTerms,
    /// HMAC-SHA256 key used to sign/verify fake webhook bodies.
    pub webhook_secret: String,
    /// Orders created so far: `partner_ref → status`.
    orders: Mutex<HashMap<String, RampOrderStatus>>,
}

impl FakeRampPartner {
    pub fn new(terms: FakeRampPartnerTerms, webhook_secret: impl Into<String>) -> Self {
        Self {
            terms,
            webhook_secret: webhook_secret.into(),
            orders: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for FakeRampPartner {
    fn default() -> Self {
        Self::new(FakeRampPartnerTerms::default(), "fake-webhook-secret")
    }
}

impl RampPartner for FakeRampPartner {
    fn name(&self) -> &'static str {
        "fake"
    }

    fn quote(
        &self,
        direction: Direction,
        asset: Asset,
        crypto_minor: i64,
    ) -> Result<RampQuote, RampError> {
        if asset != Asset::Usdc || direction != Direction::OnRamp {
            return Err(RampError::UnsupportedAsset { asset, direction });
        }
        if crypto_minor <= 0 {
            return Err(RampError::PartnerRejected(
                "crypto_minor must be positive".to_owned(),
            ));
        }
        let scale = 10i64.pow(asset.decimals());
        let ngn_kobo = (crypto_minor / scale) * self.terms.rate_kobo_per_unit
            + (crypto_minor % scale) * self.terms.rate_kobo_per_unit / scale;

        Ok(RampQuote {
            partner_quote_id: format!("fake-quote-{crypto_minor}"),
            direction,
            asset,
            crypto_minor,
            ngn_kobo,
            rate_kobo_per_unit: self.terms.rate_kobo_per_unit,
            fee_minor: self.terms.fee_minor,
            // Fake "now" is 0 so tests are deterministic.
            expires_at: self.terms.quote_ttl_secs,
        })
    }

    fn create_order(&self, order_id: Uuid, quote: &RampQuote) -> Result<RampOrder, RampError> {
        let partner_ref = format!("fake-order-{order_id}");
        self.orders
            .lock()
            .expect("orders lock poisoned")
            .insert(partner_ref.clone(), RampOrderStatus::AwaitingPayment);
        Ok(RampOrder {
            id: order_id,
            partner_ref: partner_ref.clone(),
            status: RampOrderStatus::AwaitingPayment,
            payment_instructions: Some(format!(
                "Pay {} kobo to account 0000000000 (Fake Bank)",
                quote.ngn_kobo
            )),
        })
    }

    fn order_status(&self, partner_ref: &str) -> Result<RampOrderStatus, RampError> {
        self.orders
            .lock()
            .expect("orders lock poisoned")
            .get(partner_ref)
            .copied()
            .ok_or_else(|| RampError::PartnerRejected(format!("unknown order: {partner_ref}")))
    }

    fn verify_webhook_signature(
        &self,
        raw_body: &[u8],
        header_value: &str,
    ) -> Result<WebhookEvent, RampError> {
        let expected = hmac_sha256_hex(self.webhook_secret.as_bytes(), raw_body);
        if !constant_time_eq(expected.as_bytes(), header_value.as_bytes()) {
            return Err(RampError::InvalidSignature);
        }
        let payload: serde_json::Value = serde_json::from_slice(raw_body)
            .map_err(|e| RampError::MalformedPayload(e.to_string()))?;
        let event_id = payload["event_id"]
            .as_str()
            .ok_or_else(|| RampError::MalformedPayload("missing event_id".to_owned()))?
            .to_owned();
        let partner_ref = payload["order_ref"]
            .as_str()
            .ok_or_else(|| RampError::MalformedPayload("missing order_ref".to_owned()))?
            .to_owned();
        let status_str = payload["status"]
            .as_str()
            .ok_or_else(|| RampError::MalformedPayload("missing status".to_owned()))?;
        let new_status = parse_status(status_str)
            .ok_or_else(|| RampError::MalformedPayload(format!("unknown status: {status_str}")))?;

        if let Ok(mut orders) = self.orders.lock() {
            orders.insert(partner_ref.clone(), new_status);
        }
        Ok(WebhookEvent {
            event_id,
            partner_ref,
            new_status,
            raw_payload: payload,
        })
    }
}

fn parse_status(s: &str) -> Option<RampOrderStatus> {
    match s {
        "completed" => Some(RampOrderStatus::Completed),
        "failed" => Some(RampOrderStatus::Failed),
        "refunded" => Some(RampOrderStatus::Refunded),
        "processing" => Some(RampOrderStatus::Processing),
        "awaiting_payment" => Some(RampOrderStatus::AwaitingPayment),
        _ => None,
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn partner() -> FakeRampPartner {
        FakeRampPartner::default()
    }

    #[test]
    fn quote_on_ramp_usdc_returns_correct_ngn() {
        let p = partner();
        // 10 USDC = 10_000_000 minor (7dp). At 150_000 kobo/USDC → 1_500_000 kobo.
        let q = p.quote(Direction::OnRamp, Asset::Usdc, 10_000_000).unwrap();
        assert_eq!(q.ngn_kobo, 1_500_000);
        assert_eq!(q.rate_kobo_per_unit, 150_000);
        assert_eq!(q.fee_minor, 100_000);
        assert_eq!(q.direction, Direction::OnRamp);
    }

    #[test]
    fn quote_off_ramp_is_unsupported_by_fake() {
        let p = partner();
        let err = p
            .quote(Direction::OffRamp, Asset::Usdc, 1_000_000)
            .unwrap_err();
        assert!(matches!(err, RampError::UnsupportedAsset { .. }));
    }

    #[test]
    fn quote_unsupported_asset_is_refused() {
        let p = partner();
        let err = p
            .quote(Direction::OnRamp, Asset::Eth, 1_000_000)
            .unwrap_err();
        assert!(matches!(err, RampError::UnsupportedAsset { .. }));
    }

    #[test]
    fn quote_non_positive_amount_is_refused() {
        let p = partner();
        assert!(p.quote(Direction::OnRamp, Asset::Usdc, 0).is_err());
        assert!(p.quote(Direction::OnRamp, Asset::Usdc, -1).is_err());
    }

    #[test]
    fn create_order_assigns_partner_ref_and_tracks_status() {
        let p = partner();
        let q = p.quote(Direction::OnRamp, Asset::Usdc, 5_000_000).unwrap();
        let id = Uuid::new_v4();
        let order = p.create_order(id, &q).unwrap();
        assert_eq!(order.id, id);
        assert_eq!(order.status, RampOrderStatus::AwaitingPayment);
        assert!(order.payment_instructions.is_some());

        let status = p.order_status(&order.partner_ref).unwrap();
        assert_eq!(status, RampOrderStatus::AwaitingPayment);
    }

    #[test]
    fn order_status_unknown_ref_returns_error() {
        let p = partner();
        assert!(p.order_status("no-such-ref").is_err());
    }

    #[test]
    fn valid_webhook_signature_is_accepted() {
        let p = FakeRampPartner::new(FakeRampPartnerTerms::default(), "test-secret");
        let q = p.quote(Direction::OnRamp, Asset::Usdc, 1_000_000).unwrap();
        let id = Uuid::new_v4();
        let order = p.create_order(id, &q).unwrap();

        let payload = serde_json::json!({
            "event_id": "evt-001",
            "order_ref": order.partner_ref,
            "status": "completed"
        })
        .to_string();
        let sig = hmac_sha256_hex(b"test-secret", payload.as_bytes());
        let event = p
            .verify_webhook_signature(payload.as_bytes(), &sig)
            .unwrap();
        assert_eq!(event.event_id, "evt-001");
        assert_eq!(event.new_status, RampOrderStatus::Completed);
    }

    #[test]
    fn bad_webhook_signature_is_rejected() {
        let p = FakeRampPartner::new(FakeRampPartnerTerms::default(), "test-secret");
        let payload = br#"{"event_id":"e1","order_ref":"r1","status":"completed"}"#;
        let err = p
            .verify_webhook_signature(payload, "bad-signature")
            .unwrap_err();
        assert_eq!(err, RampError::InvalidSignature);
    }

    #[test]
    fn malformed_webhook_payload_is_rejected() {
        let p = partner();
        let payload = b"not-json";
        let sig = hmac_sha256_hex(b"fake-webhook-secret", payload);
        let err = p.verify_webhook_signature(payload, &sig).unwrap_err();
        assert!(matches!(err, RampError::MalformedPayload(_)));
    }

    #[test]
    fn constant_time_eq_is_correct() {
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(constant_time_eq(b"secret", b"secret"));
        assert!(!constant_time_eq(b"abc", b"abd"));
    }

    #[test]
    fn hmac_sha256_hex_known_vector() {
        // RFC 4231 test vector 1: key=0x0b*20, data="Hi There"
        let key = [0x0bu8; 20];
        let data = b"Hi There";
        let result = hmac_sha256_hex(&key, data);
        assert_eq!(
            result,
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }
}
