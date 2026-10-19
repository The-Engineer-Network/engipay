//! The notification service: turns events into messages and delivers them.
//!
//! Flow:
//!
//! 1. Business code calls [`enqueue`] with an [`Event`]. This writes one outbox
//!    row per requested channel, skipping channels the user has turned off.
//!    Rows are unique per `(dedupe_key, channel)`, so enqueueing the same event
//!    twice adds nothing.
//! 2. [`deliver_due`] claims due rows and sends them. A claim sets a lease
//!    (`next_attempt_at`) in the same statement that selects the rows, using
//!    `FOR UPDATE SKIP LOCKED`, so two workers never take the same row.
//! 3. The in-app channel writes into the notification feed
//!    ([`crate::services::notifications::record`]), which is idempotent on the
//!    event's dedupe key, so it is exactly-once even if delivery is retried.
//!    External channels get `idempotency_key` = the outbox row id, so a
//!    provider can drop a duplicate. A crash after a successful send but before
//!    the row is marked can still resend an external message; that is the
//!    at-least-once limit of this design, and the idempotency key is there to
//!    close it at the provider.

use std::future::Future;
use std::time::Duration;

use engipay_core::UserId;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::services::notifications::{NewNotification, record};

/// Attempts before a message is marked `failed` and left for a human.
pub const MAX_ATTEMPTS: i32 = 5;

/// How long a claimed row is held before another worker may take it, so a
/// crashed worker does not strand messages.
pub const CLAIM_LEASE: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    InApp,
    Email,
    Sms,
    Push,
}

impl Channel {
    pub const ALL: [Channel; 4] = [Channel::InApp, Channel::Email, Channel::Sms, Channel::Push];

    pub fn as_str(self) -> &'static str {
        match self {
            Channel::InApp => "in_app",
            Channel::Email => "email",
            Channel::Sms => "sms",
            Channel::Push => "push",
        }
    }
}

/// The events the product can tell a user about. Each has a fixed template.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    DepositReceived,
    WithdrawalCompleted,
    ScheduledTransferCompleted,
    ScheduledTransferSkipped,
}

