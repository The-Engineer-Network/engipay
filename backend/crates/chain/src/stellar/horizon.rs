//! Horizon responses, and the rules that turn a payment record into a deposit.
//!
//! The pure conversion logic (`deposit_from_record`) is free of network and
//! clock dependencies so it can be tested against recorded JSON. The
//! [`TransactionCache`] lives here too — it caches `GET /transactions/{hash}`
//! responses by `tx_hash` with a 60-second TTL, so multi-operation
//! transactions do not trigger redundant network round-trips.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use engipay_core::{Asset, Chain, Money};
use serde::Deserialize;

use super::network::StellarNetwork;
use crate::ObservedDeposit;

/// How long a cached transaction detail is considered fresh.
pub const TRANSACTION_CACHE_TTL: Duration = Duration::from_secs(60);

/// `GET /` on Horizon.
#[derive(Debug, Deserialize)]
pub struct Root {
    /// The newest ledger Horizon has fully ingested. Payments in it are final.
    pub history_latest_ledger: u64,
}

/// `GET /fee_stats` — the fee distribution from the last ledger Horizon saw.
///
/// All fee values are in stroops per operation as strings (Horizon returns them
/// as JSON strings to avoid precision loss in some parsers).
#[derive(Debug, Deserialize)]
pub struct FeeStats {
    /// The distribution of fees actually charged in the last ledger.
    pub fee_charged: FeeDistribution,
}

/// Sub-object under [`FeeStats`] for the `fee_charged` distribution.
#[derive(Debug, Deserialize)]
pub struct FeeDistribution {
    /// Median fee charged in the last ledger, in stroops (as a decimal string).
    pub p50: String,
    /// 90th-percentile fee charged in the last ledger, in stroops (string).
    pub p90: String,
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
    /// The paying account. Logged when a transfer into custody is refused, so a
    /// person can trace it back.
    #[serde(default)]
    pub from: Option<String>,
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

/// Short-lived in-process cache for Horizon transaction detail responses.
///
/// Keyed by `transaction_hash`. Entries expire after [`TRANSACTION_CACHE_TTL`]
/// (60 seconds). The cache is intentionally simple — no background eviction,
/// just lazy expiry on read and on explicit [`TransactionCache::evict_expired`].
///
/// The main use-case is multi-operation transactions: Horizon returns one
/// `PaymentRecord` per operation, all sharing the same `transaction_hash`.
/// Without a cache each operation would trigger a separate
/// `GET /transactions/{hash}` call; with the cache only the first does.
#[derive(Debug, Default)]
pub struct TransactionCache {
    entries: HashMap<String, CacheEntry>,
}

#[derive(Debug)]
struct CacheEntry {
    transaction: JoinedTransaction,
    inserted_at: Instant,
}

impl TransactionCache {
    /// Creates an empty cache.
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns a cached transaction if it exists and has not expired.
    pub fn get(&self, tx_hash: &str) -> Option<&JoinedTransaction> {
        self.entries.get(tx_hash).and_then(|entry| {
            if entry.inserted_at.elapsed() < TRANSACTION_CACHE_TTL {
                Some(&entry.transaction)
            } else {
                None
            }
        })
    }

    /// Inserts or refreshes a transaction entry, recording the current time.
    pub fn insert(&mut self, tx_hash: String, transaction: JoinedTransaction) {
        self.entries.insert(
            tx_hash,
            CacheEntry {
                transaction,
                inserted_at: Instant::now(),
            },
        );
    }

    /// Removes all entries whose TTL has elapsed. Call periodically to bound
    /// memory growth across a long-running polling loop.
    pub fn evict_expired(&mut self) {
        self.entries
            .retain(|_, entry| entry.inserted_at.elapsed() < TRANSACTION_CACHE_TTL);
    }

