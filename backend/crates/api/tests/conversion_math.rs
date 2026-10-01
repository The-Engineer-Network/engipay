#![allow(clippy::unwrap_used, clippy::expect_used)]

use engipay_api::services::conversion_math::{
    BPS_DENOMINATOR, ConversionMathError, DEFAULT_FEE_BPS, calculate_quote_output,
};
use engipay_core::{Asset, Money};

#[test]
fn test_default_fee_basis_points_is_fifty_bps() {
    assert_eq!(DEFAULT_FEE_BPS, 50);
    assert_eq!(BPS_DENOMINATOR, 10_000);
}

#[test]
fn test_same_decimal_precision_conversion() {
    // USDC (7 decimals) to XLM (7 decimals)
    // Rate: 1 USDC = 8.5 XLM -> 85 / 10
    // Input: 200 USDC = 200 * 10^7 = 2_000_000_000 minor units
    // Fee: 50 bps (0.5%)
    let input = Money::from_minor(Asset::Usdc, 2_000_000_000);
    let quote = calculate_quote_output(input, Asset::Xlm, 85, 10, DEFAULT_FEE_BPS).unwrap();

    // Fee: 2_000_000_000 * 50 / 10_000 = 10_000_000 (1 USDC)
    assert_eq!(
        quote.fee_deducted,
        Money::from_minor(Asset::Usdc, 10_000_000)
    );
    assert_eq!(
        quote.net_input_amount,
        Money::from_minor(Asset::Usdc, 1_990_000_000)
    );

    // Gross output: 2_000_000_000 * 85 / 10 = 17_000_000_000 (1700 XLM)
    assert_eq!(
        quote.gross_output_amount,
        Money::from_minor(Asset::Xlm, 17_000_000_000)
    );

    // Net output: 1_990_000_000 * 85 / 10 = 16_915_000_000 (1691.5 XLM)
    assert_eq!(
        quote.net_output_amount,
        Money::from_minor(Asset::Xlm, 16_915_000_000)
    );
    assert_eq!(quote.fee_bps, 50);
}

#[test]
fn test_finer_to_coarser_precision_scaling() {
    // ETH (18 decimals) to USDC (7 decimals)
    // 1 ETH = 3,000 USDC -> rate = 3000 / 1
    // Input: 1 ETH = 10^18 minor units
    // Fee: 100 bps (1.0%)
    let input = Money::from_minor(Asset::Eth, 1_000_000_000_000_000_000);
    let quote = calculate_quote_output(input, Asset::Usdc, 3000, 1, 100).unwrap();

    // Fee: 1 ETH * 100 / 10_000 = 0.01 ETH = 10^16 minor units
    assert_eq!(
        quote.fee_deducted,
        Money::from_minor(Asset::Eth, 10_000_000_000_000_000)
    );
    assert_eq!(
        quote.net_input_amount,
        Money::from_minor(Asset::Eth, 990_000_000_000_000_000)
    );

    // 0.99 ETH * 3000 USDC/ETH = 2970 USDC
    // USDC has 7 decimals: 2970 * 10^7 = 29_700_000_000 minor units
    assert_eq!(
        quote.net_output_amount,
        Money::from_minor(Asset::Usdc, 29_700_000_000)
    );
}

#[test]
fn test_coarser_to_finer_precision_scaling() {
    // USDC (7 decimals) to ETH (18 decimals)
    // 1 ETH = 2,500 USDC -> rate = 1 ETH / 2500 USDC = 1 / 2500
    // Input: 5,000 USDC = 5_000 * 10^7 = 50_000_000_000 minor units
    // Fee: 0 bps
    let input = Money::from_minor(Asset::Usdc, 50_000_000_000);
    let quote = calculate_quote_output(input, Asset::Eth, 1, 2500, 0).unwrap();

    // 5000 / 2500 = 2 ETH = 2 * 10^18 minor units
    assert_eq!(
        quote.net_output_amount,
        Money::from_minor(Asset::Eth, 2_000_000_000_000_000_000)
    );
}

#[test]
fn test_rounding_down_preserves_solvency() {
    // Conversion with indivisible division rounds DOWN, never giving extra money.
    let input = Money::from_minor(Asset::Usdc, 100);
    let quote = calculate_quote_output(input, Asset::Xlm, 1, 3, 0).unwrap();

    // 100 / 3 = 33 (remainder 1 truncated)
    assert_eq!(quote.net_output_amount.minor, 33);
}

#[test]
fn test_fee_rounding_down() {
    // Fee calculation truncates fractional minor units to not overcharge caller
    let input = Money::from_minor(Asset::Usdc, 199);
    // 199 * 50 / 10_000 = 9950 / 10_000 = 0
    let quote = calculate_quote_output(input, Asset::Xlm, 1, 1, 50).unwrap();
    assert_eq!(quote.fee_deducted.minor, 0);
    assert_eq!(quote.net_input_amount.minor, 199);
}

#[test]
fn test_boundary_fee_100_percent() {
    let input = Money::from_minor(Asset::Usdc, 10_000_000);
    let quote = calculate_quote_output(input, Asset::Xlm, 1, 1, 10_000).unwrap();

    assert_eq!(quote.fee_deducted.minor, 10_000_000);
    assert_eq!(quote.net_input_amount.minor, 0);
    assert_eq!(quote.net_output_amount.minor, 0);
}

#[test]
fn test_error_on_zero_or_negative_amount() {
    let zero = Money::from_minor(Asset::Btc, 0);
    assert_eq!(
        calculate_quote_output(zero, Asset::Usdc, 1, 1, 50).unwrap_err(),
        ConversionMathError::NonPositiveAmount
    );

    let neg = Money::from_minor(Asset::Btc, -50);
    assert_eq!(
        calculate_quote_output(neg, Asset::Usdc, 1, 1, 50).unwrap_err(),
        ConversionMathError::NonPositiveAmount
    );
}

#[test]
fn test_error_on_fee_over_100_percent() {
    let input = Money::from_minor(Asset::Btc, 1_000_000);
    assert_eq!(
        calculate_quote_output(input, Asset::Usdc, 1, 1, 10_001).unwrap_err(),
        ConversionMathError::FeeExceedsMaximum(10_001)
    );
}

#[test]
fn test_error_on_zero_or_negative_rates() {
    let input = Money::from_minor(Asset::Usdc, 1_000_000);
    assert_eq!(
        calculate_quote_output(input, Asset::Btc, 0, 1, 50).unwrap_err(),
        ConversionMathError::NonPositiveRate
    );
    assert_eq!(
        calculate_quote_output(input, Asset::Btc, 1, 0, 50).unwrap_err(),
        ConversionMathError::NonPositiveRate
    );
    assert_eq!(
        calculate_quote_output(input, Asset::Btc, -1, 1, 50).unwrap_err(),
        ConversionMathError::NonPositiveRate
    );
    assert_eq!(
        calculate_quote_output(input, Asset::Btc, 1, -1, 50).unwrap_err(),
        ConversionMathError::NonPositiveRate
    );
}