impl EventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EventKind::DepositReceived => "deposit_received",
            EventKind::WithdrawalCompleted => "withdrawal_completed",
            EventKind::ScheduledTransferCompleted => "scheduled_transfer_completed",
            EventKind::ScheduledTransferSkipped => "scheduled_transfer_skipped",
        }
    }

    /// Title and body for this event. `detail` is a short, already-formatted
    /// fact such as "5 USDC" or "insufficient balance for 2026-11-01".
    pub fn render(self, detail: &str) -> (String, String) {
        match self {
            EventKind::DepositReceived => (
                "Deposit received".to_string(),
                format!("Your deposit of {detail} has arrived."),
            ),
            EventKind::WithdrawalCompleted => (
                "Withdrawal completed".to_string(),
                format!("Your withdrawal of {detail} has been sent."),
            ),
            EventKind::ScheduledTransferCompleted => (
                "Scheduled transfer sent".to_string(),
                format!("Your scheduled transfer of {detail} was sent."),
            ),
            EventKind::ScheduledTransferSkipped => (
                "Scheduled transfer skipped".to_string(),
                format!("A scheduled transfer was not sent: {detail}."),
            ),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    pub user: UserId,
    pub kind: EventKind,
    /// Identifies this occurrence, e.g. `"deposit:<tx hash>"`. Must be stable
    /// across retries of the same event.
    pub dedupe_key: String,
    pub detail: String,
    /// Channels to try. Channels the user has disabled are skipped.
    pub channels: Vec<Channel>,
}

#[derive(Debug, thiserror::Error)]
pub enum ServiceError {
    #[error("dedupe_key must be between 1 and 200 characters")]
    InvalidDedupeKey,
    #[error("notification database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// Whether a channel is on for a user. A missing preference means on.
pub async fn channel_enabled(
    pool: &PgPool,
    user: UserId,
    channel: Channel,
) -> Result<bool, sqlx::Error> {
    let enabled: Option<bool> = sqlx::query_scalar(
        "SELECT enabled FROM notification_preferences WHERE user_id = $1 AND channel = $2",
    )
    .bind(user.as_uuid())
    .bind(channel.as_str())
    .fetch_optional(pool)
    .await?;
    Ok(enabled.unwrap_or(true))
}

/// Sets a user's preference for a channel.
pub async fn set_channel_enabled(
    pool: &PgPool,
    user: UserId,
    channel: Channel,
    enabled: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO notification_preferences (user_id, channel, enabled) VALUES ($1, $2, $3) \
         ON CONFLICT (user_id, channel) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()",
    )
    .bind(user.as_uuid())
    .bind(channel.as_str())
    .bind(enabled)
    .execute(pool)
    .await?;
    Ok(())
}

/// Writes outbox rows for an event. Returns how many rows were newly added.
///
/// Call this in the same database transaction as the business change when you
/// can; this version takes the pool for callers that cannot.
pub async fn enqueue(pool: &PgPool, event: &Event) -> Result<u64, ServiceError> {
    let len = event.dedupe_key.chars().count();
    if !(1..=200).contains(&len) {
        return Err(ServiceError::InvalidDedupeKey);
    }
    let (title, body) = event.kind.render(&event.detail);

    let mut added = 0;
    for &channel in &event.channels {
        if !channel_enabled(pool, event.user, channel).await? {
            continue;
        }
        let result = sqlx::query(
            "INSERT INTO notification_outbox \
                 (user_id, event_kind, channel, dedupe_key, title, body) \
             VALUES ($1, $2, $3, $4, $5, $6) \
             ON CONFLICT (dedupe_key, channel) DO NOTHING",
        )
        .bind(event.user.as_uuid())
        .bind(event.kind.as_str())
        .bind(channel.as_str())
        .bind(&event.dedupe_key)
        .bind(&title)
        .bind(&body)
        .execute(pool)
        .await?;
        added += result.rows_affected();
    }
    Ok(added)
}

/// A message handed to an external provider (email, SMS or push).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboundMessage {
    /// The outbox row id. Providers should treat a repeat with the same key as
    /// already sent.
    pub idempotency_key: String,
    pub user: UserId,
    pub channel: Channel,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProviderError {
    /// Worth retrying later (timeouts, 5xx, rate limits).
    #[error("transient provider failure: {0}")]
    Transient(String),
    /// Will not succeed on retry (bad address, rejected content).
    #[error("permanent provider failure: {0}")]
    Permanent(String),
}

/// Sends a message on an external channel. Real adapters call a provider's
/// API; tests use an in-memory recorder.
pub trait ExternalSender: Sync {
    fn send(
        &self,
        message: &OutboundMessage,
    ) -> impl Future<Output = Result<(), ProviderError>> + Send;
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct DeliveryReport {
    pub sent: u64,
    pub retried: u64,
    pub failed: u64,
}

struct Claimed {
    id: Uuid,
    user_id: Uuid,
    event_kind: String,
    channel: String,
    dedupe_key: String,
    title: String,
    body: String,
    attempts: i32,
}

/// Claims up to `batch` due rows and delivers them once each.
pub async fn deliver_due<S: ExternalSender>(
    pool: &PgPool,
    sender: &S,
    batch: i64,
) -> Result<DeliveryReport, sqlx::Error> {
    let lease_secs = CLAIM_LEASE.as_secs() as f64;

    // Claim: one statement picks the rows, locks them against other workers,
    // and pushes their lease out so no one else takes them while we send.
    let rows = sqlx::query(
        "UPDATE notification_outbox \
         SET attempts = attempts + 1, \
             next_attempt_at = now() + make_interval(secs => $2) \
         WHERE id IN ( \
             SELECT id FROM notification_outbox \
             WHERE state = 'pending' AND next_attempt_at <= now() \
             ORDER BY next_attempt_at \
             LIMIT $1 \
             FOR UPDATE SKIP LOCKED \
         ) \
         RETURNING id, user_id, event_kind, channel, dedupe_key, title, body, attempts",
    )
    .bind(batch)
    .bind(lease_secs)
    .fetch_all(pool)
    .await?;

    let mut report = DeliveryReport::default();
    for row in rows {
        let claimed = Claimed {
            id: row.try_get("id")?,
            user_id: row.try_get("user_id")?,
            event_kind: row.try_get("event_kind")?,
            channel: row.try_get("channel")?,
            dedupe_key: row.try_get("dedupe_key")?,
            title: row.try_get("title")?,
            body: row.try_get("body")?,
            attempts: row.try_get("attempts")?,
        };

        let outcome = if claimed.channel == Channel::InApp.as_str() {
            deliver_in_app(pool, &claimed).await
        } else {
            let channel = match claimed.channel.as_str() {
                "email" => Channel::Email,
                "sms" => Channel::Sms,
                _ => Channel::Push,
            };
            let message = OutboundMessage {
                idempotency_key: claimed.id.to_string(),
                user: UserId::from_uuid(claimed.user_id),
                channel,
                title: claimed.title.clone(),
                body: claimed.body.clone(),
            };
            sender.send(&message).await.map_err(|e| e.to_string())
        };

        match outcome {
            Ok(()) => {
                mark(pool, claimed.id, "sent", None, None).await?;
                report.sent += 1;
            }
            Err(error) => {
                if claimed.attempts >= MAX_ATTEMPTS {
                    mark(pool, claimed.id, "failed", Some(&error), None).await?;
                    report.failed += 1;
                } else {
                    // Back off: 30s, 60s, 90s, ...
                    let delay = 30.0 * f64::from(claimed.attempts);
                    mark(pool, claimed.id, "pending", Some(&error), Some(delay)).await?;
                    report.retried += 1;
                }
            }
        }
    }
    Ok(report)
}

/// In-app delivery writes the feed row. Its dedupe key is the event's, so a
/// second delivery of the same event cannot add a second entry.
async fn deliver_in_app(pool: &PgPool, claimed: &Claimed) -> Result<(), String> {
    record(
        pool,
        &NewNotification {
            user: UserId::from_uuid(claimed.user_id),
            kind: claimed.event_kind.clone(),
            title: claimed.title.clone(),
            body: claimed.body.clone(),
            dedupe_key: claimed.dedupe_key.clone(),
        },
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Records the result of one delivery attempt.
///
/// `state` is `sent`, `failed`, or `pending` (retry). `retry_after_secs` sets
/// the next attempt time for a retry.
async fn mark(
    pool: &PgPool,
    id: Uuid,
    state: &str,
    error: Option<&str>,
    retry_after_secs: Option<f64>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE notification_outbox SET \
             state = $2, \
             last_error = $3, \
             sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END, \
             next_attempt_at = CASE WHEN $4::float8 IS NULL THEN next_attempt_at \
                                    ELSE now() + make_interval(secs => $4) END \
         WHERE id = $1",
    )
    .bind(id)
    .bind(state)
    .bind(error)
    .bind(retry_after_secs)
    .execute(pool)
    .await?;
    Ok(())
}
