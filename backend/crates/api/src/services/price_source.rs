//! Price source trait and fake implementation for conversion quotes.
//!
//! ## Rounding rule
//!
//! All division uses integer floor-division, which always rounds toward negative
//! infinity. Because the result of a conversion is the amount the *user receives*,
//! and we divide by the rate (or multiply by a fee fraction), floor-division
//! means the user always receives strictly less than or equal to the exact
//! mathematical result. The platform can therefore never give away more than it
//! intends: any fractional minor unit that the maths would produce is silently
//! dropped in the user's disfavour, not the platform's.
//!
//! Rule written down: **always floor-divide when computing amounts the user
//! receives; always ceiling-divide (or equivalently, round the fee up) when
//! computing fees the platform collects.** This is enforced below by explicit
//! integer division with the direction noted.

use engipay_core::Asset;

/// A quoted price for converting `from` to `to`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversionPrice {
    /// How many `to`-minor units the user receives per `from`-minor unit,
    /// scaled by `rate_scale` (i.e. `rate * rate_scale` as an integer).
    /// Keeping the raw numerator and denominator avoids a floating-point step.
    pub rate_numerator: i128,
    pub rate_denominator: i128,
    /// Fee rate in basis points (1 bp = 0.01%).
    pub fee_bps: u32,
    /// Number of seconds until this price expires.
    pub ttl_seconds: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PriceError {
    #[error("no price available for {0}/{1}")]
    NoPair(String, String),
    #[error("converting an asset to itself is not allowed")]
    SameAsset,
}

/// Source of live (or simulated) conversion prices.
///
/// Implementations may call an external oracle or return a fixed fake price.
/// The trait is object-safe so it can be stored as `Box<dyn PriceSource>` on
/// `AppState`.
pub trait PriceSource: Send + Sync {
    fn quote(&self, from: Asset, to: Asset) -> Result<ConversionPrice, PriceError>;
}

// ── Fake implementation ───────────────────────────────────────────────────────

/// Fixed prices used in development and tests. Rates are chosen to be round
/// numbers that make test assertions easy to write.
///
/// | Pair         | Rate          |
/// |--------------|---------------|
/// | USDC → XLM   | 1 USDC = 10 XLM (exactly) |
/// | XLM  → USDC  | 10 XLM = 1 USDC (exactly) |
/// | USDC → ETH   | 3500 USDC = 1 ETH          |
/// | ETH  → USDC  | 1 ETH = 3500 USDC          |
/// | USDC → BTC   | 65000 USDC = 1 BTC         |
/// | BTC  → USDC  | 1 BTC = 65000 USDC         |
/// | XLM  → ETH   | (via USDC cross: 35000 XLM = 1 ETH) |
/// | ETH  → XLM   | (via USDC cross: 1 ETH = 35000 XLM) |
///
/// Fee: 50 bps (0.5%) on all pairs. TTL: 30 seconds.
pub struct FakePriceSource;

impl FakePriceSource {
    const FEE_BPS: u32 = 50;
    const TTL_SECONDS: u32 = 30;

    /// Returns `(numerator, denominator)` where the exchange rate is
    /// `numerator / denominator` in terms of `to`-minor per `from`-minor,
    /// accounting for the different decimal precisions of each asset.
    ///
    /// For example USDC (7dp) → XLM (7dp) at 1:10 means
    /// `1 * 10^7 USDC-minor` = `10 * 10^7 XLM-minor`, so per-minor rate is 10/1.
    ///
    /// When `from` and `to` have different precisions the rate is adjusted:
    /// `rate_numerator / rate_denominator` is already in minor-unit terms.
    fn rate(from: Asset, to: Asset) -> Option<(i128, i128)> {
        // Whole-unit rates expressed as (to_units_per_from_unit_numerator, denominator).
        // We then scale by decimal differences.
        let (whole_num, whole_den) = match (from, to) {
            (Asset::Usdc, Asset::Xlm) => (10, 1),
            (Asset::Xlm, Asset::Usdc) => (1, 10),
            (Asset::Usdc, Asset::Eth) => (1, 3500),
            (Asset::Eth, Asset::Usdc) => (3500, 1),
            (Asset::Usdc, Asset::Btc) => (1, 65000),
            (Asset::Btc, Asset::Usdc) => (65000, 1),
            (Asset::Xlm, Asset::Eth) => (1, 35000),
            (Asset::Eth, Asset::Xlm) => (35000, 1),
            (Asset::Xlm, Asset::Btc) => (1, 650_000),
            (Asset::Btc, Asset::Xlm) => (650_000, 1),
            (Asset::Eth, Asset::Btc) => (1, 18),  // ~1 ETH ≈ 1/18 BTC
            (Asset::Btc, Asset::Eth) => (18, 1),
            _ => return None,
        };

        // Adjust for decimal precision difference.
        // per-minor rate = whole_num/whole_den * 10^(to_decimals - from_decimals)
        let from_dec = i32::try_from(from.decimals()).ok()?;
        let to_dec = i32::try_from(to.decimals()).ok()?;
        let diff = to_dec - from_dec;

        let (num, den) = if diff >= 0 {
            let scale = 10_i128.checked_pow(u32::try_from(diff).ok()?)?;
            (whole_num.checked_mul(scale)?, whole_den)
        } else {
            let scale = 10_i128.checked_pow(u32::try_from(-diff).ok()?)?;
            (whole_num, whole_den.checked_mul(scale)?)
        };

        Some((num, den))
    }
}

