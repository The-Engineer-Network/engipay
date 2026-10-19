//! Scheduled and recurring transfers, end to end against a real Postgres.
//!
//! Needs DATABASE_URL pointing at a database with every migration applied, so
//! it is ignored by default. Run it with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test scheduled_transfers_db -- --ignored
//!
//! `run_due` is a global worker. Each test uses its own users and its own
//! dates, asserts on its own rows, and the tests run one at a time.

#![allow(clippy::unwrap_used)]

use chrono::NaiveDate;
use engipay_api::services::scheduled_transfers::{
    self as sched, Cadence, occurrence_reference, run_due,
};
use engipay_core::{Asset, Money, UserId};
use engipay_ledger::postgres::PostgresLedgerStore;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

const TIER_0_LIMIT: i128 = 1_000_000_000_000;

/// Smallest-unit amount of whole USDC, derived from the asset's decimals.
fn usdc(whole: &str) -> i128 {
    Money::parse(Asset::Usdc, whole).unwrap().minor
}

async fn setup() -> (PgPool, PostgresLedgerStore) {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .unwrap();
    let ledger = PostgresLedgerStore::new(pool.clone());
    (pool, ledger)
}

async fn user(pool: &PgPool) -> UserId {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id) VALUES ($1)")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    UserId::from_uuid(id)
}