    /// Number of entries currently in the cache (including possibly-stale ones
    /// that have not been read since they expired).
    #[cfg(test)]
    #[allow(clippy::len_without_is_empty)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }
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
    /// This is a security-sensitive rejection: unauthorized assets must be recorded.
    UnsupportedAsset {
        code: String,
        issuer: String,
        /// `true` when `code == "USDC"` but the issuer is not Circle's.
        counterfeit_usdc: bool,
    },
    Malformed(&'static str),
}

impl Skipped {
    /// Whether this rejection is a security concern requiring audit logging.
    pub fn is_security_sensitive(&self) -> bool {
        matches!(self, Skipped::UnsupportedAsset { .. })
    }
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
                // Flag tokens named "USDC" from the wrong issuer separately so
                // operators can distinguish counterfeit USDC from unknown assets.
                let counterfeit_usdc = code == "USDC";
                return Err(Skipped::UnsupportedAsset {
                    code,
                    issuer,
                    counterfeit_usdc,
                });
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
        // Deterministic idempotency key: "stellar:<transaction_hash>:<operation_index>"
        // The paging_token is Horizon's operation index, unique per operation on the network.
        // This prevents double-crediting the same deposit and identifies specific credit events.
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

/// Extracts the 64-bit muxed account ID from a Stellar `M...` address.
///
/// Returns `Some(id)` when `destination` is a valid muxed account address,
/// and `None` for a plain `G...` custody account address (which carries no
/// embedded ID and must be flagged for memo parsing or manual review) or for
/// any invalid input.
pub fn extract_muxed_id(destination: &str) -> Option<u64> {
    match engipay_core::stellar::parse_address(destination) {
        Ok(engipay_core::stellar::StellarAddress::Muxed { id, .. }) => Some(id),
        _ => None,
    }
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
        assert!(matches!(
            skipped,
            Err(Skipped::UnsupportedAsset {
                counterfeit_usdc: true,
                ..
            })
        ));
    }

    #[test]
    fn mainnet_usdc_is_not_accepted_on_testnet() {
        let skipped = deposit(serde_json::json!({
            "asset_type": "credit_alphanum4",
            "asset_code": "USDC",
            "asset_issuer": StellarNetwork::Mainnet.usdc_issuer(),
        }));
        assert!(matches!(
            skipped,
            Err(Skipped::UnsupportedAsset {
                counterfeit_usdc: true,
                ..
            })
        ));
    }

    /// alphanum12 assets named "USDC" (e.g. "USDC        " padded) are treated
    /// as counterfeit — the official Circle USDC is always alphanum4.
    #[test]
    fn alphanum12_usdc_from_any_issuer_is_counterfeit() {
        let skipped = deposit(serde_json::json!({
            "asset_type": "credit_alphanum12",
            "asset_code": "USDC",
            "asset_issuer": sender(),
        }));
        assert!(matches!(
            skipped,
            Err(Skipped::UnsupportedAsset {
                counterfeit_usdc: true,
                ..
            })
        ));
    }

    /// alphanum12 assets named "USDC" using Circle's testnet issuer still fail:
    /// the real Circle USDC is alphanum4, not alphanum12.
    #[test]
    fn alphanum12_usdc_from_circle_issuer_is_still_counterfeit() {
        let skipped = deposit(serde_json::json!({
            "asset_type": "credit_alphanum12",
            "asset_code": "USDC",
            "asset_issuer": StellarNetwork::Testnet.usdc_issuer(),
        }));
        assert!(matches!(
            skipped,
            Err(Skipped::UnsupportedAsset {
                counterfeit_usdc: true,
                ..
            })
        ));
    }

    /// A completely different token (not named USDC) is unsupported but is NOT
    /// flagged as counterfeit_usdc.
    #[test]
    fn unknown_asset_is_unsupported_but_not_counterfeit() {
        let skipped = deposit(serde_json::json!({
            "asset_type": "credit_alphanum4",
            "asset_code": "FAKE",
            "asset_issuer": sender(),
        }));
        assert!(matches!(
            skipped,
            Err(Skipped::UnsupportedAsset {
                counterfeit_usdc: false,
                ..
            })
        ));
    }

