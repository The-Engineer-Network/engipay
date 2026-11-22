//! Soroban RPC event watcher for USDC SAC token transfers.
//!
//! The Horizon payments API only sees *classic* Stellar operations. A Soroban
//! smart contract `transfer` call — as issued by Soroban wallets or DeFi
//! contracts — emits a contract event that Horizon ignores. This module polls
//! the Stellar RPC `getEvents` JSON-RPC method to find those transfers.
//!
//! # Events consumed
//!
//! Every successful `transfer` on a SEP-41 / Stellar Asset Contract emits:
//!
//! ```text
//! topics  = ["transfer", from: Address, to: Address]
//! data    = { amount: i128, to_muxed_id: Option<u64> }   (SEP-41 v2)
//!           OR
//!           i128                                          (legacy)
//! ```
//!
//! We filter on `contractIds = [usdc_contract_id]` and
//! `topics[0] = Symbol("transfer")`.  Topic 2 (the `to` address) is then
//! compared against the custody account. The `to_muxed_id` field, when
//! present, lets us route the deposit to a specific user without a memo.
//!
//! # Reference format
//!
//! `soroban:<event_id>` — the event's `id` field from the RPC response, which
//! is a TOID + 10-digit zero-padded event index, unique per event on the
//! ledger and stable across restarts.
//!
//! # Refusal rules
//! * `contractId` ≠ Circle's USDC SAC for this network → refused.
//! * `to` address ≠ custody (plain or muxed) → refused.
//! * `amount` ≤ 0 → refused.
//! * Failed events or events with a missing ledger field → refused.

use engipay_core::{Asset, Chain, Money};
use serde::Deserialize;
use tracing::{error, warn};

use super::network::StellarNetwork;
use crate::{ChainError, ObservedDeposit};

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC request/response types
// ─────────────────────────────────────────────────────────────────────────────

/// Maximum number of events per `getEvents` call. The Stellar RPC hard limit
/// is 10 000; we use 1 000 so we stay well under but still handle spiky ledgers.
const MAX_EVENTS: u32 = 1_000;

/// A filter passed to `getEvents`.
#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct EventFilter<'a> {
    /// Only `"contract"` events are relevant (not `"system"` or `"diagnostic"`).
    #[serde(rename = "type")]
    kind: &'static str,
    /// Restrict to the USDC SAC contract only.
    contract_ids: [&'a str; 1],
    /// Topic filter: position 0 must be the `Symbol("transfer")` segment.
    topics: [[&'a str; 1]; 1],
}

/// Pagination cursor sent with a `getEvents` request.
#[derive(serde::Serialize, Debug)]
struct EventPagination<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor: Option<&'a str>,
    limit: u32,
}

/// The full `getEvents` JSON-RPC request body.
#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct GetEventsParams<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    start_ledger: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end_ledger: Option<u64>,
    filters: [EventFilter<'a>; 1],
    pagination: EventPagination<'a>,
    /// Request JSON-formatted ScVal instead of base64 XDR, so we can parse
    /// topic and data without an XDR library.
    xdr_format: &'static str,
}

/// A single event returned by `getEvents`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcEvent {
    /// Unique opaque identifier for this event (TOID + event index).
    pub id: String,
    /// The contract that emitted this event.
    pub contract_id: String,
    /// Ledger sequence in which this event was emitted.
    pub ledger: u64,
    /// Topics as a list of ScVal-encoded values.
    /// XDR format is chosen with `xdrFormat = "json"` to avoid base64 parsing.
    #[serde(default)]
    pub topic: Vec<serde_json::Value>,
    /// Event data (amount ± muxed ID) as an ScVal JSON.
    #[serde(default)]
    pub value: Option<serde_json::Value>,
}

/// `getEvents` result object.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetEventsResult {
    events: Vec<RpcEvent>,
    #[serde(default)]
    _latest_ledger: u64,
}

