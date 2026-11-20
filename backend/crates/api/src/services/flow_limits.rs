//! Daily velocity checks for withdrawals and conversions.
//!
//! Wraps [`check_velocity_limits`] (which counts transfers) and adds the
//! user's rolling 24h withdrawals and conversions to the volume, so money
//! cannot be moved out through those flows to bypass the tier limit.

use engipay_core::{Money, UserId};
use sqlx::PgPool;

use crate::error::ApiError;
use crate::services::limits::{LimitError, calculate_24h_volume, tier_daily_limit};

/// True when `current + requested` would exceed `limit` (all minor units).
pub fn exceeds_limit(current: i128, requested: i128, limit: i128) -> bool {
    current.saturating_add(requested) > limit
}

async fn sum_minor(pool: &PgPool, sql: &str, user_id: UserId) -> Result<i128, ApiError> {
    let total: String = sqlx::query_scalar(sql)
        .bind(user_id.as_uuid())
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to total 24h volume: {e}")))?;
    total
        .parse::<i128>()
        .map_err(|_| ApiError::Internal(anyhow::anyhow!("unexpected volume total: {total:?}")))
}

/// Refuses `amount` (source amount, in minor units) when it would push the
/// user's rolling 24h volume across transfers, withdrawals and conversions
/// past their tier's daily limit. Call before any hold is placed.
pub async fn check_outflow_velocity(
    pool: &PgPool,
    user_id: UserId,
    amount: Money,
    tier_0_limit_minor: i128,
) -> Result<(), ApiError> {
    let tier: i32 = sqlx::query_scalar("SELECT COALESCE(tier, 0) FROM user_profiles WHERE id = $1")
        .bind(user_id.as_uuid())
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to fetch user tier: {e}")))?
        .unwrap_or(0);

    let transfers = calculate_24h_volume(pool, user_id)
        .await
        .map_err(ApiError::from)?
        .minor;
    let withdrawals = sum_minor(
        pool,
        "SELECT COALESCE(SUM(amount), 0)::text FROM withdrawals \
         WHERE user_id = $1 AND asset = 'USDC' AND status <> 'failed' \
           AND created_at >= now() - INTERVAL '24 hours'",
        user_id,
    )
    .await?;
    let conversions = sum_minor(
        pool,
        "SELECT COALESCE(SUM(amount_in), 0)::text FROM conversions \
         WHERE user_id = $1 AND asset_in = 'USDC' AND status IN ('processing', 'completed') \
           AND created_at >= now() - INTERVAL '24 hours'",
        user_id,
    )
    .await?;

    let current = transfers
        .saturating_add(withdrawals)
        .saturating_add(conversions);
    let limit = tier_daily_limit(tier, tier_0_limit_minor).minor;
    if exceeds_limit(current, amount.minor, limit) {
        return Err(LimitError::Exceeded {
            tier,
            current,
            requested: amount.minor,
            limit,
        }
        .into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn at_the_limit_is_allowed_over_is_refused() {
        assert!(!exceeds_limit(400, 100, 500));
        assert!(exceeds_limit(400, 101, 500));
    }

    #[test]
    fn saturates_instead_of_overflowing() {
        assert!(exceeds_limit(i128::MAX, 1, 500));
    }

    #[test]
    fn exceeded_maps_to_limit_exceeded() {
        let err: ApiError = LimitError::Exceeded { tier: 0, current: 0, requested: 10, limit: 5 }.into();
        assert!(matches!(err, ApiError::LimitExceeded(_)));
    }
}

#[cfg(test)]
mod convert_tests {
    use super::*;

    #[test]
    fn source_amount_over_remaining_limit_is_refused() {
        // 450 already used of 500; a 60 conversion must be refused.
        let unit = 10_000_000_i128;
        assert!(exceeds_limit(450 * unit, 60 * unit, 500 * unit));
        assert!(!exceeds_limit(450 * unit, 50 * unit, 500 * unit));
    }
}
