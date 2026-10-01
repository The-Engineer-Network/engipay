//! Exact money.
//!
//! Amounts are whole numbers of the asset's smallest unit (wei, USDC units,
//! sats) held in an `i128`. There is no floating point anywhere, so 0.1 + 0.2
//! is exactly 0.3, and a balance can never drift by a rounding error.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::{Asset, Chain};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MoneyError {
    #[error("amount is empty")]
    Empty,
    #[error("amount is not a plain decimal number: {0}")]
    Invalid(String),
    /// Rejected rather than rounded: a user who types 0.0000001 BTC must be told,
    /// not silently charged a different amount.
    #[error("{asset} supports at most {max_decimals} decimal places")]
    TooPrecise { asset: Asset, max_decimals: u32 },
    #[error("amount is too large")]
    Overflow,
    #[error("cannot combine {left} with {right}")]
    AssetMismatch { left: Asset, right: Asset },
    #[error("{asset} is not available on {chain:?}")]
    NotOnNetwork { asset: Asset, chain: Chain },
    /// The ledger holds USDC at 7 decimals, but Base USDC has only 6. An amount
    /// with a 7th-decimal digit cannot be sent on Base, and is refused rather
    /// than silently trimmed.
    #[error("{asset} amount has more precision than {chain:?} supports")]
    NotRepresentable { asset: Asset, chain: Chain },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Money {
    pub asset: Asset,
    /// Smallest units. Signed, because ledger postings are debits and credits.
    pub minor: i128,
}

impl Money {
    pub const fn from_minor(asset: Asset, minor: i128) -> Self {
        Self { asset, minor }
    }

    pub const fn zero(asset: Asset) -> Self {
        Self { asset, minor: 0 }
    }

    pub const fn is_positive(&self) -> bool {
        self.minor > 0
    }

    pub const fn is_zero(&self) -> bool {
        self.minor == 0
    }

    /// Parses a human amount such as "1.5" for `asset`.
    ///
    /// Accepts only digits with at most one decimal point. Signs, exponents,
    /// spaces inside the number and separators are all rejected: an amount that
    /// could be read two ways must not be read either way.
    pub fn parse(asset: Asset, input: &str) -> Result<Self, MoneyError> {
        let text = input.trim();
        if text.is_empty() {
            return Err(MoneyError::Empty);
        }

        let (whole, fraction) = match text.split_once('.') {
            Some((w, f)) => (w, f),
            None => (text, ""),
        };

        let well_formed = !(whole.is_empty() && fraction.is_empty())
            && whole.bytes().all(|b| b.is_ascii_digit())
            && fraction.bytes().all(|b| b.is_ascii_digit());
        if !well_formed {
            return Err(MoneyError::Invalid(input.to_owned()));
        }

        let decimals = asset.decimals();
        let fraction = fraction.trim_end_matches('0');
        let fraction_len = u32::try_from(fraction.len()).map_err(|_| MoneyError::Overflow)?;
        if fraction_len > decimals {
            return Err(MoneyError::TooPrecise {
                asset,
                max_decimals: decimals,
            });
        }

        let scale = 10i128.checked_pow(decimals).ok_or(MoneyError::Overflow)?;
        let whole_units = if whole.is_empty() {
            0
        } else {
            whole.parse::<i128>().map_err(|_| MoneyError::Overflow)?
        };

        let fraction_units = if fraction.is_empty() {
            0
        } else {
            let padding = decimals
                .checked_sub(fraction_len)
                .ok_or(MoneyError::Overflow)?;
            let raw = fraction.parse::<i128>().map_err(|_| MoneyError::Overflow)?;
            raw.checked_mul(10i128.checked_pow(padding).ok_or(MoneyError::Overflow)?)
                .ok_or(MoneyError::Overflow)?
        };

        let minor = whole_units
            .checked_mul(scale)
            .and_then(|units| units.checked_add(fraction_units))
            .ok_or(MoneyError::Overflow)?;

        Ok(Self { asset, minor })
    }

    pub fn checked_add(self, other: Money) -> Result<Money, MoneyError> {
        self.same_asset(other)?;
        let minor = self
            .minor
            .checked_add(other.minor)
            .ok_or(MoneyError::Overflow)?;
        Ok(Money {
            asset: self.asset,
            minor,
        })
    }

    pub fn checked_sub(self, other: Money) -> Result<Money, MoneyError> {
        self.same_asset(other)?;
        let minor = self
            .minor
            .checked_sub(other.minor)
            .ok_or(MoneyError::Overflow)?;
        Ok(Money {
            asset: self.asset,
            minor,
        })
    }

    pub fn checked_neg(self) -> Result<Money, MoneyError> {
        let minor = self.minor.checked_neg().ok_or(MoneyError::Overflow)?;
        Ok(Money {
            asset: self.asset,
            minor,
        })
    }

    /// Converts to the units a network uses on-chain, e.g. ledger USDC (7
    /// decimals) to Base USDC (6 decimals). Refuses amounts the network cannot
    /// represent instead of rounding them.
    pub fn to_network_units(self, chain: Chain) -> Result<i128, MoneyError> {
        let factor = network_factor(self.asset, chain)?;
        let remainder = self.minor.checked_rem(factor).ok_or(MoneyError::Overflow)?;
        if remainder != 0 {
            return Err(MoneyError::NotRepresentable {
                asset: self.asset,
                chain,
            });
        }
        self.minor.checked_div(factor).ok_or(MoneyError::Overflow)
    }

