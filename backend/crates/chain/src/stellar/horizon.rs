//! Horizon responses, and the rules that turn a payment record into a deposit.
//!
//! Everything here is pure: no network, no clock. The decisions that credit a
//! user's balance are tested against recorded Horizon JSON.

use engipay_core::{Asset, Chain, Money};
use serde::Deserialize;

use super::network::StellarNetwork;
use crate::ObservedDeposit;

/// `GET /` on Horizon.
#[derive(Debug, Deserialize)]
pub struct Root {
    /// The newest ledger Horizon has fully ingested. Payments in it are final.
    pub history_latest_ledger: u64,
}

/// `GET /accounts/{id}`.
#[derive(Debug, Deserialize)]
pub struct Account {
    /// Returned as a string because it can exceed JavaScript's safe integers.
    pub sequence: String,
}

#[derive(Debug, Deserialize)]
pub struct Page<T> {
    #[serde(rename = "_embedded")]
    pub embedded: Embedded<T>,
}

#[derive(Debug, Deserialize)]
pub struct Embedded<T> {
    pub records: Vec<T>,
}

/// One record from `GET /accounts/{id}/payments?join=transactions`.
///
/// Only the fields deposits depend on. Unknown operation types deserialise
/// fine and are ignored by [`deposit_from_record`].
#[derive(Debug, Clone, Deserialize)]
pub struct PaymentRecord {
    pub paging_token: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub transaction_hash: String,
    #[serde(default)]
    pub transaction_successful: bool,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub to_muxed: Option<String>,
    #[serde(default)]
    pub asset_type: Option<String>,
    #[serde(default)]
    pub asset_code: Option<String>,
    #[serde(default)]
    pub asset_issuer: Option<String>,
    #[serde(default)]
    pub amount: Option<String>,
    #[serde(default)]
    pub transaction: Option<JoinedTransaction>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JoinedTransaction {
    pub ledger: u64,
    pub successful: bool,
}

/// `400` from `POST /transactions`.
#[derive(Debug, Deserialize)]
pub struct SubmitProblem {
    pub title: String,
    #[serde(default)]
    pub extras: Option<SubmitExtras>,
}

#[derive(Debug, Deserialize)]
pub struct SubmitExtras {
    pub result_codes: Option<serde_json::Value>,
}

/// `200` from `POST /transactions`.
#[derive(Debug, Deserialize)]
pub struct Submitted {
    pub hash: String,
    pub ledger: u64,
}

/// Why a payment into the custody account was not turned into a deposit. Each
/// of these is logged, because money arrived and someone may need to act.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Skipped {
    /// Outgoing, or not a payment at all (e.g. account creation or a trustline).
    NotIncoming,
    Failed,
    /// A token EngiPay does not hold, including fake USDC from another issuer.
    UnsupportedAsset {
        code: String,
        issuer: String,
    },
    Malformed(&'static str),
}

/// Turns a Horizon payment record into a deposit into `custody`.
///
/// `latest_ledger` is Horizon's newest ingested ledger, used to report
/// confirmations. A deposit is only ever produced for a successful payment of
/// XLM or of USDC from the network's real issuer, into the custody account.
pub fn deposit_from_record(
    record: &PaymentRecord,
    custody: &str,
    network: StellarNetwork,
    latest_ledger: u64,
) -> Result<ObservedDeposit, Skipped> {
    let is_payment = matches!(
        record.kind.as_str(),
        "payment" | "path_payment_strict_receive" | "path_payment_strict_send"
    );
    if !is_payment || record.to.as_deref() != Some(custody) {
        return Err(Skipped::NotIncoming);
    }

    let transaction = record.transaction.as_ref().ok_or(Skipped::Malformed(
        "record was fetched without join=transactions",
    ))?;
    // Both flags must agree. Failed transactions still appear in history.
    if !record.transaction_successful || !transaction.successful {
        return Err(Skipped::Failed);
    }

    let asset = match record.asset_type.as_deref() {
        Some("native") => Asset::Xlm,
        Some("credit_alphanum4") | Some("credit_alphanum12") => {
            let code = record.asset_code.clone().unwrap_or_default();
            let issuer = record.asset_issuer.clone().unwrap_or_default();
            if code == "USDC" && issuer == network.usdc_issuer() {
                Asset::Usdc
            } else {
                return Err(Skipped::UnsupportedAsset { code, issuer });
            }
        }
        _ => return Err(Skipped::Malformed("unknown asset_type")),
    };

    let stroops = record
        .amount
        .as_deref()
        .and_then(parse_stroops)
        .ok_or(Skipped::Malformed(
            "amount is not a 7-decimal Stellar amount",
        ))?;
    let money = Money::from_network_units(asset, Chain::Stellar, i128::from(stroops))
        .map_err(|_| Skipped::Malformed("amount out of range"))?;

    let confirmations = latest_ledger
        .checked_sub(transaction.ledger)
        .and_then(|behind| behind.checked_add(1))
        .map_or(0, |count| u32::try_from(count).unwrap_or(u32::MAX));

    Ok(ObservedDeposit {
        money,
        // The muxed address identifies the user. A payment to the bare custody
        // account has no owner and must be reviewed by a person.
        address: record
            .to_muxed
            .clone()
            .unwrap_or_else(|| custody.to_owned()),
        // The operation id is unique across the network's history.
        reference: format!(
            "stellar:{}:{}",
            record.transaction_hash, record.paging_token
        ),
        confirmations,
    })
}

/// Parses Horizon's amount format, always seven decimals (e.g. "12.3400000"),
/// into stroops. Anything else is refused rather than guessed at.
pub fn parse_stroops(amount: &str) -> Option<i64> {
    let (whole, fraction) = amount.split_once('.')?;
    if whole.is_empty()
        || fraction.len() != 7
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !fraction.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let whole: i64 = whole.parse().ok()?;
    let fraction: i64 = fraction.parse().ok()?;
    whole.checked_mul(10_000_000)?.checked_add(fraction)
}

/// Horizon paging tokens for operations are TOIDs: the ledger sequence in the
/// top 32 bits. A cursor just below a ledger's first operation lets us resume
/// from a ledger height without storing Horizon-specific state.
pub fn cursor_for_ledger(ledger: u64) -> Option<i64> {
    let ledger = i64::try_from(ledger).ok()?;
    ledger.checked_mul(1 << 32)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn account(seed: u8) -> String {
        stellar_strkey::ed25519::PublicKey([seed; 32])
            .to_string()
            .as_str()
            .to_owned()
    }

    fn custody() -> String {
        account(1)
    }

    fn muxed() -> String {
        engipay_core::stellar::muxed_deposit_address(&custody(), 420).unwrap()
    }

    fn sender() -> String {
        account(2)
    }

    /// Shaped like a real record from horizon-testnet, trimmed to the fields
    /// Horizon always returns for a payment.
    fn record(json: serde_json::Value) -> PaymentRecord {
        let mut base = serde_json::json!({
            "id": "4294967297",
            "paging_token": "4294967297",
            "transaction_successful": true,
            "source_account": sender(),
            "type": "payment",
            "type_i": 1,
            "created_at": "2026-09-16T12:00:00Z",
            "transaction_hash": "a1b2c3",
            "asset_type": "native",
            "from": sender(),
            "to": custody(),
            "to_muxed": muxed(),
            "to_muxed_id": "420",
            "amount": "25.5000000",
            "transaction": { "ledger": 100, "successful": true }
        });
        if let (Some(base), Some(patch)) = (base.as_object_mut(), json.as_object()) {
            for (key, value) in patch {
                base.insert(key.clone(), value.clone());
            }
        }
        serde_json::from_value(base).unwrap()
    }

    fn deposit(json: serde_json::Value) -> Result<ObservedDeposit, Skipped> {
        deposit_from_record(&record(json), &custody(), StellarNetwork::Testnet, 104)
    }

    #[test]
    fn a_native_payment_to_a_muxed_address_is_a_deposit() {
        let found = deposit(serde_json::json!({})).unwrap();
        assert_eq!(found.money, Money::from_minor(Asset::Xlm, 255_000_000));
        assert_eq!(found.address, muxed());
        assert_eq!(found.reference, "stellar:a1b2c3:4294967297");
        assert_eq!(found.confirmations, 5);
    }

    #[test]
    fn usdc_from_circle_is_usdc() {
        let found = deposit(serde_json::json!({
            "asset_type": "credit_alphanum4",
            "asset_code": "USDC",
            "asset_issuer": StellarNetwork::Testnet.usdc_issuer(),
            "amount": "10.0000001",
        }))
        .unwrap();
        assert_eq!(found.money, Money::from_minor(Asset::Usdc, 100_000_001));
    }

    #[test]
    fn usdc_from_any_other_issuer_is_refused() {
        let skipped = deposit(serde_json::json!({
            "asset_type": "credit_alphanum4",
            "asset_code": "USDC",
            "asset_issuer": sender(),
        }));
        assert!(matches!(skipped, Err(Skipped::UnsupportedAsset { .. })));
    }

    #[test]
    fn mainnet_usdc_is_not_accepted_on_testnet() {
        let skipped = deposit(serde_json::json!({
            "asset_type": "credit_alphanum4",
            "asset_code": "USDC",
            "asset_issuer": StellarNetwork::Mainnet.usdc_issuer(),
        }));
        assert!(matches!(skipped, Err(Skipped::UnsupportedAsset { .. })));
    }

    #[test]
    fn failed_transactions_are_never_deposits() {
        assert_eq!(
            deposit(serde_json::json!({ "transaction_successful": false })),
            Err(Skipped::Failed)
        );
        assert_eq!(
            deposit(serde_json::json!({ "transaction": { "ledger": 100, "successful": false } })),
            Err(Skipped::Failed)
        );
    }

    #[test]
    fn outgoing_payments_are_not_deposits() {
        assert_eq!(
            deposit(serde_json::json!({ "from": custody(), "to": sender(), "to_muxed": null })),
            Err(Skipped::NotIncoming)
        );
    }

    #[test]
    fn other_operation_types_are_ignored() {
        assert_eq!(
            deposit(serde_json::json!({ "type": "create_account" })),
            Err(Skipped::NotIncoming)
        );
    }

    #[test]
    fn a_payment_to_the_bare_custody_account_has_no_owner() {
        let found = deposit(serde_json::json!({ "to_muxed": null })).unwrap();
        assert_eq!(found.address, custody());
    }

    #[test]
    fn records_without_the_joined_transaction_are_malformed() {
        assert!(matches!(
            deposit(serde_json::json!({ "transaction": null })),
            Err(Skipped::Malformed(_))
        ));
    }

    #[test]
    fn stroops_parse_exactly() {
        assert_eq!(parse_stroops("0.0000001"), Some(1));
        assert_eq!(parse_stroops("25.5000000"), Some(255_000_000));
        assert_eq!(parse_stroops("922337203685.4775807"), Some(i64::MAX));
        for bad in [
            "25.5",
            "25",
            ".5000000",
            "-1.0000000",
            "1.00000000",
            "1e3.0000000",
            "",
        ] {
            assert_eq!(parse_stroops(bad), None, "{bad:?}");
        }
        assert_eq!(parse_stroops("922337203685.4775808"), None);
    }

    #[test]
    fn a_ledger_cursor_sorts_before_that_ledgers_operations() {
        let cursor = cursor_for_ledger(100).unwrap();
        let first_operation_in_ledger_100: i64 = (100 << 32) + (1 << 12) + 1;
        let last_operation_in_ledger_99: i64 = (100 << 32) - 1;
        assert!(cursor < first_operation_in_ledger_100);
        assert!(cursor > last_operation_in_ledger_99);
    }
}
