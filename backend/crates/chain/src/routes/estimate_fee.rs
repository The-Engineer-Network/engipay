//! `POST /internal/estimate-fee` — what a transfer will cost to send, right now.
//!
//! Fees are quoted per chain because each network charges in its own unit:
//!
//! | Chain    | Fee unit                    | Source                                 |
//! |----------|-----------------------------|----------------------------------------|
//! | Stellar  | stroops of XLM              | network constants (base reserve + fee) |
//! | Base     | wei of ETH                  | `eth_feeHistory` (EIP-1559)            |
//! | Bitcoin  | satoshis of BTC             | Esplora `/fee-estimates` (sat/vB)      |
//!
//! Two rules hold everywhere:
//!
//! * **No floating point touches money.** Every figure that leaves this module
//!   is an integer in the asset's smallest unit, carried in JSON as a *string*
//!   so no `serde_json` or JavaScript caller can quietly turn it into a float.
//!   Esplora publishes sat/vB as a fractional JSON number, so [`sat_per_vb`]
//!   scales the digits with integers and rounds **up**: an under-quoted fee
//!   that fails on-chain is worse than one satoshi of dust.
//! * **A fee is not always paid in the asset being sent.** Stellar always
//!   charges XLM and Base always charges ETH, even for USDC. The quote reports
//!   `fee_asset` separately and only totals `amount + fee` when the two assets
//!   actually match.
//!
//! Fee data arrives through [`FeeOracle`], so the handler is tested against
//! fakes and the network-facing readers against recorded indexer responses.

use std::future::Future;
use std::pin::Pin;

use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use engipay_core::stellar::parse_address;
use engipay_core::{Asset, Chain, Money, MoneyError};
use serde::{Deserialize, Serialize};

use crate::ChainError;
use crate::routes::ChainHttpState;
use crate::stellar::payment::BASE_FEE;

/// Validates a `0x`-prefixed 20-byte hex address and lowercases it, so the same
/// address compares equal whatever casing it arrived in.
fn normalise_evm_address(input: &str) -> Option<String> {
    let hex = input.strip_prefix("0x")?;
    (hex.len() == 40 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| format!("0x{}", hex.to_ascii_lowercase()))
}

/// Parses a JSON-RPC hex quantity such as `"0x1bc16d674ec80000"`. `None` if it
/// is malformed or does not fit the ledger's `i128`.
fn hex_quantity(input: &str) -> Option<i128> {
    let hex = input.strip_prefix("0x")?;
    if hex.is_empty() {
        return None;
    }
    i128::try_from(u128::from_str_radix(hex, 16).ok()?).ok()
}

/// The network's minimum account reserve: 0.5 XLM, in stroops.
///
/// A payment to an account that does not exist yet also creates it, which costs
/// more than this; that is decided when the transaction is built, not by a
/// quote.
pub const STELLAR_MINIMUM_BASE_RESERVE: i128 = 5_000_000;

/// Operations in a plain payment: exactly one.
pub const PAYMENT_OPERATIONS: i128 = 1;

/// Gas for a native ETH transfer on Base.
pub const ETH_TRANSFER_GAS_LIMIT: u64 = 21_000;

/// Gas for an ERC-20 transfer (USDC). Cold storage writes and call data make
/// this several times a native transfer; 65k is the usual working value.
pub const ERC20_TRANSFER_GAS_LIMIT: u64 = 65_000;

/// Priority fee tip used when the node reports no median tip: 1 gwei.
pub const DEFAULT_MAX_PRIORITY_FEE_WEI: u128 = 1_000_000_000;

/// Headroom over the node's current base fee, so a quote survives the base fee
/// rising while the user is still confirming in their wallet.
pub const BASE_FEE_HEADROOM: u128 = 2;

/// Virtual bytes of a typical withdrawal: one P2WPKH input, a recipient output
/// and one change output.
pub const BITCOIN_P2WPKH_VSIZE: u64 = 141;

/// Nothing below this relays; an empty mempool is reported as 0 sat/vB by
/// Esplora and is floored rather than quoted as free.
pub const MIN_BITCOIN_FEE_RATE_SAT_VB: u64 = 1;

/// How long a quote is expected to hold. Gas and mempool fees both move.
pub const QUOTE_VALID_SECONDS: u32 = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Wire types
// ─────────────────────────────────────────────────────────────────────────────

/// A fee quote request.
///
/// `amount` is a decimal **string**, never a JSON number: a JSON number is
/// already a float by the time the client has parsed it, and money must not be.
/// Unknown fields are refused so a typo is never silently ignored.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EstimateFeeRequest {
    pub chain: Chain,
    pub asset: Asset,
    /// Human amount of what is being sent, e.g. `"25.5"`.
    pub amount: String,
    /// Where the money is going, validated against `chain`.
    pub destination: String,
}

/// Where the numbers in a quote came from, so a caller knows how far to trust
/// them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FeeSource {
    /// A network constant: the same for every request.
    NetworkConstant,
    /// An EVM JSON-RPC node.
    Rpc,
    /// A Bitcoin Esplora indexer.
    Esplora,
}

/// The per-network arithmetic behind a quote, so the UI can explain itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "network", rename_all = "lowercase")]
pub enum FeeBreakdown {
    Stellar {
        base_reserve_minor: i128,
        base_fee_per_operation_minor: i128,
        operations: i128,
    },
    Base {
        gas_limit: u64,
        base_fee_per_gas_wei: u128,
        max_priority_fee_per_gas_wei: u128,
        max_fee_per_gas_wei: u128,
    },
    Bitcoin {
        fee_rate_sat_vb: u64,
        estimated_vsize: u64,
    },
}

/// A fee quote. Every amount is an exact integer of its asset's smallest unit,
/// carried as a string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EstimateFeeResponse {
    pub chain: Chain,
    /// The asset being sent, echoed back.
    pub asset: Asset,
    /// The asset the fee is charged in. Not always `asset`: Stellar charges
    /// XLM and Base charges ETH for every transfer, including USDC.
    pub fee_asset: Asset,
    /// Fee in the smallest unit of `fee_asset`, e.g. `"5000100"`.
    pub fee_minor: String,
    /// The same fee in human units, e.g. `"0.000005"`.
    pub fee: String,
    /// `amount + fee`, only when the fee is paid in the asset being sent.
    /// `None` otherwise: adding XLM to USDC would be nonsense.
    pub total_minor: Option<String>,
    /// The same total in human units.
    pub total: Option<String>,
    pub source: FeeSource,
    pub breakdown: FeeBreakdown,
    pub expires_in_seconds: u32,
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/// A request that passed every validation rule and is safe to price.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedFeeRequest {
    pub chain: Chain,
    pub asset: Asset,
    pub amount: Money,
    /// Canonical form: checksummed for Stellar, lowercased for Base.
    pub destination: String,
}

