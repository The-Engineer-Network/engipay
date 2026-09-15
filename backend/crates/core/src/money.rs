//! Exact money.
//!
//! Amounts are whole numbers of the asset's smallest unit (wei, USDC units,
//! sats) held in an `i128`. There is no floating point anywhere, so 0.1 + 0.2
//! is exactly 0.3, and a balance can never drift by a rounding error.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::Asset;

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

impl fmt::Display for Money {
    /// Human form with trailing zeros removed: "1.5 ETH", "0 USDC", "-2 BTC".
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
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
            write!(f, "{sign}{whole} {}", self.asset)
        } else {
            write!(f, "{sign}{whole}.{fraction} {}", self.asset)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usdc(text: &str) -> Result<Money, MoneyError> {
        Money::parse(Asset::Usdc, text)
    }

    #[test]
    fn parses_to_exact_smallest_units() {
        assert_eq!(usdc("1.5").map(|m| m.minor), Ok(1_500_000));
        assert_eq!(usdc("25").map(|m| m.minor), Ok(25_000_000));
        assert_eq!(usdc(".5").map(|m| m.minor), Ok(500_000));
        assert_eq!(usdc("0.000001").map(|m| m.minor), Ok(1));
        assert_eq!(
            Money::parse(Asset::Eth, "1").map(|m| m.minor),
            Ok(1_000_000_000_000_000_000)
        );
        assert_eq!(
            Money::parse(Asset::Btc, "0.00000001").map(|m| m.minor),
            Ok(1)
        );
    }

    #[test]
    fn has_no_floating_point_error() {
        let a = Money::parse(Asset::Eth, "0.1").ok();
        let b = Money::parse(Asset::Eth, "0.2").ok();
        let sum = a.zip(b).and_then(|(a, b)| a.checked_add(b).ok());
        assert_eq!(sum, Money::parse(Asset::Eth, "0.3").ok());
    }

    #[test]
    fn trailing_zeros_do_not_count_as_precision() {
        assert_eq!(usdc("1.50000000").map(|m| m.minor), Ok(1_500_000));
    }

    #[test]
    fn rejects_more_precision_than_the_asset_has_instead_of_rounding() {
        assert_eq!(
            usdc("1.0000001"),
            Err(MoneyError::TooPrecise {
                asset: Asset::Usdc,
                max_decimals: 6
            })
        );
        assert!(Money::parse(Asset::Btc, "0.000000001").is_err());
    }

    #[test]
    fn rejects_anything_that_is_not_a_plain_number() {
        for bad in [
            "", "   ", ".", "-1", "+1", "1e6", "1,000", "1.2.3", "1 000", "abc", "0x10",
        ] {
            assert!(usdc(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn refuses_to_mix_assets() {
        let eth = Money::from_minor(Asset::Eth, 1);
        let btc = Money::from_minor(Asset::Btc, 1);
        assert_eq!(
            eth.checked_add(btc),
            Err(MoneyError::AssetMismatch {
                left: Asset::Eth,
                right: Asset::Btc
            })
        );
    }

    #[test]
    fn detects_overflow_instead_of_wrapping() {
        let max = Money::from_minor(Asset::Usdc, i128::MAX);
        assert_eq!(
            max.checked_add(Money::from_minor(Asset::Usdc, 1)),
            Err(MoneyError::Overflow)
        );
        assert_eq!(
            usdc("999999999999999999999999999999999999999"),
            Err(MoneyError::Overflow)
        );
    }

    #[test]
    fn displays_human_amounts() {
        assert_eq!(
            Money::from_minor(Asset::Usdc, 1_500_000).to_string(),
            "1.5 USDC"
        );
        assert_eq!(Money::from_minor(Asset::Usdc, 0).to_string(), "0 USDC");
        assert_eq!(
            Money::from_minor(Asset::Btc, 1).to_string(),
            "0.00000001 BTC"
        );
        assert_eq!(
            Money::from_minor(Asset::Btc, -250_000_000).to_string(),
            "-2.5 BTC"
        );
    }

    #[test]
    fn display_and_parse_round_trip() {
        for text in ["0.000001", "1", "123.456789", "1000000"] {
            let money = usdc(text).ok();
            let shown = money.map(|m| m.to_string().trim_end_matches(" USDC").to_owned());
            assert_eq!(shown.as_deref(), Some(text));
        }
    }
}
