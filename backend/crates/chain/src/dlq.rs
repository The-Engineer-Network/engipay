//! Dead-Letter Queue (DLQ) for uncreditable incoming deposits.
//!
//! When a deposit arrives that cannot be immediately credited — for example
//! because the recipient address is not associated with any known user,
//! because of a database constraint violation, or because the payload is
//! corrupted — it must **not** crash the watcher or be silently dropped.
//!
//! Instead, the deposit is recorded in the `uncredited_deposits` table with:
//! - `reason`      — a machine-readable code for why crediting failed
//! - `raw_payload` — the full JSON-serialised [`ObservedDeposit`] for forensics
//! - `status`      — `pending_investigation` (the initial state)
//!
//! Operations that write to the table are collected here so the watcher only
//! needs to call [`push_to_dlq`].
//!
//! # Database schema (must be in a migration before this runs)
//!
//! ```sql
//! CREATE TABLE uncredited_deposits (
//!     id              BIGSERIAL PRIMARY KEY,
//!     created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
//!     reason          TEXT        NOT NULL,
//!     raw_payload     JSONB       NOT NULL,
//!     status          TEXT        NOT NULL DEFAULT 'pending_investigation'
//! );
//! ```

use serde::{Deserialize, Serialize};

use crate::ObservedDeposit;

// ── Domain types ──────────────────────────────────────────────────────────────

/// The reason a deposit could not be credited. Each variant maps to a stable
/// string stored in the `reason` column so operators can filter by category.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DlqReason {
    /// The deposit address is not associated with any known EngiPay user.
    UnknownRecipient,
    /// A database constraint prevented the credit (e.g. duplicate reference).
    DatabaseConstraint,
    /// The deposit payload is structurally invalid or could not be parsed.
    MalformedPayload,
    /// Any other reason; the detail string carries the explanation.
    Other(String),
}

impl DlqReason {
    /// Returns the stable string stored in the `reason` column.
    pub fn as_str(&self) -> String {
        match self {
            DlqReason::UnknownRecipient => "unknown_recipient".to_owned(),
            DlqReason::DatabaseConstraint => "database_constraint".to_owned(),
            DlqReason::MalformedPayload => "malformed_payload".to_owned(),
            DlqReason::Other(detail) => format!("other:{detail}"),
        }
    }
}

/// A single DLQ entry as it would be inserted into `uncredited_deposits`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DlqEntry {
    pub reason: String,
    pub raw_payload: serde_json::Value,
    pub status: String,
}

impl DlqEntry {
    /// Constructs a new entry from a deposit and the reason it was not credited.
    ///
    /// The entry always starts with `status = "pending_investigation"`.
    pub fn new(deposit: &ObservedDeposit, reason: DlqReason) -> Self {
        // Serialise the deposit to JSON so it can be inspected without
        // deserialising Rust types.
        let raw_payload = serde_json::to_value(DlqDepositPayload::from(deposit))
            .unwrap_or_else(|_| serde_json::Value::Null);

        Self {
            reason: reason.as_str(),
            raw_payload,
            status: "pending_investigation".to_owned(),
        }
    }
}

// ── Serialisable payload ──────────────────────────────────────────────────────

/// The subset of [`ObservedDeposit`] fields that end up in `raw_payload`.
/// All money is stored as its minor-unit integer to preserve exactness — no
/// floating point ever touches a money value (project-wide rule).
#[derive(Debug, Serialize, Deserialize)]
struct DlqDepositPayload<'a> {
    reference: &'a str,
    address: &'a str,
    /// Minor-unit integer, e.g. stroops for XLM, cents-of-USDC for USDC.
    amount_minor: i128,
    asset: String,
    confirmations: u32,
}

impl<'a> From<&'a ObservedDeposit> for DlqDepositPayload<'a> {
    fn from(d: &'a ObservedDeposit) -> Self {
        Self {
            reference: &d.reference,
            address: &d.address,
            amount_minor: d.money.minor,
            asset: format!("{:?}", d.money.asset),
            confirmations: d.confirmations,
        }
    }
}

// ── Database write ────────────────────────────────────────────────────────────

/// Error type for DLQ operations.
#[derive(Debug, thiserror::Error)]
pub enum DlqError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("serialisation error: {0}")]
    Serialisation(#[from] serde_json::Error),
}