/// Everything a client can get wrong before a network is ever contacted.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RequestError {
    #[error("amount: {0}")]
    Amount(#[from] MoneyError),
    #[error("amount must be greater than zero")]
    NotPositive,
    #[error("{asset} cannot be sent on {chain:?}")]
    UnsupportedAsset { asset: Asset, chain: Chain },
    #[error("destination is not a valid {chain:?} address: {reason}")]
    Destination { chain: Chain, reason: String },
    /// A body that could not be read at all. `axum` reports what was wrong with
    /// it; the message is already written for a caller.
    #[error("{0}")]
    Body(String),
}

impl EstimateFeeRequest {
    /// Checks every field, cheapest first: asset on network, then amount, then
    /// destination. Nothing is coerced and nothing is defaulted.
    pub fn validate(self) -> Result<ValidatedFeeRequest, RequestError> {
        let chain = self.chain;
        let asset = self.asset;
        if !asset.is_on(chain) {
            return Err(RequestError::UnsupportedAsset { asset, chain });
        }

        let amount = Money::parse(asset, &self.amount)?;
        if !amount.is_positive() {
            return Err(RequestError::NotPositive);
        }
        // Refuses amounts the network cannot represent (7-decimal ledger USDC
        // sent on Base) instead of rounding them away.
        amount
            .to_network_units(chain)
            .map_err(RequestError::Amount)?;

        Ok(ValidatedFeeRequest {
            chain,
            asset,
            amount,
            destination: normalise_destination(chain, &self.destination)?,
        })
    }
}

/// Validates a destination against its network and returns the canonical form.
///
/// A quote for an address that cannot receive money is worse than useless, so
/// the address is checked here rather than discovered at broadcast time.
fn normalise_destination(chain: Chain, destination: &str) -> Result<String, RequestError> {
    let trimmed = destination.trim();
    let bad = |reason: &str| RequestError::Destination {
        chain,
        reason: reason.to_owned(),
    };

    match chain {
        // Strkey verifies the version byte and the checksum, so a mistyped or
        // truncated `G...`/`M...` cannot slip through.
        Chain::Stellar => parse_address(trimmed)
            .map(|address| address.base_account().to_owned())
            .map_err(|error| bad(&error.to_string())),
        Chain::Base => normalise_evm_address(trimmed)
            .ok_or_else(|| bad("expected a 0x-prefixed 20-byte hex address")),
        Chain::Bitcoin => {
            if is_bitcoin_address(trimmed) {
                Ok(trimmed.to_owned())
            } else {
                Err(bad("expected a base58 (3…) or bech32 (bc1…) address"))
            }
        }
    }
}

/// Checks a Bitcoin mainnet address.
///
/// Full bech32 checksum verification needs a BCH code library; this checks what
/// a quote depends on: the prefix, the length and the character set. Legacy
/// P2PKH (`1…`) is deliberately refused — EngiPay does not send to it.
fn is_bitcoin_address(address: &str) -> bool {
    const BASE58: &str = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const BECH32: &str = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    if let Some(data) = address
        .strip_prefix("bc1")
        .or_else(|| address.strip_prefix("BC1"))
    {
        // The `1` in `bc1` is the bech32 separator; the payload that follows is
        // bech32 data only, which is why it never contains a `1` itself.
        (14..=74).contains(&address.len())
            && data
                .to_ascii_lowercase()
                .bytes()
                .all(|byte| BECH32.contains(char::from(byte)))
    } else {
        (26..=35).contains(&address.len())
            && address.starts_with('3')
            && address
                .bytes()
                .all(|byte| BASE58.contains(char::from(byte)))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fee data
// ─────────────────────────────────────────────────────────────────────────────

/// What a network currently charges, in that network's own units.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkFeeData {
    Stellar {
        base_reserve_minor: i128,
        base_fee_per_operation_minor: i128,
    },
    Base {
        base_fee_per_gas_wei: u128,
        max_priority_fee_per_gas_wei: u128,
    },
    Bitcoin {
        fee_rate_sat_vb: u64,
    },
}

impl NetworkFeeData {
    /// The network these figures came from.
    pub const fn chain(&self) -> Chain {
        match self {
            Self::Stellar { .. } => Chain::Stellar,
            Self::Base { .. } => Chain::Base,
            Self::Bitcoin { .. } => Chain::Bitcoin,
        }
    }
}

impl std::fmt::Display for NetworkFeeData {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Stellar {
                base_reserve_minor,
                base_fee_per_operation_minor,
            } => write!(
                f,
                "base reserve {base_reserve_minor} stroops, {base_fee_per_operation_minor} stroops per operation"
            ),
            Self::Base {
                base_fee_per_gas_wei,
                max_priority_fee_per_gas_wei,
            } => write!(
                f,
                "base fee {base_fee_per_gas_wei} wei, tip {max_priority_fee_per_gas_wei} wei"
            ),
            Self::Bitcoin { fee_rate_sat_vb } => write!(f, "{fee_rate_sat_vb} sat/vB"),
        }
    }
}

/// A live source of [`NetworkFeeData`].
///
/// The future is boxed rather than written as `impl Future` so an oracle can sit
/// behind `Arc<dyn FeeOracle>` in the router state, which is what lets the
/// handler be tested against a fake instead of a live node.
pub trait FeeOracle: Send + Sync {
    fn fees(
        &self,
        chain: Chain,
    ) -> Pin<Box<dyn Future<Output = Result<NetworkFeeData, ChainError>> + Send + '_>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quoting
// ─────────────────────────────────────────────────────────────────────────────

/// Something that stopped a quote being computed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum QuoteError {
    /// The oracle answered with another network's numbers. Treated as a hard
    /// failure: a Bitcoin fee rate priced onto a Base transfer would be wrong by
    /// orders of magnitude, and silently wrong is the dangerous kind.
    #[error("the fee data is for {data:?}, not {requested:?}")]
    WrongNetwork { requested: Chain, data: Chain },
    #[error("the fee does not fit in the asset's units")]
    Overflow,
}

