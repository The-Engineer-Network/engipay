//! The notification outbox and delivery, end to end against a real Postgres.
//!
//! Needs DATABASE_URL pointing at a database with every migration applied, so
//! it is ignored by default. Run it with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test notification_service_db -- --ignored
//!
//! `deliver_due` is a global worker: it claims due rows for every user. So
//! each test uses unique dedupe keys, checks only its own rows, and the tests
//! run one at a time so one test's worker never claims another's rows.

#![allow(clippy::unwrap_used)]

use std::sync::Mutex;

use engipay_api::services::notification_service::{
    Channel, Event, EventKind, ExternalSender, MAX_ATTEMPTS, OutboundMessage, ProviderError,
    deliver_due, enqueue, set_channel_enabled,
};
use engipay_core::UserId;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn pool() -> PgPool {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .unwrap()
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

/// A deposit event with a key no other test run can share.
fn deposit(user: UserId, channels: Vec<Channel>) -> Event {
    Event {
        user,
        kind: EventKind::DepositReceived,
        dedupe_key: format!("deposit:{}", Uuid::new_v4()),
        detail: "5 USDC".to_string(),
        channels,
    }
}

/// Outbox state of one event's row on one channel.
async fn state_of(pool: &PgPool, key: &str, channel: &str) -> String {
    sqlx::query_scalar(
        "SELECT state FROM notification_outbox WHERE dedupe_key = $1 AND channel = $2",
    )
    .bind(key)
    .bind(channel)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Records every message it is asked to send.
#[derive(Default)]
struct RecordingSender {
    sent: Mutex<Vec<OutboundMessage>>,
}

impl ExternalSender for RecordingSender {
    async fn send(&self, message: &OutboundMessage) -> Result<(), ProviderError> {
        self.sent.lock().unwrap().push(message.clone());
        Ok(())
    }
}

/// Always fails with a transient error.
struct FlakySender;

impl ExternalSender for FlakySender {
    async fn send(&self, _message: &OutboundMessage) -> Result<(), ProviderError> {
        Err(ProviderError::Transient("timeout".to_string()))
    }
}

/// Makes this event's pending rows due now, so a test does not wait out the backoff.
async fn make_due(pool: &PgPool, key: &str) {
    sqlx::query(
        "UPDATE notification_outbox SET next_attempt_at = now() \
         WHERE dedupe_key = $1 AND state = 'pending'",
    )
    .bind(key)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn enqueueing_the_same_event_twice_adds_one_row_per_channel() {
    let _serial = SERIAL.lock().await;
    let pool = pool().await;
    let u = user(&pool).await;
    let event = deposit(u, vec![Channel::InApp, Channel::Email]);

    assert_eq!(enqueue(&pool, &event).await.unwrap(), 2);
    assert_eq!(
        enqueue(&pool, &event).await.unwrap(),
        0,
        "a replay adds nothing"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_disabled_channel_is_not_enqueued() {
    let _serial = SERIAL.lock().await;
    let pool = pool().await;
    let u = user(&pool).await;
    set_channel_enabled(&pool, u, Channel::Sms, false)
        .await
        .unwrap();
    let event = deposit(u, vec![Channel::InApp, Channel::Sms]);

    let added = enqueue(&pool, &event).await.unwrap();
    assert_eq!(added, 1, "only the in-app channel is still on");
    assert_eq!(
        state_of(&pool, &event.dedupe_key, "in_app").await,
        "pending"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn in_app_delivery_writes_the_feed_once_even_when_run_again() {
    let _serial = SERIAL.lock().await;
    let pool = pool().await;
    let u = user(&pool).await;
    let event = deposit(u, vec![Channel::InApp]);
    enqueue(&pool, &event).await.unwrap();
    let sender = RecordingSender::default();

    deliver_due(&pool, &sender, 100).await.unwrap();
    assert_eq!(state_of(&pool, &event.dedupe_key, "in_app").await, "sent");
    deliver_due(&pool, &sender, 100).await.unwrap();

    let feed_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND dedupe_key = $2",
    )
    .bind(u.as_uuid())
    .bind(&event.dedupe_key)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        feed_rows, 1,
        "the feed holds exactly one entry for the event"
    );
    assert!(
        sender.sent.lock().unwrap().iter().all(|m| m.user != u),
        "in-app never calls the external sender"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn external_message_carries_the_outbox_id_as_its_idempotency_key() {
    let _serial = SERIAL.lock().await;
    let pool = pool().await;
    let u = user(&pool).await;
    let event = deposit(u, vec![Channel::Email]);
    enqueue(&pool, &event).await.unwrap();
    let sender = RecordingSender::default();

    deliver_due(&pool, &sender, 100).await.unwrap();

    let sent: Vec<OutboundMessage> = sender
        .sent
        .lock()
        .unwrap()
        .iter()
        .filter(|m| m.user == u)
        .cloned()
        .collect();
    assert_eq!(sent.len(), 1);
    let row_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM notification_outbox WHERE dedupe_key = $1 AND channel = 'email'",
    )
    .bind(&event.dedupe_key)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(sent[0].idempotency_key, row_id.to_string());
    assert_eq!(sent[0].channel, Channel::Email);
    assert_eq!(state_of(&pool, &event.dedupe_key, "email").await, "sent");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_failing_provider_is_retried_then_marked_failed() {
    let _serial = SERIAL.lock().await;
    let pool = pool().await;
    let u = user(&pool).await;
    let event = deposit(u, vec![Channel::Sms]);
    enqueue(&pool, &event).await.unwrap();

    for attempt in 1..=MAX_ATTEMPTS {
        make_due(&pool, &event.dedupe_key).await;
        deliver_due(&pool, &FlakySender, 100).await.unwrap();
        let expected = if attempt == MAX_ATTEMPTS {
            "failed"
        } else {
            "pending"
        };
        assert_eq!(
            state_of(&pool, &event.dedupe_key, "sms").await,
            expected,
            "state after attempt {attempt}"
        );
    }
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_claimed_row_is_not_picked_up_again_until_its_lease_expires() {
    let _serial = SERIAL.lock().await;
    let pool = pool().await;
    let u = user(&pool).await;
    let event = deposit(u, vec![Channel::Push]);
    enqueue(&pool, &event).await.unwrap();

    // The failed first attempt schedules a retry 30 seconds out.
    deliver_due(&pool, &FlakySender, 100).await.unwrap();
    let attempts_after_first: i32 = sqlx::query_scalar(
        "SELECT attempts FROM notification_outbox WHERE dedupe_key = $1 AND channel = 'push'",
    )
    .bind(&event.dedupe_key)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Another worker run before the retry time must leave the row alone.
    deliver_due(&pool, &RecordingSender::default(), 100)
        .await
        .unwrap();
    let attempts_after_second: i32 = sqlx::query_scalar(
        "SELECT attempts FROM notification_outbox WHERE dedupe_key = $1 AND channel = 'push'",
    )
    .bind(&event.dedupe_key)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(attempts_after_first, 1);
    assert_eq!(attempts_after_second, 1, "a row not yet due is not claimed");
}
