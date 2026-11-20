//! Manual review gate for high-value withdrawals.
//!
//! Withdrawals above the configured threshold must not proceed directly to
//! signing.  Instead they are flagged as `pending_manual_review`, an alert is
//! dispatched to the operations team, and the signing keys are never invoked
//! until a dual-operator approval has been recorded.
//!
//! # Threshold
//!
//! The threshold is configurable at construction time via
//! [`ReviewConfig::new`].  The default (`$10,000 USDC`) is set as
//! [`DEFAULT_REVIEW_THRESHOLD_MINOR`] and reflects the security requirement
//! in issue #187.  Production deployments can override this through the
//! `WITHDRAWAL_REVIEW_THRESHOLD_USDC` environment variable (integer USDC,
//! no decimals required).
//!
//! # Alerting
//!
//! There is no persistent notification bus yet (it is planned but not yet
//! wired).  Following the pattern established in the chain DLQ module, alerts
//! are emitted as structured [`tracing::warn!`] events at the `warn` level
//! with a dedicated `alert` field.  Log aggregation infrastructure (Datadog,
//! Loki, etc.) can route on this field.
//!
//! # Exact arithmetic
//!
//! All comparisons use integer minor units (`i128`).  Floating point is never
//! used to represent money — a project-wide invariant enforced by the
//! workspace lints.

use engipay_core::{Asset, Money};

// ── Threshold ─────────────────────────────────────────────────────────────────

/// The default high-value threshold: $10,000 USDC.
///
/// USDC has 7 decimal places in EngiPay's internal ledger, so:
///   `10_000 USD × 10_000_000 minor-units/USD = 100_000_000_000 minor units`.
pub const DEFAULT_REVIEW_THRESHOLD_MINOR: i128 = 10_000_i128 * 10_000_000_i128;

// ── ReviewConfig ──────────────────────────────────────────────────────────────

/// Configuration for the withdrawal review gate.
///
/// Construct with [`ReviewConfig::default`] to use the built-in threshold, or
/// with [`ReviewConfig::new`] to specify a custom threshold (useful in tests
/// and for production deployments that need a different limit).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewConfig {
    /// Withdrawals **strictly greater than** this amount require manual review.
    /// Stored in USDC minor units (7 decimal places).
    pub threshold: Money,
}

impl ReviewConfig {
    /// Creates a config with a custom threshold.
    ///
    /// `threshold_minor` is in USDC minor units.  Pass `0` to require review
    /// on all withdrawals.
    pub fn new(threshold_minor: i128) -> Self {
        Self {
            threshold: Money::from_minor(Asset::Usdc, threshold_minor),
        }
    }

    /// Reads the threshold from the `WITHDRAWAL_REVIEW_THRESHOLD_USDC`
    /// environment variable (whole USDC, no decimals), falling back to
    /// [`DEFAULT_REVIEW_THRESHOLD_MINOR`].
    ///
    /// Returns an error string if the variable is set but cannot be parsed.
    pub fn from_env() -> Result<Self, String> {
        match std::env::var("WITHDRAWAL_REVIEW_THRESHOLD_USDC") {
            Err(_) => Ok(Self::default()),
            Ok(raw) => {
                let whole: i128 = raw.trim().parse().map_err(|_| {
                    format!(
                        "WITHDRAWAL_REVIEW_THRESHOLD_USDC must be a whole-number USDC amount, got {:?}",
                        raw
                    )
                })?;
                if whole < 0 {
                    return Err(format!(
                        "WITHDRAWAL_REVIEW_THRESHOLD_USDC must not be negative, got {whole}"
                    ));
                }
                // Convert whole USDC to minor units (7 decimal places).
                let minor = whole
                    .checked_mul(10_000_000)
                    .ok_or_else(|| "WITHDRAWAL_REVIEW_THRESHOLD_USDC is too large".to_owned())?;
                Ok(Self::new(minor))
            }
        }
    }
}

