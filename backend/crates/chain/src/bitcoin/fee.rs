//! Dynamic Bitcoin mining fee calculation based on mempool estimates.
//!
//! Outgoing Bitcoin transactions require dynamic mining fee estimation to ensure
//! predictable block inclusion without overpaying for block space. This module
//! queries and parses fee estimates from an Esplora-compatible `/fee-estimates`
//! endpoint, selects the appropriate confirmation target rate, and multiplies
//! the virtual transaction size (vBytes) by fee rate (sat/vB) using checked integer
//! arithmetic.
//!
//! Strict type safety is enforced; money and fee amounts are represented exclusively
//! in integer satoshis and ledger minor units without floating-point representation.

use std::collections::BTreeMap;
use engipay_core::{Asset, Money, MoneyError};
use serde::{Deserialize, Serialize};

/// Minimum allowed fee rate in sat/vB for standard Bitcoin transaction relay.
pub const MIN_FEE_RATE_SAT_PER_VB: u64 = 1;

/// Error types occurring during Bitcoin fee calculation and estimation.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BitcoinFeeError {
    #[error("virtual transaction size in vbytes must be greater than zero")]
    ZeroVbytes,

    #[error("fee rate must be at least 1 sat/vB")]
    ZeroFeeRate,

    #[error("fee calculation overflowed: {vbytes} vB * {sat_per_vb} sat/vB")]
    Overflow { vbytes: u64, sat_per_vb: u64 },

    #[error("no fee estimates available")]
    EmptyEstimates,

    #[error("failed to query esplora fee estimates: {0}")]
    QueryFailed(String),

    #[error("failed to parse fee estimates response: {0}")]
    ParseError(String),

    #[error("core money conversion error: {0}")]
    Money(#[from] MoneyError),
}

/// Represents Esplora fee estimates mapping target confirmation blocks to sat/vB fee rates.
///
/// In Esplora `/fee-estimates`, keys represent target confirmation block counts
/// (e.g. 1, 2, 3, 6, 144) and values represent recommended fee rates in satoshis
/// per virtual byte (sat/vB).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EsploraFeeEstimates(pub BTreeMap<u32, f64>);

impl EsploraFeeEstimates {
    /// Constructs a new [`EsploraFeeEstimates`] map.
    pub fn new(estimates: BTreeMap<u32, f64>) -> Self {
        Self(estimates)
    }

    /// Finds the recommended fee rate (in integer sat/vB, rounded up) for a given
    /// target confirmation block count (e.g. 2 blocks).
    ///
    /// If an exact target block count is available in the estimates, its rate is returned.
    /// If not, it falls back to the closest available target block count.
    /// Rates are ceiling-rounded to integer satoshis per vByte, and clamped to at least
    /// [`MIN_FEE_RATE_SAT_PER_VB`].
    pub fn get_fee_rate_sat_per_vb(&self, target_blocks: u32) -> Result<u64, BitcoinFeeError> {
        if self.0.is_empty() {
            return Err(BitcoinFeeError::EmptyEstimates);
        }

        // Check exact match first
        if let Some(&rate) = self.0.get(&target_blocks) {
            return Self::sanitize_rate(rate);
        }

        // Find closest target block count
        let mut closest_blocks = None;
        let mut min_diff = u32::MAX;

        for &blocks in self.0.keys() {
            let diff = blocks.abs_diff(target_blocks);
            if diff < min_diff {
                min_diff = diff;
                closest_blocks = Some(blocks);
            }
        }

        let chosen = closest_blocks.ok_or(BitcoinFeeError::EmptyEstimates)?;
        Self::sanitize_rate(self.0[&chosen])
    }

    /// Sanitizes and ceiling-rounds a floating-point fee rate to an integer sat/vB.
    fn sanitize_rate(rate: f64) -> Result<u64, BitcoinFeeError> {
        if !rate.is_finite() || rate <= 0.0 {
            return Err(BitcoinFeeError::ZeroFeeRate);
        }
        let sat_per_vb = rate.ceil() as u64;
        Ok(sat_per_vb.max(MIN_FEE_RATE_SAT_PER_VB))
    }
}

/// Queries Esplora `/fee-estimates` endpoint and returns parsed [`EsploraFeeEstimates`].
pub async fn fetch_fee_estimates(
    client: &reqwest::Client,
    esplora_url: &str,
) -> Result<EsploraFeeEstimates, BitcoinFeeError> {
    let url = format!("{}/fee-estimates", esplora_url.trim_end_matches('/'));
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| BitcoinFeeError::QueryFailed(e.to_string()))?;

    let raw_map: BTreeMap<String, f64> = response
        .json()
        .await
        .map_err(|e| BitcoinFeeError::ParseError(e.to_string()))?;

    let mut parsed = BTreeMap::new();
    for (k, v) in raw_map {
        if let Ok(blocks) = k.parse::<u32>() {
            parsed.insert(blocks, v);
        }
    }

    if parsed.is_empty() {
        return Err(BitcoinFeeError::EmptyEstimates);
    }

    Ok(EsploraFeeEstimates::new(parsed))
}

