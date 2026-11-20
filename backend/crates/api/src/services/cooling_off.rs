//! Cooling-off period for new withdrawal destinations.
//!
//! An attacker who takes over an account will want to drain it to an address
//! they control. Holding every withdrawal to a destination the user has never
//! sent to before for [`COOLING_OFF_DURATION`] gives the real owner time to
//! notice and lock the account before any money leaves.
//!
//! # How it works
//!
//! 1. [`check_address_cooling_off`] records the `(user_id, destination)` pair
//!    in `withdrawal_destinations` the first time it is seen, and never moves
//!    that timestamp afterwards, so a second withdrawal cannot reset the clock.
//! 2. If the pair was first seen less than [`COOLING_OFF_DURATION`] ago, the
//!    result is [`CoolingOff::Hold`] with the time the hold ends.
//! 3. [`hold_withdrawal_if_cooling_off`] applies that decision to a
//!    `pending_broadcast` withdrawal, moving it to `cooling_off`.
//! 4. The withdrawal worker in `engipay-chain` moves `cooling_off` rows back
//!    to `pending_broadcast` once `cooling_off_until` has passed.

use std::time::Duration;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

/// How long a newly-seen withdrawal destination is held.
pub const COOLING_OFF_DURATION: Duration = Duration::from_secs(24 * 60 * 60);

/// Result of [`check_address_cooling_off`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoolingOff {
    /// The destination was first seen at least [`COOLING_OFF_DURATION`] ago.
    Clear,
    /// The destination is new; withdrawals to it wait until `until`.
    Hold { until: DateTime<Utc> },
}

/// Decides whether a destination first seen at `first_seen` is still cooling
/// off at `now`. The boundary is inclusive: at exactly 24 hours it is clear.
pub fn decide(first_seen: DateTime<Utc>, now: DateTime<Utc>) -> CoolingOff {
    let until = first_seen + cooling_off_duration();
    if now >= until {
        CoolingOff::Clear
    } else {
        CoolingOff::Hold { until }
    }
}

fn cooling_off_duration() -> chrono::Duration {
    // 24 hours always fits; the fallback only exists to avoid a panic path.
    chrono::Duration::from_std(COOLING_OFF_DURATION).unwrap_or(chrono::Duration::MAX)
}

/// Checks whether withdrawals from `user_id` to `destination` must cool off,
/// recording the destination as seen if this is the first time.
///
/// Requires the `withdrawal_destinations` table (migration 0010).
pub async fn check_address_cooling_off(
    pool: &PgPool,
    user_id: Uuid,
    destination: &str,
) -> Result<CoolingOff, sqlx::Error> {
    // `DO NOTHING` keeps the original first_seen_at. The read uses the
    // database clock for both values so app/DB clock skew cannot shorten the
    // hold.
    sqlx::query(
        "INSERT INTO withdrawal_destinations (user_id, destination, first_seen_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id, destination) DO NOTHING",
    )
    .bind(user_id)
    .bind(destination)
    .execute(pool)
    .await?;

    let (first_seen, now): (DateTime<Utc>, DateTime<Utc>) = sqlx::query_as(
        "SELECT first_seen_at, now() FROM withdrawal_destinations
         WHERE user_id = $1 AND destination = $2",
    )
    .bind(user_id)
    .bind(destination)
    .fetch_one(pool)
    .await?;

    Ok(decide(first_seen, now))
}

