//! Fee schedule types shared across services.
//!
//! A `FeeSchedule` describes the cost of one product (transfer, withdrawal,
//! conversion, buy, sell) for a single asset.  The schedule has a stable UUID
//! (`id`) that is embedded in every quote so the ledger can reject a settlement
//! that was priced against a schedule different from the one it recorded.
//!
//! ## Fee formula
//!
//! ```text
//! percentage_component = ceil(gross_minor × bps / 10_000)
//! clamped_pct          = clamp(percentage_component, min_fee_minor, max_fee_minor)
//! total_fee            = fixed_minor + clamped_pct
//! ```
//!
//! ## Rounding rule
//!
//! The percentage component is always rounded **up** (ceiling division) toward
//! the next smallest unit.  Rounding in favour of the platform is simpler to
//! reason about and avoids the risk of a large number of tiny transactions
//! collectively producing less fee than expected.  The maximum error per quote
//! is one smallest unit (e.g. 0.0000001 USDC), which is negligible for users
//! and predictable for accounting.
//!
//! Integer ceiling division is used throughout:
//!
//! ```text
//! ceil(a / b) = (a + b - 1) / b   (integer, both positive)
//! ```
//!
//! No floating-point arithmetic is ever used.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::Asset;

/// The five products EngiPay charges fees for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Product {
    Transfer,
    Withdrawal,
    Conversion,
    Buy,
    Sell,
}

impl Product {
    pub const ALL: [Product; 5] = [
        Product::Transfer,
        Product::Withdrawal,
        Product::Conversion,
        Product::Buy,
        Product::Sell,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Product::Transfer => "transfer",
            Product::Withdrawal => "withdrawal",
            Product::Conversion => "conversion",
            Product::Buy => "buy",
            Product::Sell => "sell",
        }
    }
}

impl fmt::Display for Product {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("unsupported product: {0}")]
pub struct UnknownProduct(pub String);

impl FromStr for Product {
    type Err = UnknownProduct;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Product::ALL
            .into_iter()
            .find(|p| p.as_str().eq_ignore_ascii_case(value.trim()))
            .ok_or_else(|| UnknownProduct(value.to_owned()))
    }
}

impl TryFrom<String> for Product {
    type Error = UnknownProduct;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        value.parse()
    }
}

impl From<Product> for &'static str {
    fn from(p: Product) -> Self {
        p.as_str()
    }
}

/// A versioned fee schedule for one (product, asset) pair.
///
/// `id` is the version token embedded in every quote.  Because `fee_schedules`
/// is append-only, an `id` always refers to exactly one set of parameters.
/// Settlement that receives this `id` can look it up and confirm it matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeeSchedule {
    /// Stable version identifier – included in every quote.
    pub id: Uuid,
    pub product: Product,
    pub asset: Asset,
    /// Flat fee in the asset's smallest units.  Added unconditionally.
    pub fixed_minor: i128,
    /// Percentage component in basis points (1 bp = 0.01 %).
    /// E.g. `30` → 0.30 %.  `0` means no percentage component.
    pub bps: u32,
    /// Floor applied to the percentage component only (not to `fixed_minor`).
    pub min_fee_minor: i128,
    /// Optional cap on the *total* fee (fixed + percentage).
    /// `None` means no cap.
    pub max_fee_minor: Option<i128>,
}

/// Outcome of computing a fee.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeeResult {
    /// Total fee in smallest units of the schedule's asset.
    pub fee_minor: i128,
    /// The schedule version that produced this fee.
    pub schedule_version: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum FeeError {
    #[error("gross amount must be greater than zero")]
    NonPositiveGross,
    #[error("fee schedule asset {schedule} does not match gross asset {gross}")]
    AssetMismatch { schedule: Asset, gross: Asset },
    #[error("arithmetic overflow computing fee")]
    Overflow,
}

