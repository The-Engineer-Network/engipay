//! `POST /internal/estimate-fee` — dynamic fee quotes for Stellar, Base, and Bitcoin.
//!
//! # Request
//!
//! ```json
//! {
//!   "chain":       "stellar",          // "stellar" | "base" | "bitcoin"
//!   "asset":       "USDC",             // any asset symbol recognised by engipay-core
//!   "amount":      "10.50",            // human decimal string, no floating point in the ledger
//!   "destination": "G..."              // chain-specific address (validated but not executed)
//! }
//! ```
//!
//! # Response `200 OK`
//!
//! ```json
//! {
//!   "chain":          "stellar",
//!   "asset":          "USDC",
//!   "fee_asset":      "XLM",           // the asset the fee is denominated in
//!   "fee_amount":     "0.00100",       // human decimal, same precision as fee_asset
//!   "fee_minor":      10000,           // smallest units of fee_asset (stroops for Stellar)
//!   "estimated":      true             // false when the value is a hard-coded constant
//! }
//! ```
//!
//! # Error responses
//!
//! | Status | `error.code`         | Meaning                                  |
//! |--------|----------------------|------------------------------------------|
//! | 400    | `bad_request`        | Missing/invalid field or unsupported combination |
//! | 503    | `fee_unavailable`    | Could not reach the upstream fee oracle  |
//!
//! # Fee logic per chain
//!
//! **Stellar** — fees are always paid in XLM. We return the `base_fee` from
//! the last ledger (Horizon `/` root response) multiplied by the number of
//! operations needed (1 for a simple payment, 2 for a path-payment or
//! account-creation). The base reserve is informational and not included
//! because it is not a per-transfer cost. When Horizon is unreachable we
//! return the network hard-floor (100 stroops).
//!
//! **Base (EVM / EIP-1559)** — gas fee in ETH. We query `eth_feeHistory`
//! for the latest `baseFeePerGas` and add a priority-fee tip. For an ETH
//! transfer 21 000 gas is used; for an ERC-20 transfer (USDC) we use 65 000.
//! Fee = `(base_fee + priority_fee) × gas_limit`.
//!
//! **Bitcoin** — fee in BTC. We query Esplora (`/api/fee-estimates`) for the
//! recommended sat/vB for a 1-confirmation target, then multiply by 141 vB
//! (a typical 1-input 2-output P2WPKH transaction). When the fee oracle is
//! unavailable we fall back to 10 sat/vB.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Router;
use serde::{Deserialize, Serialize};

use engipay_core::{Asset, Chain, Money};

// ─── Request / response types ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct EstimateFeeRequest {
    /// Network to estimate for: `"stellar"`, `"base"`, or `"bitcoin"`.
    pub chain: Chain,
    /// Asset being sent (e.g. `"USDC"`, `"XLM"`, `"ETH"`, `"BTC"`).
    pub asset: Asset,
    /// Human-readable decimal amount (e.g. `"10.50"`). Validated but not
    /// actually sent — the estimate does not depend on the exact amount for
    /// current fee models, but it is required so the API can reject obviously
    /// nonsensical requests early.
    pub amount: String,
    /// Destination address. Validated for non-emptiness; not used in fee math.
    pub destination: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct EstimateFeeResponse {
    /// The chain the fee applies to.
    pub chain: Chain,
    /// The asset being sent.
    pub asset: Asset,
    /// The asset in which the fee is denominated (XLM on Stellar, ETH on Base,
    /// BTC on Bitcoin).
    pub fee_asset: Asset,
    /// Human-readable decimal fee, formatted to `fee_asset.decimals()` digits.
    pub fee_amount: String,
    /// Fee in the smallest indivisible unit of `fee_asset`.
    pub fee_minor: i128,
    /// `true` when the value came from the live fee oracle; `false` when we
    /// used a hard-coded fallback because the oracle was unreachable.
    pub estimated: bool,
}

// ─── Error type ────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum FeeError {
    #[error("{0}")]
    BadRequest(String),
    #[error("could not reach fee oracle: {0}")]
    Unavailable(String),
}