impl Default for ReviewConfig {
    fn default() -> Self {
        Self::new(DEFAULT_REVIEW_THRESHOLD_MINOR)
    }
}

// ── ReviewDecision ────────────────────────────────────────────────────────────

/// The decision produced by [`check_withdrawal`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReviewDecision {
    /// The withdrawal is within the threshold and may proceed to signing.
    Approved,
    /// The withdrawal exceeds the threshold and must wait for dual-operator
    /// approval before signing keys are invoked.
    PendingManualReview {
        /// The withdrawal amount that triggered the review.
        amount: Money,
        /// The threshold that was exceeded.
        threshold: Money,
    },
}

impl ReviewDecision {
    /// The withdrawal status string stored in the database.
    pub fn status(&self) -> &'static str {
        match self {
            ReviewDecision::Approved => "approved",
            ReviewDecision::PendingManualReview { .. } => "pending_manual_review",
        }
    }

    /// Returns `true` if the withdrawal requires manual review.
    pub fn requires_review(&self) -> bool {
        matches!(self, ReviewDecision::PendingManualReview { .. })
    }
}

// ── check_withdrawal ──────────────────────────────────────────────────────────

/// Determines whether a withdrawal requires manual review.
///
/// Withdrawals whose `amount` is **strictly greater than**
/// `config.threshold` are flagged as `pending_manual_review` and an alert is
/// logged.  All comparisons are exact integer arithmetic — no floating point.
///
/// # Arguments
///
/// * `amount`  — the withdrawal amount in USDC minor units.
/// * `config`  — the review threshold configuration.
///
/// # Returns
///
/// A [`ReviewDecision`]:
/// - [`ReviewDecision::Approved`] when `amount <= threshold`.
/// - [`ReviewDecision::PendingManualReview`] when `amount > threshold`.
///
/// # Alerting
///
/// When a withdrawal is flagged, a structured `warn!` log event is emitted
/// with `alert = "high_value_withdrawal"`.  Operations tooling should route
/// on this field.
pub fn check_withdrawal(amount: Money, config: &ReviewConfig) -> ReviewDecision {
    if amount.minor > config.threshold.minor {
        // Emit a structured alert. The operations team monitors for
        // `alert = "high_value_withdrawal"` in log aggregation.
        tracing::warn!(
            alert = "high_value_withdrawal",
            amount_minor = amount.minor,
            threshold_minor = config.threshold.minor,
            status = "pending_manual_review",
            "high-value withdrawal flagged for manual review; \
             signing keys will NOT be invoked until dual-operator approval"
        );

        ReviewDecision::PendingManualReview {
            amount,
            threshold: config.threshold,
        }
    } else {
        ReviewDecision::Approved
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use super::*;

    // Helper: 1 USDC = 10_000_000 minor units (7 decimals).
    fn usdc(whole: i128) -> Money {
        Money::from_minor(Asset::Usdc, whole.saturating_mul(10_000_000))
    }

    fn usdc_minor(minor: i128) -> Money {
        Money::from_minor(Asset::Usdc, minor)
    }

    // ── ReviewConfig ──────────────────────────────────────────────────────────

    #[test]
    fn default_threshold_is_10_000_usdc() {
        let config = ReviewConfig::default();
        assert_eq!(config.threshold.minor, DEFAULT_REVIEW_THRESHOLD_MINOR);
        assert_eq!(config.threshold.minor, usdc(10_000).minor);
    }

    #[test]
    fn custom_threshold_stores_correct_minor_units() {
        let config = ReviewConfig::new(usdc(5_000).minor);
        assert_eq!(config.threshold.minor, 5_000 * 10_000_000);
    }

    #[test]
    fn zero_threshold_flags_all_positive_withdrawals() {
        let config = ReviewConfig::new(0);
        assert!(check_withdrawal(usdc_minor(1), &config).requires_review());
    }

    // ── check_withdrawal: normal / approved cases ─────────────────────────────

    #[test]
    fn withdrawal_below_threshold_is_approved() {
        let config = ReviewConfig::default();
        let result = check_withdrawal(usdc(9_999), &config);
        assert_eq!(result, ReviewDecision::Approved);
        assert_eq!(result.status(), "approved");
        assert!(!result.requires_review());
    }

    #[test]
    fn withdrawal_exactly_at_threshold_is_approved() {
        let config = ReviewConfig::default();
        // Exactly $10,000 USDC: must NOT trigger review (strictly greater than).
        let result = check_withdrawal(usdc(10_000), &config);
        assert_eq!(result, ReviewDecision::Approved);
        assert!(!result.requires_review());
    }

    #[test]
    fn zero_amount_withdrawal_is_approved() {
        let config = ReviewConfig::default();
        let result = check_withdrawal(Money::zero(Asset::Usdc), &config);
        assert_eq!(result, ReviewDecision::Approved);
    }

    // ── check_withdrawal: high-value / review cases ───────────────────────────

    #[test]
    fn withdrawal_above_threshold_requires_review() {
        let config = ReviewConfig::default();
        let result = check_withdrawal(usdc(10_001), &config);
        assert!(result.requires_review());
        assert_eq!(result.status(), "pending_manual_review");
    }

    #[test]
    fn withdrawal_one_minor_unit_above_threshold_requires_review() {
        let config = ReviewConfig::default();
        // Exactly one minor unit over the threshold.
        let amount = usdc_minor(DEFAULT_REVIEW_THRESHOLD_MINOR + 1);
        let result = check_withdrawal(amount, &config);
        assert!(result.requires_review());
        assert_eq!(result.status(), "pending_manual_review");
    }

    #[test]
    fn review_decision_carries_amount_and_threshold() {
        let config = ReviewConfig::default();
        let amount = usdc(15_000);
        let result = check_withdrawal(amount, &config);

        match result {
            ReviewDecision::PendingManualReview {
                amount: a,
                threshold: t,
            } => {
                assert_eq!(a.minor, usdc(15_000).minor);
                assert_eq!(t.minor, DEFAULT_REVIEW_THRESHOLD_MINOR);
            }
            ReviewDecision::Approved => panic!("expected PendingManualReview"),
        }
    }

    #[test]
    fn large_withdrawal_requires_review() {
        let config = ReviewConfig::default();
        let result = check_withdrawal(usdc(1_000_000), &config);
        assert!(result.requires_review());
    }

    // ── boundary values ───────────────────────────────────────────────────────

    #[test]
    fn boundary_one_below_threshold_is_approved() {
        let config = ReviewConfig::default();
        let just_under = usdc_minor(DEFAULT_REVIEW_THRESHOLD_MINOR - 1);
        assert!(!check_withdrawal(just_under, &config).requires_review());
    }

    #[test]
    fn boundary_exactly_at_threshold_is_approved() {
        let config = ReviewConfig::default();
        let at_threshold = usdc_minor(DEFAULT_REVIEW_THRESHOLD_MINOR);
        assert!(!check_withdrawal(at_threshold, &config).requires_review());
    }

    #[test]
    fn boundary_one_above_threshold_requires_review() {
        let config = ReviewConfig::default();
        let one_above = usdc_minor(DEFAULT_REVIEW_THRESHOLD_MINOR + 1);
        assert!(check_withdrawal(one_above, &config).requires_review());
    }

    // ── ReviewDecision::status strings are stable ─────────────────────────────

    #[test]
    fn status_strings_are_stable() {
        let approved = ReviewDecision::Approved;
        assert_eq!(approved.status(), "approved");

        let review = ReviewDecision::PendingManualReview {
            amount: usdc(1),
            threshold: usdc(0),
        };
        assert_eq!(review.status(), "pending_manual_review");
    }

    // ── custom thresholds ─────────────────────────────────────────────────────

    #[test]
    fn custom_lower_threshold_flags_smaller_amounts() {
        let config = ReviewConfig::new(usdc(1_000).minor);
        // $1,001 exceeds $1,000 threshold.
        assert!(check_withdrawal(usdc(1_001), &config).requires_review());
        // $1,000 exactly does not.
        assert!(!check_withdrawal(usdc(1_000), &config).requires_review());
        // $999 does not.
        assert!(!check_withdrawal(usdc(999), &config).requires_review());
    }

    #[test]
    fn custom_higher_threshold_allows_large_amounts() {
        let config = ReviewConfig::new(usdc(50_000).minor);
        // $10,000 (default threshold) should be approved under a $50,000 limit.
        assert!(!check_withdrawal(usdc(10_000), &config).requires_review());
        assert!(!check_withdrawal(usdc(49_999), &config).requires_review());
        assert!(!check_withdrawal(usdc(50_000), &config).requires_review());
        assert!(check_withdrawal(usdc(50_001), &config).requires_review());
    }

    // ── from_env ──────────────────────────────────────────────────────────────

    #[test]
    fn from_env_falls_back_to_default_when_unset() {
        // Remove the variable if it happens to be set, then check the default.
        // SAFETY: test-only, single-threaded context; no other threads read this var.
        unsafe { std::env::remove_var("WITHDRAWAL_REVIEW_THRESHOLD_USDC") };
        let config = ReviewConfig::from_env().unwrap();
        assert_eq!(config.threshold.minor, DEFAULT_REVIEW_THRESHOLD_MINOR);
    }

    #[test]
    fn from_env_parses_whole_usdc_correctly() {
        // SAFETY: test-only, single-threaded context; no other threads read this var.
        unsafe { std::env::set_var("WITHDRAWAL_REVIEW_THRESHOLD_USDC", "5000") };
        let config = ReviewConfig::from_env().unwrap();
        // 5000 USDC × 10_000_000 minor/USDC.
        assert_eq!(config.threshold.minor, 5_000 * 10_000_000);
        unsafe { std::env::remove_var("WITHDRAWAL_REVIEW_THRESHOLD_USDC") };
    }

    #[test]
    fn from_env_rejects_non_numeric_value() {
        // SAFETY: test-only, single-threaded context; no other threads read this var.
        unsafe { std::env::set_var("WITHDRAWAL_REVIEW_THRESHOLD_USDC", "notanumber") };
        let result = ReviewConfig::from_env();
        assert!(result.is_err(), "non-numeric value must be rejected");
        unsafe { std::env::remove_var("WITHDRAWAL_REVIEW_THRESHOLD_USDC") };
    }

    #[test]
    fn from_env_rejects_negative_value() {
        // SAFETY: test-only, single-threaded context; no other threads read this var.
        unsafe { std::env::set_var("WITHDRAWAL_REVIEW_THRESHOLD_USDC", "-100") };
        let result = ReviewConfig::from_env();
        assert!(result.is_err(), "negative threshold must be rejected");
        unsafe { std::env::remove_var("WITHDRAWAL_REVIEW_THRESHOLD_USDC") };
    }

    // ── no floating-point money ───────────────────────────────────────────────

    #[test]
    fn all_amounts_are_exact_integers() {
        let config = ReviewConfig::default();
        // Verify that a fractional-cent amount is handled as an integer,
        // not a float (would round differently on different platforms).
        let one_cent = usdc_minor(1); // 1 minor unit of USDC
        let result = check_withdrawal(one_cent, &config);
        assert_eq!(result, ReviewDecision::Approved);

        // i128::MAX is representable without overflow.
        let huge = Money::from_minor(Asset::Usdc, i128::MAX);
        let huge_result = check_withdrawal(huge, &config);
        assert!(huge_result.requires_review());
    }
}
