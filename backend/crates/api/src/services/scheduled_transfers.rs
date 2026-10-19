//! Scheduled and recurring transfers between EngiPay users.
//!
//! A schedule has a cadence (once, weekly or monthly) and a `next_run_on` date.
//! [`run_due`] finds schedules that are due and runs one occurrence of each:
//!
//! 1. The schedule is claimed, so two workers never run the same occurrence.
//! 2. The AML velocity limit is checked, as for a manual transfer. Failing it
//!    skips the occurrence and tells the user why.
//! 3. The ledger transfer runs with reference `sched:<id>:<run_on>`. The
//!    ledger treats a repeated reference as a replay, so retrying after a
//!    crash cannot pay twice.
//! 4. The user is notified (idempotently, keyed on the same reference).
//! 5. The run is recorded and the schedule advances, in one transaction.
//!
//! Insufficient funds skips that occurrence only; the schedule carries on to
//! its next date. Any other failure leaves the schedule due, to be tried on the
//! next pass.

use chrono::{Datelike, Duration, NaiveDate, Utc};
use engipay_core::{Asset, Money, UserId};
use engipay_ledger::LedgerError;
use engipay_ledger::postgres::PostgresLedgerStore;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::services::limits::{LimitError, check_velocity_limits};
use crate::services::notification_service::{Channel, Event, EventKind, enqueue};

/// How long a worker holds a schedule while it runs one occurrence.
pub const CLAIM_LEASE_SECS: i64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cadence {
    Once,
    Weekly,
    Monthly,
}

impl Cadence {
    pub fn as_str(self) -> &'static str {
        match self {
            Cadence::Once => "once",
            Cadence::Weekly => "weekly",
            Cadence::Monthly => "monthly",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "once" => Some(Cadence::Once),
            "weekly" => Some(Cadence::Weekly),
            "monthly" => Some(Cadence::Monthly),
            _ => None,
        }
    }
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let first_of_next =
        NaiveDate::from_ymd_opt(next_year, next_month, 1).expect("valid first of month");
    let last = first_of_next - Duration::days(1);
    last.day()
}

/// The occurrence after `after`, or `None` when the schedule runs once.
///
/// Monthly occurrences use `anchor_day` and clamp to the last day of short
/// months. From an anchor of 31, that gives Feb 28 (or 29), then Mar 31 again,
/// rather than drifting to the 28th for good.
pub fn next_occurrence(cadence: Cadence, anchor_day: u32, after: NaiveDate) -> Option<NaiveDate> {
    match cadence {
        Cadence::Once => None,
        Cadence::Weekly => Some(after + Duration::days(7)),
        Cadence::Monthly => {
            let (year, month) = if after.month() == 12 {
                (after.year() + 1, 1)
            } else {
                (after.year(), after.month() + 1)
            };
            let day = anchor_day.min(days_in_month(year, month));
            NaiveDate::from_ymd_opt(year, month, day)
        }
    }
}

/// The reference used for one occurrence on the ledger.
pub fn occurrence_reference(schedule: Uuid, run_on: NaiveDate) -> String {
    format!("sched:{schedule}:{run_on}")
}