/// JSON-RPC `2.0` response envelope.
#[derive(Debug, Deserialize)]
struct JsonRpcResponse<T> {
    #[serde(default)]
    result: Option<T>,
    #[serde(default)]
    error: Option<serde_json::Value>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/// Calls `getEvents` on the Stellar RPC endpoint and returns all USDC SAC
/// transfer events directed at `custody` from ledger `from_ledger` onwards.
///
/// `rpc_url` is the base Stellar RPC endpoint (e.g.
/// `https://soroban-testnet.stellar.org`). The URL must not have a trailing
/// slash; [`super::StellarConfig::rpc_url`] guarantees this.
///
/// Only events from Circle's USDC SAC contract ([`StellarNetwork::usdc_contract_id`])
/// are returned. Events for other contracts are silently skipped.
///
/// # Errors
/// Returns [`ChainError::Unavailable`] if the RPC endpoint cannot be reached
/// or returns a non-success HTTP status.
pub async fn soroban_deposits_since(
    http: &reqwest::Client,
    rpc_url: &str,
    network: StellarNetwork,
    custody: &str,
    from_ledger: u64,
    latest_ledger: u64,
) -> Result<Vec<ObservedDeposit>, ChainError> {
    let usdc_contract = network.usdc_contract_id();
    let mut deposits = Vec::new();
    let mut cursor: Option<String> = None;

    // Pages loop. The RPC may cap each page at `MAX_EVENTS`; if a page is
    // full we paginate using the last event's `id` as the cursor.
    loop {
        let params = GetEventsParams {
            start_ledger: if cursor.is_none() {
                Some(from_ledger)
            } else {
                None
            },
            end_ledger: None,
            filters: [EventFilter {
                kind: "contract",
                contract_ids: [usdc_contract.as_str()],
                // First topic must be Symbol("transfer"). We use a wildcard here
                // because the exact XDR encoding of a Symbol depends on the
                // `xdrFormat` in use; the server-side `is_symbol_transfer` check
                // in `deposit_from_event` validates the actual topic value.
                topics: [["*"]],
            }],
            pagination: EventPagination {
                cursor: cursor.as_deref(),
                limit: MAX_EVENTS,
            },
            xdr_format: "json",
        };

        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getEvents",
            "params": params,
        });

        let response = http
            .post(rpc_url)
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                ChainError::Unavailable(format!("Stellar RPC unreachable: {error}"))
            })?;

        let status = response.status();
        if !status.is_success() {
            return Err(ChainError::Unavailable(format!(
                "Stellar RPC returned {status}"
            )));
        }

        let rpc: JsonRpcResponse<GetEventsResult> = response.json().await.map_err(|error| {
            ChainError::Unavailable(format!("Stellar RPC response unreadable: {error}"))
        })?;

        if let Some(err) = rpc.error {
            return Err(ChainError::Unavailable(format!("Stellar RPC error: {err}")));
        }

        let result = rpc.result.ok_or_else(|| {
            ChainError::Unavailable("Stellar RPC returned no result for getEvents".to_owned())
        })?;

        let page_len = result.events.len();
        let last_event_id = result.events.last().map(|e| e.id.clone());

        for event in result.events {
            // Double-check the contract ID — the RPC filter is a best-effort
            // hint; we must not trust it for security-sensitive decisions.
            if event.contract_id != usdc_contract {
                warn!(
                    event_id = %event.id,
                    contract_id = %event.contract_id,
                    expected = %usdc_contract,
                    "SECURITY: getEvents returned event from unexpected contract; skipping"
                );
                continue;
            }

            match deposit_from_event(&event, custody, network, latest_ledger) {
                Ok(deposit) => deposits.push(deposit),
                Err(SorobanSkipped::NotForCustody) => {}
                Err(reason) => {
                    let is_security = reason.is_security_sensitive();
                    if is_security {
                        error!(
                            event_id = %event.id,
                            contract_id = %event.contract_id,
                            ?reason,
                            "SECURITY: Soroban event refused; quarantined for review"
                        );
                    } else {
                        warn!(
                            event_id = %event.id,
                            ?reason,
                            "Soroban transfer event not credited"
                        );
                    }
                }
            }
        }

        // Paginate if the page was full.
        if page_len == usize::try_from(MAX_EVENTS).unwrap_or(usize::MAX) {
            if let Some(last_id) = last_event_id {
                cursor = Some(last_id);
                continue;
            }
        }
        break;
    }

    Ok(deposits)
}