impl FeeSchedule {
    /// Compute the fee for a given gross amount (before fees), in the
    /// asset's smallest units.
    ///
    /// The gross and schedule assets must match; passing the wrong asset is a
    /// programming error and returns `FeeError::AssetMismatch`.
    ///
    /// # Rounding
    ///
    /// The percentage component is rounded **up** (ceiling division).  See the
    /// module-level documentation for the full formula and rationale.
    pub fn compute_fee(&self, gross_minor: i128) -> Result<FeeResult, FeeError> {
        if gross_minor <= 0 {
            return Err(FeeError::NonPositiveGross);
        }

        // Percentage component: ceil(gross × bps / 10_000).
        // Using integer ceiling: (a + b - 1) / b, all checked for overflow.
        let pct_component: i128 = if self.bps == 0 {
            0
        } else {
            let bps = i128::from(self.bps);
            let numerator = gross_minor.checked_mul(bps).ok_or(FeeError::Overflow)?;
            let divisor: i128 = 10_000;
            // ceil division: (n + d - 1) / d
            numerator
                .checked_add(divisor - 1)
                .and_then(|v| v.checked_div(divisor))
                .ok_or(FeeError::Overflow)?
        };

        // Apply floor to the percentage component only.
        let clamped_pct = pct_component.max(self.min_fee_minor);

        // Add the flat component.
        let total = self
            .fixed_minor
            .checked_add(clamped_pct)
            .ok_or(FeeError::Overflow)?;

        // Apply the optional cap to the total.
        let fee_minor = match self.max_fee_minor {
            Some(cap) => total.min(cap),
            None => total,
        };

        Ok(FeeResult {
            fee_minor,
            schedule_version: self.id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schedule(fixed: i128, bps: u32, min: i128, max: Option<i128>) -> FeeSchedule {
        FeeSchedule {
            id: Uuid::new_v4(),
            product: Product::Transfer,
            asset: Asset::Usdc,
            fixed_minor: fixed,
            bps,
            min_fee_minor: min,
            max_fee_minor: max,
        }
    }

    // 1 USDC = 10_000_000 smallest units (7 decimals).
    const USDC: i128 = 10_000_000;

    #[test]
    fn flat_fee_only() {
        // 0.10 USDC flat, no percentage.
        let s = schedule(USDC / 10, 0, 0, None);
        let r = s.compute_fee(100 * USDC).unwrap();
        assert_eq!(r.fee_minor, USDC / 10);
    }

    #[test]
    fn percentage_fee_only() {
        // 0.30 % = 30 bps, no flat, no floor, no cap.
        let s = schedule(0, 30, 0, None);
        // 100 USDC × 0.30 % = 0.30 USDC = 3_000_000 smallest units.
        let r = s.compute_fee(100 * USDC).unwrap();
        assert_eq!(r.fee_minor, 3 * USDC / 10);
    }

    #[test]
    fn percentage_rounds_up() {
        // 30 bps on 1 smallest unit:
        // exact = 1 × 30 / 10_000 = 0.003  →  ceil = 1.
        let s = schedule(0, 30, 0, None);
        let r = s.compute_fee(1).unwrap();
        assert_eq!(r.fee_minor, 1, "must round up, not down or to zero");
    }

    #[test]
    fn min_fee_applied_to_percentage_component() {
        // 0.30 % of 10 USDC = 0.03 USDC, but min is 0.50 USDC.
        let s = schedule(0, 30, USDC / 2, None);
        let r = s.compute_fee(10 * USDC).unwrap();
        assert_eq!(r.fee_minor, USDC / 2);
    }

    #[test]
    fn min_fee_not_applied_when_percentage_exceeds_it() {
        // 0.30 % of 1000 USDC = 3 USDC, which exceeds min of 0.50 USDC.
        let s = schedule(0, 30, USDC / 2, None);
        let r = s.compute_fee(1_000 * USDC).unwrap();
        assert_eq!(r.fee_minor, 3 * USDC);
    }

    #[test]
    fn max_fee_caps_total() {
        // 0.30 % of 10_000 USDC = 30 USDC, but cap is 10 USDC.
        let s = schedule(0, 30, 0, Some(10 * USDC));
        let r = s.compute_fee(10_000 * USDC).unwrap();
        assert_eq!(r.fee_minor, 10 * USDC);
    }

    #[test]
    fn fixed_plus_percentage_with_all_params() {
        // 0.50 flat + 0.30 % (min 0.50, max 10 USDC) — withdrawal schedule.
        let s = schedule(USDC / 2, 30, USDC / 2, Some(10 * USDC));

        // 50 USDC: pct = ceil(500_000_000 × 30 / 10_000) = 1_500_000.
        // 1_500_000 < min_fee_minor (5_000_000), so clamped_pct = 5_000_000.
        // total = fixed(5_000_000) + clamped_pct(5_000_000) = 10_000_000.
        // 10_000_000 < cap(100_000_000) → final fee = 10_000_000.
        let r = s.compute_fee(50 * USDC).unwrap();
        assert_eq!(r.fee_minor, 10_000_000);

        // Very small amount (1 unit): pct = ceil(1×30/10_000) = 1.
        // Floored to min 5_000_000; total = 5_000_000 + 5_000_000 = 10_000_000.
        let r_small = s.compute_fee(USDC).unwrap();
        assert_eq!(r_small.fee_minor, 10_000_000);

        // Large amount (5_000 USDC): pct = ceil(50_000_000_000×30/10_000) = 150_000_000.
        // 150_000_000 > min (5_000_000), so clamped_pct = 150_000_000.
        // total = 5_000_000 + 150_000_000 = 155_000_000 → exceeds cap (100_000_000).
        let r_large = s.compute_fee(5_000 * USDC).unwrap();
        assert_eq!(r_large.fee_minor, 10 * USDC);
    }

    #[test]
    fn refuses_non_positive_gross() {
        let s = schedule(0, 30, 0, None);
        assert_eq!(s.compute_fee(0), Err(FeeError::NonPositiveGross));
        assert_eq!(s.compute_fee(-1), Err(FeeError::NonPositiveGross));
    }

    #[test]
    fn schedule_version_is_propagated() {
        let id = Uuid::new_v4();
        let s = FeeSchedule {
            id,
            product: Product::Withdrawal,
            asset: Asset::Usdc,
            fixed_minor: 0,
            bps: 30,
            min_fee_minor: 0,
            max_fee_minor: None,
        };
        let r = s.compute_fee(USDC).unwrap();
        assert_eq!(r.schedule_version, id);
    }

    #[test]
    fn product_roundtrips_str() {
        for p in Product::ALL {
            assert_eq!(p.as_str().parse::<Product>().unwrap(), p);
        }
    }

    #[test]
    fn product_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&Product::Transfer).unwrap(),
            "\"transfer\""
        );
        assert_eq!(
            serde_json::from_str::<Product>("\"withdrawal\"").unwrap(),
            Product::Withdrawal
        );
    }
}
