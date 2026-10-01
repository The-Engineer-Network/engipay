//! `GET /internal/balances` — live on-chain reserves of every custody account.
//!
//! # Response `200 OK`
//!
//! ```json
//! {
//!   "stellar_xlm":  { "amount": "1520.25",  "minor": "15202500000" },
//!   "stellar_usdc": { "amount": "300",      "minor": "3000000000" },
//!   "base_eth":     { "amount": "0.42",     "minor": "420000000000000000" },
//!   "base_usdc":    { "amount": "1000.5",   "minor": "10005000000" },
//!   "bitcoin_btc":  null,
//!   "errors":       { "bitcoin_btc": "BITCOIN_CUSTODY_ADDRESS is not set" }
//! }
//! ```
//!
//! `amount` is an exact decimal and `minor` the ledger's smallest units, as a
//! string because it can exceed what JSON numbers hold exactly. A reserve that
//! is not configured or could not be read is `null`, with the reason under
//! `errors`, so one unreachable node never hides the others.
//!
//! # Sources
//!
//! | Field          | Source                                                    |
//! |----------------|-----------------------------------------------------------|
//! | `stellar_xlm`  | Horizon `/accounts/{STELLAR_CUSTODY_ACCOUNT}`, native     |
//! | `stellar_usdc` | same account, USDC from Circle's issuer only (alphanum4)  |
//! | `base_eth`     | `eth_getBalance(BASE_CUSTODY_ADDRESS)` on `BASE_RPC_URL`  |
//! | `base_usdc`    | `balanceOf(BASE_CUSTODY_ADDRESS)` on Circle's Base USDC   |
//! | `bitcoin_btc`  | sum of confirmed UTXOs of `BITCOIN_CUSTODY_ADDRESS` from Esplora |

use std::collections::BTreeMap;
use std::env;
use std::time::Duration;

use axum::routing::get;
use axum::{Json, Router};
use engipay_core::{Asset, Chain, Money};
use serde::{Deserialize, Serialize};

use crate::stellar::StellarNetwork;

/// Circle's native USDC on Base mainnet and Base Sepolia.
const BASE_MAINNET_USDC: &str = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BASE_SEPOLIA_USDC: &str = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
/// `balanceOf(address)` selector.
const BALANCE_OF: &str = "70a08231";

pub fn routes() -> Router {
    Router::new().route("/internal/balances", get(handle_balances))
}

/// One reserve: exact decimal and smallest units.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reserve {
    pub amount: String,
    pub minor: String,
}