// ─────────────────────────────────────────────────────────────────────────────
// Event → ObservedDeposit conversion
// ─────────────────────────────────────────────────────────────────────────────

/// Why a Soroban transfer event was not turned into a deposit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SorobanSkipped {
    /// The `to` address in the event is not the custody account.
    NotForCustody,
    /// Amount is zero or negative.
    NonPositiveAmount,
    /// Topics do not match a valid transfer event structure.
    MalformedTopics(&'static str),
    /// Data field does not contain a usable amount.
    MalformedData(&'static str),
    /// An unknown token contract emitted a transfer-shaped event.
    /// This is security-sensitive: only Circle's USDC SAC is accepted.
    WrongContract,
}

impl SorobanSkipped {
    fn is_security_sensitive(&self) -> bool {
        matches!(self, Self::WrongContract)
    }
}

/// Converts a raw RPC event into an [`ObservedDeposit`], or explains why it
/// was skipped.
///
/// Topic layout expected (SEP-41):
/// ```text
/// topic[0]  Symbol("transfer")
/// topic[1]  Address(from)
/// topic[2]  Address(to)
/// ```
/// Data (SEP-41 v2 map or legacy i128):
/// ```text
/// { amount: i128, to_muxed_id: Option<u64> }  OR  i128
/// ```
pub fn deposit_from_event(
    event: &RpcEvent,
    custody: &str,
    _network: StellarNetwork,
    latest_ledger: u64,
) -> Result<ObservedDeposit, SorobanSkipped> {
    // ── topic validation ──────────────────────────────────────────────────────

    // A transfer event has exactly 3 topics: [symbol, from, to].
    if event.topic.len() < 3 {
        return Err(SorobanSkipped::MalformedTopics("fewer than 3 topics"));
    }

    // topic[0] must be Symbol("transfer").
    if !is_symbol_transfer(&event.topic[0]) {
        return Err(SorobanSkipped::MalformedTopics(
            "topic[0] is not Symbol(transfer)",
        ));
    }

    // topic[2] is the `to` address.
    let to_address = extract_address(&event.topic[2]).ok_or(SorobanSkipped::MalformedTopics(
        "topic[2] is not an Address",
    ))?;

    // Check whether the destination is the custody account (bare or muxed).
    // A muxed destination has the same G... base account as custody, with an
    // embedded user ID.
    if !is_custody_destination(&to_address, custody) {
        return Err(SorobanSkipped::NotForCustody);
    }

    // ── data extraction ───────────────────────────────────────────────────────

    let (amount, to_muxed_id) = extract_amount_and_muxed_id(event.value.as_ref())?;

    if amount <= 0 {
        return Err(SorobanSkipped::NonPositiveAmount);
    }

    // ── build deposit ─────────────────────────────────────────────────────────

    let money = Money::from_network_units(Asset::Usdc, Chain::Stellar, amount)
        .map_err(|_| SorobanSkipped::MalformedData("amount out of ledger range"))?;

    // The deposit address is the muxed M... address when we have a muxed ID,
    // otherwise the bare custody G... address.
    let address = match to_muxed_id {
        Some(id) => engipay_core::stellar::muxed_deposit_address(custody, id)
            .unwrap_or_else(|_| custody.to_owned()),
        None => {
            // The `to` address from the event might already be a muxed address
            // in G.../M... strkey form. If it is muxed, use it; if it is the
            // bare custody account, keep as-is.
            if to_address.starts_with('M') {
                to_address.clone()
            } else {
                custody.to_owned()
            }
        }
    };

    let confirmations = latest_ledger
        .checked_sub(event.ledger)
        .and_then(|behind| behind.checked_add(1))
        .map_or(0, |count| u32::try_from(count).unwrap_or(u32::MAX));

    // Deduplicate: the event ID is a stable, unique, network-level identifier.
    let reference = format!("soroban:{}", event.id);

    Ok(ObservedDeposit {
        money,
        address,
        reference,
        confirmations,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// ScVal JSON helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Returns true iff `val` is the JSON representation of `Symbol("transfer")`.
///
/// When `xdrFormat = "json"` the RPC expands ScVal as:
/// `{ "symbol": "transfer" }` for `ScVal::Symbol("transfer")`.
fn is_symbol_transfer(val: &serde_json::Value) -> bool {
    val.get("symbol").and_then(|s| s.as_str()) == Some("transfer")
}

/// Extracts the address string from an ScVal JSON address object.
///
/// The RPC with `xdrFormat = "json"` represents an `ScVal::Address(account)` as:
/// ```json
/// { "address": "G..." }         // stellar account
/// { "address": "M..." }         // muxed stellar account
/// { "address": "C..." }         // contract address
/// ```
fn extract_address(val: &serde_json::Value) -> Option<String> {
    val.get("address")
        .and_then(|a| a.as_str())
        .map(str::to_owned)
}

/// Returns true iff `destination` is the custody account (plain `G...`) or a
/// muxed address (`M...`) rooted at the same base account.
fn is_custody_destination(destination: &str, custody: &str) -> bool {
    if destination == custody {
        return true;
    }
    // A muxed address is rooted at the same G... account as custody.
    // Decode both and compare the Ed25519 key.
    use engipay_core::stellar::{StellarAddress, parse_address};
    let dest_key = match parse_address(destination) {
        Ok(StellarAddress::Account(ref key)) => key.clone(),
        Ok(StellarAddress::Muxed { base, .. }) => base,
        _ => return false,
    };
    let custody_key = match parse_address(custody) {
        Ok(StellarAddress::Account(ref key)) => key.clone(),
        _ => return false,
    };
    dest_key == custody_key
}

/// Extracts `(amount: i128, to_muxed_id: Option<u64>)` from the event data ScVal.
///
/// SEP-41 v2 emits a map:
/// ```json
/// { "map": [
///     { "key": { "symbol": "amount" }, "val": { "i128": { "hi": 0, "lo": 100000000 } } },
///     { "key": { "symbol": "to_muxed_id" }, "val": { "u64": 42 } }
///   ]
/// }
/// ```
///
/// Legacy (pre-SEP-41 v2) SAC implementations emit a bare i128:
/// ```json
/// { "i128": { "hi": 0, "lo": 100000000 } }
/// ```
fn extract_amount_and_muxed_id(
    data: Option<&serde_json::Value>,
) -> Result<(i128, Option<u64>), SorobanSkipped> {
    let data = data.ok_or(SorobanSkipped::MalformedData("missing event data"))?;

    // Try SEP-41 v2 map format first.
    if let Some(map) = data.get("map").and_then(|m| m.as_array()) {
        let mut amount: Option<i128> = None;
        let mut to_muxed_id: Option<u64> = None;

        for entry in map {
            let key_sym = entry
                .get("key")
                .and_then(|k| k.get("symbol"))
                .and_then(|s| s.as_str());
            match key_sym {
                Some("amount") => {
                    amount = entry.get("val").and_then(parse_i128);
                }
                Some("to_muxed_id") => {
                    to_muxed_id = entry
                        .get("val")
                        .and_then(|v| v.get("u64"))
                        .and_then(|v| v.as_u64());
                }
                _ => {}
            }
        }

        return amount
            .map(|a| (a, to_muxed_id))
            .ok_or(SorobanSkipped::MalformedData("no 'amount' in map data"));
    }

    // Fall back to bare i128.
    if let Some(amount) = parse_i128(data) {
        return Ok((amount, None));
    }

    Err(SorobanSkipped::MalformedData(
        "data is neither a map nor a bare i128",
    ))
}

/// Parses an ScVal JSON i128 object into a Rust `i128`.
///
/// The Stellar RPC JSON representation of `i128` is:
/// ```json
/// { "i128": { "hi": <i64>, "lo": <u64> } }
/// ```
/// where `value = (hi as i128) << 64 | (lo as u128) as i128`.
fn parse_i128(val: &serde_json::Value) -> Option<i128> {
    let inner = val.get("i128")?;
    let hi: i64 = inner.get("hi")?.as_i64()?;
    let lo: u64 = inner.get("lo")?.as_u64()?;
    // Combine: high 64 bits (signed) and low 64 bits (unsigned).
    let result = ((hi as i128) << 64) | (lo as u128 as i128);
    Some(result)
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
pub mod tests {
    use super::*;

    /// Builds a deterministic `G...` address from a single seed byte.
    pub fn g_account(seed: u8) -> String {
        stellar_strkey::ed25519::PublicKey([seed; 32])
            .to_string()
            .as_str()
            .to_owned()
    }

    /// A muxed deposit address for `g_account(1)` with the given user ID.
    pub fn muxed(id: u64) -> String {
        engipay_core::stellar::muxed_deposit_address(&g_account(1), id).unwrap()
    }

    /// The USDC SAC contract ID for testnet.
    fn usdc_contract() -> String {
        StellarNetwork::Testnet.usdc_contract_id()
    }

    /// Builds a minimal transfer event JSON from the given overrides.
    fn transfer_event(overrides: serde_json::Value) -> RpcEvent {
        let custody = g_account(1);
        let sender = g_account(2);

        let mut base = serde_json::json!({
            "id": "0000000017408937983-0000000001",
            "contractId": usdc_contract(),
            "ledger": 100u64,
            "topic": [
                { "symbol": "transfer" },
                { "address": sender },
                { "address": custody }
            ],
            "value": { "i128": { "hi": 0, "lo": 100_000_000u64 } }
        });

        if let (Some(base_obj), Some(patch)) = (base.as_object_mut(), overrides.as_object()) {
            for (k, v) in patch {
                base_obj.insert(k.clone(), v.clone());
            }
        }

        serde_json::from_value(base).unwrap()
    }

    // ── Happy path: basic transfer to custody account ─────────────────────────

    #[test]
    fn transfer_to_custody_produces_deposit() {
        let event = transfer_event(serde_json::json!({}));
        let deposit =
            deposit_from_event(&event, &g_account(1), StellarNetwork::Testnet, 104).unwrap();

        // 1 USDC = 10_000_000 stroops; 100_000_000 = 10 USDC
        assert_eq!(deposit.money, Money::from_minor(Asset::Usdc, 100_000_000));
        assert_eq!(
            deposit.address,
            g_account(1),
            "bare custody when no muxed ID"
        );
        assert_eq!(deposit.reference, "soroban:0000000017408937983-0000000001");
        assert_eq!(deposit.confirmations, 5, "latest=104, ledger=100 → 5");
    }

    // ── Happy path: SEP-41 v2 map format with to_muxed_id ────────────────────

    #[test]
    fn transfer_with_muxed_id_routes_to_user() {
        let event = transfer_event(serde_json::json!({
            "value": {
                "map": [
                    {
                        "key": { "symbol": "amount" },
                        "val": { "i128": { "hi": 0, "lo": 50_000_000u64 } }
                    },
                    {
                        "key": { "symbol": "to_muxed_id" },
                        "val": { "u64": 42u64 }
                    }
                ]
            }
        }));

        let deposit =
            deposit_from_event(&event, &g_account(1), StellarNetwork::Testnet, 101).unwrap();

        assert_eq!(deposit.money, Money::from_minor(Asset::Usdc, 50_000_000));
        assert_eq!(
            deposit.address,
            muxed(42),
            "muxed ID 42 must produce an M... address"
        );
        assert_eq!(deposit.confirmations, 2, "latest=101, ledger=100 → 2");
    }

    // ── Happy path: SEP-41 v2 map without to_muxed_id ────────────────────────

    #[test]
    fn transfer_map_without_muxed_id_uses_custody() {
        let event = transfer_event(serde_json::json!({
            "value": {
                "map": [
                    {
                        "key": { "symbol": "amount" },
                        "val": { "i128": { "hi": 0, "lo": 25_000_000u64 } }
                    }
                ]
            }
        }));

        let deposit =
            deposit_from_event(&event, &g_account(1), StellarNetwork::Testnet, 100).unwrap();
        assert_eq!(deposit.address, g_account(1));
    }

    // ── Happy path: destination is a muxed M... address ──────────────────────

    #[test]
    fn transfer_to_muxed_address_accepted_and_preserved() {
        let custody = g_account(1);
        let muxed_addr = muxed(99);

        let event = transfer_event(serde_json::json!({
            "topic": [
                { "symbol": "transfer" },
                { "address": g_account(2) },
                { "address": muxed_addr }
            ]
        }));

        let deposit = deposit_from_event(&event, &custody, StellarNetwork::Testnet, 100).unwrap();
        assert_eq!(deposit.address, muxed_addr);
    }

    // ── Refusal: transfer to a different account ──────────────────────────────

    #[test]
    fn transfer_to_other_account_is_not_a_deposit() {
        let event = transfer_event(serde_json::json!({
            "topic": [
                { "symbol": "transfer" },
                { "address": g_account(2) },
                { "address": g_account(3) }      // ← not our custody
            ]
        }));
        assert_eq!(
            deposit_from_event(&event, &g_account(1), StellarNetwork::Testnet, 100),
            Err(SorobanSkipped::NotForCustody)
        );
    }

    // ── Refusal: wrong first topic ────────────────────────────────────────────

    #[test]
    fn event_with_wrong_first_topic_is_malformed() {
        let event = transfer_event(serde_json::json!({
            "topic": [
                { "symbol": "mint" },             // ← not "transfer"
                { "address": g_account(2) },
                { "address": g_account(1) }
            ]
        }));
        assert!(matches!(
            deposit_from_event(&event, &g_account(1), StellarNetwork::Testnet, 100),
            Err(SorobanSkipped::MalformedTopics(_))
        ));
    }

    // ── Refusal: too few topics ────────────────────────────────────────────────

    #[test]
    fn event_with_fewer_than_three_topics_is_malformed() {
        let event = transfer_event(serde_json::json!({
            "topic": [{ "symbol": "transfer" }, { "address": g_account(2) }]
        }));
        assert!(matches!(
            deposit_from_event(&event, &g_account(1), StellarNetwork::Testnet, 100),
            Err(SorobanSkipped::MalformedTopics(_))
        ));
    }

    // ── Refusal: zero amount ──────────────────────────────────────────────────

    #[test]
    fn zero_amount_transfer_is_not_credited() {
        let event = transfer_event(serde_json::json!({
            "value": { "i128": { "hi": 0, "lo": 0u64 } }
        }));
        assert_eq!(
            deposit_from_event(&event, &g_account(1), StellarNetwork::Testnet, 100),
            Err(SorobanSkipped::NonPositiveAmount)
        );
    }

    // ── Refusal: negative amount ──────────────────────────────────────────────

    #[test]
    fn negative_amount_transfer_is_not_credited() {
        // i128 = -1: hi = -1, lo = u64::MAX (two's complement)
        let event = transfer_event(serde_json::json!({
            "value": { "i128": { "hi": -1i64, "lo": u64::MAX } }
        }));
        assert_eq!(
            deposit_from_event(&event, &g_account(1), StellarNetwork::Testnet, 100),
            Err(SorobanSkipped::NonPositiveAmount)
        );
    }

    // ── Refusal: missing event data ───────────────────────────────────────────

    #[test]
    fn event_without_data_is_malformed() {
        let event = transfer_event(serde_json::json!({ "value": null }));
        assert!(matches!(
            deposit_from_event(&event, &g_account(1), StellarNetwork::Testnet, 100),
            Err(SorobanSkipped::MalformedData(_))
        ));
    }

    // ── parse_i128 edge cases ─────────────────────────────────────────────────

    #[test]
    fn parse_i128_zero() {
        let val = serde_json::json!({ "i128": { "hi": 0, "lo": 0u64 } });
        assert_eq!(parse_i128(&val), Some(0i128));
    }

    #[test]
    fn parse_i128_positive() {
        let val = serde_json::json!({ "i128": { "hi": 0, "lo": 100_000_000u64 } });
        assert_eq!(parse_i128(&val), Some(100_000_000i128));
    }

    #[test]
    fn parse_i128_negative_one() {
        // -1 in i128: hi = -1 (i64), lo = 18446744073709551615 (u64::MAX)
        let val = serde_json::json!({ "i128": { "hi": -1i64, "lo": u64::MAX } });
        assert_eq!(parse_i128(&val), Some(-1i128));
    }

    #[test]
    fn parse_i128_large_positive() {
        // i128::MAX: hi = i64::MAX, lo = u64::MAX
        let val = serde_json::json!({ "i128": { "hi": i64::MAX, "lo": u64::MAX } });
        assert_eq!(parse_i128(&val), Some(i128::MAX));
    }

    #[test]
    fn parse_i128_missing_returns_none() {
        assert_eq!(parse_i128(&serde_json::json!({})), None);
        assert_eq!(parse_i128(&serde_json::json!({ "i128": {} })), None);
    }

    // ── is_symbol_transfer ────────────────────────────────────────────────────

    #[test]
    fn is_symbol_transfer_accepts_transfer() {
        assert!(is_symbol_transfer(
            &serde_json::json!({ "symbol": "transfer" })
        ));
    }

    #[test]
    fn is_symbol_transfer_rejects_others() {
        assert!(!is_symbol_transfer(
            &serde_json::json!({ "symbol": "mint" })
        ));
        assert!(!is_symbol_transfer(&serde_json::json!("transfer")));
        assert!(!is_symbol_transfer(&serde_json::json!({})));
    }

    // ── is_custody_destination ────────────────────────────────────────────────

    #[test]
    fn custody_account_matches_itself() {
        let custody = g_account(1);
        assert!(is_custody_destination(&custody, &custody));
    }

    #[test]
    fn muxed_address_matches_custody_base_account() {
        let custody = g_account(1);
        let muxed_addr = muxed(5);
        assert!(is_custody_destination(&muxed_addr, &custody));
    }

    #[test]
    fn different_account_does_not_match_custody() {
        let custody = g_account(1);
        let other = g_account(2);
        assert!(!is_custody_destination(&other, &custody));
    }

    // ── confirmations calculation ─────────────────────────────────────────────

    #[test]
    fn confirmations_calculated_correctly() {
        // latest=110, ledger=105 → 110 - 105 + 1 = 6
        let event = transfer_event(serde_json::json!({ "ledger": 105u64 }));
        let deposit =
            deposit_from_event(&event, &g_account(1), StellarNetwork::Testnet, 110).unwrap();
        assert_eq!(deposit.confirmations, 6);
    }

    #[test]
    fn confirmations_is_one_at_latest_ledger() {
        let event = transfer_event(serde_json::json!({ "ledger": 100u64 }));
        let deposit =
            deposit_from_event(&event, &g_account(1), StellarNetwork::Testnet, 100).unwrap();
        assert_eq!(deposit.confirmations, 1);
    }
}