/// Multiplies virtual transaction size (vBytes) by fee rate (sat/vB) to calculate total fee in satoshis.
///
/// Ensures strict validation:
/// - `vbytes` must be > 0.
/// - `sat_per_vb` must be >= 1.
/// - Checked integer multiplication prevents arithmetic overflow.
pub fn calculate_bitcoin_fee(vbytes: u64, sat_per_vb: u64) -> Result<u64, BitcoinFeeError> {
    if vbytes == 0 {
        return Err(BitcoinFeeError::ZeroVbytes);
    }
    if sat_per_vb == 0 {
        return Err(BitcoinFeeError::ZeroFeeRate);
    }

    vbytes
        .checked_mul(sat_per_vb)
        .ok_or(BitcoinFeeError::Overflow { vbytes, sat_per_vb })
}

/// Calculates dynamic Bitcoin mining fee in satoshis for a target confirmation block count.
pub fn calculate_dynamic_fee(
    estimates: &EsploraFeeEstimates,
    target_blocks: u32,
    vbytes: u64,
) -> Result<u64, BitcoinFeeError> {
    let sat_per_vb = estimates.get_fee_rate_sat_per_vb(target_blocks)?;
    calculate_bitcoin_fee(vbytes, sat_per_vb)
}

/// Calculates dynamic Bitcoin mining fee represented as a ledger [`Money`] amount of [`Asset::Btc`].
pub fn calculate_dynamic_fee_money(
    estimates: &EsploraFeeEstimates,
    target_blocks: u32,
    vbytes: u64,
) -> Result<Money, BitcoinFeeError> {
    let fee_sats = calculate_dynamic_fee(estimates, target_blocks, vbytes)?;
    let minor = i128::from(fee_sats);
    Ok(Money::from_minor(Asset::Btc, minor))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_estimates() -> EsploraFeeEstimates {
        let mut map = BTreeMap::new();
        map.insert(1, 28.4);
        map.insert(2, 21.2);
        map.insert(3, 17.0);
        map.insert(6, 12.1);
        map.insert(144, 4.0);
        EsploraFeeEstimates::new(map)
    }

    #[test]
    fn calculates_fee_correctly() {
        // 140 vbytes * 20 sat/vB = 2,800 sats
        let fee = calculate_bitcoin_fee(140, 20).expect("valid fee");
        assert_eq!(fee, 2800);
    }

    #[test]
    fn rejects_zero_vbytes() {
        assert_eq!(
            calculate_bitcoin_fee(0, 10),
            Err(BitcoinFeeError::ZeroVbytes)
        );
    }

    #[test]
    fn rejects_zero_fee_rate() {
        assert_eq!(
            calculate_bitcoin_fee(140, 0),
            Err(BitcoinFeeError::ZeroFeeRate)
        );
    }

    #[test]
    fn detects_multiplication_overflow() {
        assert!(matches!(
            calculate_bitcoin_fee(u64::MAX, 2),
            Err(BitcoinFeeError::Overflow { .. })
        ));
    }

    #[test]
    fn resolves_exact_target_block_rate() {
        let estimates = sample_estimates();
        // 21.2 rounds up to 22 sat/vB
        let rate = estimates.get_fee_rate_sat_per_vb(2).expect("valid rate");
        assert_eq!(rate, 22);
    }

    #[test]
    fn resolves_closest_target_block_rate() {
        let estimates = sample_estimates();
        // Target 5 is closest to 6 (12.1 rounds up to 13 sat/vB)
        let rate = estimates.get_fee_rate_sat_per_vb(5).expect("valid rate");
        assert_eq!(rate, 13);
    }

    #[test]
    fn enforces_minimum_relay_rate() {
        let mut map = BTreeMap::new();
        map.insert(100, 0.2); // sub-1 sat/vB
        let estimates = EsploraFeeEstimates::new(map);
        let rate = estimates.get_fee_rate_sat_per_vb(100).expect("valid rate");
        assert_eq!(rate, 1);
    }

    #[test]
    fn calculates_dynamic_fee_for_target() {
        let estimates = sample_estimates();
        // Target 2 blocks: 22 sat/vB * 200 vB = 4,400 sats
        let fee = calculate_dynamic_fee(&estimates, 2, 200).expect("valid dynamic fee");
        assert_eq!(fee, 4400);
    }

    #[test]
    fn calculates_dynamic_fee_money() {
        let estimates = sample_estimates();
        let money = calculate_dynamic_fee_money(&estimates, 2, 200).expect("valid money");
        assert_eq!(money.asset, Asset::Btc);
        assert_eq!(money.minor, 4400);
    }

    #[test]
    fn rejects_empty_estimates() {
        let empty = EsploraFeeEstimates::new(BTreeMap::new());
        assert_eq!(
            empty.get_fee_rate_sat_per_vb(2),
            Err(BitcoinFeeError::EmptyEstimates)
        );
    }
}