fn asset_from_symbol(symbol: &str) -> Option<Asset> {
    Asset::ALL
        .into_iter()
        .find(|asset| asset.symbol() == symbol)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueSchedule {
    pub id: Uuid,
    pub sender: UserId,
    pub recipient: UserId,
    pub money: Money,
    pub cadence: Cadence,
    pub anchor_day: u32,
    pub run_on: NaiveDate,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct RunReport {
    pub sent: u64,
    pub skipped: u64,
    /// Left due, to be tried on the next pass.
    pub retried: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum ScheduleError {
    #[error("start date must not be in the past")]
    StartInPast,
    #[error("amount must be a positive whole number of the asset's smallest unit")]
    InvalidAmount,
    #[error("a schedule cannot send money to its own account")]
    SameAccount,
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// Creates a schedule. `start_on` is the first occurrence.
pub async fn create(
    pool: &PgPool,
    sender: UserId,
    recipient: UserId,
    money: Money,
    cadence: Cadence,
    start_on: NaiveDate,
    today: NaiveDate,
) -> Result<Uuid, ScheduleError> {
    if start_on < today {
        return Err(ScheduleError::StartInPast);
    }
    if money.minor <= 0 {
        return Err(ScheduleError::InvalidAmount);
    }
    if sender == recipient {
        return Err(ScheduleError::SameAccount);
    }
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO scheduled_transfers \
             (sender_id, recipient_id, asset, amount_minor, cadence, anchor_day, next_run_on) \
         VALUES ($1, $2, $3, $4::numeric, $5, $6, $7) \
         RETURNING id",
    )
    .bind(sender.as_uuid())
    .bind(recipient.as_uuid())
    .bind(money.asset.symbol())
    .bind(money.minor.to_string())
    .bind(cadence.as_str())
    .bind(start_on.day() as i16)
    .bind(start_on)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// Cancels a schedule the caller owns. Returns false when there is no such
/// active schedule for this sender.
pub async fn cancel(pool: &PgPool, sender: UserId, id: Uuid) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE scheduled_transfers SET status = 'cancelled', updated_at = now() \
         WHERE id = $1 AND sender_id = $2 AND status = 'active'",
    )
    .bind(id)
    .bind(sender.as_uuid())
    .execute(pool)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Runs one pass over every schedule due on or before `today`.
pub async fn run_due(
    pool: &PgPool,
    ledger: &PostgresLedgerStore,
    tier_0_limit_minor: i128,
    today: NaiveDate,
    batch: i64,
) -> Result<RunReport, sqlx::Error> {
    let mut report = RunReport::default();
    for due in claim_due(pool, today, batch).await? {
        match run_one(pool, ledger, tier_0_limit_minor, &due).await {
            Ok(Outcome::Sent) => report.sent += 1,
            Ok(Outcome::Skipped) => report.skipped += 1,
            Err(error) => {
                tracing::warn!(
                    schedule = %due.id,
                    reason = error.message(),
                    "scheduled transfer left due for the next pass"
                );
                release(pool, due.id).await?;
                report.retried += 1;
            }
        }
    }
    Ok(report)
}

enum Outcome {
    Sent,
    Skipped,
}

async fn claim_due(
    pool: &PgPool,
    today: NaiveDate,
    batch: i64,
) -> Result<Vec<DueSchedule>, sqlx::Error> {
    let rows = sqlx::query(
        "UPDATE scheduled_transfers SET claimed_until = now() + make_interval(secs => $3) \
         WHERE id IN ( \
             SELECT id FROM scheduled_transfers \
             WHERE status = 'active' AND next_run_on <= $1 \
               AND (claimed_until IS NULL OR claimed_until < now()) \
             ORDER BY next_run_on \
             LIMIT $2 \
             FOR UPDATE SKIP LOCKED \
         ) \
         RETURNING id, sender_id, recipient_id, asset, amount_minor::text AS amount, \
                   cadence, anchor_day, next_run_on",
    )
    .bind(today)
    .bind(batch)
    .bind(CLAIM_LEASE_SECS as f64)
    .fetch_all(pool)
    .await?;

    let mut due = Vec::with_capacity(rows.len());
    for row in rows {
        let asset_text: String = row.try_get("asset")?;
        let amount: String = row.try_get("amount")?;
        let cadence_text: String = row.try_get("cadence")?;
        let asset = asset_from_symbol(&asset_text)
            .ok_or_else(|| sqlx::Error::Decode(format!("unknown asset {asset_text}").into()))?;
        let cadence = Cadence::parse(&cadence_text)
            .ok_or_else(|| sqlx::Error::Decode(format!("unknown cadence {cadence_text}").into()))?;
        let minor: i128 = amount
            .parse()
            .map_err(|_| sqlx::Error::Decode("amount is not an integer".into()))?;
        let anchor: i16 = row.try_get("anchor_day")?;
        due.push(DueSchedule {
            id: row.try_get("id")?,
            sender: UserId::from_uuid(row.try_get("sender_id")?),
            recipient: UserId::from_uuid(row.try_get("recipient_id")?),
            money: Money::from_minor(asset, minor),
            cadence,
            anchor_day: anchor as u32,
            run_on: row.try_get("next_run_on")?,
        });
    }
    Ok(due)
}

/// Frees a claimed schedule without advancing it, so it is retried on the next pass.
async fn release(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE scheduled_transfers SET claimed_until = NULL WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Errors that leave the occurrence due. Anything else is recorded as a skip.
#[derive(Debug)]
enum RetryableError {
    Database(String),
    Ledger(String),
}

impl RetryableError {
    fn message(&self) -> &str {
        match self {
            RetryableError::Database(message) | RetryableError::Ledger(message) => message,
        }
    }
}

async fn run_one(
    pool: &PgPool,
    ledger: &PostgresLedgerStore,
    tier_0_limit_minor: i128,
    due: &DueSchedule,
) -> Result<Outcome, RetryableError> {
    let reference = occurrence_reference(due.id, due.run_on);

    // Read the tier; a missing profile is tier 0.
    let tier: i32 = sqlx::query_scalar("SELECT COALESCE(tier, 0) FROM user_profiles WHERE id = $1")
        .bind(due.sender.as_uuid())
        .fetch_optional(pool)
        .await
        .map_err(|e| RetryableError::Database(e.to_string()))?
        .unwrap_or(0);

    // If the ledger already holds this occurrence (we crashed after moving the
    // money), it is a replay: go straight to the ledger, which returns the
    // original result. Re-running the limit check here would count the money
    // we already moved and wrongly skip a payment that went out.
    let already_on_ledger: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM ledger_transactions WHERE reference = $1")
            .bind(&reference)
            .fetch_optional(pool)
            .await
            .map_err(|e| RetryableError::Database(e.to_string()))?;

    let skip_reason: Option<String> = if already_on_ledger.is_some() {
        None
    } else {
        match check_velocity_limits(pool, due.sender, tier, due.money, tier_0_limit_minor).await {
            Ok(()) => None,
            Err(LimitError::Exceeded { .. }) => {
                Some("the 24-hour sending limit would be exceeded".to_string())
            }
            Err(LimitError::Database(message)) => return Err(RetryableError::Database(message)),
        }
    };

    let (transaction_id, reason) = match skip_reason {
        Some(reason) => (None, Some(reason)),
        None => match ledger
            .transfer(due.sender, due.recipient, due.money, &reference)
            .await
        {
            Ok(receipt) => (Some(receipt.transaction_id), None),
            Err(LedgerError::InsufficientFunds { .. }) => {
                (None, Some("insufficient balance".to_string()))
            }
            Err(LedgerError::Database { message, .. }) => {
                return Err(RetryableError::Ledger(message));
            }
            Err(other) => (None, Some(other.to_string())),
        },
    };

    // Tell the user before recording the run. If we crash here the occurrence
    // is still due, and the retry re-enqueues the same event, which is a no-op.
    let (kind, detail) = match (&transaction_id, &reason) {
        (Some(_), _) => (
            EventKind::ScheduledTransferCompleted,
            format!("{} {}", due.money.minor, due.money.asset.symbol()),
        ),
        (None, Some(why)) => (EventKind::ScheduledTransferSkipped, why.clone()),
        (None, None) => unreachable!("an occurrence is either sent or skipped"),
    };
    enqueue(
        pool,
        &Event {
            user: due.sender,
            kind,
            dedupe_key: reference.clone(),
            detail,
            channels: vec![Channel::InApp],
        },
    )
    .await
    .map_err(|e| RetryableError::Database(e.to_string()))?;

    // Record the run and move the schedule forward in one transaction.
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| RetryableError::Database(e.to_string()))?;
    sqlx::query(
        "INSERT INTO scheduled_transfer_runs \
             (schedule_id, run_on, outcome, transaction_id, skip_reason) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (schedule_id, run_on) DO NOTHING",
    )
    .bind(due.id)
    .bind(due.run_on)
    .bind(if transaction_id.is_some() {
        "sent"
    } else {
        "skipped"
    })
    .bind(transaction_id)
    .bind(&reason)
    .execute(&mut *tx)
    .await
    .map_err(|e| RetryableError::Database(e.to_string()))?;

    match next_occurrence(due.cadence, due.anchor_day, due.run_on) {
        Some(next) => {
            sqlx::query(
                "UPDATE scheduled_transfers SET next_run_on = $2, claimed_until = NULL, \
                     updated_at = now() WHERE id = $1",
            )
            .bind(due.id)
            .bind(next)
            .execute(&mut *tx)
            .await
        }
        None => {
            sqlx::query(
                "UPDATE scheduled_transfers SET status = 'completed', claimed_until = NULL, \
                     updated_at = now() WHERE id = $1",
            )
            .bind(due.id)
            .execute(&mut *tx)
            .await
        }
    }
    .map_err(|e| RetryableError::Database(e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| RetryableError::Database(e.to_string()))?;

    Ok(if transaction_id.is_some() {
        Outcome::Sent
    } else {
        Outcome::Skipped
    })
}

/// Today's date in UTC. Passed in explicitly so the runner is testable.
pub fn today_utc() -> NaiveDate {
    Utc::now().date_naive()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn weekly_adds_seven_days() {
        assert_eq!(
            next_occurrence(Cadence::Weekly, 3, d(2026, 10, 19)),
            Some(d(2026, 10, 26))
        );
    }

    #[test]
    fn once_has_no_next_occurrence() {
        assert_eq!(next_occurrence(Cadence::Once, 19, d(2026, 10, 19)), None);
    }

    #[test]
    fn monthly_keeps_the_anchor_day_when_the_month_has_it() {
        assert_eq!(
            next_occurrence(Cadence::Monthly, 15, d(2026, 10, 15)),
            Some(d(2026, 11, 15))
        );
    }

    #[test]
    fn monthly_clamps_to_end_of_short_month_then_recovers() {
        // Jan 31 -> Feb 28 (2027 is not a leap year) -> Mar 31.
        let feb = next_occurrence(Cadence::Monthly, 31, d(2027, 1, 31)).unwrap();
        assert_eq!(feb, d(2027, 2, 28));
        assert_eq!(
            next_occurrence(Cadence::Monthly, 31, feb),
            Some(d(2027, 3, 31))
        );
    }

    #[test]
    fn monthly_uses_leap_day_in_a_leap_year() {
        assert_eq!(
            next_occurrence(Cadence::Monthly, 31, d(2028, 1, 31)),
            Some(d(2028, 2, 29))
        );
    }

    #[test]
    fn monthly_rolls_over_the_year() {
        assert_eq!(
            next_occurrence(Cadence::Monthly, 10, d(2026, 12, 10)),
            Some(d(2027, 1, 10))
        );
    }

    #[test]
    fn occurrence_reference_is_stable_per_date() {
        let id = Uuid::nil();
        assert_eq!(
            occurrence_reference(id, d(2026, 11, 1)),
            "sched:00000000-0000-0000-0000-000000000000:2026-11-01"
        );
    }
}