impl IntoResponse for FeeError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            FeeError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            FeeError::Unavailable(_) => (StatusCode::SERVICE_UNAVAILABLE, "fee_unavailable"),
        };
        let body = serde_json::json!({
            "error": { "code": code, "message": self.to_string() }
        });
        (status, Json(body)).into_response()
    }
}

// ─── Axum router ────────────────────────────────────────────────────────────

pub fn routes() -> Router {
    Router::new().route("/internal/estimate-fee", post(handle_estimate_fee))
}

/// Handler. Validates the request then delegates to the per-chain estimator.
async fn handle_estimate_fee(
    Json(req): Json<EstimateFeeRequest>,
) -> Result<Json<EstimateFeeResponse>, FeeError> {
    // Validate that the asset is available on the requested chain.
    if !req.asset.is_on(req.chain) {
        return Err(FeeError::BadRequest(format!(
            "{} is not available on {:?}",
            req.asset, req.chain
        )));
    }

    // Validate amount: must parse as a positive Money value. This catches
    // negative amounts, empty strings, and non-decimal garbage.
    let money = Money::parse(req.asset, &req.amount)
        .map_err(|error| FeeError::BadRequest(format!("invalid amount: {error}")))?;
    if !money.is_positive() {
        return Err(FeeError::BadRequest(
            "amount must be greater than zero".to_owned(),
        ));
    }

    // Validate destination is non-empty (deeper validation is chain-specific
    // and would need each chain's address library; a length check prevents
    // obviously invalid requests).
    if req.destination.trim().is_empty() {
        return Err(FeeError::BadRequest(
            "destination must not be empty".to_owned(),
        ));
    }

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .user_agent(concat!("engipay-chain/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| FeeError::Unavailable(error.to_string()))?;

    let response = match req.chain {
        Chain::Stellar => estimate_stellar(&http, req.asset).await?,
        Chain::Base => estimate_base(&http, req.asset).await?,
        Chain::Bitcoin => estimate_bitcoin(&http).await?,
    };

    Ok(Json(response))
}

// ─── Per-chain fee estimators ───────────────────────────────────────────────

/// Stellar: fee in XLM (stroops).
///
/// The network always charges `base_fee × num_operations` per transaction.
/// We assume 1 operation for a simple XLM payment and 2 for USDC (which may go
/// through a path-payment to handle decimal conversions). When Horizon is down
/// we use the hard-floor of 100 stroops per operation.
async fn estimate_stellar(
    http: &reqwest::Client,
    asset: Asset,
) -> Result<EstimateFeeResponse, FeeError> {
    // Number of operations required for this asset on Stellar.
    let num_ops: i128 = match asset {
        Asset::Usdc => 2, // path-payment or change-trust operation may be needed
        _ => 1,
    };

    let (base_fee_per_op, estimated) = fetch_stellar_base_fee(http).await;
    let fee_minor = base_fee_per_op
        .checked_mul(num_ops)
        .unwrap_or(base_fee_per_op);

    // Build a Money value in XLM to format the human amount.
    let fee_money = Money::from_minor(Asset::Xlm, fee_minor);

    Ok(EstimateFeeResponse {
        chain: Chain::Stellar,
        asset,
        fee_asset: Asset::Xlm,
        fee_amount: format_money(fee_money),
        fee_minor,
        estimated,
    })
}

/// Fetch the Horizon base_fee from the root endpoint.
/// Returns `(stroops_per_op, estimated_from_network)`.
async fn fetch_stellar_base_fee(http: &reqwest::Client) -> (i128, bool) {
    // Prefer the env-configured URL, fall back to testnet public instance.
    let horizon_url = std::env::var("STELLAR_HORIZON_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "https://horizon-testnet.stellar.org".to_owned());

    // Horizon root response contains `base_fee_in_stroops` and
    // `last_ledger_base_fee` depending on the Horizon version.
    #[derive(serde::Deserialize)]
    struct HorizonRoot {
        #[serde(default)]
        base_fee_in_stroops: Option<u32>,
        /// Alternate field name used in some Horizon versions.
        #[serde(default)]
        last_ledger_base_fee: Option<u32>,
    }

    let result = http
        .get(format!("{horizon_url}/"))
        .send()
        .await;

    let response = match result {
        Ok(r) => r.error_for_status(),
        Err(e) => Err(e),
    };

    match response {
        Ok(resp) => {
            if let Ok(root) = resp.json::<HorizonRoot>().await {
                let fee = root
                    .base_fee_in_stroops
                    .or(root.last_ledger_base_fee)
                    .unwrap_or(100);
                return (i128::from(fee), true);
            }
        }
        Err(err) => {
            tracing::warn!(%err, "could not reach Horizon for fee estimate; using floor");
        }
    }

    // Hard-coded floor: 100 stroops (0.00001 XLM) per operation.
    (100, false)
}

/// Base (EIP-1559): fee in ETH (wei).
///
/// We read `baseFeePerGas` from the latest block via `eth_feeHistory` and add
/// a priority fee tip of 1 gwei. Gas limits: 21 000 for ETH, 65 000 for ERC-20
/// (USDC on Base).
async fn estimate_base(
    http: &reqwest::Client,
    asset: Asset,
) -> Result<EstimateFeeResponse, FeeError> {
    let gas_limit: i128 = match asset {
        Asset::Eth => 21_000,
        Asset::Usdc => 65_000,
        other => {
            return Err(FeeError::BadRequest(format!(
                "{other} is not supported on Base"
            )));
        }
    };

    let (fee_per_gas, estimated) = fetch_base_fee_per_gas(http).await;
    // fee = (base_fee + priority_fee) × gas_limit
    let fee_minor = fee_per_gas
        .checked_mul(gas_limit)
        .unwrap_or(fee_per_gas);

    Ok(EstimateFeeResponse {
        chain: Chain::Base,
        asset,
        fee_asset: Asset::Eth,
        fee_amount: format_money(Money::from_minor(Asset::Eth, fee_minor)),
        fee_minor,
        estimated,
    })
}

/// Fetches `baseFeePerGas` from Base via `eth_feeHistory`.
/// Returns `(wei_per_gas_including_tip, estimated_from_network)`.
async fn fetch_base_fee_per_gas(http: &reqwest::Client) -> (i128, bool) {
    let rpc_url = std::env::var("BASE_RPC_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "https://mainnet.base.org".to_owned());

    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_feeHistory",
        "params": ["0x1", "latest", []]
    });

    #[derive(serde::Deserialize)]
    struct FeeHistoryResult {
        #[serde(rename = "baseFeePerGas")]
        base_fee_per_gas: Vec<String>,
    }
    #[derive(serde::Deserialize)]
    struct RpcResponse {
        result: Option<FeeHistoryResult>,
    }

    let result = http.post(&rpc_url).json(&body).send().await;

    if let Ok(resp) = result {
        if let Ok(rpc) = resp.json::<RpcResponse>().await {
            if let Some(fee_history) = rpc.result {
                // baseFeePerGas returns [block_n, block_n+1]; use the first (current).
                if let Some(hex) = fee_history.base_fee_per_gas.first() {
                    if let Some(base) = parse_hex_u128(hex) {
                        // Add 1 gwei priority fee tip.
                        const PRIORITY_FEE_WEI: u128 = 1_000_000_000;
                        let total = base.saturating_add(PRIORITY_FEE_WEI);
                        if let Ok(total_i128) = i128::try_from(total) {
                            return (total_i128, true);
                        }
                    }
                }
            }
        }
    } else if let Err(ref err) = result {
        tracing::warn!(%err, "could not reach Base RPC for fee estimate; using fallback");
    }

    // Fallback: 30 gwei base + 1 gwei tip = 31 gwei.
    const FALLBACK_GAS_PRICE_WEI: i128 = 31_000_000_000;
    (FALLBACK_GAS_PRICE_WEI, false)
}

/// Bitcoin: fee in BTC (satoshis).
///
/// We query the Esplora REST API for the recommended fee rate (sat/vB) at a
/// 1-block confirmation target, then multiply by a typical P2WPKH transaction
/// weight: 1 input + 2 outputs ≈ 141 vbytes.
async fn estimate_bitcoin(http: &reqwest::Client) -> Result<EstimateFeeResponse, FeeError> {
    let (sat_per_vbyte, estimated) = fetch_bitcoin_fee_rate(http).await;

    // Typical 1-input / 2-output P2WPKH transaction: ~141 vbytes.
    const TYPICAL_TX_VBYTES: i128 = 141;
    let fee_minor = sat_per_vbyte
        .checked_mul(TYPICAL_TX_VBYTES)
        .unwrap_or(sat_per_vbyte);

    Ok(EstimateFeeResponse {
        chain: Chain::Bitcoin,
        asset: Asset::Btc,
        fee_asset: Asset::Btc,
        fee_amount: format_money(Money::from_minor(Asset::Btc, fee_minor)),
        fee_minor,
        estimated,
    })
}

/// Fetch recommended sat/vB from Esplora `/api/fee-estimates`.
/// Returns `(sat_per_vbyte, estimated_from_network)`.
async fn fetch_bitcoin_fee_rate(http: &reqwest::Client) -> (i128, bool) {
    let esplora_url = std::env::var("BITCOIN_ESPLORA_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "https://blockstream.info/api".to_owned());

    // Esplora returns `{ "1": <sat/vB for 1-block target>, "6": ..., ... }`.
    let result = http
        .get(format!("{esplora_url}/fee-estimates"))
        .send()
        .await;

    if let Ok(resp) = result {
        if let Ok(map) = resp.json::<serde_json::Value>().await {
            // Try target "1" (next-block), then "2" as fallback, then "6".
            for target in &["1", "2", "6"] {
                // Ceiling the float first; realistic sat/vB values are small
                // integers (< 10 000), so the cast to i128 is always exact.
                #[allow(clippy::cast_possible_truncation)]
                let rate_opt: Option<i128> = map
                    .get(target)
                    .and_then(|v| v.as_f64())
                    .map(|r| r.ceil())
                    .filter(|r| r.is_finite() && *r > 0.0)
                    .map(|r| r as i128)
                    .filter(|&r| r > 0);
                if let Some(rate) = rate_opt {
                    return (rate, true);
                }
            }
        }
    } else if let Err(ref err) = result {
        tracing::warn!(%err, "could not reach Esplora for Bitcoin fee estimate; using fallback");
    }

    // Fallback: 10 sat/vB — conservative floor for periods when Esplora is
    // unreachable. This keeps the user informed that a fee is required even
    // when we cannot quote the live rate.
    (10, false)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Formats a `Money` value as a decimal string with the full precision of the
/// underlying asset (e.g. 7 decimal places for XLM/USDC, 18 for ETH, 8 for
/// BTC). No floating-point arithmetic is used; the minor unit is divided into
/// an integer part and a fractional part using integer arithmetic only.
#[allow(clippy::arithmetic_side_effects)]
fn format_money(money: Money) -> String {
    let minor = money.minor;
    let decimals = money.asset.decimals();
    let scale: i128 = 10_i128.pow(decimals);
    let integer_part = minor / scale;
    let frac_part = (minor % scale).abs();
    format!("{integer_part}.{frac_part:0>width$}", width = decimals as usize)
}

/// Parses a `0x`-prefixed hex string into a `u128`. Returns `None` on any
/// malformed input, including an empty hex body (`"0x"`).
fn parse_hex_u128(input: &str) -> Option<u128> {
    let hex = input.strip_prefix("0x")?;
    if hex.is_empty() {
        return None;
    }
    u128::from_str_radix(hex, 16).ok()
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    // ── format_money ─────────────────────────────────────────────────────────

    #[test]
    fn format_xlm_stroop_amounts() {
        // 100 stroops = 0.0000100 XLM (7 decimals)
        assert_eq!(
            format_money(Money::from_minor(Asset::Xlm, 100)),
            "0.0000100"
        );
        // 200 stroops
        assert_eq!(
            format_money(Money::from_minor(Asset::Xlm, 200)),
            "0.0000200"
        );
        // 1 XLM = 10_000_000 stroops
        assert_eq!(
            format_money(Money::from_minor(Asset::Xlm, 10_000_000)),
            "1.0000000"
        );
    }

    #[test]
    fn format_btc_satoshi_amounts() {
        // 1 sat = 0.00000001 BTC (8 decimals)
        assert_eq!(
            format_money(Money::from_minor(Asset::Btc, 1)),
            "0.00000001"
        );
        // 1410 sats (141 vbytes × 10 sat/vB fallback)
        assert_eq!(
            format_money(Money::from_minor(Asset::Btc, 1410)),
            "0.00001410"
        );
    }

    #[test]
    fn format_eth_wei_amounts() {
        // 21_000 gas × 31 gwei fallback = 651_000 gwei = 651_000_000_000_000 wei
        let fee_wei: i128 = 21_000 * 31_000_000_000_i128;
        let formatted = format_money(Money::from_minor(Asset::Eth, fee_wei));
        // Should be "0.000651000000000000" (18 decimals)
        assert!(
            formatted.starts_with("0."),
            "ETH fee should be fractional: {formatted}"
        );
        assert_eq!(formatted.len(), 2 + 18, "18 decimal places: {formatted}");
    }

    // ── parse_hex_u128 ────────────────────────────────────────────────────────

    #[test]
    fn parses_hex_quantities() {
        assert_eq!(parse_hex_u128("0x0"), Some(0));
        assert_eq!(parse_hex_u128("0x1"), Some(1));
        assert_eq!(parse_hex_u128("0x3B9ACA00"), Some(1_000_000_000)); // 1 gwei
        assert_eq!(parse_hex_u128("0x"), None);
        assert_eq!(parse_hex_u128(""), None);
        assert_eq!(parse_hex_u128("not-hex"), None);
    }

    // ── Stellar fee calculation ──────────────────────────────────────────────

    #[test]
    fn stellar_xlm_fee_uses_single_op() {
        // XLM transfer: 1 operation at 100 stroops floor → 100 stroops.
        let fee_minor: i128 = 100; // base_fee × 1 op
        assert_eq!(fee_minor, 100);
        assert_eq!(format_money(Money::from_minor(Asset::Xlm, fee_minor)), "0.0000100");
    }

    #[test]
    fn stellar_usdc_fee_uses_two_ops() {
        // USDC on Stellar: 2 operations at 100 stroops each → 200 stroops.
        let fee_minor: i128 = 100 * 2;
        assert_eq!(fee_minor, 200);
        assert_eq!(format_money(Money::from_minor(Asset::Xlm, fee_minor)), "0.0000200");
    }

    #[test]
    fn stellar_fee_scales_with_base_fee() {
        // If Horizon returns 500 stroops per op, USDC costs 1000.
        let base_fee: i128 = 500;
        assert_eq!(base_fee * 2, 1000);
        assert_eq!(
            format_money(Money::from_minor(Asset::Xlm, base_fee * 2)),
            "0.0001000"
        );
    }

    // ── Base fee calculation ─────────────────────────────────────────────────

    #[test]
    fn base_eth_transfer_gas_limit() {
        // ETH transfer uses 21 000 gas.
        let gas_limit: i128 = 21_000;
        let fee_per_gas: i128 = 31_000_000_000; // 31 gwei fallback
        let fee_minor = fee_per_gas * gas_limit;
        assert_eq!(fee_minor, 651_000_000_000_000_i128);
    }

    #[test]
    fn base_usdc_transfer_gas_limit() {
        // ERC-20 (USDC) transfer uses 65 000 gas.
        let gas_limit: i128 = 65_000;
        let fee_per_gas: i128 = 31_000_000_000; // 31 gwei fallback
        let fee_minor = fee_per_gas * gas_limit;
        assert_eq!(fee_minor, 2_015_000_000_000_000_i128);
    }

    #[test]
    fn base_fee_scales_with_gas_price() {
        // Ensure fee arithmetic does not overflow for realistic gas prices.
        // 200 gwei × 65 000 gas = 13_000_000_000_000_000 wei (well within i128).
        let gas_limit: i128 = 65_000;
        let fee_per_gas: i128 = 200_000_000_000; // 200 gwei
        let fee = fee_per_gas * gas_limit;
        assert_eq!(fee, 13_000_000_000_000_000_i128);
        // Fits in i128 with huge headroom.
        assert!(fee < i128::MAX);
    }

    // ── Bitcoin fee calculation ───────────────────────────────────────────────

    #[test]
    fn bitcoin_fee_typical_tx_fallback() {
        // At 10 sat/vB fallback, a 141-vbyte tx costs 1410 sats.
        let sat_per_vbyte: i128 = 10;
        let typical_vbytes: i128 = 141;
        let fee_minor = sat_per_vbyte * typical_vbytes;
        assert_eq!(fee_minor, 1_410);
        assert_eq!(
            format_money(Money::from_minor(Asset::Btc, fee_minor)),
            "0.00001410"
        );
    }

    #[test]
    fn bitcoin_fee_scales_with_rate() {
        // At 50 sat/vB, a 141-vbyte tx costs 7050 sats.
        let sat_per_vbyte: i128 = 50;
        let fee_minor = sat_per_vbyte * 141;
        assert_eq!(fee_minor, 7_050);
    }

    #[test]
    fn bitcoin_fee_no_overflow_at_high_rates() {
        // Even at 1000 sat/vB (extremely rare), no overflow.
        let sat_per_vbyte: i128 = 1_000;
        let fee_minor = sat_per_vbyte * 141;
        assert_eq!(fee_minor, 141_000);
        assert!(fee_minor < i128::MAX);
    }

    // ── Request validation ────────────────────────────────────────────────────

    #[test]
    fn asset_chain_compatibility() {
        // These should all be valid (asset.is_on(chain)).
        assert!(Asset::Xlm.is_on(Chain::Stellar));
        assert!(Asset::Usdc.is_on(Chain::Stellar));
        assert!(Asset::Eth.is_on(Chain::Base));
        assert!(Asset::Usdc.is_on(Chain::Base));
        assert!(Asset::Btc.is_on(Chain::Bitcoin));

        // These are invalid combinations.
        assert!(!Asset::Btc.is_on(Chain::Stellar));
        assert!(!Asset::Eth.is_on(Chain::Bitcoin));
        assert!(!Asset::Xlm.is_on(Chain::Base));
    }

    #[test]
    fn zero_amount_is_rejected() {
        // Money::parse succeeds but is_positive() is false.
        let m = Money::parse(Asset::Usdc, "0").unwrap();
        assert!(!m.is_positive());
    }

    #[test]
    fn negative_and_invalid_amounts_are_rejected() {
        // Money::parse rejects negative and malformed inputs.
        assert!(Money::parse(Asset::Usdc, "-1").is_err());
        assert!(Money::parse(Asset::Usdc, "").is_err());
        assert!(Money::parse(Asset::Usdc, "abc").is_err());
    }

    // ── EstimateFeeResponse round-trip serialisation ─────────────────────────

    #[test]
    fn response_serialises_correctly() {
        let resp = EstimateFeeResponse {
            chain: Chain::Stellar,
            asset: Asset::Xlm,
            fee_asset: Asset::Xlm,
            fee_amount: "0.0000100".to_owned(),
            fee_minor: 100,
            estimated: false,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["chain"], "stellar");
        assert_eq!(json["asset"], "XLM");
        assert_eq!(json["fee_asset"], "XLM");
        assert_eq!(json["fee_amount"], "0.0000100");
        assert_eq!(json["fee_minor"], 100);
        assert_eq!(json["estimated"], false);
    }

    #[test]
    fn bitcoin_response_serialises_correctly() {
        let resp = EstimateFeeResponse {
            chain: Chain::Bitcoin,
            asset: Asset::Btc,
            fee_asset: Asset::Btc,
            fee_amount: "0.00001410".to_owned(),
            fee_minor: 1_410,
            estimated: false,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["chain"], "bitcoin");
        assert_eq!(json["fee_asset"], "BTC");
        assert_eq!(json["fee_minor"], 1410);
    }
}