/// Prices a validated request against network fee data.
pub fn quote(
    request: &ValidatedFeeRequest,
    data: &NetworkFeeData,
) -> Result<EstimateFeeResponse, QuoteError> {
    if data.chain() != request.chain {
        return Err(QuoteError::WrongNetwork {
            requested: request.chain,
            data: data.chain(),
        });
    }

    let (fee, breakdown, source) = match data {
        // A payment costs the base reserve plus the per-operation fee, in XLM,
        // whatever asset is being moved.
        NetworkFeeData::Stellar {
            base_reserve_minor,
            base_fee_per_operation_minor,
        } => {
            let operations = base_fee_per_operation_minor
                .checked_mul(PAYMENT_OPERATIONS)
                .ok_or(QuoteError::Overflow)?;
            let stroops = base_reserve_minor
                .checked_add(operations)
                .ok_or(QuoteError::Overflow)?;
            (
                Money::from_network_units(Asset::Xlm, Chain::Stellar, stroops)
                    .map_err(|_| QuoteError::Overflow)?,
                FeeBreakdown::Stellar {
                    base_reserve_minor: *base_reserve_minor,
                    base_fee_per_operation_minor: *base_fee_per_operation_minor,
                    operations: PAYMENT_OPERATIONS,
                },
                FeeSource::NetworkConstant,
            )
        }

        // EIP-1559: the transaction may cost up to `max_fee_per_gas`, the base
        // fee plus headroom plus the tip. Always paid in ETH.
        NetworkFeeData::Base {
            base_fee_per_gas_wei,
            max_priority_fee_per_gas_wei,
        } => {
            let gas_limit = transfer_gas_limit(request.asset);
            let headroom = base_fee_per_gas_wei
                .checked_mul(BASE_FEE_HEADROOM)
                .ok_or(QuoteError::Overflow)?;
            let max_fee_per_gas_wei = headroom
                .checked_add(*max_priority_fee_per_gas_wei)
                .ok_or(QuoteError::Overflow)?;
            let gas = i128::from(gas_limit);
            let wei = i128::try_from(max_fee_per_gas_wei)
                .map_err(|_| QuoteError::Overflow)?
                .checked_mul(gas)
                .ok_or(QuoteError::Overflow)?;
            (
                Money::from_network_units(Asset::Eth, Chain::Base, wei)
                    .map_err(|_| QuoteError::Overflow)?,
                FeeBreakdown::Base {
                    gas_limit,
                    base_fee_per_gas_wei: *base_fee_per_gas_wei,
                    max_priority_fee_per_gas_wei: *max_priority_fee_per_gas_wei,
                    max_fee_per_gas_wei,
                },
                FeeSource::Rpc,
            )
        }

        // Bitcoin has no per-operation fee: the rate times the size of the
        // transaction, and size does not depend on the amount being sent.
        NetworkFeeData::Bitcoin { fee_rate_sat_vb } => {
            let sats = fee_rate_sat_vb
                .checked_mul(BITCOIN_P2WPKH_VSIZE)
                .ok_or(QuoteError::Overflow)?;
            (
                Money::from_network_units(Asset::Btc, Chain::Bitcoin, i128::from(sats))
                    .map_err(|_| QuoteError::Overflow)?,
                FeeBreakdown::Bitcoin {
                    fee_rate_sat_vb: *fee_rate_sat_vb,
                    estimated_vsize: BITCOIN_P2WPKH_VSIZE,
                },
                FeeSource::Esplora,
            )
        }
    };

    // Only total up when the fee is charged in the asset being sent.
    let total = if fee.asset == request.asset {
        Some(
            request
                .amount
                .checked_add(fee)
                .map_err(|_| QuoteError::Overflow)?,
        )
    } else {
        None
    };

    Ok(EstimateFeeResponse {
        chain: request.chain,
        asset: request.asset,
        fee_asset: fee.asset,
        fee_minor: fee.minor.to_string(),
        fee: decimal_amount(&fee),
        total_minor: total.as_ref().map(|money| money.minor.to_string()),
        total: total.as_ref().map(decimal_amount),
        source,
        breakdown,
        expires_in_seconds: QUOTE_VALID_SECONDS,
    })
}

/// Gas an asset's transfer costs on Base.
const fn transfer_gas_limit(asset: Asset) -> u64 {
    match asset {
        Asset::Usdc => ERC20_TRANSFER_GAS_LIMIT,
        _ => ETH_TRANSFER_GAS_LIMIT,
    }
}

/// `money` as a bare decimal number, without the asset symbol: `Money`'s own
/// display is the one definition of how an amount is written.
fn decimal_amount(money: &Money) -> String {
    money
        .to_string()
        .split_once(' ')
        .map_or_else(|| money.to_string(), |(number, _asset)| number.to_owned())
}

// ─────────────────────────────────────────────────────────────────────────────
// Fee oracles
// ─────────────────────────────────────────────────────────────────────────────

/// The default oracle: network constants for Stellar, live reads for Base and
/// Bitcoin when an endpoint is configured.
///
/// A chain without a configured endpoint answers
/// [`ChainError::NotImplemented`], which the handler turns into `503`. A fee is
/// never guessed.
pub struct FeeQuotes {
    base: Option<BaseRpcFees>,
    bitcoin: Option<EsploraFees>,
}

impl FeeQuotes {
    /// `base_rpc_url` and `esplora_url` are both optional.
    pub fn new(
        base_rpc_url: Option<String>,
        esplora_url: Option<String>,
    ) -> Result<Self, ChainError> {
        Ok(Self {
            base: match base_rpc_url {
                Some(url) => Some(BaseRpcFees::new(&url)?),
                None => None,
            },
            bitcoin: match esplora_url {
                Some(url) => Some(EsploraFees::new(&url)?),
                None => None,
            },
        })
    }
}

impl FeeOracle for FeeQuotes {
    fn fees(
        &self,
        chain: Chain,
    ) -> Pin<Box<dyn Future<Output = Result<NetworkFeeData, ChainError>> + Send + '_>> {
        match (chain, &self.base, &self.bitcoin) {
            // The minimum base reserve and the per-operation fee are network
            // constants, so a Stellar quote costs no request at all.
            (Chain::Stellar, _, _) => Box::pin(async {
                Ok(NetworkFeeData::Stellar {
                    base_reserve_minor: STELLAR_MINIMUM_BASE_RESERVE,
                    base_fee_per_operation_minor: i128::from(BASE_FEE),
                })
            }),
            (Chain::Base, Some(base), _) => base.fees(chain),
            (Chain::Bitcoin, _, Some(bitcoin)) => bitcoin.fees(chain),
            (Chain::Base, None, _) | (Chain::Bitcoin, _, None) => {
                Box::pin(async { Err(ChainError::NotImplemented) })
            }
        }
    }
}

/// Reads EIP-1559 prices from an EVM JSON-RPC endpoint.
pub struct BaseRpcFees {
    http: reqwest::Client,
    url: String,
}

/// Blocks of history requested from the node. Enough to smooth a one-block
/// spike without turning a live quote into a moving average.
const FEE_HISTORY_BLOCKS: &str = "0x5";

impl BaseRpcFees {
    pub fn new(url: &str) -> Result<Self, ChainError> {
        let url = url.trim().trim_end_matches('/');
        if url.is_empty() {
            return Err(ChainError::Config("the Base RPC URL is empty".to_owned()));
        }
        Ok(Self {
            http: http_client()?,
            url: url.to_owned(),
        })
    }

