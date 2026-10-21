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

/// One entry from `GET /paths/strict-send` or `GET /paths/strict-receive`.
///
/// Horizon returns the intermediate hops in `path` (as `{asset_type, asset_code,
/// asset_issuer}` objects) plus the amounts at each end of the conversion.
#[derive(Debug, Clone, Deserialize)]
pub struct PathRecord {
    /// The asset the sender gives up.
    #[serde(default)]
    pub source_asset_type: Option<String>,
    #[serde(default)]
    pub source_asset_code: Option<String>,
    #[serde(default)]
    pub source_asset_issuer: Option<String>,
    /// How much of the source asset the sender gives up.
    #[serde(default)]
    pub source_amount: Option<String>,
    /// The asset the recipient receives.
    #[serde(default)]
    pub destination_asset_type: Option<String>,
    #[serde(default)]
    pub destination_asset_code: Option<String>,
    #[serde(default)]
    pub destination_asset_issuer: Option<String>,
    /// How much of the destination asset the recipient receives.
    #[serde(default)]
    pub destination_amount: Option<String>,
    /// Intermediate hops between source and destination assets.
    #[serde(default)]
    pub path: Vec<PathHop>,
}

/// One intermediate asset in a [`PathRecord`]'s `path` array.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PathHop {
    pub asset_type: String,
    #[serde(default)]
    pub asset_code: Option<String>,
    #[serde(default)]
    pub asset_issuer: Option<String>,
}

/// A quoted cross-asset payment, as returned by Horizon's path-finding
/// endpoints, together with the slippage the user agreed to.
///
/// `slippage_bps` is a bound in basis points (1 bps = 0.01%). For a strict-send
/// quote the sender fixes `source_amount` and the recipient must receive at
/// least `destination_amount` minus the slippage allowance; for a strict-receive
/// quote the recipient fixes `destination_amount` and the sender must not pay
/// more than `source_amount` plus the allowance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathQuote {
    /// The asset the sender gives up.
    pub source_asset: Asset,
    /// The asset the recipient receives.
    pub destination_asset: Asset,
    /// Amount of `source_asset` the sender gives up.
    pub source_amount: i64,
    /// Amount of `destination_asset` the recipient receives.
    pub destination_amount: i64,
    /// Intermediate hops between the source and destination assets.
    pub path: Vec<PathHop>,
    /// The user-agreed slippage bound, in basis points.
    pub slippage_bps: u32,
    /// Whether the sender fixed the source amount (`true`) or the recipient
    /// fixed the destination amount (`false`).
    pub strict_send: bool,
}

impl PathQuote {
    /// The smallest destination amount the recipient will accept, given the
    /// quoted amount and the agreed slippage. Only meaningful for strict-send
    /// quotes, where the sender fixes the source amount.
    pub fn minimum_destination(&self) -> i64 {
        apply_slippage_down(self.destination_amount, self.slippage_bps)
    }

    /// The largest source amount the sender will pay, given the quoted amount
    /// and the agreed slippage. Only meaningful for strict-receive quotes,
    /// where the recipient fixes the destination amount.
    pub fn maximum_source(&self) -> i64 {
        apply_slippage_up(self.source_amount, self.slippage_bps)
    }

    /// Whether an actually-executed payment stays within the agreed slippage.
    ///
    /// For a strict-send quote the recipient must receive at least
    /// [`PathQuote::minimum_destination`]; for a strict-receive quote the sender
    /// must pay no more than [`PathQuote::maximum_source`].
    pub fn within_slippage(&self, actual_source: i64, actual_destination: i64) -> bool {
        if self.strict_send {
            actual_destination >= self.minimum_destination()
        } else {
            actual_source <= self.maximum_source()
        }
    }
}

/// Reduces `amount` by `bps` basis points, rounding down. Saturates at zero.
fn apply_slippage_down(amount: i64, bps: u32) -> i64 {
    let bps = i128::from(bps);
    let amount = i128::from(amount);
    let reduced = amount - amount.saturating_mul(bps) / 10_000;
    i64::try_from(reduced.max(0)).unwrap_or(i64::MAX)
}