/// Runs the cooling-off check for a `pending_broadcast` withdrawal and, if
/// its destination is new, moves it to `cooling_off` until the hold ends.
///
/// Call this before the withdrawal can be picked up by the broadcast worker.
/// A withdrawal that is no longer `pending_broadcast` is left untouched.
pub async fn hold_withdrawal_if_cooling_off(
    pool: &PgPool,
    withdrawal_id: Uuid,
) -> Result<CoolingOff, sqlx::Error> {
    let (user_id, destination): (Uuid, String) =
        sqlx::query_as("SELECT user_id, destination FROM withdrawals WHERE id = $1")
            .bind(withdrawal_id)
            .fetch_one(pool)
            .await?;

    let decision = check_address_cooling_off(pool, user_id, &destination).await?;
    if let CoolingOff::Hold { until } = decision {
        sqlx::query(
            "UPDATE withdrawals
             SET status = 'cooling_off', cooling_off_until = $2, updated_at = now()
             WHERE id = $1 AND status = 'pending_broadcast'",
        )
        .bind(withdrawal_id)
        .bind(until)
        .execute(pool)
        .await?;
    }
    Ok(decision)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    fn at(hour: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap() + chrono::Duration::hours(hour.into())
    }

    #[test]
    fn brand_new_destination_is_held_for_24_hours() {
        assert_eq!(decide(at(0), at(0)), CoolingOff::Hold { until: at(24) });
    }

    #[test]
    fn destination_seen_23_hours_ago_is_still_held() {
        assert_eq!(decide(at(0), at(23)), CoolingOff::Hold { until: at(24) });
    }

    #[test]
    fn destination_seen_exactly_24_hours_ago_is_clear() {
        assert_eq!(decide(at(0), at(24)), CoolingOff::Clear);
    }

    #[test]
    fn destination_seen_25_hours_ago_is_clear() {
        assert_eq!(decide(at(0), at(25)), CoolingOff::Clear);
    }

    #[test]
    fn one_second_before_the_boundary_is_held() {
        let now = at(24) - chrono::Duration::seconds(1);
        assert_eq!(decide(at(0), now), CoolingOff::Hold { until: at(24) });
    }

    #[test]
    fn cooling_off_window_is_24_hours() {
        assert_eq!(COOLING_OFF_DURATION, Duration::from_secs(86_400));
    }

    // ── Integration tests (require a PostgreSQL database) ──────────────
    //
    // The database must already have backend/migrations applied, as
    // scripts/verify-migrations.sh does.
    // Run with: DATABASE_URL=postgres://… cargo test -p engipay-api \
    //           cooling_off -- --ignored

    async fn test_pool() -> Option<PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let pool = PgPool::connect(&url).await.ok()?;
        Some(pool)
    }

    async fn new_user(pool: &PgPool) -> Uuid {
        let user = Uuid::new_v4();
        sqlx::query("INSERT INTO users (id) VALUES ($1)")
            .bind(user)
            .execute(pool)
            .await
            .unwrap();
        user
    }

    async fn new_withdrawal(pool: &PgPool, user: Uuid, destination: &str) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO withdrawals (user_id, chain, asset, amount, estimated_network_fee, destination)
             VALUES ($1, 'stellar', 'XLM', 10000000, 100, $2)
             RETURNING id",
        )
        .bind(user)
        .bind(destination)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn first_withdrawal_to_a_destination_is_held() {
        let pool = test_pool().await.unwrap();
        let user = new_user(&pool).await;

        let decision = check_address_cooling_off(&pool, user, "GNEW")
            .await
            .unwrap();
        assert!(matches!(decision, CoolingOff::Hold { .. }));
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn repeat_checks_do_not_reset_the_clock() {
        let pool = test_pool().await.unwrap();
        let user = new_user(&pool).await;

        let CoolingOff::Hold { until: first } = check_address_cooling_off(&pool, user, "GREPEAT")
            .await
            .unwrap()
        else {
            panic!("new destination must be held");
        };
        let CoolingOff::Hold { until: second } = check_address_cooling_off(&pool, user, "GREPEAT")
            .await
            .unwrap()
        else {
            panic!("still within the window");
        };
        assert_eq!(first, second);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn destination_older_than_24_hours_is_clear() {
        let pool = test_pool().await.unwrap();
        let user = new_user(&pool).await;
        sqlx::query(
            "INSERT INTO withdrawal_destinations (user_id, destination, first_seen_at)
             VALUES ($1, 'GOLD', now() - interval '25 hours')",
        )
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();

        let decision = check_address_cooling_off(&pool, user, "GOLD")
            .await
            .unwrap();
        assert_eq!(decision, CoolingOff::Clear);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn destinations_are_tracked_per_user() {
        let pool = test_pool().await.unwrap();
        let alice = new_user(&pool).await;
        let bob = new_user(&pool).await;
        sqlx::query(
            "INSERT INTO withdrawal_destinations (user_id, destination, first_seen_at)
             VALUES ($1, 'GSHARED', now() - interval '30 days')",
        )
        .bind(alice)
        .execute(&pool)
        .await
        .unwrap();

        // Alice has used it for a month; Bob never has.
        let decision = check_address_cooling_off(&pool, bob, "GSHARED")
            .await
            .unwrap();
        assert!(matches!(decision, CoolingOff::Hold { .. }));
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn withdrawal_to_new_destination_is_marked_cooling_off() {
        let pool = test_pool().await.unwrap();
        let user = new_user(&pool).await;
        let withdrawal = new_withdrawal(&pool, user, "GHELD").await;

        let decision = hold_withdrawal_if_cooling_off(&pool, withdrawal)
            .await
            .unwrap();
        let CoolingOff::Hold { until } = decision else {
            panic!("new destination must be held");
        };

        let (status, stored_until): (String, Option<DateTime<Utc>>) =
            sqlx::query_as("SELECT status, cooling_off_until FROM withdrawals WHERE id = $1")
                .bind(withdrawal)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "cooling_off");
        assert_eq!(stored_until, Some(until));
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn withdrawal_to_known_destination_stays_pending() {
        let pool = test_pool().await.unwrap();
        let user = new_user(&pool).await;
        sqlx::query(
            "INSERT INTO withdrawal_destinations (user_id, destination, first_seen_at)
             VALUES ($1, 'GKNOWN', now() - interval '2 days')",
        )
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
        let withdrawal = new_withdrawal(&pool, user, "GKNOWN").await;

        let decision = hold_withdrawal_if_cooling_off(&pool, withdrawal)
            .await
            .unwrap();
        assert_eq!(decision, CoolingOff::Clear);

        let status: String = sqlx::query_scalar("SELECT status FROM withdrawals WHERE id = $1")
            .bind(withdrawal)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "pending_broadcast");
    }
}