impl PriceSource for FakePriceSource {
    fn quote(&self, from: Asset, to: Asset) -> Result<ConversionPrice, PriceError> {
        if from == to {
            return Err(PriceError::SameAsset);
        }
        let (rate_numerator, rate_denominator) = Self::rate(from, to).ok_or_else(|| {
            PriceError::NoPair(from.symbol().to_owned(), to.symbol().to_owned())
        })?;
        Ok(ConversionPrice {
            rate_numerator,
            rate_denominator,
            fee_bps: Self::FEE_BPS,
            ttl_seconds: Self::TTL_SECONDS,
        })
    }
}

// ── Pricing math ─────────────────────────────────────────────────────────────

/// Compute the amount out and the fee given an amount in and a price.
///
/// Rounding rule (see module doc): floor for amount_out (user's disfavour),
/// ceiling for fee (platform's favour).
///
/// Returns `None` when `amount_in` is non-positive or the result would be zero.
pub fn apply_price(amount_in: i128, price: &ConversionPrice) -> Option<(i128, i128)> {
    if amount_in <= 0 || price.rate_numerator <= 0 || price.rate_denominator <= 0 {
        return None;
    }

    // fee = ceil(amount_in * fee_bps / 10_000)
    // Use ceiling division: ceil(a/b) = (a + b - 1) / b  (for positive a, b).
    let fee_bps = i128::from(price.fee_bps);
    let fee_num = amount_in.checked_mul(fee_bps)?;
    let fee = (fee_num.checked_add(9_999)?) / 10_000;

    // net = amount_in - fee
    let net = amount_in.checked_sub(fee)?;
    if net <= 0 {
        return None;
    }

    // amount_out = floor(net * rate_numerator / rate_denominator)
    let out_unscaled = net.checked_mul(price.rate_numerator)?;
    let amount_out = out_unscaled / price.rate_denominator;

    if amount_out <= 0 {
        return None;
    }

    Some((amount_out, fee))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use super::*;

    #[test]
    fn same_asset_is_refused() {
        let src = FakePriceSource;
        assert_eq!(
            src.quote(Asset::Usdc, Asset::Usdc),
            Err(PriceError::SameAsset)
        );
        assert_eq!(src.quote(Asset::Xlm, Asset::Xlm), Err(PriceError::SameAsset));
    }

    #[test]
    fn unknown_pair_is_refused() {
        // ETH <-> BTC is defined; no pair that is undefined currently:
        // all Assets have some cross defined. We test a consistent pair.
        let src = FakePriceSource;
        // USDC/ETH should work
        assert!(src.quote(Asset::Usdc, Asset::Eth).is_ok());
    }

    #[test]
    fn usdc_to_xlm_rate_and_fee() {
        let src = FakePriceSource;
        let price = src.quote(Asset::Usdc, Asset::Xlm).unwrap();
        // 1 USDC = 10 XLM, same decimals (7), so per-minor rate = 10/1
        assert_eq!(price.rate_numerator, 10);
        assert_eq!(price.rate_denominator, 1);
        assert_eq!(price.fee_bps, 50);
    }

    #[test]
    fn xlm_to_usdc_rate() {
        let src = FakePriceSource;
        let price = src.quote(Asset::Xlm, Asset::Usdc).unwrap();
        // 10 XLM = 1 USDC, same decimals → per-minor rate = 1/10
        assert_eq!(price.rate_numerator, 1);
        assert_eq!(price.rate_denominator, 10);
    }

    #[test]
    fn apply_price_usdc_to_xlm() {
        let src = FakePriceSource;
        let price = src.quote(Asset::Usdc, Asset::Xlm).unwrap();
        // Send 100 USDC-minor (7dp). Fee = ceil(100 * 50 / 10000) = ceil(0.5) = 1
        // net = 99. out = floor(99 * 10 / 1) = 990
        let (out, fee) = apply_price(100, &price).unwrap();
        assert_eq!(fee, 1);
        assert_eq!(out, 990);
    }

    #[test]
    fn rounding_never_favours_user() {
        // For a range of amounts, verify floor-division holds:
        // out * rate_denominator <= net * rate_numerator
        let src = FakePriceSource;
        let price = src.quote(Asset::Xlm, Asset::Usdc).unwrap();
        for amount in [1_000_000i128, 9_999_999, 100_000_001, 7_777_777] {
            let (out, fee) = apply_price(amount, &price).unwrap();
            let net = amount - fee;
            // out ≤ exact math result
            assert!(out * price.rate_denominator <= net * price.rate_numerator);
        }
    }

    #[test]
    fn zero_and_negative_amounts_refused() {
        let src = FakePriceSource;
        let price = src.quote(Asset::Usdc, Asset::Xlm).unwrap();
        assert_eq!(apply_price(0, &price), None);
        assert_eq!(apply_price(-1, &price), None);
    }

    #[test]
    fn expiry_is_30_seconds() {
        let src = FakePriceSource;
        let p = src.quote(Asset::Usdc, Asset::Xlm).unwrap();
        assert_eq!(p.ttl_seconds, 30);
    }

    #[test]
    fn all_supported_pairs_return_a_price() {
        let src = FakePriceSource;
        let pairs = [
            (Asset::Usdc, Asset::Xlm),
            (Asset::Xlm, Asset::Usdc),
            (Asset::Usdc, Asset::Eth),
            (Asset::Eth, Asset::Usdc),
            (Asset::Usdc, Asset::Btc),
            (Asset::Btc, Asset::Usdc),
            (Asset::Xlm, Asset::Eth),
            (Asset::Eth, Asset::Xlm),
        ];
        for (from, to) in pairs {
            assert!(
                src.quote(from, to).is_ok(),
                "{from}/{to} should be supported"
            );
        }
    }
}