/// Increases `amount` by `bps` basis points, rounding up. Saturates at
/// `i64::MAX`.
fn apply_slippage_up(amount: i64, bps: u32) -> i64 {
    let bps = i128::from(bps);
    let amount = i128::from(amount);
    let increased = amount + (amount.saturating_mul(bps) + 9_999) / 10_000;
    i64::try_from(increased).unwrap_or(i64::MAX)
}

/// Builds the query string for `GET /paths/strict-send`.
///
/// `source_asset` is the asset the sender gives up; `destination_asset` is the
/// asset the recipient receives. `source_amount` is in stroops.
pub fn strict_send_query(
    source_asset: Asset,
    destination_asset: Asset,
    source_amount: i64,
    network: StellarNetwork,
) -> String {
    let mut query = format!(
        "source_asset_type={}&source_amount={}",
        asset_type_param(source_asset),
        format_stroops(source_amount)
    );
    append_asset_params(&mut query, "source", source_asset, network);
    append_asset_params(&mut query, "destination", destination_asset, network);
    query
}

/// Builds the query string for `GET /paths/strict-receive`.
///
/// `source_asset` is the asset the sender gives up; `destination_asset` is the
/// asset the recipient receives. `destination_amount` is in stroops.
pub fn strict_receive_query(
    source_asset: Asset,
    destination_asset: Asset,
    destination_amount: i64,
    network: StellarNetwork,
) -> String {
    let mut query = format!(
        "destination_asset_type={}&destination_amount={}",
        asset_type_param(destination_asset),
        format_stroops(destination_amount)
    );
    append_asset_params(&mut query, "source", source_asset, network);
    append_asset_params(&mut query, "destination", destination_asset, network);
    query
}

fn asset_type_param(asset: Asset) -> &'static str {
    match asset {
        Asset::Xlm => "native",
        Asset::Usdc => "credit_alphanum4",
    }
}

fn append_asset_params(
    query: &mut String,
    prefix: &str,
    asset: Asset,
    network: StellarNetwork,
) {
    match asset {
        Asset::Xlm => {}
        Asset::Usdc => {
            query.push_str(&format!(
                "&{prefix}_asset_code=USDC&{prefix}_asset_issuer={}",
                network.usdc_issuer()
            ));
        }
    }
}

/// Formats a stroop amount as Horizon's 7-decimal string.
fn format_stroops(stroops: i64) -> String {
    let sign = if stroops < 0 { "-" } else { "" };
    let magnitude = stroops.unsigned_abs();
    format!(
        "{sign}{}.{:07}",
        magnitude / 10_000_000,
        magnitude % 10_000_000
    )
}

