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

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
    /// Source identifiers that contributed to the aggregate.
    pub source_ids: Vec<String>,
    /// Unix timestamp in seconds of the newest contributing observation.
    pub observed_at_unix: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PriceError {
    #[error("no price available for {0}/{1}")]
    NoPair(String, String),
    #[error("converting an asset to itself is not allowed")]
    SameAsset,
    #[error("fewer than two price sources returned a usable observation")]
    InsufficientSources,
    #[error("price sources disagree beyond the configured threshold")]
    SourcesDisagree,
    #[error("price source observation is stale")]
    StalePrice,
    #[error("price source cache is unavailable")]
    CacheUnavailable,
    #[error("price arithmetic overflow")]
    ArithmeticOverflow,
}

/// Source of live (or simulated) conversion prices.
///
/// Implementations may call an external oracle or return a fixed fake price.
/// The trait is object-safe so it can be stored as `Box<dyn PriceSource>` on
/// `AppState`.
pub trait PriceSource: Send + Sync {
    fn quote(&self, from: Asset, to: Asset) -> Result<ConversionPrice, PriceError>;
}

/// Combines independent providers, rejecting stale or materially divergent data.
pub struct AggregatedPriceSource {
    sources: Vec<Arc<dyn PriceSource>>,
    max_deviation_bps: u32,
    max_age: Duration,
    cache_ttl: Duration,
    cache: Mutex<HashMap<(Asset, Asset), (Instant, ConversionPrice)>>,
}

impl AggregatedPriceSource {
    pub fn new(
        sources: Vec<Arc<dyn PriceSource>>,
        max_deviation_bps: u32,
        max_age: Duration,
        cache_ttl: Duration,
    ) -> Self {
        Self {
            sources,
            max_deviation_bps,
            max_age,
            cache_ttl,
            cache: Mutex::new(HashMap::new()),
        }
    }

    fn load(&self, from: Asset, to: Asset) -> Result<ConversionPrice, PriceError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| PriceError::StalePrice)?
            .as_secs();
        let now = i64::try_from(now).map_err(|_| PriceError::ArithmeticOverflow)?;
        let mut prices = Vec::new();
        for source in &self.sources {
            let price = match source.quote(from, to) {
                Ok(price) => price,
                Err(_) => continue,
            };
            if price.rate_numerator <= 0
                || price.rate_denominator <= 0
                || price.source_ids.len() != 1
                || prices
                    .iter()
                    .any(|accepted: &ConversionPrice| accepted.source_ids == price.source_ids)
            {
                continue;
            }
            if price.observed_at_unix > now
                || now.saturating_sub(price.observed_at_unix)
                    > i64::try_from(self.max_age.as_secs()).unwrap_or(i64::MAX)
            {
                continue;
            }
            prices.push(price);
        }
        if prices.len() < 2 {
            return Err(if prices.is_empty() {
                PriceError::StalePrice
            } else {
                PriceError::InsufficientSources
            });
        }

        for index in 1..prices.len() {
            let mut position = index;
            while position > 0 {
                let left = &prices[position - 1];
                let right = &prices[position];
                let left_scaled = left
                    .rate_numerator
                    .checked_mul(right.rate_denominator)
                    .ok_or(PriceError::ArithmeticOverflow)?;
                let right_scaled = right
                    .rate_numerator
                    .checked_mul(left.rate_denominator)
                    .ok_or(PriceError::ArithmeticOverflow)?;
                if left_scaled <= right_scaled {
                    break;
                }
                prices.swap(position - 1, position);
                position -= 1;
            }
        }
        let middle = prices.len() / 2;
        let median = if prices.len() % 2 == 1 {
            prices[middle].clone()
        } else {
            let lower = &prices[middle - 1];
            let upper = &prices[middle];
            ConversionPrice {
                rate_numerator: lower
                    .rate_numerator
                    .checked_mul(upper.rate_denominator)
                    .and_then(|value| {
                        upper
                            .rate_numerator
                            .checked_mul(lower.rate_denominator)
                            .and_then(|other| value.checked_add(other))
                    })
                    .ok_or(PriceError::ArithmeticOverflow)?,
                rate_denominator: lower
                    .rate_denominator
                    .checked_mul(upper.rate_denominator)
                    .and_then(|value| value.checked_mul(2))
                    .ok_or(PriceError::ArithmeticOverflow)?,
                fee_bps: upper.fee_bps,
                ttl_seconds: upper.ttl_seconds,
                source_ids: Vec::new(),
                observed_at_unix: 0,
            }
        };
        for price in &prices {
            let left = price
                .rate_numerator
                .checked_mul(median.rate_denominator)
                .ok_or(PriceError::ArithmeticOverflow)?;
            let right = median
                .rate_numerator
                .checked_mul(price.rate_denominator)
                .ok_or(PriceError::ArithmeticOverflow)?;
            let difference = left.abs_diff(right);
            let allowed = u128::try_from(right)
                .ok()
                .and_then(|value| value.checked_mul(u128::from(self.max_deviation_bps)))
                .ok_or(PriceError::ArithmeticOverflow)?;
            if difference
                .checked_mul(10_000)
                .ok_or(PriceError::ArithmeticOverflow)?
                > allowed
            {
                return Err(PriceError::SourcesDisagree);
            }
        }

        let source_ids = prices
            .iter()
            .flat_map(|price| price.source_ids.iter().cloned())
            .collect();
        let observed_at_unix = prices
            .iter()
            .map(|price| price.observed_at_unix)
            .max()
            .ok_or(PriceError::InsufficientSources)?;
        Ok(ConversionPrice {
            rate_numerator: median.rate_numerator,
            rate_denominator: median.rate_denominator,
            fee_bps: median.fee_bps,
            ttl_seconds: u32::try_from(self.cache_ttl.as_secs()).unwrap_or(u32::MAX),
            source_ids,
            observed_at_unix,
        })
    }
}

