//! Conversion quote calculation helper.
//!
//! Provides deterministic calculation of conversion output amounts and platform
//! fee deductions based on input amount, exchange rate, and fee basis points.
//!
//! All calculations are performed using exact integer arithmetic (`i128`).
//! Floating-point arithmetic is strictly forbidden to prevent precision drift
//! and rounding discrepancies.

#![allow(
    clippy::arithmetic_side_effects,
    clippy::unwrap_used,
    clippy::expect_used
)]

use engipay_core::{Asset, Money, MoneyError};

/// Basis points denominator: 10,000 basis points = 100%.
pub const BPS_DENOMINATOR: i128 = 10_000;

/// Default conversion platform fee in basis points (0.50% = 50 bps).
pub const DEFAULT_FEE_BPS: u32 = 50;

/// Errors that can occur during conversion quote calculation.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ConversionMathError {
    #[error("input amount must be positive")]
    NonPositiveAmount,

    #[error("exchange rate must be positive")]
    NonPositiveRate,

    #[error("fee basis points ({0}) cannot exceed 100% (10,000 bps)")]
    FeeExceedsMaximum(u32),

    #[error("arithmetic overflow occurred during conversion calculation")]
    Overflow,

    #[error("core money error: {0}")]
    Money(#[from] MoneyError),
}

/// Output breakdown of a calculated conversion quote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConversionQuoteOutput {
    /// The input money amount provided for conversion.
    pub input_amount: Money,
    /// The fee deducted from the input, denominated in the input asset.
    pub fee_deducted: Money,
    /// The net input amount after deducting the platform fee.
    pub net_input_amount: Money,
    /// The gross output amount before fee deduction.
    pub gross_output_amount: Money,
    /// The net output amount received in the destination asset.
    pub net_output_amount: Money,
    /// Fee basis points applied.
    pub fee_bps: u32,
}

/// Calculates the output amount and fee deduction for converting between two assets.
///
/// # Arguments
/// * `input` - The input `Money` to be converted. Must have `minor > 0`.
/// * `to_asset` - The target `Asset` to receive.
/// * `rate_numerator` - Rate multiplier (target units per input unit).
/// * `rate_denominator` - Rate divisor. Must be strictly positive.
/// * `fee_bps` - Fee in basis points (e.g. 50 bps = 0.50%). Must be <= 10,000.
///
/// # Formula
/// 1. `fee_minor = (input.minor * fee_bps) / 10_000` (rounded down)
/// 2. `net_input_minor = input.minor - fee_minor`
/// 3. Decimal adjustment between input asset decimals ($D_{in}$) and output asset decimals ($D_{out}$):
///    - If $D_{out} \ge D_{in}$: `scaled_net = net_input_minor * 10^(D_{out} - D_{in})`
///    - If $D_{out} < D_{in}$: `scaled_net = net_input_minor / 10^(D_{in} - D_{out})`
/// 4. `net_output_minor = (scaled_net * rate_numerator) / rate_denominator`
pub fn calculate_quote_output(
    input: Money,
    to_asset: Asset,
    rate_numerator: i128,
    rate_denominator: i128,
    fee_bps: u32,
) -> Result<ConversionQuoteOutput, ConversionMathError> {
    if input.minor <= 0 {
        return Err(ConversionMathError::NonPositiveAmount);
    }
    if rate_numerator <= 0 || rate_denominator <= 0 {
        return Err(ConversionMathError::NonPositiveRate);
    }
    if fee_bps as i128 > BPS_DENOMINATOR {
        return Err(ConversionMathError::FeeExceedsMaximum(fee_bps));
    }

    let fee_bps_i128 = fee_bps as i128;

    // 1. Fee calculation: fee = (input * fee_bps) / 10_000
    let fee_minor = input
        .minor
        .checked_mul(fee_bps_i128)
        .ok_or(ConversionMathError::Overflow)?
        / BPS_DENOMINATOR;

    let net_input_minor = input
        .minor
        .checked_sub(fee_minor)
        .ok_or(ConversionMathError::Overflow)?;

    // 2. Decimal scaling between assets
    let from_decimals = input.asset.decimals();
    let to_decimals = to_asset.decimals();

    let gross_output_minor = compute_scaled_output(
        input.minor,
        from_decimals,
        to_decimals,
        rate_numerator,
        rate_denominator,
    )?;

    let net_output_minor = compute_scaled_output(
        net_input_minor,
        from_decimals,
        to_decimals,
        rate_numerator,
        rate_denominator,
    )?;

    Ok(ConversionQuoteOutput {
        input_amount: input,
        fee_deducted: Money::from_minor(input.asset, fee_minor),
        net_input_amount: Money::from_minor(input.asset, net_input_minor),
        gross_output_amount: Money::from_minor(to_asset, gross_output_minor),
        net_output_amount: Money::from_minor(to_asset, net_output_minor),
        fee_bps,
    })
}