impl From<Money> for Reserve {
    fn from(money: Money) -> Self {
        Self {
            amount: money.decimal(),
            minor: money.minor.to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BalancesResponse {
    pub stellar_xlm: Option<Reserve>,
    pub stellar_usdc: Option<Reserve>,
    pub base_eth: Option<Reserve>,
    pub base_usdc: Option<Reserve>,
    pub bitcoin_btc: Option<Reserve>,
    /// Why a reserve is `null`, keyed by field name. Empty when all were read.
    pub errors: BTreeMap<String, String>,
}

/// Where each reserve is read from. Built from the environment in production
/// and pointed at mock nodes in tests.
#[derive(Debug, Clone, Default)]
pub struct Sources {
    pub stellar: Option<StellarSource>,
    pub base: Option<BaseSource>,
    pub bitcoin: Option<BitcoinSource>,
}

#[derive(Debug, Clone)]
pub struct StellarSource {
    pub horizon_url: String,
    pub account: String,
    pub network: StellarNetwork,
}

#[derive(Debug, Clone)]
pub struct BaseSource {
    pub rpc_url: String,
    pub address: String,
    pub usdc_contract: String,
}

#[derive(Debug, Clone)]
pub struct BitcoinSource {
    pub esplora_url: String,
    pub address: String,
}

/// Why a reserve could not be read.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ReserveError {
    #[error("{0} is not set")]
    NotConfigured(&'static str),
    #[error("could not reach the node: {0}")]
    Unreachable(String),
    #[error("the node returned an unexpected response: {0}")]
    Unexpected(String),
}

fn configured(name: &'static str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

impl Sources {
    /// Reads every source from the environment; a missing one stays `None`
    /// and is reported per reserve.
    pub fn from_env() -> Self {
        let stellar_network = configured("STELLAR_NETWORK")
            .and_then(|value| StellarNetwork::parse(&value))
            .unwrap_or(StellarNetwork::Testnet);
        let base_mainnet = configured("BASE_NETWORK").is_some_and(|value| value == "mainnet");

        Self {
            stellar: configured("STELLAR_CUSTODY_ACCOUNT").map(|account| StellarSource {
                horizon_url: configured("STELLAR_HORIZON_URL")
                    .unwrap_or_else(|| stellar_network.default_horizon_url().to_owned()),
                account,
                network: stellar_network,
            }),
            base: configured("BASE_CUSTODY_ADDRESS").map(|address| BaseSource {
                rpc_url: configured("BASE_RPC_URL").unwrap_or_else(|| {
                    if base_mainnet {
                        "https://mainnet.base.org".to_owned()
                    } else {
                        "https://sepolia.base.org".to_owned()
                    }
                }),
                address,
                usdc_contract: if base_mainnet {
                    BASE_MAINNET_USDC
                } else {
                    BASE_SEPOLIA_USDC
                }
                .to_owned(),
            }),
            bitcoin: configured("BITCOIN_CUSTODY_ADDRESS").map(|address| BitcoinSource {
                esplora_url: configured("BITCOIN_ESPLORA_URL")
                    .unwrap_or_else(|| "https://blockstream.info/api".to_owned()),
                address,
            }),
        }
    }
}

async fn handle_balances() -> Json<BalancesResponse> {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(concat!("engipay-chain/", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_default();
    Json(collect_balances(&http, &Sources::from_env()).await)
}

/// Reads every reserve concurrently.
pub async fn collect_balances(http: &reqwest::Client, sources: &Sources) -> BalancesResponse {
    let stellar = async {
        match &sources.stellar {
            Some(source) => fetch_stellar(http, source).await,
            None => Err(ReserveError::NotConfigured("STELLAR_CUSTODY_ACCOUNT")),
        }
    };
    let base_eth = async {
        match &sources.base {
            Some(source) => fetch_base_eth(http, source).await,
            None => Err(ReserveError::NotConfigured("BASE_CUSTODY_ADDRESS")),
        }
    };
    let base_usdc = async {
        match &sources.base {
            Some(source) => fetch_base_usdc(http, source).await,
            None => Err(ReserveError::NotConfigured("BASE_CUSTODY_ADDRESS")),
        }
    };
    let bitcoin = async {
        match &sources.bitcoin {
            Some(source) => fetch_bitcoin(http, source).await,
            None => Err(ReserveError::NotConfigured("BITCOIN_CUSTODY_ADDRESS")),
        }
    };
    let (stellar, base_eth, base_usdc, bitcoin) =
        tokio::join!(stellar, base_eth, base_usdc, bitcoin);

    let mut response = BalancesResponse::default();
    let mut put = |field: &'static str, result: Result<Money, ReserveError>| match result {
        Ok(money) => Some(Reserve::from(money)),
        Err(error) => {
            response.errors.insert(field.to_owned(), error.to_string());
            None
        }
    };
    let (xlm, usdc) = match stellar {
        Ok((xlm, usdc)) => (Ok(xlm), Ok(usdc)),
        Err(error) => (Err(error.clone()), Err(error)),
    };
    let stellar_xlm = put("stellar_xlm", xlm);
    let stellar_usdc = put("stellar_usdc", usdc);
    let base_eth = put("base_eth", base_eth);
    let base_usdc = put("base_usdc", base_usdc);
    let bitcoin_btc = put("bitcoin_btc", bitcoin);

    response.stellar_xlm = stellar_xlm;
    response.stellar_usdc = stellar_usdc;
    response.base_eth = base_eth;
    response.base_usdc = base_usdc;
    response.bitcoin_btc = bitcoin_btc;
    response
}

// ─── Fetching ────────────────────────────────────────────────────────────────

fn unreachable(error: reqwest::Error) -> ReserveError {
    ReserveError::Unreachable(error.to_string())
}

async fn get_json<T: serde::de::DeserializeOwned>(
    http: &reqwest::Client,
    url: &str,
) -> Result<T, ReserveError> {
    http.get(url)
        .send()
        .await
        .map_err(unreachable)?
        .error_for_status()
        .map_err(unreachable)?
        .json()
        .await
        .map_err(|error| ReserveError::Unexpected(error.to_string()))
}

async fn rpc(
    http: &reqwest::Client,
    url: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<String, ReserveError> {
    #[derive(Deserialize)]
    struct Response {
        #[serde(default)]
        result: Option<String>,
        #[serde(default)]
        error: Option<serde_json::Value>,
    }
    let body = serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let response: Response = http
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(unreachable)?
        .error_for_status()
        .map_err(unreachable)?
        .json()
        .await
        .map_err(|error| ReserveError::Unexpected(error.to_string()))?;
    match (response.result, response.error) {
        (_, Some(error)) => Err(ReserveError::Unexpected(format!(
            "{method} failed: {error}"
        ))),
        (Some(result), None) => Ok(result),
        (None, None) => Err(ReserveError::Unexpected(format!(
            "{method} returned no result"
        ))),
    }
}

async fn fetch_stellar(
    http: &reqwest::Client,
    source: &StellarSource,
) -> Result<(Money, Money), ReserveError> {
    let url = format!(
        "{}/accounts/{}",
        source.horizon_url.trim_end_matches('/'),
        source.account
    );
    let account: HorizonAccount = get_json(http, &url).await?;
    parse_stellar_balances(&account, source.network)
}

async fn fetch_base_eth(
    http: &reqwest::Client,
    source: &BaseSource,
) -> Result<Money, ReserveError> {
    let wei = rpc(
        http,
        &source.rpc_url,
        "eth_getBalance",
        serde_json::json!([source.address, "latest"]),
    )
    .await?;
    parse_base_eth(&wei)
}

async fn fetch_base_usdc(
    http: &reqwest::Client,
    source: &BaseSource,
) -> Result<Money, ReserveError> {
    let data = balance_of_call(&source.address)?;
    let units = rpc(
        http,
        &source.rpc_url,
        "eth_call",
        serde_json::json!([{ "to": source.usdc_contract, "data": data }, "latest"]),
    )
    .await?;
    parse_base_usdc(&units)
}

async fn fetch_bitcoin(
    http: &reqwest::Client,
    source: &BitcoinSource,
) -> Result<Money, ReserveError> {
    let url = format!(
        "{}/address/{}/utxo",
        source.esplora_url.trim_end_matches('/'),
        source.address
    );
    let utxos: Vec<EsploraUtxo> = get_json(http, &url).await?;
    sum_confirmed_utxos(&utxos)
}

// ─── Parsing (pure) ──────────────────────────────────────────────────────────

/// The part of a Horizon account record that holds balances.
#[derive(Debug, Deserialize)]
pub struct HorizonAccount {
    pub balances: Vec<HorizonBalance>,
}

#[derive(Debug, Deserialize)]
pub struct HorizonBalance {
    pub asset_type: String,
    #[serde(default)]
    pub asset_code: Option<String>,
    #[serde(default)]
    pub asset_issuer: Option<String>,
    /// Decimal string with 7 places, e.g. `"100.0000000"`.
    pub balance: String,
}

/// XLM and real USDC held by a Stellar account. USDC counts only from
/// Circle's issuer as an alphanum4 asset; any other "USDC" is ignored. An
/// account with no USDC trustline holds zero USDC.
pub fn parse_stellar_balances(
    account: &HorizonAccount,
    network: StellarNetwork,
) -> Result<(Money, Money), ReserveError> {
    let mut xlm = None;
    let mut usdc = Money::zero(Asset::Usdc);
    for entry in &account.balances {
        let parse = |asset| {
            Money::parse(asset, &entry.balance).map_err(|_| {
                ReserveError::Unexpected(format!("unparseable balance {:?}", entry.balance))
            })
        };
        match entry.asset_type.as_str() {
            "native" => xlm = Some(parse(Asset::Xlm)?),
            "credit_alphanum4"
                if entry.asset_code.as_deref() == Some("USDC")
                    && entry.asset_issuer.as_deref() == Some(network.usdc_issuer()) =>
            {
                usdc = parse(Asset::Usdc)?;
            }
            _ => {}
        }
    }
    let xlm = xlm.ok_or_else(|| ReserveError::Unexpected("account has no XLM balance".into()))?;
    Ok((xlm, usdc))
}

/// ETH from an `eth_getBalance` result: hex wei.
pub fn parse_base_eth(hex: &str) -> Result<Money, ReserveError> {
    let wei = parse_quantity(hex)?;
    Money::from_network_units(Asset::Eth, Chain::Base, wei)
        .map_err(|error| ReserveError::Unexpected(error.to_string()))
}

/// USDC from a `balanceOf` result: a 32-byte hex word of 6-decimal units.
pub fn parse_base_usdc(hex: &str) -> Result<Money, ReserveError> {
    let units = parse_quantity(hex)?;
    Money::from_network_units(Asset::Usdc, Chain::Base, units)
        .map_err(|error| ReserveError::Unexpected(error.to_string()))
}

/// A `0x` hex quantity or word as an exact integer. Anything that does not fit
/// an `i128` is refused rather than truncated: no real reserve is that large.
pub fn parse_quantity(hex: &str) -> Result<i128, ReserveError> {
    let digits = hex
        .trim()
        .strip_prefix("0x")
        .ok_or_else(|| ReserveError::Unexpected(format!("not a hex quantity: {hex:?}")))?;
    let digits = digits.trim_start_matches('0');
    if digits.is_empty() {
        return Ok(0);
    }
    if digits.len() > 31 {
        return Err(ReserveError::Unexpected(format!(
            "quantity too large: {hex:?}"
        )));
    }
    i128::from_str_radix(digits, 16)
        .map_err(|_| ReserveError::Unexpected(format!("not a hex quantity: {hex:?}")))
}

/// `balanceOf(address)` call data for `address`.
pub fn balance_of_call(address: &str) -> Result<String, ReserveError> {
    let hex = address.trim().strip_prefix("0x").unwrap_or(address.trim());
    if hex.len() != 40 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ReserveError::Unexpected(
            "BASE_CUSTODY_ADDRESS is not a 0x address".into(),
        ));
    }
    Ok(format!("0x{BALANCE_OF}{:0>64}", hex.to_ascii_lowercase()))
}

/// One UTXO as Esplora reports it.
#[derive(Debug, Deserialize)]
pub struct EsploraUtxo {
    /// Satoshis.
    pub value: u64,
    pub status: EsploraStatus,
}

#[derive(Debug, Deserialize)]
pub struct EsploraStatus {
    pub confirmed: bool,
}

/// BTC held in confirmed UTXOs. Unconfirmed outputs are not reserves yet.
pub fn sum_confirmed_utxos(utxos: &[EsploraUtxo]) -> Result<Money, ReserveError> {
    let mut sats: i128 = 0;
    for utxo in utxos.iter().filter(|utxo| utxo.status.confirmed) {
        sats = sats
            .checked_add(i128::from(utxo.value))
            .ok_or_else(|| ReserveError::Unexpected("UTXO sum overflows".into()))?;
    }
    Money::from_network_units(Asset::Btc, Chain::Bitcoin, sats)
        .map_err(|error| ReserveError::Unexpected(error.to_string()))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use wiremock::matchers::{body_partial_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    const CUSTODY_G: &str = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
    const CUSTODY_0X: &str = "0x00000000000000000000000000000000000000AB";

    fn horizon_account() -> serde_json::Value {
        serde_json::json!({
            "id": CUSTODY_G,
            "balances": [
                {
                    "asset_type": "credit_alphanum4",
                    "asset_code": "USDC",
                    "asset_issuer": StellarNetwork::Testnet.usdc_issuer(),
                    "balance": "300.0000000"
                },
                {
                    // Counterfeit: right code, wrong issuer.
                    "asset_type": "credit_alphanum4",
                    "asset_code": "USDC",
                    "asset_issuer": CUSTODY_G,
                    "balance": "999999.0000000"
                },
                {
                    // Right code and issuer, but alphanum12: not Circle's USDC.
                    "asset_type": "credit_alphanum12",
                    "asset_code": "USDC",
                    "asset_issuer": StellarNetwork::Testnet.usdc_issuer(),
                    "balance": "5.0000000"
                },
                { "asset_type": "native", "balance": "1520.2500000" }
            ]
        })
    }

    // ── Parsing ─────────────────────────────────────────────────────────────

    #[test]
    fn stellar_counts_xlm_and_only_circles_usdc() {
        let account: HorizonAccount = serde_json::from_value(horizon_account()).unwrap();
        let (xlm, usdc) = parse_stellar_balances(&account, StellarNetwork::Testnet).unwrap();
        assert_eq!(xlm, Money::parse(Asset::Xlm, "1520.25").unwrap());
        assert_eq!(usdc, Money::parse(Asset::Usdc, "300").unwrap());
    }

    #[test]
    fn stellar_without_a_usdc_trustline_holds_zero_usdc() {
        let account: HorizonAccount = serde_json::from_value(serde_json::json!({
            "balances": [{ "asset_type": "native", "balance": "1.0000000" }]
        }))
        .unwrap();
        let (_, usdc) = parse_stellar_balances(&account, StellarNetwork::Mainnet).unwrap();
        assert!(usdc.is_zero());
    }

    #[test]
    fn stellar_garbage_balances_are_refused() {
        let account: HorizonAccount = serde_json::from_value(serde_json::json!({
            "balances": [{ "asset_type": "native", "balance": "1e9" }]
        }))
        .unwrap();
        assert!(parse_stellar_balances(&account, StellarNetwork::Testnet).is_err());
    }

    #[test]
    fn base_eth_is_exact_wei() {
        // 0.42 ETH = 420_000_000_000_000_000 wei.
        let eth = parse_base_eth("0x5d423c655aa0000").unwrap();
        assert_eq!(eth, Money::parse(Asset::Eth, "0.42").unwrap());
        assert!(parse_base_eth("0x0").unwrap().is_zero());
    }

    #[test]
    fn base_usdc_scales_six_decimals_to_the_ledger() {
        // 1000.5 USDC = 1_000_500_000 units of 6 decimals, as a 32-byte word.
        let word = format!("0x{:064x}", 1_000_500_000u64);
        let usdc = parse_base_usdc(&word).unwrap();
        assert_eq!(usdc, Money::parse(Asset::Usdc, "1000.5").unwrap());
        assert_eq!(usdc.minor, 10_005_000_000);
    }

    #[test]
    fn quantities_that_are_not_hex_or_too_large_are_refused() {
        assert!(parse_quantity("1234").is_err());
        assert!(parse_quantity("0xzz").is_err());
        assert!(parse_quantity(&format!("0x{}", "f".repeat(64))).is_err());
        assert_eq!(parse_quantity("0x").unwrap(), 0);
    }

    #[test]
    fn balance_of_call_data_pads_the_address() {
        assert_eq!(
            balance_of_call(CUSTODY_0X).unwrap(),
            "0x70a08231000000000000000000000000\
             00000000000000000000000000000000000000ab"
        );
        assert!(balance_of_call("not an address").is_err());
    }

    #[test]
    fn bitcoin_sums_only_confirmed_utxos() {
        let utxos: Vec<EsploraUtxo> = serde_json::from_value(serde_json::json!([
            { "txid": "a", "vout": 0, "value": 150_000_000, "status": { "confirmed": true } },
            { "txid": "b", "vout": 1, "value": 25_000_000, "status": { "confirmed": true } },
            { "txid": "c", "vout": 0, "value": 99, "status": { "confirmed": false } }
        ]))
        .unwrap();
        assert_eq!(
            sum_confirmed_utxos(&utxos).unwrap(),
            Money::parse(Asset::Btc, "1.75").unwrap()
        );
    }

    // ── Against mock nodes ──────────────────────────────────────────────────

    async fn mock_nodes() -> (MockServer, MockServer, MockServer) {
        let horizon = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(format!("/accounts/{CUSTODY_G}")))
            .respond_with(ResponseTemplate::new(200).set_body_json(horizon_account()))
            .mount(&horizon)
            .await;

        let base = MockServer::start().await;
        Mock::given(method("POST"))
            .and(body_partial_json(
                serde_json::json!({ "method": "eth_getBalance" }),
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 1, "result": "0x5d423c655aa0000"
            })))
            .mount(&base)
            .await;
        Mock::given(method("POST"))
            .and(body_partial_json(serde_json::json!({
                "method": "eth_call",
                "params": [{ "to": BASE_SEPOLIA_USDC }, "latest"]
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 1,
                "result": format!("0x{:064x}", 1_000_500_000u64)
            })))
            .mount(&base)
            .await;

        let esplora = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/address/bc1qcustody/utxo"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                { "txid": "a", "vout": 0, "value": 150_000_000, "status": { "confirmed": true } },
                { "txid": "b", "vout": 0, "value": 5, "status": { "confirmed": false } }
            ])))
            .mount(&esplora)
            .await;

        (horizon, base, esplora)
    }

    fn sources(horizon: &MockServer, base: &MockServer, esplora: &MockServer) -> Sources {
        Sources {
            stellar: Some(StellarSource {
                horizon_url: horizon.uri(),
                account: CUSTODY_G.to_owned(),
                network: StellarNetwork::Testnet,
            }),
            base: Some(BaseSource {
                rpc_url: base.uri(),
                address: CUSTODY_0X.to_owned(),
                usdc_contract: BASE_SEPOLIA_USDC.to_owned(),
            }),
            bitcoin: Some(BitcoinSource {
                esplora_url: esplora.uri(),
                address: "bc1qcustody".to_owned(),
            }),
        }
    }

    #[tokio::test]
    async fn reads_every_reserve_from_its_node() {
        let (horizon, base, esplora) = mock_nodes().await;
        let response =
            collect_balances(&reqwest::Client::new(), &sources(&horizon, &base, &esplora)).await;

        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["stellar_xlm"]["amount"], "1520.25");
        assert_eq!(json["stellar_xlm"]["minor"], "15202500000");
        assert_eq!(json["stellar_usdc"]["amount"], "300");
        assert_eq!(json["base_eth"]["amount"], "0.42");
        assert_eq!(json["base_eth"]["minor"], "420000000000000000");
        assert_eq!(json["base_usdc"]["amount"], "1000.5");
        assert_eq!(json["base_usdc"]["minor"], "10005000000");
        assert_eq!(json["bitcoin_btc"]["amount"], "1.5");
        assert_eq!(json["bitcoin_btc"]["minor"], "150000000");
    }

    #[tokio::test]
    async fn an_unreachable_node_only_nulls_its_own_reserves() {
        let (horizon, base, esplora) = mock_nodes().await;
        let mut sources = sources(&horizon, &base, &esplora);
        // Nothing listens on port 9 (discard) in the test environment.
        sources.bitcoin = Some(BitcoinSource {
            esplora_url: "http://127.0.0.1:9".to_owned(),
            address: "bc1qcustody".to_owned(),
        });

        let response = collect_balances(&reqwest::Client::new(), &sources).await;
        assert!(response.bitcoin_btc.is_none());
        assert!(response.errors["bitcoin_btc"].starts_with("could not reach the node"));
        assert!(response.stellar_xlm.is_some());
        assert!(response.base_usdc.is_some());
    }

    #[tokio::test]
    async fn an_rpc_error_is_reported_not_hidden() {
        let base = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 1, "error": { "code": -32000, "message": "header not found" }
            })))
            .mount(&base)
            .await;
        let sources = Sources {
            base: Some(BaseSource {
                rpc_url: base.uri(),
                address: CUSTODY_0X.to_owned(),
                usdc_contract: BASE_SEPOLIA_USDC.to_owned(),
            }),
            ..Sources::default()
        };

        let response = collect_balances(&reqwest::Client::new(), &sources).await;
        assert!(response.base_eth.is_none());
        assert!(response.errors["base_eth"].contains("header not found"));
    }

    #[tokio::test]
    async fn unconfigured_reserves_say_which_variable_is_missing() {
        let response = collect_balances(&reqwest::Client::new(), &Sources::default()).await;
        assert_eq!(
            response.errors["stellar_xlm"],
            "STELLAR_CUSTODY_ACCOUNT is not set"
        );
        assert_eq!(
            response.errors["base_usdc"],
            "BASE_CUSTODY_ADDRESS is not set"
        );
        assert_eq!(
            response.errors["bitcoin_btc"],
            "BITCOIN_CUSTODY_ADDRESS is not set"
        );
        let json = serde_json::to_value(&response).unwrap();
        assert!(json["stellar_xlm"].is_null());
    }

    #[tokio::test]
    async fn the_route_is_served_under_internal() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;

        let response = crate::routes::internal()
            .oneshot(
                Request::get("/internal/balances")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}