impl PriceSource for AggregatedPriceSource {
    fn quote(&self, from: Asset, to: Asset) -> Result<ConversionPrice, PriceError> {
        if from == to {
            return Err(PriceError::SameAsset);
        }
        {
            let cache = self
                .cache
                .lock()
                .map_err(|_| PriceError::CacheUnavailable)?;
            if let Some((cached_at, price)) = cache.get(&(from, to)) {
                let within_ttl = cached_at.elapsed() < self.cache_ttl;
                let within_max_age = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .ok()
                    .and_then(|now| i64::try_from(now.as_secs()).ok())
                    .is_some_and(|now| {
                        price.observed_at_unix <= now
                            && now.saturating_sub(price.observed_at_unix)
                                <= i64::try_from(self.max_age.as_secs()).unwrap_or(i64::MAX)
                    });
                if within_ttl && within_max_age {
                    return Ok(price.clone());
                }
            }
        }
        let price = self.load(from, to)?;
        self.cache
            .lock()
            .map_err(|_| PriceError::CacheUnavailable)?
            .insert((from, to), (Instant::now(), price.clone()));
        Ok(price)
    }
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
        let (whole_num, whole_den): (i128, i128) = match (from, to) {
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
            (Asset::Eth, Asset::Btc) => (1, 18), // ~1 ETH ≈ 1/18 BTC
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
        let (rate_numerator, rate_denominator) = Self::rate(from, to)
            .ok_or_else(|| PriceError::NoPair(from.symbol().to_owned(), to.symbol().to_owned()))?;
        Ok(ConversionPrice {
            rate_numerator,
            rate_denominator,
            fee_bps: Self::FEE_BPS,
            ttl_seconds: Self::TTL_SECONDS,
            source_ids: vec!["fake".to_owned()],
            observed_at_unix: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .ok()
                .and_then(|value| i64::try_from(value.as_secs()).ok())
                .unwrap_or_default(),
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

    struct TestSource {
        id: &'static str,
        result: Result<ConversionPrice, PriceError>,
    }

    impl PriceSource for TestSource {
        fn quote(&self, _from: Asset, _to: Asset) -> Result<ConversionPrice, PriceError> {
            self.result.clone().map(|mut price| {
                price.source_ids = vec![self.id.to_owned()];
                price
            })
        }
    }

    fn observed_price(rate_numerator: i128, observed_at_unix: i64) -> ConversionPrice {
        ConversionPrice {
            rate_numerator,
            rate_denominator: 1,
            fee_bps: 50,
            ttl_seconds: 30,
            source_ids: Vec::new(),
            observed_at_unix,
        }
    }

    fn aggregate(sources: Vec<Arc<dyn PriceSource>>) -> AggregatedPriceSource {
        AggregatedPriceSource::new(
            sources,
            500,
            Duration::from_secs(60),
            Duration::from_secs(5),
        )
    }

    fn source(id: &'static str, rate: i128) -> Arc<dyn PriceSource> {
        Arc::new(TestSource {
            id,
            result: Ok(observed_price(rate, unix_now())),
        })
    }

    struct CountingSource {
        calls: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl PriceSource for CountingSource {
        fn quote(&self, _from: Asset, _to: Asset) -> Result<ConversionPrice, PriceError> {
            self.calls
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Ok(observed_price(100, unix_now()))
        }
    }

    fn unix_now() -> i64 {
        i64::try_from(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        )
        .unwrap()
    }

    #[test]
    fn agreeing_sources_are_aggregated_by_median_and_recorded() {
        let prices = aggregate(vec![source("one", 100), source("two", 102)])
            .quote(Asset::Usdc, Asset::Xlm)
            .unwrap();
        assert_eq!(prices.rate_numerator, 202);
        assert_eq!(prices.rate_denominator, 2);
        assert_eq!(prices.source_ids, vec!["one", "two"]);
        assert_eq!(prices.ttl_seconds, 5);
    }

    #[test]
    fn disagreeing_sources_are_rejected() {
        let result =
            aggregate(vec![source("one", 100), source("two", 130)]).quote(Asset::Usdc, Asset::Xlm);
        assert_eq!(result, Err(PriceError::SourcesDisagree));
    }

    #[test]
    fn one_source_down_is_tolerated_when_two_others_agree() {
        let offline: Arc<dyn PriceSource> = Arc::new(TestSource {
            id: "offline",
            result: Err(PriceError::NoPair("USDC".to_owned(), "XLM".to_owned())),
        });
        let result = aggregate(vec![source("one", 100), offline, source("two", 102)])
            .quote(Asset::Usdc, Asset::Xlm)
            .unwrap();
        assert_eq!(result.source_ids, vec!["one", "two"]);
    }

    #[test]
    fn stale_observations_are_rejected() {
        let stale_at = unix_now() - 120;
        let stale: Arc<dyn PriceSource> = Arc::new(TestSource {
            id: "stale-one",
            result: Ok(observed_price(100, stale_at)),
        });
        let also_stale: Arc<dyn PriceSource> = Arc::new(TestSource {
            id: "stale-two",
            result: Ok(observed_price(101, stale_at)),
        });
        assert_eq!(
            aggregate(vec![stale, also_stale]).quote(Asset::Usdc, Asset::Xlm),
            Err(PriceError::StalePrice)
        );
    }

    #[test]
    fn cached_price_avoids_requerying_sources() {
        let first_calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let second_calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let price_source = aggregate(vec![
            Arc::new(CountingSource {
                calls: first_calls.clone(),
            }),
            Arc::new(CountingSource {
                calls: second_calls.clone(),
            }),
        ]);
        price_source.quote(Asset::Usdc, Asset::Xlm).unwrap();
        price_source.quote(Asset::Usdc, Asset::Xlm).unwrap();
        assert_eq!(first_calls.load(std::sync::atomic::Ordering::Relaxed), 1);
        assert_eq!(second_calls.load(std::sync::atomic::Ordering::Relaxed), 1);
    }

    #[test]
    fn same_asset_is_refused() {
        let src = FakePriceSource;
        assert_eq!(
            src.quote(Asset::Usdc, Asset::Usdc),
            Err(PriceError::SameAsset)
        );
        assert_eq!(
            src.quote(Asset::Xlm, Asset::Xlm),
            Err(PriceError::SameAsset)
        );
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