    /// `eth_feeHistory`, reduced to the two numbers a transfer needs.
    async fn quote(&self) -> Result<NetworkFeeData, ChainError> {
        let response = self
            .http
            .post(&self.url)
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "eth_feeHistory",
                // An empty percentile list: the tip is the base fee plus a
                // configured tip, which never needs a node-side median.
                "params": [FEE_HISTORY_BLOCKS, "latest", []],
            }))
            .send()
            .await
            .map_err(|error| ChainError::Unavailable(error.to_string()))?;

        let envelope: RpcEnvelope = response.json().await.map_err(|error| {
            ChainError::Unavailable(format!("unexpected RPC response: {error}"))
        })?;
        if let Some(error) = envelope.error {
            return Err(ChainError::Rejected(format!(
                "eth_feeHistory: {}",
                error.message
            )));
        }
        let history = envelope.result.ok_or_else(|| {
            ChainError::Unavailable("eth_feeHistory returned no result".to_owned())
        })?;

        // The last entry is the base fee for the block being built, which is the
        // one this transaction will be priced against. JSON-RPC quantities are
        // hex strings, not numbers.
        let base_fee_per_gas_wei = history
            .base_fee_per_gas
            .last()
            .and_then(|quantity| hex_quantity(quantity))
            .and_then(|wei| u128::try_from(wei).ok())
            .ok_or_else(|| {
                ChainError::Unavailable("eth_feeHistory reported no base fee".to_owned())
            })?;

        Ok(NetworkFeeData::Base {
            base_fee_per_gas_wei,
            max_priority_fee_per_gas_wei: DEFAULT_MAX_PRIORITY_FEE_WEI,
        })
    }
}

impl FeeOracle for BaseRpcFees {
    fn fees(
        &self,
        _chain: Chain,
    ) -> Pin<Box<dyn Future<Output = Result<NetworkFeeData, ChainError>> + Send + '_>> {
        Box::pin(async move { self.quote().await })
    }
}

/// `eth_feeHistory`, with only the fields this module reads.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeeHistory {
    base_fee_per_gas: Vec<String>,
}

/// A JSON-RPC reply: exactly one of `result` and `error` is present.
#[derive(Debug, Deserialize)]
struct RpcEnvelope {
    #[serde(default)]
    result: Option<FeeHistory>,
    #[serde(default)]
    error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
struct RpcError {
    message: String,
}

/// Reads recommended fee rates from a Bitcoin Esplora indexer.
pub struct EsploraFees {
    http: reqwest::Client,
    url: String,
    /// Confirmation target, in blocks. 6 is roughly an hour on Bitcoin.
    target: String,
}

/// Confirmation target Esplora is asked for, in blocks.
const BITCOIN_FEE_TARGET_BLOCKS: &str = "6";

impl EsploraFees {
    pub fn new(url: &str) -> Result<Self, ChainError> {
        let url = url.trim().trim_end_matches('/');
        if url.is_empty() {
            return Err(ChainError::Config(
                "the Bitcoin Esplora URL is empty".to_owned(),
            ));
        }
        Ok(Self {
            http: http_client()?,
            url: url.to_owned(),
            target: BITCOIN_FEE_TARGET_BLOCKS.to_owned(),
        })
    }

    async fn quote(&self) -> Result<NetworkFeeData, ChainError> {
        let body: serde_json::Map<String, serde_json::Value> = self
            .http
            .get(format!("{}/fee-estimates", self.url))
            .send()
            .await
            .map_err(|error| ChainError::Unavailable(error.to_string()))?
            .json()
            .await
            .map_err(|error| {
                ChainError::Unavailable(format!("unexpected Esplora response: {error}"))
            })?;

        let rate = body
            .get(&self.target)
            .ok_or_else(|| {
                ChainError::Unavailable(format!(
                    "Esplora has no fee estimate for {} blocks",
                    self.target
                ))
            })
            .and_then(rate_to_decimal_string)?;

        Ok(NetworkFeeData::Bitcoin {
            fee_rate_sat_vb: sat_per_vb(&rate)?,
        })
    }
}

impl FeeOracle for EsploraFees {
    fn fees(
        &self,
        _chain: Chain,
    ) -> Pin<Box<dyn Future<Output = Result<NetworkFeeData, ChainError>> + Send + '_>> {
        Box::pin(async move { self.quote().await })
    }
}

/// Renders a JSON number or numeric string as text, without ever converting it
/// to `f64`.
fn rate_to_decimal_string(value: &serde_json::Value) -> Result<String, ChainError> {
    match value {
        serde_json::Value::Number(number) => Ok(number.to_string()),
        serde_json::Value::String(text) => Ok(text.clone()),
        other => Err(ChainError::Unavailable(format!(
            "unexpected fee rate in the Esplora response: {other}"
        ))),
    }
}

/// Converts an indexer's sat/vB rate into whole satoshis per virtual byte,
/// rounding **up**.
///
/// Esplora publishes fractional rates ("12.3"), so the digits are scaled with
/// integer arithmetic and rounded up to the next whole satoshi. Rounding down
/// would quote below the rate actually being paid and the transaction would be
/// underpriced. Zero (an empty mempool) is floored at
/// [`MIN_BITCOIN_FEE_RATE_SAT_VB`], because a free transaction does not relay.
pub fn sat_per_vb(input: &str) -> Result<u64, ChainError> {
    /// Enough decimals to keep any published rate, without inventing precision
    /// an indexer did not report.
    const MAX_DECIMALS: u32 = 6;
    const SCALE: u64 = 1_000_000;
    /// Anything above this is a misconfigured or hostile endpoint, not a fee.
    const MAX_RATE: u64 = 10_000;

    let text = input.trim();
    let (whole, fraction) = match text.split_once('.') {
        Some((whole, fraction)) => (whole, fraction),
        None => (text, ""),
    };
    let well_formed = !(whole.is_empty() && fraction.is_empty())
        && whole.bytes().all(|byte| byte.is_ascii_digit())
        && fraction.bytes().all(|byte| byte.is_ascii_digit());
    if !well_formed {
        return Err(ChainError::Unavailable(format!(
            "fee rate {input:?} is not a plain decimal number"
        )));
    }
    let decimals = u32::try_from(fraction.len()).unwrap_or(u32::MAX);
    if decimals > MAX_DECIMALS {
        return Err(ChainError::Unavailable(format!(
            "fee rate {input:?} has more than {MAX_DECIMALS} decimal places"
        )));
    }

    let whole_units = if whole.is_empty() {
        0
    } else {
        whole
            .parse::<u64>()
            .map_err(|_| ChainError::Unavailable(format!("fee rate {input:?} is out of range")))?
    };
    // Pad the published fraction out to a fixed scale, then take the digits
    // apart by `char::to_digit`, so no subtraction on the digits is needed.
    let padding = usize::try_from(MAX_DECIMALS)
        .unwrap_or(0)
        .saturating_sub(usize::try_from(decimals).unwrap_or(usize::MAX));
    let padded = fraction
        .bytes()
        .chain(std::iter::repeat_n(b'0', padding))
        .try_fold(0u64, |acc, byte| {
            let digit = char::from(byte).to_digit(10).ok_or(())?;
            acc.checked_mul(10)
                .and_then(|acc| acc.checked_add(u64::from(digit)))
                .ok_or(())
        })
        .map_err(|_| ChainError::Unavailable("fee rate is out of range".to_owned()))?;

    let scaled = whole_units
        .checked_mul(SCALE)
        .and_then(|whole| whole.checked_add(padded))
        .ok_or_else(|| ChainError::Unavailable("fee rate is out of range".to_owned()))?;
    // Ceiling division: (scaled + SCALE - 1) / SCALE, without the subtraction
    // that would need a guard.
    let rounded = scaled
        .checked_add(SCALE - 1)
        .map(|rounded| rounded / SCALE)
        .ok_or_else(|| ChainError::Unavailable("fee rate is out of range".to_owned()))?;

    let floored = rounded.max(MIN_BITCOIN_FEE_RATE_SAT_VB);
    if floored > MAX_RATE {
        return Err(ChainError::Unavailable(format!(
            "fee rate {input:?} is implausibly high"
        )));
    }
    Ok(floored)
}