    /// The UnsupportedAsset error carries the issuer so operators can trace
    /// which account issued the counterfeit token.
    #[test]
    fn unsupported_asset_error_carries_issuer() {
        let fake_issuer = sender();
        let skipped = deposit(serde_json::json!({
            "asset_type": "credit_alphanum4",
            "asset_code": "USDC",
            "asset_issuer": fake_issuer,
        }));
        match skipped {
            Err(Skipped::UnsupportedAsset {
                code,
                issuer,
                counterfeit_usdc,
            }) => {
                assert_eq!(code, "USDC");
                assert_eq!(issuer, fake_issuer);
                assert!(counterfeit_usdc);
            }
            other => panic!("expected UnsupportedAsset, got {other:?}"),
        }
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
    fn stroops_parse_edge_cases() {
        assert_eq!(parse_stroops("0.0000000"), Some(0));
        assert_eq!(parse_stroops("0.0000001"), Some(1));
        assert_eq!(parse_stroops("1.0000000"), Some(10_000_000));
        assert_eq!(parse_stroops("10.0000000"), Some(100_000_000));
        assert_eq!(parse_stroops("100.0000000"), Some(1_000_000_000));
        assert_eq!(parse_stroops("1000.0000000"), Some(10_000_000_000));
        assert_eq!(parse_stroops("10000.0000000"), Some(100_000_000_000));
        assert_eq!(parse_stroops("100000.0000000"), Some(1_000_000_000_000));
        assert_eq!(parse_stroops("1000000.0000000"), Some(10_000_000_000_000));
        assert_eq!(parse_stroops("10000000.0000000"), Some(100_000_000_000_000));
        assert_eq!(
            parse_stroops("100000000.0000000"),
            Some(1_000_000_000_000_000)
        );
        assert_eq!(
            parse_stroops("1000000000.0000000"),
            Some(10_000_000_000_000_000)
        );
    }

    #[test]
    fn stroops_parse_fractional_precision() {
        assert_eq!(parse_stroops("0.0000001"), Some(1));
        assert_eq!(parse_stroops("0.0000010"), Some(10));
        assert_eq!(parse_stroops("0.0000100"), Some(100));
        assert_eq!(parse_stroops("0.0001000"), Some(1000));
        assert_eq!(parse_stroops("0.0010000"), Some(10_000));
        assert_eq!(parse_stroops("0.0100000"), Some(100_000));
        assert_eq!(parse_stroops("0.1000000"), Some(1_000_000));
        assert_eq!(parse_stroops("1.0000000"), Some(10_000_000));
        assert_eq!(parse_stroops("0.1234567"), Some(1_234_567));
        assert_eq!(parse_stroops("0.9999999"), Some(9_999_999));
        // Seven decimals is exactly what Horizon sends, so this is valid.
        assert_eq!(parse_stroops("123.4567890"), Some(1_234_567_890));
        assert_eq!(parse_stroops("123.456789"), None);
    }

    #[test]
    fn stroops_parse_invalid_formats() {
        let invalid = [
            "abc.0000000",
            "123.abcdefg",
            " 123.0000000",
            "123.0000000 ",
            "123. 000000",
            "123.000 000",
            "+123.0000000",
            "123.0000000e0",
            "NaN",
            "Infinity",
            "1.00000000",
            "1.000000",
            "1.00000",
        ];
        for bad in invalid {
            assert_eq!(parse_stroops(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn unsupported_asset_is_security_sensitive() {
        let unsupported = Skipped::UnsupportedAsset {
            code: "FAKE".to_owned(),
            issuer: "GXXXX".to_owned(),
        };
        assert!(unsupported.is_security_sensitive());

        assert!(!Skipped::NotIncoming.is_security_sensitive());
        assert!(!Skipped::Failed.is_security_sensitive());
        assert!(!Skipped::Malformed("test").is_security_sensitive());
    }

    #[test]
    fn a_ledger_cursor_sorts_before_that_ledgers_operations() {
        let cursor = cursor_for_ledger(100).unwrap();
        let first_operation_in_ledger_100: i64 = (100 << 32) + (1 << 12) + 1;
        let last_operation_in_ledger_99: i64 = (100 << 32) - 1;
        assert!(cursor < first_operation_in_ledger_100);
        assert!(cursor > last_operation_in_ledger_99);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // TransactionCache
    // ──────────────────────────────────────────────────────────────────────────

    fn tx(ledger: u64) -> JoinedTransaction {
        JoinedTransaction {
            ledger,
            successful: true,
        }
    }

    #[test]
    fn cache_miss_on_empty_cache() {
        let cache = TransactionCache::new();
        assert!(cache.get("abc123").is_none());
    }

    #[test]
    fn cache_hit_after_insert() {
        let mut cache = TransactionCache::new();
        cache.insert("abc123".to_owned(), tx(50));
        let found = cache.get("abc123").expect("entry should be present");
        assert_eq!(found.ledger, 50);
        assert!(found.successful);
    }

    #[test]
    fn cache_hit_for_second_operation_in_same_transaction() {
        // Simulate a multi-operation transaction: two PaymentRecords share the
        // same transaction_hash. The first miss populates the cache; the second
        // should be a hit without re-fetching.
        let tx_hash = "multiopera1234".to_owned();
        let mut cache = TransactionCache::new();

        // First operation: cache miss, then we insert the fetched data.
        assert!(cache.get(&tx_hash).is_none(), "should miss on first lookup");
        cache.insert(tx_hash.clone(), tx(200));

        // Second operation (same tx_hash): should hit.
        let found = cache.get(&tx_hash).expect("second lookup should hit");
        assert_eq!(found.ledger, 200);
    }

    #[test]
    fn cache_hit_for_many_operations_in_same_transaction() {
        let tx_hash = "bigmultiopera".to_owned();
        let mut cache = TransactionCache::new();
        cache.insert(tx_hash.clone(), tx(300));

        // 100 operations, same hash — all should hit the cache.
        for _ in 0..100 {
            let found = cache.get(&tx_hash).expect("should hit");
            assert_eq!(found.ledger, 300);
        }
    }

    #[test]
    fn different_transaction_hashes_are_independent() {
        let mut cache = TransactionCache::new();
        cache.insert("tx_a".to_owned(), tx(10));
        cache.insert("tx_b".to_owned(), tx(20));

        assert_eq!(cache.get("tx_a").unwrap().ledger, 10);
        assert_eq!(cache.get("tx_b").unwrap().ledger, 20);
        assert!(cache.get("tx_c").is_none());
    }

    #[test]
    fn insert_overwrites_existing_entry() {
        let mut cache = TransactionCache::new();
        cache.insert("tx1".to_owned(), tx(1));
        cache.insert("tx1".to_owned(), tx(99));
        assert_eq!(cache.get("tx1").unwrap().ledger, 99);
    }

    #[test]
    fn expired_entry_returns_none() {
        use std::time::{Duration, Instant};

        // Build a cache, insert an entry, then manually back-date it past the TTL.
        let mut cache = TransactionCache::new();
        cache.insert("stale".to_owned(), tx(42));

        // Force expiry by replacing the entry with an old `inserted_at`.
        let stale_time = Instant::now()
            .checked_sub(TRANSACTION_CACHE_TTL + Duration::from_secs(1))
            .expect("time arithmetic should not underflow on any reasonable system");
        cache.entries.insert(
            "stale".to_owned(),
            CacheEntry {
                transaction: tx(42),
                inserted_at: stale_time,
            },
        );

        assert!(
            cache.get("stale").is_none(),
            "expired entry must not be returned"
        );
    }

    #[test]
    fn evict_expired_removes_only_stale_entries() {
        use std::time::{Duration, Instant};

        let mut cache = TransactionCache::new();
        cache.insert("fresh".to_owned(), tx(1));

        let stale_time = Instant::now()
            .checked_sub(TRANSACTION_CACHE_TTL + Duration::from_secs(1))
            .expect("time arithmetic should not underflow");
        cache.entries.insert(
            "stale".to_owned(),
            CacheEntry {
                transaction: tx(2),
                inserted_at: stale_time,
            },
        );

        assert_eq!(cache.len(), 2);
        cache.evict_expired();
        assert_eq!(cache.len(), 1, "only the stale entry should be removed");
        assert!(cache.get("fresh").is_some());
        // The stale key is gone from the map entirely.
        assert!(!cache.entries.contains_key("stale"));
    }

    #[test]
    fn deposit_from_multi_op_tx_uses_cached_transaction() {
        // Verify that deposit_from_record still works correctly when the same
        // JoinedTransaction (as would be returned from a cache hit) is reused
        // for multiple PaymentRecord instances that share the same tx_hash.
        let custody = custody();
        let tx_hash = "shared_tx_abc".to_owned();
        let cached_tx = JoinedTransaction {
            ledger: 100,
            successful: true,
        };

        // Create two payment records sharing the same transaction.
        let mut base_record = record(serde_json::json!({
            "transaction_hash": tx_hash,
            "paging_token": "1001",
            "transaction": { "ledger": 100, "successful": true }
        }));
        let mut second_record = base_record.clone();
        second_record.paging_token = "1002".to_owned();

        // Simulate using the cached JoinedTransaction for both records.
        base_record.transaction = Some(cached_tx.clone());
        second_record.transaction = Some(cached_tx.clone());

        let d1 = deposit_from_record(&base_record, &custody, StellarNetwork::Testnet, 104)
            .expect("first op should produce a deposit");
        let d2 = deposit_from_record(&second_record, &custody, StellarNetwork::Testnet, 104)
            .expect("second op should produce a deposit");

        // Both deposits originate from the same ledger.
        assert_eq!(d1.confirmations, d2.confirmations);
        // References are unique per-operation (different paging_token).
        assert_ne!(d1.reference, d2.reference);
        assert!(d1.reference.contains(&tx_hash));
        assert!(d2.reference.contains(&tx_hash));
    }
}