fn date(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

async fn fund(ledger: &PostgresLedgerStore, user: UserId, whole_usdc: &str) {
    let money = Money::parse(Asset::Usdc, whole_usdc).unwrap();
    ledger
        .deposit(user, money, &format!("fund:{}", Uuid::new_v4()))
        .await
        .unwrap();
}

async fn available(ledger: &PostgresLedgerStore, user: UserId) -> i128 {
    ledger
        .get_user_balances(user)
        .await
        .unwrap()
        .into_iter()
        .find(|b| b.asset == Asset::Usdc)
        .map(|b| b.available)
        .unwrap_or(0)
}

async fn schedule_row(pool: &PgPool, id: Uuid) -> (String, NaiveDate) {
    sqlx::query_as::<_, (String, NaiveDate)>(
        "SELECT status, next_run_on FROM scheduled_transfers WHERE id = $1",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn run_outcome(pool: &PgPool, id: Uuid, run_on: NaiveDate) -> Option<String> {
    sqlx::query_scalar(
        "SELECT outcome FROM scheduled_transfer_runs WHERE schedule_id = $1 AND run_on = $2",
    )
    .bind(id)
    .bind(run_on)
    .fetch_optional(pool)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn monthly_schedule_sends_and_moves_to_the_next_month() {
    let _serial = SERIAL.lock().await;
    let (pool, ledger) = setup().await;
    let (sender, recipient) = (user(&pool).await, user(&pool).await);
    fund(&ledger, sender, "100").await;
    let start = date(2040, 1, 31);
    let id = sched::create(
        &pool,
        sender,
        recipient,
        Money::parse(Asset::Usdc, "5").unwrap(),
        Cadence::Monthly,
        start,
        start,
    )
    .await
    .unwrap();

    run_due(&pool, &ledger, TIER_0_LIMIT, start, 100)
        .await
        .unwrap();

    assert_eq!(run_outcome(&pool, id, start).await.as_deref(), Some("sent"));
    // 2040 is a leap year: Jan 31 clamps to Feb 29.
    assert_eq!(schedule_row(&pool, id).await.1, date(2040, 2, 29));
    assert_eq!(
        available(&ledger, sender).await,
        usdc("95"),
        "5 USDC left the sender"
    );
    assert_eq!(available(&ledger, recipient).await, usdc("5"));
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_crash_after_the_money_moved_replays_once_and_is_recorded_as_sent() {
    let _serial = SERIAL.lock().await;
    let (pool, ledger) = setup().await;
    let (sender, recipient) = (user(&pool).await, user(&pool).await);
    fund(&ledger, sender, "100").await;
    let day = date(2040, 5, 1);
    let id = sched::create(
        &pool,
        sender,
        recipient,
        Money::parse(Asset::Usdc, "5").unwrap(),
        Cadence::Once,
        day,
        day,
    )
    .await
    .unwrap();

    // Simulate a crash: the ledger moved the money, but the run was never recorded.
    let money = Money::parse(Asset::Usdc, "5").unwrap();
    ledger
        .transfer(sender, recipient, money, &occurrence_reference(id, day))
        .await
        .unwrap();

    run_due(&pool, &ledger, TIER_0_LIMIT, day, 100)
        .await
        .unwrap();

    assert_eq!(
        run_outcome(&pool, id, day).await.as_deref(),
        Some("sent"),
        "a replayed transfer is recorded as sent, not skipped"
    );
    assert_eq!(
        available(&ledger, sender).await,
        usdc("95"),
        "the money moved exactly once"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn insufficient_balance_skips_one_occurrence_and_tells_the_user() {
    let _serial = SERIAL.lock().await;
    let (pool, ledger) = setup().await;
    let (sender, recipient) = (user(&pool).await, user(&pool).await);
    fund(&ledger, sender, "1").await;
    let day = date(2040, 6, 1);
    let id = sched::create(
        &pool,
        sender,
        recipient,
        Money::parse(Asset::Usdc, "5").unwrap(),
        Cadence::Monthly,
        day,
        day,
    )
    .await
    .unwrap();

    run_due(&pool, &ledger, TIER_0_LIMIT, day, 100)
        .await
        .unwrap();

    assert_eq!(
        run_outcome(&pool, id, day).await.as_deref(),
        Some("skipped")
    );
    let (status, next) = schedule_row(&pool, id).await;
    assert_eq!(
        status, "active",
        "a skipped occurrence does not end the schedule"
    );
    assert_eq!(next, date(2040, 7, 1), "it moves on to the next month");
    assert_eq!(available(&ledger, sender).await, usdc("1"), "nothing moved");

    let reference = occurrence_reference(id, day);
    let event_kind: String = sqlx::query_scalar(
        "SELECT event_kind FROM notification_outbox WHERE dedupe_key = $1 AND channel = 'in_app'",
    )
    .bind(&reference)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(event_kind, "scheduled_transfer_skipped");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn running_the_same_day_twice_does_not_pay_twice() {
    let _serial = SERIAL.lock().await;
    let (pool, ledger) = setup().await;
    let (sender, recipient) = (user(&pool).await, user(&pool).await);
    fund(&ledger, sender, "100").await;
    let day = date(2040, 8, 1);
    sched::create(
        &pool,
        sender,
        recipient,
        Money::parse(Asset::Usdc, "5").unwrap(),
        Cadence::Monthly,
        day,
        day,
    )
    .await
    .unwrap();

    run_due(&pool, &ledger, TIER_0_LIMIT, day, 100)
        .await
        .unwrap();
    run_due(&pool, &ledger, TIER_0_LIMIT, day, 100)
        .await
        .unwrap();

    assert_eq!(
        available(&ledger, sender).await,
        usdc("95"),
        "one payment, not two"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_one_off_schedule_completes_after_its_single_run() {
    let _serial = SERIAL.lock().await;
    let (pool, ledger) = setup().await;
    let (sender, recipient) = (user(&pool).await, user(&pool).await);
    fund(&ledger, sender, "100").await;
    let day = date(2040, 9, 1);
    let id = sched::create(
        &pool,
        sender,
        recipient,
        Money::parse(Asset::Usdc, "5").unwrap(),
        Cadence::Once,
        day,
        day,
    )
    .await
    .unwrap();

    run_due(&pool, &ledger, TIER_0_LIMIT, day, 100)
        .await
        .unwrap();

    assert_eq!(schedule_row(&pool, id).await.0, "completed");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn only_the_sender_can_cancel_and_a_cancelled_schedule_is_not_run() {
    let _serial = SERIAL.lock().await;
    let (pool, ledger) = setup().await;
    let (sender, recipient, stranger) = (user(&pool).await, user(&pool).await, user(&pool).await);
    fund(&ledger, sender, "100").await;
    let day = date(2040, 10, 1);
    let id = sched::create(
        &pool,
        sender,
        recipient,
        Money::parse(Asset::Usdc, "5").unwrap(),
        Cadence::Monthly,
        day,
        day,
    )
    .await
    .unwrap();

    assert!(
        !sched::cancel(&pool, stranger, id).await.unwrap(),
        "a stranger cannot cancel"
    );
    assert!(sched::cancel(&pool, sender, id).await.unwrap());

    run_due(&pool, &ledger, TIER_0_LIMIT, day, 100)
        .await
        .unwrap();

    assert_eq!(schedule_row(&pool, id).await.0, "cancelled");
    assert_eq!(
        available(&ledger, sender).await,
        usdc("100"),
        "nothing was sent"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_start_date_in_the_past_is_refused() {
    let _serial = SERIAL.lock().await;
    let (pool, _ledger) = setup().await;
    let (sender, recipient) = (user(&pool).await, user(&pool).await);

    let result = sched::create(
        &pool,
        sender,
        recipient,
        Money::parse(Asset::Usdc, "5").unwrap(),
        Cadence::Weekly,
        date(2040, 1, 1),
        date(2040, 1, 2),
    )
    .await;
    assert!(matches!(result, Err(sched::ScheduleError::StartInPast)));
}