fn http_client() -> Result<reqwest::Client, ChainError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(concat!("engipay-chain/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| ChainError::Unavailable(error.to_string()))
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP
// ─────────────────────────────────────────────────────────────────────────────

/// Everything the endpoint can fail with.
#[derive(Debug, thiserror::Error)]
pub enum FeeError {
    #[error("{0}")]
    Invalid(#[from] RequestError),
    #[error("{0}")]
    Unquotable(#[from] QuoteError),
    #[error("no fee source is configured for {0:?}")]
    NoSource(Chain),
    #[error("{0}")]
    Chain(#[from] ChainError),
}

/// `POST /internal/estimate-fee`.
///
/// The JSON extractor is taken as a `Result` so an unreadable body comes back in
/// the same error envelope as everything else, instead of `axum`'s plain-text
/// rejection.
pub async fn estimate_fee(
    State(state): State<ChainHttpState>,
    payload: Result<Json<EstimateFeeRequest>, JsonRejection>,
) -> Result<Json<EstimateFeeResponse>, FeeError> {
    let Json(request) = payload.map_err(|rejection| RequestError::Body(rejection.body_text()))?;
    let validated = request.validate()?;
    let data = state
        .fees
        .fees(validated.chain)
        .await
        .map_err(|error| match error {
            // Nothing configured for this network: a 503 the caller can retry
            // once the operator has set the endpoint, not a 500.
            ChainError::NotImplemented => FeeError::NoSource(validated.chain),
            other => FeeError::Chain(other),
        })?;
    tracing::debug!(chain = ?validated.chain, fee = %data, "quoted network fee");
    Ok(Json(quote(&validated, &data)?))
}

impl axum::response::IntoResponse for FeeError {
    fn into_response(self) -> axum::response::Response {
        use axum::http::StatusCode;
        let (status, code) = match &self {
            // The caller's input, not ours.
            FeeError::Invalid(_) | FeeError::Unquotable(_) => {
                (StatusCode::BAD_REQUEST, "bad_request")
            }
            FeeError::NoSource(_) => (StatusCode::SERVICE_UNAVAILABLE, "not_configured"),
            // The network is down or refused: the caller may retry.
            FeeError::Chain(ChainError::Unavailable(_)) => {
                (StatusCode::SERVICE_UNAVAILABLE, "upstream_unavailable")
            }
            FeeError::Chain(ChainError::Rejected(_)) => {
                (StatusCode::BAD_GATEWAY, "upstream_rejected")
            }
            FeeError::Chain(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        };

        // Upstream detail is logged, not returned: the caller has no use for a
        // node's error string and it can carry endpoint internals.
        if let FeeError::Chain(error) = &self {
            tracing::warn!(%error, "estimate_fee could not read network fee data");
        }

        let body = Json(serde_json::json!({
            "error": { "code": code, "message": self.to_string() }
        }));
        (status, body).into_response()
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use std::sync::Arc;

    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use serde_json::{Value, json};
    use tower::ServiceExt;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::routes::router;

    const BASE_ADDRESS: &str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const BITCOIN_BECH32: &str = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
    const BITCOIN_P2SH: &str = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";

    /// A deterministic `G...` account, so no test depends on a copied address.
    fn account(seed: u8) -> String {
        stellar_strkey::ed25519::PublicKey([seed; 32])
            .to_string()
            .as_str()
            .to_owned()
    }

    fn request(chain: Chain, asset: Asset, amount: &str, destination: &str) -> EstimateFeeRequest {
        EstimateFeeRequest {
            chain,
            asset,
            amount: amount.to_owned(),
            destination: destination.to_owned(),
        }
    }

    fn stellar_fees() -> NetworkFeeData {
        NetworkFeeData::Stellar {
            base_reserve_minor: STELLAR_MINIMUM_BASE_RESERVE,
            base_fee_per_operation_minor: i128::from(BASE_FEE),
        }
    }

    /// An oracle that always answers with the same data, so the handler can be
    /// driven without a node or an indexer.
    struct FakeOracle(NetworkFeeData);

    impl FeeOracle for FakeOracle {
        fn fees(
            &self,
            _chain: Chain,
        ) -> Pin<Box<dyn Future<Output = Result<NetworkFeeData, ChainError>> + Send + '_>> {
            Box::pin(async move { Ok(self.0) })
        }
    }

    async fn post(app: axum::Router, body: Value) -> (StatusCode, Value) {
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/internal/estimate-fee")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, json)
    }

    // ── Stellar ──────────────────────────────────────────────────────────────

    #[test]
    fn stellar_fee_is_the_base_reserve_plus_the_operation_fee() {
        let validated = request(Chain::Stellar, Asset::Xlm, "2", &account(1))
            .validate()
            .unwrap();
        let quoted = quote(&validated, &stellar_fees()).unwrap();

        // 0.5 XLM reserve + 100 stroops for the single payment operation.
        assert_eq!(quoted.fee_minor, "5000100");
        assert_eq!(quoted.fee, "0.50001");
        assert_eq!(quoted.fee_asset, Asset::Xlm);
        assert_eq!(quoted.source, FeeSource::NetworkConstant);
        assert_eq!(
            quoted.breakdown,
            FeeBreakdown::Stellar {
                base_reserve_minor: STELLAR_MINIMUM_BASE_RESERVE,
                base_fee_per_operation_minor: i128::from(BASE_FEE),
                operations: PAYMENT_OPERATIONS,
            }
        );
        // Paid in the same asset, so the caller gets a total.
        assert_eq!(quoted.total_minor.as_deref(), Some("25000100"));
        assert_eq!(quoted.total.as_deref(), Some("2.50001"));
    }

    #[test]
    fn stellar_fees_are_charged_in_xlm_even_for_usdc() {
        let validated = request(Chain::Stellar, Asset::Usdc, "10", &account(1))
            .validate()
            .unwrap();
        let quoted = quote(&validated, &stellar_fees()).unwrap();

        assert_eq!(quoted.asset, Asset::Usdc);
        assert_eq!(quoted.fee_asset, Asset::Xlm);
        assert_eq!(quoted.fee_minor, "5000100");
        // USDC plus XLM is not a number: no total is offered.
        assert_eq!(quoted.total_minor, None);
        assert_eq!(quoted.total, None);
    }

    /// A muxed destination is accepted, since deposits are paid to `M…`.
    #[test]
    fn stellar_muxed_destinations_are_accepted_and_normalised() {
        let custody = account(1);
        let muxed = engipay_core::stellar::muxed_deposit_address(&custody, 42).unwrap();
        let validated = request(Chain::Stellar, Asset::Xlm, "1", &muxed)
            .validate()
            .unwrap();
        assert_eq!(validated.destination, custody);
    }

    // ── Base ─────────────────────────────────────────────────────────────────

    #[test]
    fn base_fee_is_gas_times_the_eip1559_max_fee_per_gas() {
        let validated = request(Chain::Base, Asset::Eth, "0.5", BASE_ADDRESS)
            .validate()
            .unwrap();
        let quoted = quote(
            &validated,
            &NetworkFeeData::Base {
                base_fee_per_gas_wei: 1_000_000_000,
                max_priority_fee_per_gas_wei: 500_000_000,
            },
        )
        .unwrap();

        // 21_000 gas x (2 x 1 gwei base + 0.5 gwei tip) = 0.0000525 ETH.
        assert_eq!(quoted.fee_minor, "52500000000000");
        assert_eq!(quoted.fee, "0.0000525");
        assert_eq!(quoted.fee_asset, Asset::Eth);
        assert_eq!(quoted.source, FeeSource::Rpc);
        assert_eq!(
            quoted.breakdown,
            FeeBreakdown::Base {
                gas_limit: ETH_TRANSFER_GAS_LIMIT,
                base_fee_per_gas_wei: 1_000_000_000,
                max_priority_fee_per_gas_wei: 500_000_000,
                max_fee_per_gas_wei: 2_500_000_000,
            }
        );
        // 0.5 ETH + the fee.
        assert_eq!(quoted.total, Some("0.5000525".to_owned()));
    }

    #[test]
    fn base_usdc_costs_erc20_gas_and_is_paid_in_eth() {
        let validated = request(Chain::Base, Asset::Usdc, "25", BASE_ADDRESS)
            .validate()
            .unwrap();
        let quoted = quote(
            &validated,
            &NetworkFeeData::Base {
                base_fee_per_gas_wei: 1_000_000_000,
                max_priority_fee_per_gas_wei: 1_000_000_000,
            },
        )
        .unwrap();

        // 65_000 gas x 3 gwei = 0.000000195 ETH, charged in ETH for a USDC send.
        assert_eq!(quoted.fee_minor, "195000000000000");
        assert_eq!(quoted.fee_asset, Asset::Eth);
        assert_eq!(quoted.total_minor, None);
        assert!(matches!(
            quoted.breakdown,
            FeeBreakdown::Base {
                gas_limit: ERC20_TRANSFER_GAS_LIMIT,
                ..
            }
        ));
    }

    #[test]
    fn base_addresses_are_normalised_to_lowercase() {
        let validated = request(Chain::Base, Asset::Eth, "1", BASE_ADDRESS)
            .validate()
            .unwrap();
        assert_eq!(validated.destination, BASE_ADDRESS.to_ascii_lowercase());
    }

    // ── Bitcoin ──────────────────────────────────────────────────────────────

    #[test]
    fn bitcoin_fee_is_the_recommended_rate_times_the_transaction_size() {
        let validated = request(Chain::Bitcoin, Asset::Btc, "0.5", BITCOIN_BECH32)
            .validate()
            .unwrap();
        let quoted = quote(
            &validated,
            &NetworkFeeData::Bitcoin {
                fee_rate_sat_vb: 12,
            },
        )
        .unwrap();

        // 12 sat/vB x 141 vbytes.
        assert_eq!(quoted.fee_minor, "1692");
        assert_eq!(quoted.fee, "0.00001692");
        assert_eq!(quoted.fee_asset, Asset::Btc);
        assert_eq!(quoted.source, FeeSource::Esplora);
        assert_eq!(
            quoted.breakdown,
            FeeBreakdown::Bitcoin {
                fee_rate_sat_vb: 12,
                estimated_vsize: BITCOIN_P2WPKH_VSIZE,
            }
        );
        assert_eq!(quoted.total_minor.as_deref(), Some("50001692"));
    }

    /// On a UTXO chain the size of the transaction, not the amount, is what the
    /// fee buys — a larger amount must not change the quote.
    #[test]
    fn bitcoin_fee_does_not_depend_on_the_amount() {
        let small = request(Chain::Bitcoin, Asset::Btc, "0.01", BITCOIN_BECH32)
            .validate()
            .unwrap();
        let large = request(Chain::Bitcoin, Asset::Btc, "10", BITCOIN_BECH32)
            .validate()
            .unwrap();
        let data = NetworkFeeData::Bitcoin {
            fee_rate_sat_vb: 40,
        };

        assert_eq!(
            quote(&small, &data).unwrap().fee_minor,
            quote(&large, &data).unwrap().fee_minor
        );
    }

    // ── Cross-network safety ────────────────────────────────────────────────

    #[test]
    fn fee_data_from_the_wrong_network_is_refused() {
        let stellar = request(Chain::Stellar, Asset::Xlm, "1", &account(1))
            .validate()
            .unwrap();
        let bitcoin = quote(
            &stellar,
            &NetworkFeeData::Bitcoin {
                fee_rate_sat_vb: 12,
            },
        );
        assert_eq!(
            bitcoin,
            Err(QuoteError::WrongNetwork {
                requested: Chain::Stellar,
                data: Chain::Bitcoin,
            })
        );

        let base = request(Chain::Base, Asset::Eth, "1", BASE_ADDRESS)
            .validate()
            .unwrap();
        assert!(quote(&base, &stellar_fees()).is_err());
    }

    #[test]
    fn an_implausible_gas_price_is_refused_rather_than_quoted() {
        let validated = request(Chain::Base, Asset::Eth, "1", BASE_ADDRESS)
            .validate()
            .unwrap();
        let quoted = quote(
            &validated,
            &NetworkFeeData::Base {
                base_fee_per_gas_wei: u128::MAX,
                max_priority_fee_per_gas_wei: u128::MAX,
            },
        );
        assert_eq!(quoted, Err(QuoteError::Overflow));
    }

    // ── sat/vB parsing ──────────────────────────────────────────────────────

    #[test]
    fn whole_sat_per_vb_rates_pass_through() {
        assert_eq!(sat_per_vb("1").unwrap(), 1);
        assert_eq!(sat_per_vb("12").unwrap(), 12);
        assert_eq!(sat_per_vb(" 250 ").unwrap(), 250);
    }

    /// Esplora publishes fractional rates; rounding down would underprice the
    /// transaction, so every fraction rounds up.
    #[test]
    fn fractional_rates_round_up_never_down() {
        assert_eq!(sat_per_vb("12.3").unwrap(), 13);
        assert_eq!(sat_per_vb("0.0001").unwrap(), 1);
        assert_eq!(sat_per_vb("1.000001").unwrap(), 2);
        assert_eq!(sat_per_vb(".5").unwrap(), 1);
    }

    #[test]
    fn an_empty_mempool_rate_is_floored_at_one_sat_per_vb() {
        assert_eq!(sat_per_vb("0").unwrap(), MIN_BITCOIN_FEE_RATE_SAT_VB);
        assert_eq!(sat_per_vb("0.0").unwrap(), MIN_BITCOIN_FEE_RATE_SAT_VB);
    }

    #[test]
    fn rates_that_are_not_plain_decimals_are_refused() {
        for bad in [
            "",
            " ",
            "12 sat/vB",
            "-3",
            "+3",
            "1e-8",
            "0x10",
            "1,5",
            "NaN",
            ".",
        ] {
            assert!(sat_per_vb(bad).is_err(), "{bad:?} must be refused");
        }
        // More decimals than any indexer publishes.
        assert!(sat_per_vb("1.0000001").is_err());
        // Absurd, i.e. a misconfigured endpoint.
        assert!(sat_per_vb("999999").is_err());
    }

    // ── Request validation ───────────────────────────────────────────────────

    #[test]
    fn an_asset_off_its_network_is_refused() {
        assert_eq!(
            request(Chain::Base, Asset::Btc, "1", BITCOIN_BECH32).validate(),
            Err(RequestError::UnsupportedAsset {
                asset: Asset::Btc,
                chain: Chain::Base,
            })
        );
        assert!(
            request(Chain::Stellar, Asset::Eth, "1", &account(1))
                .validate()
                .is_err()
        );
        assert!(
            request(Chain::Bitcoin, Asset::Xlm, "1", BITCOIN_BECH32)
                .validate()
                .is_err()
        );
    }

    #[test]
    fn zero_and_negative_amounts_are_refused() {
        for bad in ["0", "0.0000000", "-1", ""] {
            assert!(
                matches!(
                    request(Chain::Bitcoin, Asset::Btc, bad, BITCOIN_BECH32).validate(),
                    Err(RequestError::NotPositive) | Err(RequestError::Amount(_))
                ),
                "{bad:?} must be refused"
            );
        }
    }

    /// Seven-decimal ledger USDC cannot be sent on 6-decimal Base: refused, not
    /// rounded.
    #[test]
    fn amounts_the_network_cannot_represent_are_refused() {
        let error = request(Chain::Base, Asset::Usdc, "0.0000001", BASE_ADDRESS).validate();
        assert!(matches!(
            error,
            Err(RequestError::Amount(MoneyError::NotRepresentable { .. }))
        ));
        // Six decimals is fine.
        assert!(
            request(Chain::Base, Asset::Usdc, "0.000001", BASE_ADDRESS)
                .validate()
                .is_ok()
        );
    }

    #[test]
    fn destinations_are_validated_per_network() {
        // A Stellar address on Base.
        assert!(matches!(
            request(Chain::Base, Asset::Eth, "1", &account(1)).validate(),
            Err(RequestError::Destination { .. })
        ));
        // Not a hex address.
        assert!(matches!(
            request(Chain::Base, Asset::Eth, "1", "0x1234").validate(),
            Err(RequestError::Destination { .. })
        ));
        // A truncated Stellar address: the strkey checksum catches it.
        assert!(matches!(
            request(Chain::Stellar, Asset::Xlm, "1", "GAAAA").validate(),
            Err(RequestError::Destination { .. })
        ));
        // Legacy P2PKH, an Ethereum address and an empty string on Bitcoin.
        for bad in ["1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", BASE_ADDRESS, "  "] {
            assert!(
                matches!(
                    request(Chain::Bitcoin, Asset::Btc, "1", bad).validate(),
                    Err(RequestError::Destination { .. })
                ),
                "{bad:?} must be refused"
            );
        }
        // Both accepted Bitcoin formats pass.
        assert!(
            request(Chain::Bitcoin, Asset::Btc, "1", BITCOIN_P2SH)
                .validate()
                .is_ok()
        );
        assert!(
            request(Chain::Bitcoin, Asset::Btc, "1", BITCOIN_BECH32)
                .validate()
                .is_ok()
        );
    }

    #[test]
    fn an_unknown_field_is_refused_rather_than_ignored() {
        let body = json!({
            "chain": "stellar",
            "asset": "XLM",
            "amount": "1",
            "destination": account(1),
            "amount_minor": 10000000,
        });
        assert!(serde_json::from_value::<EstimateFeeRequest>(body).is_err());
    }

    #[test]
    fn the_wire_format_is_explicit_about_what_it_accepts() {
        // Asset symbols are case-insensitive; chain names are the exact
        // lowercase names the domain uses, so nothing is guessed.
        let parsed: EstimateFeeRequest = serde_json::from_value(json!({
            "chain": "stellar",
            "asset": "xlm",
            "amount": "1",
            "destination": account(1),
        }))
        .unwrap();
        assert_eq!(parsed.chain, Chain::Stellar);
        assert_eq!(parsed.asset, Asset::Xlm);
        assert!(
            serde_json::from_value::<EstimateFeeRequest>(json!({
                "chain": "Stellar",
                "asset": "XLM",
                "amount": "1",
                "destination": account(1),
            }))
            .is_err()
        );
    }

    // ── Fee sources ──────────────────────────────────────────────────────────

    #[tokio::test]
    async fn stellar_quotes_need_no_configured_endpoint() {
        let quotes = FeeQuotes::new(None, None).unwrap();
        assert_eq!(
            quotes.fees(Chain::Stellar).await.unwrap(),
            stellar_fees(),
            "the base reserve and per-operation fee are network constants"
        );
    }

    #[tokio::test]
    async fn a_chain_without_an_endpoint_reports_not_implemented() {
        let quotes = FeeQuotes::new(None, None).unwrap();
        assert!(matches!(
            quotes.fees(Chain::Base).await,
            Err(ChainError::NotImplemented)
        ));
        assert!(matches!(
            quotes.fees(Chain::Bitcoin).await,
            Err(ChainError::NotImplemented)
        ));
    }

    #[tokio::test]
    async fn base_prices_are_read_from_eth_fee_history() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    // Six base fees for five blocks: the last is the block the
                    // transaction would land in.
                    "baseFeePerGas": [
                        "0x3b9aca00", "0x3b9aca00", "0x3b9aca00", "0x3b9aca00",
                        "0x3b9aca00", "0x77359400"
                    ],
                    "gasUsedRatio": [0.5, 0.5, 0.5, 0.5, 0.5],
                    "reward": []
                }
            })))
            .mount(&server)
            .await;

        let fees = BaseRpcFees::new(&format!("{}/rpc", server.uri())).unwrap();
        assert_eq!(
            fees.fees(Chain::Base).await.unwrap(),
            NetworkFeeData::Base {
                base_fee_per_gas_wei: 2_000_000_000,
                max_priority_fee_per_gas_wei: DEFAULT_MAX_PRIORITY_FEE_WEI,
            }
        );
    }

    #[tokio::test]
    async fn an_rpc_error_is_surfaced_as_a_rejection() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "error": { "code": -32601, "message": "method not found" },
            })))
            .mount(&server)
            .await;

        let fees = BaseRpcFees::new(&server.uri()).unwrap();
        assert!(matches!(
            fees.fees(Chain::Base).await,
            Err(ChainError::Rejected(_))
        ));
    }

    #[tokio::test]
    async fn a_node_that_reports_no_base_fee_is_an_error_not_a_zero_fee_quote() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({ "jsonrpc": "2.0", "id": 1, "result": {} })),
            )
            .mount(&server)
            .await;

        let fees = BaseRpcFees::new(&server.uri()).unwrap();
        assert!(matches!(
            fees.fees(Chain::Base).await,
            Err(ChainError::Unavailable(_))
        ));
    }

    #[tokio::test]
    async fn bitcoin_rates_are_read_from_esplora_and_rounded_up() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/fee-estimates"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({ "1": 25.4, "6": "12.3", "144": 1 })),
            )
            .mount(&server)
            .await;

        let fees = EsploraFees::new(&format!("{}/api/", server.uri())).unwrap();
        assert_eq!(
            fees.fees(Chain::Bitcoin).await.unwrap(),
            NetworkFeeData::Bitcoin {
                fee_rate_sat_vb: 13
            }
        );
    }

    #[tokio::test]
    async fn a_missing_confirmation_target_is_an_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "1": 25 })))
            .mount(&server)
            .await;

        let fees = EsploraFees::new(&server.uri()).unwrap();
        assert!(matches!(
            fees.fees(Chain::Bitcoin).await,
            Err(ChainError::Unavailable(_))
        ));
    }

    // ── Handler ─────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn the_endpoint_quotes_a_stellar_transfer() {
        let app = router(Arc::new(FakeOracle(stellar_fees())));
        let (status, body) = post(
            app,
            json!({
                "chain": "stellar",
                "asset": "XLM",
                "amount": "2",
                "destination": account(1),
            }),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["chain"], "stellar");
        assert_eq!(body["asset"], "XLM");
        assert_eq!(body["fee_asset"], "XLM");
        // Amounts leave as strings so no client can read them as floats.
        assert_eq!(body["fee_minor"], "5000100");
        assert_eq!(body["fee"], "0.50001");
        assert_eq!(body["total_minor"], "25000100");
        assert_eq!(body["source"], "network_constant");
        assert_eq!(body["breakdown"]["network"], "stellar");
        assert_eq!(body["breakdown"]["base_reserve_minor"], 5_000_000);
        assert_eq!(body["breakdown"]["operations"], 1);
        assert_eq!(body["expires_in_seconds"], 30);
    }

    #[tokio::test]
    async fn the_endpoint_reports_the_network_each_fee_is_paid_in() {
        let app = router(Arc::new(FakeOracle(NetworkFeeData::Bitcoin {
            fee_rate_sat_vb: 12,
        })));
        let (status, body) = post(
            app,
            json!({
                "chain": "bitcoin",
                "asset": "BTC",
                "amount": "0.5",
                "destination": BITCOIN_BECH32,
            }),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["fee_asset"], "BTC");
        assert_eq!(body["fee_minor"], "1692");
        assert_eq!(body["breakdown"]["network"], "bitcoin");
        assert_eq!(body["breakdown"]["fee_rate_sat_vb"], 12);
        assert_eq!(body["source"], "esplora");
    }

    #[tokio::test]
    async fn an_invalid_request_is_a_bad_request() {
        let app = router(Arc::new(FakeOracle(stellar_fees())));
        let (status, body) = post(
            app,
            json!({
                "chain": "base",
                "asset": "BTC",
                "amount": "1",
                "destination": BITCOIN_BECH32,
            }),
        )
        .await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"]["code"], "bad_request");
        assert_eq!(body["error"]["message"], "BTC cannot be sent on Base");
    }

    #[tokio::test]
    async fn a_malformed_body_never_reaches_the_fee_source() {
        let app = router(Arc::new(FakeOracle(stellar_fees())));
        let (status, body) = post(app, json!({ "chain": "stellar" })).await;

        assert!(
            status.is_client_error(),
            "{status} should be a client error"
        );
        // Every failure, including an unreadable body, uses one error shape.
        assert_eq!(body["error"]["code"], "bad_request");
        assert!(body["error"]["message"].is_string());
    }

    #[tokio::test]
    async fn a_chain_with_no_configured_source_is_unavailable() {
        // No endpoints configured: Base has nothing to read a price from, and
        // the quote must say so rather than invent one.
        let app = router(Arc::new(FeeQuotes::new(None, None).unwrap()));
        let (status, body) = post(
            app,
            json!({
                "chain": "base",
                "asset": "ETH",
                "amount": "1",
                "destination": BASE_ADDRESS,
            }),
        )
        .await;

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["error"]["code"], "not_configured");
    }

    #[tokio::test]
    async fn an_unreachable_upstream_is_reported_as_unavailable() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(502).set_body_string("bad gateway"))
            .mount(&server)
            .await;

        let app = router(Arc::new(FeeQuotes::new(Some(server.uri()), None).unwrap()));
        let (status, body) = post(
            app,
            json!({
                "chain": "base",
                "asset": "ETH",
                "amount": "1",
                "destination": BASE_ADDRESS,
            }),
        )
        .await;

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["error"]["code"], "upstream_unavailable");
    }
}