/// Parses a Horizon asset description (`asset_type`, `asset_code`,
/// `asset_issuer`) into an [`Asset`], refusing anything EngiPay does not hold.
fn asset_from_parts(
    asset_type: Option<&str>,
    code: Option<&str>,
    issuer: Option<&str>,
    network: StellarNetwork,
) -> Option<Asset> {
    match asset_type {
        Some("native") => Some(Asset::Xlm),
        Some("credit_alphanum4") => {
            if code == Some("USDC") && issuer == Some(network.usdc_issuer()) {
                Some(Asset::Usdc)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Turns one `GET /paths/strict-send` or `GET /paths/strict-receive` record
/// into a [`PathQuote`] with the given slippage bound.
///
/// Returns `None` when the record names an asset EngiPay does not hold or an
/// amount that is not a 7-decimal Stellar amount.
pub fn quote_from_path_record(
    record: &PathRecord,
    network: StellarNetwork,
    slippage_bps: u32,
    strict_send: bool,
) -> Option<PathQuote> {
    let source_asset = asset_from_parts(
        record.source_asset_type.as_deref(),
        record.source_asset_code.as_deref(),
        record.source_asset_issuer.as_deref(),
        network,
    )?;
    let destination_asset = asset_from_parts(
        record.destination_asset_type.as_deref(),
        record.destination_asset_code.as_deref(),
        record.destination_asset_issuer.as_deref(),
        network,
    )?;
    let source_amount = record.source_amount.as_deref().and_then(parse_stroops)?;
    let destination_amount = record
        .destination_amount
        .as_deref()
        .and_then(parse_stroops)?;
    Some(PathQuote {
        source_asset,
        destination_asset,
        source_amount,
        destination_amount,
        path: record.path.clone(),
        slippage_bps,
        strict_send,
    })
}

/// Finds paths for a strict-send payment: the sender fixes `source_amount` of
/// `source_asset` and the recipient receives `destination_asset`.
///
/// `get` performs the HTTP GET and returns the raw body. The first usable
/// quote is returned, or `None` when Horizon found no path.
pub fn find_path_strict_send(
    get: impl FnOnce(&str) -> Result<Vec<u8>, crate::ChainError>,
    source_asset: Asset,
    destination_asset: Asset,
    source_amount: i64,
    network: StellarNetwork,
    slippage_bps: u32,
) -> Result<Option<PathQuote>, crate::ChainError> {
    let query = strict_send_query(source_asset, destination_asset, source_amount, network);
    find_path(get, &query, network, slippage_bps, true)
}

/// Finds paths for a strict-receive payment: the recipient fixes
/// `destination_amount` of `destination_asset` and the sender pays
/// `source_asset`.
///
/// `get` performs the HTTP GET and returns the raw body. The first usable
/// quote is returned, or `None` when Horizon found no path.
pub fn find_path_strict_receive(
    get: impl FnOnce(&str) -> Result<Vec<u8>, crate::ChainError>,
    source_asset: Asset,
    destination_asset: Asset,
    destination_amount: i64,
    network: StellarNetwork,
    slippage_bps: u32,
) -> Result<Option<PathQuote>, crate::ChainError> {
    let query = strict_receive_query(
        source_asset,
        destination_asset,
        destination_amount,
        network,
    );
    find_path(get, &query, network, slippage_bps, false)
}

fn find_path(
    get: impl FnOnce(&str) -> Result<Vec<u8>, crate::ChainError>,
    query: &str,
    network: StellarNetwork,
    slippage_bps: u32,
    strict_send: bool,
) -> Result<Option<PathQuote>, crate::ChainError> {
    let body = get(query)?;
    let records: Vec<PathRecord> = serde_json::from_slice(&body).map_err(|error| {
        crate::ChainError::Unavailable(format!("unreadable Horizon path response: {error}"))
    })?;
    Ok(records
        .iter()
        .find_map(|record| quote_from_path_record(record, network, slippage_bps, strict_send)))
}

/// The amounts actually moved by a path payment, as recorded in the ledger.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathPaymentAmounts {
    /// What the sender gave up.
    pub source: Money,
    /// What the recipient received.
    pub destination: Money,
}

/// Extracts both the sent and received amounts from a
/// `path_payment_strict_send` or `path_payment_strict_receive` record.
///
/// Returns `None` for any other operation type, for failed transactions, or
/// when either amount or asset cannot be read. `source_amount` is what the
/// sender gave up; `amount` is what the recipient received.
pub fn path_payment_from_record(
    record: &PaymentRecord,
    network: StellarNetwork,
) -> Option<PathPaymentAmounts> {
    if !matches!(
        record.kind.as_str(),
        "path_payment_strict_send" | "path_payment_strict_receive"
    ) {
        return None;
    }
    let transaction = record.transaction.as_ref()?;
    if !record.transaction_successful || !transaction.successful {
        return None;
    }

    let destination_asset = asset_from_parts(
        record.asset_type.as_deref(),
        record.asset_code.as_deref(),
        record.asset_issuer.as_deref(),
        network,
    )?;
    let source_asset = asset_from_parts(
        record.source_asset_type.as_deref(),
        record.source_asset_code.as_deref(),
        record.source_asset_issuer.as_deref(),
        network,
    )?;

    let destination_stroops = record.amount.as_deref().and_then(parse_stroops)?;
    let source_stroops = record.source_amount.as_deref().and_then(parse_stroops)?;

    let source = Money::from_network_units(source_asset, Chain::Stellar, i128::from(source_stroops))
        .ok()?;
    let destination =
        Money::from_network_units(destination_asset, Chain::Stellar, i128::from(destination_stroops))
            .ok()?;
    Some(PathPaymentAmounts {
        source,
        destination,
    })
}

/// `GET /accounts/{id}`.
#[derive(Debug, Deserialize)]
pub struct Account {
    /// Returned as a string because it can exceed JavaScript's safe integers.
    pub sequence: String,
    /// The assets the account currently holds, including native XLM.
    #[serde(default)]
    pub balances: Vec<AccountBalance>,
}

/// One entry in the `balances` array of `GET /accounts/{id}`.
///
/// Horizon reports amounts as 7-decimal strings (e.g. `"12.3400000"`).
/// Use [`parse_stroops`] to convert to a stroop integer.
#[derive(Debug, Clone, Deserialize)]
pub struct AccountBalance {
    /// Always present. `"12.3400000"` — 7-decimal Stellar amount.
    pub balance: String,
    /// `"native"` for XLM, `"credit_alphanum4"` or `"credit_alphanum12"` otherwise.
    pub asset_type: String,
    /// Present for non-native assets.
    #[serde(default)]
    pub asset_code: Option<String>,
    /// Present for non-native assets.
    #[serde(default)]
    pub asset_issuer: Option<String>,
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
    /// The asset the sender gave up. Present on path payments only.
    #[serde(default)]
    pub source_asset_type: Option<String>,
    #[serde(default)]
    pub source_asset_code: Option<String>,
    #[serde(default)]
    pub source_asset_issuer: Option<String>,
    /// How much of the source asset the sender gave up. Present on path
    /// payments only; `amount` is what the recipient received.
    #[serde(default)]
    pub source_amount: Option<String>,
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
#[derive(Debug, Default, Clone)]
pub struct TransactionCache {
    entries: HashMap<String, CacheEntry>,
}

#[derive(Debug, Clone)]
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

    /// Whether the cache holds no entries at all.
    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
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
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Submitted {
    pub hash: String,
    pub ledger: u64,
}

/// Parses Horizon's `200` body from `POST /transactions`.
///
/// The transaction was accepted, so a body that cannot be read is reported as
/// [`ChainError::Unavailable`] (outcome unknown), never as a rejection.
pub fn parse_submitted(body: &[u8]) -> Result<Submitted, crate::ChainError> {
    let submitted: Submitted = serde_json::from_slice(body).map_err(|error| {
        crate::ChainError::Unavailable(format!("unreadable Horizon submission response: {error}"))
    })?;
    let is_hash =
        submitted.hash.len() == 64 && submitted.hash.bytes().all(|byte| byte.is_ascii_hexdigit());
    if !is_hash || submitted.ledger == 0 {
        return Err(crate::ChainError::Unavailable(format!(
            "Horizon accepted the transaction but reported hash {:?} in ledger {}",
            submitted.hash, submitted.ledger
        )));
    }
    Ok(submitted)
}

/// A readable reason for a failed `POST /transactions`, including Horizon's
/// result codes (e.g. `tx_bad_seq`, `op_underfunded`) when it sent them.
pub fn submit_problem_detail(status: u16, body: &[u8]) -> String {
    match serde_json::from_slice::<SubmitProblem>(body) {
        Ok(problem) => match problem.extras.and_then(|extras| extras.result_codes) {
            Some(codes) => format!("{}: {codes}", problem.title),
            None => problem.title,
        },
        Err(_) => format!("Horizon returned {status}"),
    }
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
            let asset_type = record.asset_type.as_deref().unwrap_or_default();
            let code = record.asset_code.clone().unwrap_or_default();
            let issuer = record.asset_issuer.clone().unwrap_or_default();
            // Circle issues USDC as alphanum4 only. A 12-character asset named
            // "USDC" is a different token that borrows the ticker, so it is
            // counterfeit even when it names Circle's issuer.
            let usdc_shape_ok = asset_type == "credit_alphanum4";
            if code == "USDC" && issuer == network.usdc_issuer() && usdc_shape_ok {
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

    const HASH: &str = "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889";

    #[test]
    fn a_submission_response_yields_hash_and_ledger() {
        let body = serde_json::json!({
            "hash": HASH,
            "ledger": 47_123_456,
            "envelope_xdr": "AAAA",
            "successful": true
        });
        let submitted = parse_submitted(body.to_string().as_bytes()).unwrap();
        assert_eq!(
            submitted,
            Submitted {
                hash: HASH.to_owned(),
                ledger: 47_123_456
            }
        );
    }

    #[test]
    fn an_unreadable_submission_response_is_unknown_not_rejected() {
        let cases = [
            b"not json".to_vec(),
            serde_json::json!({ "ledger": 5 }).to_string().into_bytes(),
            serde_json::json!({ "hash": "zz", "ledger": 5 })
                .to_string()
                .into_bytes(),
            serde_json::json!({ "hash": HASH, "ledger": 0 })
                .to_string()
                .into_bytes(),
        ];
        for body in cases {
            assert!(
                matches!(
                    parse_submitted(&body),
                    Err(crate::ChainError::Unavailable(_))
                ),
                "{}",
                String::from_utf8_lossy(&body)
            );
        }
    }

    #[test]
    fn rejection_details_carry_horizon_result_codes() {
        let body = serde_json::json!({
            "type": "https://stellar.org/horizon-errors/transaction_failed",
            "title": "Transaction Failed",
            "status": 400,
            "extras": {
                "envelope_xdr": "AAAA",
                "result_codes": { "transaction": "tx_failed", "operations": ["op_no_destination"] }
            }
        });
        let detail = submit_problem_detail(400, body.to_string().as_bytes());
        assert!(detail.starts_with("Transaction Failed"), "{detail}");
        assert!(detail.contains("tx_failed"), "{detail}");
        assert!(detail.contains("op_no_destination"), "{detail}");
    }

    #[test]
    fn rejection_details_fall_back_to_title_or_status() {
        let titled = serde_json::json!({ "title": "Transaction Malformed" });
        assert_eq!(
            submit_problem_detail(400, titled.to_string().as_bytes()),
            "Transaction Malformed"
        );
        assert_eq!(
            submit_problem_detail(400, b"<html>"),
            "Horizon returned 400"
        );
    }

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
            counterfeit_usdc: false,
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

    // ──────────────────────────────────────────────────────────────────────────
    // Path payments
    // ──────────────────────────────────────────────────────────────────────────

    fn usdc_path_record(destination_amount: &str, source_amount: &str) -> serde_json::Value {
        serde_json::json!({
            "source_asset_type": "native",
            "source_amount": source_amount,
            "destination_asset_type": "credit_alphanum4",
            "destination_asset_code": "USDC",
            "destination_asset_issuer": StellarNetwork::Testnet.usdc_issuer(),
            "destination_amount": destination_amount,
            "path": []
        })
    }

    fn quote(json: serde_json::Value, slippage_bps: u32, strict_send: bool) -> PathQuote {
        let record: PathRecord = serde_json::from_value(json).unwrap();
        quote_from_path_record(&record, StellarNetwork::Testnet, slippage_bps, strict_send).unwrap()
    }

    #[test]
    fn a_strict_send_path_quote_parses_assets_and_amounts() {
        let quote = quote(
            usdc_path_record("10.0000000", "12.5000000"),
            50,
            true,
        );
        assert_eq!(quote.source_asset, Asset::Xlm);
        assert_eq!(quote.destination_asset, Asset::Usdc);
        assert_eq!(quote.source_amount, 125_000_000);
        assert_eq!(quote.destination_amount, 100_000_000);
        assert_eq!(quote.slippage_bps, 50);
        assert!(quote.strict_send);
        assert!(quote.path.is_empty());
    }

    #[test]
    fn a_strict_send_quote_within_slippage_succeeds() {
        let quote = quote(usdc_path_record("10.0000000", "12.5000000"), 50, true);
        // 0.5% of 10 USDC is 0.05 USDC; the floor is 9.95 USDC.
        assert_eq!(quote.minimum_destination(), 99_500_000);
        assert!(quote.within_slippage(125_000_000, 100_000_000));
        assert!(quote.within_slippage(125_000_000, 99_500_000));
    }

    #[test]
    fn a_strict_send_quote_outside_slippage_fails() {
        let quote = quote(usdc_path_record("10.0000000", "12.5000000"), 50, true);
        assert!(!quote.within_slippage(125_000_000, 99_499_999));
        assert!(!quote.within_slippage(125_000_000, 90_000_000));
    }

    #[test]
    fn a_strict_receive_quote_within_slippage_succeeds() {
        let quote = quote(usdc_path_record("10.0000000", "12.5000000"), 50, false);
        // 0.5% of 12.5 XLM is 0.0625 XLM; the ceiling is 12.5625 XLM.
        assert_eq!(quote.maximum_source(), 125_625_000);
        assert!(quote.within_slippage(125_000_000, 100_000_000));
        assert!(quote.within_slippage(125_625_000, 100_000_000));
    }

    #[test]
    fn a_strict_receive_quote_outside_slippage_fails() {
        let quote = quote(usdc_path_record("10.0000000", "12.5000000"), 50, false);
        assert!(!quote.within_slippage(125_625_001, 100_000_000));
        assert!(!quote.within_slippage(200_000_000, 100_000_000));
    }

    #[test]
    fn zero_slippage_requires_the_exact_quote() {
        let quote = quote(usdc_path_record("10.0000000", "12.5000000"), 0, true);
        assert_eq!(quote.minimum_destination(), 100_000_000);
        assert!(quote.within_slippage(125_000_000, 100_000_000));
        assert!(!quote.within_slippage(125_000_000, 99_999_999));
    }

    #[test]
    fn a_path_quote_refuses_assets_engipay_does_not_hold() {
        let record: PathRecord = serde_json::from_value(serde_json::json!({
            "source_asset_type": "native",
            "source_amount": "12.5000000",
            "destination_asset_type": "credit_alphanum4",
            "destination_asset_code": "USDC",
            "destination_asset_issuer": sender(),
            "destination_amount": "10.0000000",
            "path": []
        }))
        .unwrap();
        assert!(quote_from_path_record(&record, StellarNetwork::Testnet, 50, true).is_none());
    }

    #[test]
    fn strict_send_query_names_both_assets() {
        let query = strict_send_query(
            Asset::Xlm,
            Asset::Usdc,
            125_000_000,
            StellarNetwork::Testnet,
        );
        assert!(query.contains("source_asset_type=native"), "{query}");
        assert!(query.contains("source_amount=12.5000000"), "{query}");
        assert!(query.contains("destination_asset_type=credit_alphanum4"), "{query}");
        assert!(query.contains("destination_asset_code=USDC"), "{query}");
        assert!(
            query.contains(StellarNetwork::Testnet.usdc_issuer()),
            "{query}"
        );
    }

    #[test]
    fn strict_receive_query_names_both_assets() {
        let query = strict_receive_query(
            Asset::Xlm,
            Asset::Usdc,
            100_000_000,
            StellarNetwork::Testnet,
        );
        assert!(query.contains("destination_asset_type=credit_alphanum4"), "{query}");
        assert!(query.contains("destination_amount=10.0000000"), "{query}");
        assert!(query.contains("source_asset_type=native"), "{query}");
        assert!(
            query.contains(StellarNetwork::Testnet.usdc_issuer()),
            "{query}"
        );
    }

    #[test]
    fn find_path_strict_send_returns_the_first_usable_quote() {
        let body = serde_json::json!([usdc_path_record("10.0000000", "12.5000000")]);
        let found = find_path_strict_send(
            |query| {
                assert!(query.contains("source_amount=12.5000000"), "{query}");
                Ok(body.to_string().into_bytes())
            },
            Asset::Xlm,
            Asset::Usdc,
            125_000_000,
            StellarNetwork::Testnet,
            50,
        )
        .unwrap()
        .expect("a path should be found");
        assert_eq!(found.destination_amount, 100_000_000);
        assert!(found.strict_send);
    }

    #[test]
    fn find_path_strict_receive_returns_the_first_usable_quote() {
        let body = serde_json::json!([usdc_path_record("10.0000000", "12.5000000")]);
        let found = find_path_strict_receive(
            |query| {
                assert!(query.contains("destination_amount=10.0000000"), "{query}");
                Ok(body.to_string().into_bytes())
            },
            Asset::Xlm,
            Asset::Usdc,
            100_000_000,
            StellarNetwork::Testnet,
            50,
        )
        .unwrap()
        .expect("a path should be found");
        assert_eq!(found.source_amount, 125_000_000);
        assert!(!found.strict_send);
    }

    #[test]
    fn find_path_returns_none_when_horizon_finds_no_path() {
        let found = find_path_strict_send(
            |_| Ok(b"[]".to_vec()),
            Asset::Xlm,
            Asset::Usdc,
            125_000_000,
            StellarNetwork::Testnet,
            50,
        )
        .unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn find_path_reports_unreadable_responses_as_unavailable() {
        let result = find_path_strict_send(
            |_| Ok(b"not json".to_vec()),
            Asset::Xlm,
            Asset::Usdc,
            125_000_000,
            StellarNetwork::Testnet,
            50,
        );
        assert!(matches!(result, Err(crate::ChainError::Unavailable(_))));
    }

    #[test]
    fn a_path_payment_record_yields_both_amounts() {
        let record = record(serde_json::json!({
            "type": "path_payment_strict_send",
            "source_asset_type": "native",
            "source_amount": "12.5000000",
            "asset_type": "credit_alphanum4",
            "asset_code": "USDC",
            "asset_issuer": StellarNetwork::Testnet.usdc_issuer(),
            "amount": "10.0000000",
        }));
        let amounts = path_payment_from_record(&record, StellarNetwork::Testnet).unwrap();
        assert_eq!(amounts.source, Money::from_minor(Asset::Xlm, 125_000_000));
        assert_eq!(
            amounts.destination,
            Money::from_minor(Asset::Usdc, 100_000_000)
        );
    }

    #[test]
    fn a_strict_receive_path_payment_record_yields_both_amounts() {
        let record = record(serde_json::json!({
            "type": "path_payment_strict_receive",
            "source_asset_type": "native",
            "source_amount": "12.5000000",
            "asset_type": "credit_alphanum4",
            "asset_code": "USDC",
            "asset_issuer": StellarNetwork::Testnet.usdc_issuer(),
            "amount": "10.0000000",
        }));
        let amounts = path_payment_from_record(&record, StellarNetwork::Testnet).unwrap();
        assert_eq!(amounts.source, Money::from_minor(Asset::Xlm, 125_000_000));
        assert_eq!(
            amounts.destination,
            Money::from_minor(Asset::Usdc, 100_000_000)
        );
    }

    #[test]
    fn a_plain_payment_is_not_a_path_payment() {
        let record = record(serde_json::json!({}));
        assert!(path_payment_from_record(&record, StellarNetwork::Testnet).is_none());
    }

    #[test]
    fn a_failed_path_payment_yields_no_amounts() {
        let record = record(serde_json::json!({
            "type": "path_payment_strict_send",
            "source_asset_type": "native",
            "source_amount": "12.5000000",
            "transaction_successful": false,
        }));
        assert!(path_payment_from_record(&record, StellarNetwork::Testnet).is_none());
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