/// Inserts a deposit that could not be credited into the `uncredited_deposits`
/// table.
///
/// This is the main entry point for the watcher: call it whenever a deposit
/// arrives that cannot be applied to the ledger.
///
/// # Errors
///
/// Returns [`DlqError::Database`] if the insert fails.  The caller is
/// responsible for deciding whether to retry or log and continue.
pub async fn push_to_dlq(
    pool: &sqlx::PgPool,
    deposit: &ObservedDeposit,
    reason: DlqReason,
) -> Result<(), DlqError> {
    let entry = DlqEntry::new(deposit, reason);

    sqlx::query!(
        r#"
        INSERT INTO uncredited_deposits (reason, raw_payload, status)
        VALUES ($1, $2, $3)
        "#,
        entry.reason,
        entry.raw_payload,
        entry.status,
    )
    .execute(pool)
    .await?;

    tracing::warn!(
        reference = %deposit.reference,
        address   = %deposit.address,
        reason    = %entry.reason,
        "deposit could not be credited; added to DLQ"
    );

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use engipay_core::{Asset, Money};

    use super::*;
    use crate::ObservedDeposit;

    fn deposit(reference: &str) -> ObservedDeposit {
        ObservedDeposit {
            money: Money::from_minor(Asset::Xlm, 50_000_000),
            address: "MABC123".to_owned(),
            reference: reference.to_owned(),
            confirmations: 1,
        }
    }

    // ── DlqReason::as_str ─────────────────────────────────────────────────────

    #[test]
    fn reason_as_str_returns_stable_codes() {
        assert_eq!(DlqReason::UnknownRecipient.as_str(), "unknown_recipient");
        assert_eq!(DlqReason::DatabaseConstraint.as_str(), "database_constraint");
        assert_eq!(DlqReason::MalformedPayload.as_str(), "malformed_payload");
        assert_eq!(
            DlqReason::Other("custom reason".to_owned()).as_str(),
            "other:custom reason"
        );
    }

    // ── DlqEntry construction ─────────────────────────────────────────────────

    #[test]
    fn entry_starts_as_pending_investigation() {
        let d = deposit("stellar:tx1:1");
        let entry = DlqEntry::new(&d, DlqReason::UnknownRecipient);
        assert_eq!(entry.status, "pending_investigation");
        assert_eq!(entry.reason, "unknown_recipient");
    }

    #[test]
    fn entry_raw_payload_contains_reference() {
        let d = deposit("stellar:tx_abc:99");
        let entry = DlqEntry::new(&d, DlqReason::UnknownRecipient);
        let reference = entry.raw_payload["reference"].as_str().unwrap();
        assert_eq!(reference, "stellar:tx_abc:99");
    }

    #[test]
    fn entry_raw_payload_contains_exact_minor_amount() {
        let d = deposit("stellar:tx_minor:1");
        let entry = DlqEntry::new(&d, DlqReason::MalformedPayload);
        // Must be 50_000_000 (not a float).
        let minor = entry.raw_payload["amount_minor"].as_i64().unwrap();
        assert_eq!(minor, 50_000_000);
    }

    #[test]
    fn entry_raw_payload_has_no_floating_point_money() {
        let d = deposit("stellar:tx_fp:1");
        let entry = DlqEntry::new(&d, DlqReason::UnknownRecipient);
        // Verify the JSON does not contain a floating-point value for money.
        assert!(
            entry.raw_payload.get("amount").is_none(),
            "raw_payload must not have a float 'amount' field"
        );
        assert!(
            entry.raw_payload["amount_minor"].is_number(),
            "amount_minor must be a JSON number"
        );
    }

    #[test]
    fn entry_raw_payload_contains_address() {
        let d = deposit("stellar:tx_addr:1");
        let entry = DlqEntry::new(&d, DlqReason::DatabaseConstraint);
        assert_eq!(
            entry.raw_payload["address"].as_str().unwrap(),
            "MABC123"
        );
    }

    // ── Round-trip serialisation ──────────────────────────────────────────────

    #[test]
    fn dlq_entry_round_trips_through_json() {
        let d = deposit("stellar:rt:1");
        let entry = DlqEntry::new(&d, DlqReason::Other("test".to_owned()));
        let json = serde_json::to_string(&entry).unwrap();
        let back: DlqEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(entry, back);
    }

    // ── DLQ captures failed ingestion ─────────────────────────────────────────

    #[test]
    fn failed_deposit_ingestion_is_captured_in_dlq() {
        // Simulates what happens when the watcher encounters an uncreditable
        // deposit: the DlqEntry is built and its fields are correct.
        let d = ObservedDeposit {
            money: Money::from_minor(Asset::Usdc, 100_000_001),
            address: "GBADADDR".to_owned(),
            reference: "stellar:hash_x:op_y".to_owned(),
            confirmations: 2,
        };
        let entry = DlqEntry::new(&d, DlqReason::UnknownRecipient);

        // Core contract: status, reason, and reference are all set correctly.
        assert_eq!(entry.status, "pending_investigation");
        assert_eq!(entry.reason, "unknown_recipient");
        assert_eq!(
            entry.raw_payload["reference"].as_str().unwrap(),
            "stellar:hash_x:op_y"
        );
        // Money is exact integer, no float.
        assert_eq!(entry.raw_payload["amount_minor"].as_i64().unwrap(), 100_000_001);
    }
}