/// Helper to scale minor units across different asset decimal precisions and apply the exchange rate.
fn compute_scaled_output(
    amount_minor: i128,
    from_decimals: u32,
    to_decimals: u32,
    rate_num: i128,
    rate_denom: i128,
) -> Result<i128, ConversionMathError> {
    // If output decimals >= input decimals, multiply first
    if to_decimals >= from_decimals {
        let diff = to_decimals - from_decimals;
        let scale = 10_i128
            .checked_pow(diff)
            .ok_or(ConversionMathError::Overflow)?;

        let scaled = amount_minor
            .checked_mul(scale)
            .ok_or(ConversionMathError::Overflow)?;

        let num_product = scaled
            .checked_mul(rate_num)
            .ok_or(ConversionMathError::Overflow)?;

        Ok(num_product / rate_denom)
    } else {
        // Output decimals < input decimals
        let diff = from_decimals - to_decimals;
        let scale = 10_i128
            .checked_pow(diff)
            .ok_or(ConversionMathError::Overflow)?;

        let num_product = amount_minor
            .checked_mul(rate_num)
            .ok_or(ConversionMathError::Overflow)?;

        let total_denom = rate_denom
            .checked_mul(scale)
            .ok_or(ConversionMathError::Overflow)?;

        Ok(num_product / total_denom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculate_quote_usdc_to_xlm_standard_rate() {
        // 100 USDC (7 decimals -> 1_000_000_000 minor)
        // Rate: 1 USDC = 10 XLM (both have 7 decimals)
        // Fee: 50 bps (0.5%)
        let input = Money::from_minor(Asset::Usdc, 1_000_000_000);
        let quote = calculate_quote_output(input, Asset::Xlm, 10, 1, 50).unwrap();

        // Fee = 1_000_000_000 * 50 / 10_000 = 5_000_000 (0.5 USDC)
        assert_eq!(quote.fee_deducted.minor, 5_000_000);
        assert_eq!(quote.net_input_amount.minor, 995_000_000);

        // Net output = 995_000_000 * 10 = 9_950_000_000 (995 XLM)
        assert_eq!(quote.net_output_amount.minor, 9_950_000_000);
        assert_eq!(quote.gross_output_amount.minor, 10_000_000_000);
    }

    #[test]
    fn calculate_quote_handles_zero_fee() {
        let input = Money::from_minor(Asset::Usdc, 1_000_000);
        let quote = calculate_quote_output(input, Asset::Xlm, 1, 1, 0).unwrap();

        assert_eq!(quote.fee_deducted.minor, 0);
        assert_eq!(quote.net_input_amount.minor, 1_000_000);
        assert_eq!(quote.net_output_amount.minor, 1_000_000);
    }

    #[test]
    fn calculate_quote_rejects_non_positive_amounts() {
        let zero_input = Money::from_minor(Asset::Usdc, 0);
        let err = calculate_quote_output(zero_input, Asset::Xlm, 1, 1, 50).unwrap_err();
        assert_eq!(err, ConversionMathError::NonPositiveAmount);

        let neg_input = Money::from_minor(Asset::Usdc, -100);
        let err2 = calculate_quote_output(neg_input, Asset::Xlm, 1, 1, 50).unwrap_err();
        assert_eq!(err2, ConversionMathError::NonPositiveAmount);
    }

    #[test]
    fn calculate_quote_rejects_invalid_fee_bps() {
        let input = Money::from_minor(Asset::Usdc, 100);
        let err = calculate_quote_output(input, Asset::Xlm, 1, 1, 10_001).unwrap_err();
        assert_eq!(err, ConversionMathError::FeeExceedsMaximum(10_001));
    }

    #[test]
    fn calculate_quote_rejects_non_positive_rate() {
        let input = Money::from_minor(Asset::Usdc, 100);
        let err = calculate_quote_output(input, Asset::Xlm, 0, 1, 50).unwrap_err();
        assert_eq!(err, ConversionMathError::NonPositiveRate);

        let err2 = calculate_quote_output(input, Asset::Xlm, 1, 0, 50).unwrap_err();
        assert_eq!(err2, ConversionMathError::NonPositiveRate);
    }

    #[test]
    fn decimal_conversion_between_different_precisions() {
        // USDC (7 decimals) to BTC (8 decimals)
        // 1 BTC = 60,000 USDC -> rate = 1 / 60_000
        // Input: 60,000 USDC = 60_000 * 10^7 = 600_000_000_000 minor
        // Fee: 0 bps
        let input = Money::from_minor(Asset::Usdc, 600_000_000_000);
        let quote = calculate_quote_output(input, Asset::Btc, 1, 60_000, 0).unwrap();

        // 1 BTC with 8 decimals = 100_000_000 minor
        assert_eq!(quote.net_output_amount.minor, 100_000_000);
        assert_eq!(quote.net_output_amount.asset, Asset::Btc);
    }
}
