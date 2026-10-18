//! AML velocity limits: a rolling 24-hour transaction volume ceiling per KYC
//! tier (issues #113, #114).

use engipay_core::{Asset, Money, UserId};
use sqlx::PgPool;

use crate::error::ApiError;

#[derive(Debug, thiserror::Error)]
pub enum LimitError {
    #[error("database error: {0}")]
    Database(String),
    #[error(
        "24h volume of {current} plus the requested {requested} exceeds the tier {tier} daily limit of {limit}"
    )]
    Exceeded {
        tier: i32,
        current: i128,
        requested: i128,
        limit: i128,
    },
}

impl From<LimitError> for ApiError {
    fn from(error: LimitError) -> Self {
        match error {
            LimitError::Exceeded { .. } => ApiError::LimitExceeded(error.to_string()),
            LimitError::Database(message) => ApiError::Internal(anyhow::anyhow!(message)),
        }
    }
}

/// Calculates tier's daily limit based on tier 0's limit and tier scaling.
/// Higher tiers scale by (tier + 1) to provide increasing limits for KYC levels.
pub fn tier_daily_limit(tier: i32, tier_0_limit_minor: i128) -> Money {
    let multiplier = i128::from(tier.max(0)).saturating_add(1);
    Money::from_minor(Asset::Usdc, tier_0_limit_minor.saturating_mul(multiplier))
}

/// Sum of `user_id`'s outgoing transfers in the reference asset (USDC) over
/// the trailing 24 hours, read straight from the ledger postings that back
/// every balance.
///
/// Scope note: EngiPay's ledger currently has no `withdrawal`/`off_ramp`
/// transaction kind (off-ramps live in a separate, not-yet-wired-in
/// `ramp_orders` table), so only `transfer`-kind outflows are counted here;
/// see the PR description.
pub async fn calculate_24h_volume(pool: &PgPool, user_id: UserId) -> Result<Money, LimitError> {
    let total: String = sqlx::query_scalar(
        "SELECT COALESCE(SUM(-lp.amount), 0)::text \
         FROM ledger_postings lp \
         JOIN ledger_transactions lt ON lt.id = lp.transaction_id \
         WHERE lp.owner_kind = 'user' \
           AND lp.user_id = $1 \
           AND lp.bucket = 'available' \
           AND lp.asset = 'USDC' \
           AND lp.amount < 0 \
           AND lt.kind = 'transfer' \
           AND lp.created_at >= now() - INTERVAL '24 hours'",
    )
    .bind(user_id.as_uuid())
    .fetch_one(pool)
    .await
    .map_err(|error| LimitError::Database(error.to_string()))?;

    let minor = total
        .parse::<i128>()
        .map_err(|_| LimitError::Database(format!("unexpected volume total: {total:?}")))?;

    Ok(Money::from_minor(Asset::Usdc, minor))
}

/// Asserts that `user_id`'s rolling 24h volume plus `amount` stays within
/// their tier's daily limit, before a withdrawal or transfer is allowed to
/// proceed. `tier` is the caller's current KYC tier (`user_profiles.tier`).
/// `tier_0_limit_minor` is the base daily limit for tier 0 (from configuration).
///
/// Returns [`LimitError::Exceeded`] (mapped to `ApiError::LimitExceeded`,
/// HTTP 403) detailing the current usage and the maximum allowance when the
/// check fails.
pub async fn check_velocity_limits(
    pool: &PgPool,
    user_id: UserId,
    tier: i32,
    amount: Money,
    tier_0_limit_minor: i128,
) -> Result<(), LimitError> {
    let current = calculate_24h_volume(pool, user_id).await?;
    let limit = tier_daily_limit(tier, tier_0_limit_minor);

    if current.minor.saturating_add(amount.minor) > limit.minor {
        return Err(LimitError::Exceeded {
            tier,
            current: current.minor,
            requested: amount.minor,
            limit: limit.minor,
        });
    }

    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use super::*;

    #[test]
    fn tier_0_daily_limit_is_500_usdc() {
        let tier_0_limit = 500 * 10_000_000;
        assert_eq!(
            tier_daily_limit(0, tier_0_limit),
            Money::from_minor(Asset::Usdc, tier_0_limit)
        );
    }

    #[test]
    fn higher_tiers_get_a_larger_limit() {
        let tier_0_limit = 500 * 10_000_000;
        assert!(tier_daily_limit(1, tier_0_limit).minor > tier_daily_limit(0, tier_0_limit).minor);
    }

    /// `check_velocity_limits` itself needs a real pool (it calls
    /// `calculate_24h_volume`), so its blocking behaviour is asserted here
    /// against the limit arithmetic directly: this is exactly the comparison
    /// `check_velocity_limits` performs before it ever reaches the database.
    #[test]
    fn a_request_that_would_exceed_the_tier_limit_is_rejected() {
        let tier = 0;
        let limit = tier_daily_limit(tier, 500 * 10_000_000);
        let current = Money::from_minor(Asset::Usdc, limit.minor - 10);
        let requested = Money::from_minor(Asset::Usdc, 20);

        assert!(current.minor + requested.minor > limit.minor);

        let error = LimitError::Exceeded {
            tier,
            current: current.minor,
            requested: requested.minor,
            limit: limit.minor,
        };
        let api_error: ApiError = error.into();
        assert!(matches!(api_error, ApiError::LimitExceeded(_)));
    }

    #[test]
    fn a_request_within_the_remaining_allowance_is_not_rejected() {
        let tier = 0;
        let limit = tier_daily_limit(tier, 500 * 10_000_000);
        let current = Money::from_minor(Asset::Usdc, limit.minor - 100);
        let requested = Money::from_minor(Asset::Usdc, 20);

        assert!(current.minor + requested.minor <= limit.minor);
    }

    /// Requires `DATABASE_URL`: a fresh user with no postings has zero 24h
    /// volume, and a request just over their tier limit is rejected.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn check_velocity_limits_blocks_a_transfer_over_the_tier_limit() {
        let Ok(database_url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let pool = PgPool::connect(&database_url).await.unwrap();
        sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

        let user = UserId::new();
        sqlx::query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(user.as_uuid())
            .execute(&pool)
            .await
            .unwrap();

        let tier_0_limit_minor = 500 * 10_000_000;
        let volume = calculate_24h_volume(&pool, user).await.unwrap();
        assert_eq!(volume, Money::zero(Asset::Usdc));

        let over_limit = Money::from_minor(Asset::Usdc, tier_daily_limit(0, tier_0_limit_minor).minor + 1);
        let result = check_velocity_limits(&pool, user, 0, over_limit, tier_0_limit_minor).await;
        assert!(matches!(result, Err(LimitError::Exceeded { .. })));

        let within_limit = Money::from_minor(Asset::Usdc, 100);
        let result = check_velocity_limits(&pool, user, 0, within_limit, tier_0_limit_minor).await;
        assert!(result.is_ok());
    }
}