    /// Converts on-chain units from a network into ledger money. Always exact,
    /// because the ledger is never less precise than any network.
    /// The amount alone as an exact decimal, trailing zeros removed: "1.5",
    /// "0", "-2". For JSON fields and URIs, where the asset is said elsewhere.
    pub fn decimal(&self) -> String {
        let decimals = self.asset.decimals() as usize;
        let sign = if self.minor < 0 { "-" } else { "" };
        let digits = self.minor.unsigned_abs().to_string();
        // Padding to decimals + 1 guarantees at least one whole digit, so the
        // split point can never underflow; saturating keeps that explicit.
        let padded = format!("{digits:0>width$}", width = decimals.saturating_add(1));
        let split = padded.len().saturating_sub(decimals);
        let (whole, fraction) = padded.split_at(split);
        let fraction = fraction.trim_end_matches('0');
        if fraction.is_empty() {
            format!("{sign}{whole}")
        } else {
            format!("{sign}{whole}.{fraction}")
        }
    }

    pub fn from_network_units(
        asset: Asset,
        chain: Chain,
        units: i128,
    ) -> Result<Money, MoneyError> {
        let factor = network_factor(asset, chain)?;
        let minor = units.checked_mul(factor).ok_or(MoneyError::Overflow)?;
        Ok(Money { asset, minor })
    }

    fn same_asset(self, other: Money) -> Result<(), MoneyError> {
        if self.asset == other.asset {
            Ok(())
        } else {
            Err(MoneyError::AssetMismatch {
                left: self.asset,
                right: other.asset,
            })
        }
    }
}

/// How many ledger units make one on-chain unit: 10 for Base USDC, 1 when the
/// precisions match.
fn network_factor(asset: Asset, chain: Chain) -> Result<i128, MoneyError> {
    let network = asset
        .network_decimals(chain)
        .ok_or(MoneyError::NotOnNetwork { asset, chain })?;
    let shift = asset
        .decimals()
        .checked_sub(network)
        .ok_or(MoneyError::Overflow)?;
    10i128.checked_pow(shift).ok_or(MoneyError::Overflow)
}

impl fmt::Display for Money {
    /// Human form with trailing zeros removed: "1.5 ETH", "0 USDC", "-2 BTC".
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.decimal(), self.asset)
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn usdc(text: &str) -> Result<Money, MoneyError> {
        Money::parse(Asset::Usdc, text)
    }

    #[test]
    fn decimal_is_the_exact_amount_without_the_symbol() {
        assert_eq!(usdc("1.50").unwrap().decimal(), "1.5");
        assert_eq!(usdc("0").unwrap().decimal(), "0");
        assert_eq!(usdc("0.0000001").unwrap().decimal(), "0.0000001");
        assert_eq!(Money::from_minor(Asset::Btc, -200_000_000).decimal(), "-2");
        assert_eq!(usdc("1.5").unwrap().to_string(), "1.5 USDC");
    }

    #[test]
    fn parses_to_exact_smallest_units() {
        assert_eq!(usdc("1.5").map(|m| m.minor), Ok(15_000_000));
        assert_eq!(usdc("0.0000001").map(|m| m.minor), Ok(1));
        assert_eq!(usdc("0").map(|m| m.minor), Ok(0));
    }

    #[test]
    fn base_usdc_six_decimals_scale_to_seven_decimal_ledger_units() {
        // 1 USDC on Base is 1_000_000 on-chain units (6 decimals); the ledger
        // holds it as 10_000_000 minor units (7 decimals).
        let one = Money::from_network_units(Asset::Usdc, Chain::Base, 1_000_000).unwrap();
        assert_eq!(one.minor, 10_000_000);
        assert_eq!(one, usdc("1").unwrap());

        // The smallest Base unit (0.000001 USDC) maps to 10 ledger units with
        // no truncation.
        let dust = Money::from_network_units(Asset::Usdc, Chain::Base, 1).unwrap();
        assert_eq!(dust.minor, 10);

        // A non-round amount keeps every digit.
        let odd = Money::from_network_units(Asset::Usdc, Chain::Base, 123_456).unwrap();
        assert_eq!(odd.minor, 1_234_560);
        assert_eq!(odd, usdc("0.123456").unwrap());
    }

    #[test]
    fn base_usdc_round_trips_without_loss() {
        for units in [0i128, 1, 10, 999_999, 1_000_000, 123_456_789] {
            let money = Money::from_network_units(Asset::Usdc, Chain::Base, units).unwrap();
            assert_eq!(money.to_network_units(Chain::Base), Ok(units));
        }
    }

    #[test]
    fn ledger_usdc_with_seventh_decimal_is_not_representable_on_base() {
        // 1 minor unit at 7 decimals has no Base representation and must be
        // refused rather than rounded away.
        let too_fine = Money::from_minor(Asset::Usdc, 1);
        assert_eq!(
            too_fine.to_network_units(Chain::Base),
            Err(MoneyError::NotRepresentable {
                asset: Asset::Usdc,
                chain: Chain::Base,
            })
        );
    }

    #[test]
    fn from_network_units_rejects_assets_absent_from_the_network() {
        assert_eq!(
            Money::from_network_units(Asset::Btc, Chain::Base, 1),
            Err(MoneyError::NotOnNetwork {
                asset: Asset::Btc,
                chain: Chain::Base,
            })
        );
    }
}
