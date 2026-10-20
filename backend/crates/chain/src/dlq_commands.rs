//! Subcommands for managing the Dead-Letter Queue (uncredited deposits).
//!
//! Operations run these commands to list, reprocess, or resolve deposits
//! that the watcher could not credit automatically.

use anyhow::{Context, bail};
use engipay_core::{Asset, Money};
use serde::Deserialize;
use sqlx::PgPool;

use crate::ObservedDeposit;
use crate::deposit_creditor::{CreditOutcome, DepositCreditor};

/// Row from `uncredited_deposits`.
#[derive(Debug, Clone)]
pub struct UncreditedRow {
    pub id: i64,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub reason: String,
    pub raw_payload: serde_json::Value,
    pub status: String,
}

/// Lists all uncredited deposits with status `pending_investigation`.
///
/// Returns rows ordered by creation time (newest first).
pub async fn list(pool: &PgPool) -> anyhow::Result<Vec<UncreditedRow>> {
    let rows = sqlx::query_as::<
        _,
        (
            i64,
            chrono::DateTime<chrono::Utc>,
            String,
            serde_json::Value,
            String,
        ),
    >(
        "SELECT id, created_at, reason, raw_payload, status
         FROM uncredited_deposits
         WHERE status = 'pending_investigation'
         ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
    .context("could not list uncredited deposits")?;

    Ok(rows
        .into_iter()
        .map(
            |(id, created_at, reason, raw_payload, status)| UncreditedRow {
                id,
                created_at,
                reason,
                raw_payload,
                status,
            },
        )
        .collect())
}

/// Reprocesses one uncredited deposit by calling the [`DepositCreditor`].
///
/// The creditor's idempotency logic ensures that if the deposit was already
/// credited (e.g. after a code fix), no duplicate credit occurs. On success,
/// marks the row as `reprocessed`. On failure, leaves it as
/// `pending_investigation` and returns an error.
///
/// # Errors
///
/// - Returns an error if `id` does not exist or is not `pending_investigation`
/// - Returns an error if the payload cannot be deserialised into [`ObservedDeposit`]
/// - Returns an error if the creditor routes the deposit to the DLQ again
pub async fn reprocess(pool: &PgPool, id: i64, creditor: &DepositCreditor) -> anyhow::Result<()> {
    // 1. Fetch the row and check it is pending.
    let row = sqlx::query_as::<_, (i64, serde_json::Value, String)>(
        "SELECT id, raw_payload, status
         FROM uncredited_deposits
         WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .context("could not fetch uncredited deposit")?
    .with_context(|| format!("uncredited deposit {id} not found"))?;
    let (_row_id, raw_payload, status) = row;

    if status != "pending_investigation" {
        bail!(
            "uncredited deposit {id} has status {:?}, cannot reprocess (must be pending_investigation)",
            status
        );
    }

    // 2. Deserialise the raw_payload into an ObservedDeposit.
    let deposit = deserialize_payload(&raw_payload)
        .with_context(|| format!("could not parse raw_payload for uncredited deposit {id}"))?;

    // 3. Call the creditor. The reference acts as the idempotency key: if the
    // deposit was already credited (e.g. by a previous manual reprocess or a
    // code change), the ledger returns `replayed = true` and nothing moves.
    let outcome = creditor.process(deposit.clone()).await;
    match outcome {
        CreditOutcome::Credited => {
            tracing::info!(id, reference = %deposit.reference, "uncredited deposit reprocessed and credited");
        }
        CreditOutcome::Replayed => {
            tracing::info!(
                id,
                reference = %deposit.reference,
                "uncredited deposit was already credited; marking as reprocessed"
            );
        }
        CreditOutcome::Dlq(reason) => {
            bail!(
                "reprocessing uncredited deposit {id} failed again with reason {:?}; \
                 the deposit remains pending_investigation",
                reason
            );
        }
    }

    // 4. Mark the row as reprocessed.
    sqlx::query(
        "UPDATE uncredited_deposits
         SET status = 'reprocessed'
         WHERE id = $1",
    )
    .bind(id)
    .execute(pool)
    .await
    .context("could not mark deposit as reprocessed")?;

    Ok(())
}

/// Marks an uncredited deposit as `resolved` with an operator note.
///
/// Use this when the root cause has been identified and fixed (e.g. a user's
/// account was created, or the deposit was manually credited via SQL).
///
/// # Errors
///
/// - Returns an error if `id` does not exist or is not `pending_investigation`
pub async fn resolve(pool: &PgPool, id: i64, note: &str) -> anyhow::Result<()> {
    let row = sqlx::query_as::<_, (i64, String)>(
        "SELECT id, status
         FROM uncredited_deposits
         WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .context("could not fetch uncredited deposit")?
    .with_context(|| format!("uncredited deposit {id} not found"))?;
    let (_row_id, status) = row;

    if status != "pending_investigation" {
        bail!(
            "uncredited deposit {id} has status {:?}, cannot resolve (must be pending_investigation)",
            status
        );
    }

    // Store the note in a new column or append to raw_payload. For now, just
    // mark as resolved. A future migration can add a `resolution_note TEXT`.
    sqlx::query(
        "UPDATE uncredited_deposits
         SET status = 'resolved'
         WHERE id = $1",
    )
    .bind(id)
    .execute(pool)
    .await
    .context("could not mark deposit as resolved")?;

    tracing::info!(id, note, "uncredited deposit marked as resolved");
    Ok(())
}

/// Deserialises `raw_payload` (the DLQ's JSON snapshot) into an [`ObservedDeposit`].
///
/// The payload structure is defined in [`crate::dlq::DlqDepositPayload`].
fn deserialize_payload(payload: &serde_json::Value) -> anyhow::Result<ObservedDeposit> {
    #[derive(Deserialize)]
    struct DlqPayload {
        reference: String,
        address: String,
        amount_minor: i128,
        asset: String,
        confirmations: u32,
    }

    let p: DlqPayload = serde_json::from_value(payload.clone())
        .context("raw_payload is not a valid DlqDepositPayload")?;

    // Parse the asset string (e.g. "Xlm" → Asset::Xlm).
    let asset = match p.asset.as_str() {
        "Xlm" => Asset::Xlm,
        "Usdc" => Asset::Usdc,
        "Eth" => Asset::Eth,
        other => bail!("unknown asset {:?}", other),
    };

    Ok(ObservedDeposit {
        money: Money::from_minor(asset, p.amount_minor),
        address: p.address,
        reference: p.reference,
        confirmations: p.confirmations,
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_payload_parses_xlm_deposit() {
        let payload = serde_json::json!({
            "reference": "stellar:tx123:456",
            "address": "MABC",
            "amount_minor": 50_000_000,
            "asset": "Xlm",
            "confirmations": 5
        });
        let deposit = deserialize_payload(&payload).unwrap();
        assert_eq!(deposit.reference, "stellar:tx123:456");
        assert_eq!(deposit.address, "MABC");
        assert_eq!(deposit.money, Money::from_minor(Asset::Xlm, 50_000_000));
        assert_eq!(deposit.confirmations, 5);
    }

    #[test]
    fn deserialize_payload_parses_usdc_deposit() {
        let payload = serde_json::json!({
            "reference": "base:0xabc:7",
            "address": "0xdef",
            "amount_minor": 100_000_000,
            "asset": "Usdc",
            "confirmations": 12
        });
        let deposit = deserialize_payload(&payload).unwrap();
        assert_eq!(deposit.money.asset, Asset::Usdc);
        assert_eq!(deposit.money.minor, 100_000_000);
    }

    #[test]
    fn deserialize_payload_rejects_unknown_asset() {
        let payload = serde_json::json!({
            "reference": "chain:ref",
            "address": "addr",
            "amount_minor": 1,
            "asset": "UnknownAsset",
            "confirmations": 1
        });
        assert!(deserialize_payload(&payload).is_err());
    }

    #[test]
    fn deserialize_payload_rejects_malformed_json() {
        let payload = serde_json::json!({ "unexpected_field": true });
        assert!(deserialize_payload(&payload).is_err());
    }
}
