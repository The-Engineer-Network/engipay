//! Transactional outbox for domain events (issue #496).
//!
//! # Design
//!
//! Every ledger mutation writes one [`DomainEvent`] row into `outbox_events`
//! inside the **same** database transaction as the ledger change.  Because the
//! insert shares the transaction, a rollback silently discards the event row
//! too — rolled-back changes emit nothing.
//!
//! A background [`OutboxRelay`] polls `outbox_events` in `sequence` order,
//! calls the caller-supplied publish callback for each event, and then marks
//! the row `published_at = now()`.  The relay advances its cursor only after
//! a successful publish, so a process crash between publish and mark causes
//! at-least-once delivery.  Consumers must therefore deduplicate by
//! [`DomainEvent::id`].
//!
//! # Consumer deduplication
//!
//! Consumers call [`mark_consumed`] inside the same local transaction as their
//! own side-effects.  The row inserted into `outbox_consumed` acts as a fence:
//! if the consumer crashes before committing, the fence row is rolled back too,
//! and the relay will re-deliver.  Once committed, a second delivery from the
//! relay hits the `ON CONFLICT DO NOTHING` path and the event is skipped.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use uuid::Uuid;

use engipay_core::{Asset, UserId};

use crate::LedgerError;

// ── Domain events ──────────────────────────────────────────────────────

/// Every money-movement that the ledger can generate.
///
/// Each variant carries enough information for a downstream consumer to act
/// without joining back to the ledger (amounts are in the asset's smallest
/// unit, matching the rest of the codebase).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DomainEvent {
    /// On-chain or on-ramp money has been credited to a user.
    FundsDeposited {
        user_id: UserId,
        asset: Asset,
        amount: i128,
        /// Caller's idempotency reference, e.g. `base:<tx>:<log>`.
        reference: String,
    },
    /// Internal transfer between two EngiPay users completed.
    TransferCompleted {
        from_user_id: UserId,
        to_user_id: UserId,
        asset: Asset,
        amount: i128,
        reference: String,
    },
    /// Money has been committed to an in-flight operation.
    HoldCreated {
        user_id: UserId,
        asset: Asset,
        amount: i128,
        reference: String,
    },
    /// A hold was cancelled and money returned to available.
    HoldReleased {
        user_id: UserId,
        asset: Asset,
        amount: i128,
        reference: String,
    },
    /// A hold settled: money left EngiPay.
    HoldSettled {
        user_id: UserId,
        asset: Asset,
        /// Amount that left EngiPay (held amount minus fee).
        principal: i128,
        /// Platform fee, zero if none.
        fee: i128,
        reference: String,
    },
}

impl DomainEvent {
    /// A short, stable string name used as `event_type` in the database.
    pub fn event_type(&self) -> &'static str {
        match self {
            DomainEvent::FundsDeposited { .. } => "funds_deposited",
            DomainEvent::TransferCompleted { .. } => "transfer_completed",
            DomainEvent::HoldCreated { .. } => "hold_created",
            DomainEvent::HoldReleased { .. } => "hold_released",
            DomainEvent::HoldSettled { .. } => "hold_settled",
        }
    }

    /// The `aggregate_id` — the transaction id of the ledger transaction that
    /// produced this event, used for per-aggregate ordering in the relay.
    pub fn aggregate_id_from_tx(tx_id: Uuid) -> Uuid {
        tx_id
    }
}

// ── Row returned by the relay query ───────────────────────────────────

/// A single pending event as fetched by the relay worker.
#[derive(Debug, Clone)]
pub struct PendingEvent {
    /// Stable event identity for consumer deduplication.
    pub id: Uuid,
    /// Relay ordering key.
    pub sequence: i64,
    /// Logical grouping.
    pub aggregate_id: Uuid,
    pub event_type: String,
    /// Raw JSON payload as stored.
    pub payload: JsonValue,
    /// Associated ledger reference, for correlation.
    pub ledger_ref: Option<String>,
}

// ── OutboxStore trait ──────────────────────────────────────────────────

/// Database operations for the outbox.  The `postgres` feature provides the
/// concrete [`PostgresOutboxStore`] implementation.
///
/// The trait is kept minimal and synchronous-looking (returning `Future`-
/// returning methods) so it can be tested with simple in-memory doubles.
pub trait OutboxStore: Send + Sync {
    /// Fetch up to `limit` unpublished events with `sequence > after_sequence`,
    /// ordered by `sequence` ascending.
    fn fetch_pending(
        &self,
        after_sequence: Option<i64>,
        limit: u32,
    ) -> impl std::future::Future<Output = Result<Vec<PendingEvent>, LedgerError>> + Send;

    /// Mark an event as published.  Called by the relay after a successful
    /// broker publish.
    fn mark_published(
        &self,
        event_id: Uuid,
        sequence: i64,
    ) -> impl std::future::Future<Output = Result<(), LedgerError>> + Send;

    /// Load the relay cursor (highest published sequence) for `relay_name`.
    fn load_cursor(
        &self,
        relay_name: &str,
    ) -> impl std::future::Future<Output = Result<Option<i64>, LedgerError>> + Send;

    /// Persist the updated relay cursor.
    fn save_cursor(
        &self,
        relay_name: &str,
        last_sequence: i64,
    ) -> impl std::future::Future<Output = Result<(), LedgerError>> + Send;

    /// Record that `consumer_name` has successfully processed `event_id`.
    ///
    /// Uses `INSERT … ON CONFLICT DO NOTHING`, so calling this twice is safe.
    /// Returns `true` when the row was newly inserted (first time), `false`
    /// when it already existed (duplicate delivery).
    fn mark_consumed(
        &self,
        consumer_name: &str,
        event_id: Uuid,
    ) -> impl std::future::Future<Output = Result<bool, LedgerError>> + Send;

    /// Check whether `consumer_name` has already consumed `event_id`.
    fn is_consumed(
        &self,
        consumer_name: &str,
        event_id: Uuid,
    ) -> impl std::future::Future<Output = Result<bool, LedgerError>> + Send;
}

// ── OutboxRelay ────────────────────────────────────────────────────────

/// Background relay worker: polls the outbox, invokes a publish callback, and
/// advances the cursor.
///
/// Construct with [`OutboxRelay::new`], then call [`OutboxRelay::run_once`] in
/// a loop (or use the convenience [`OutboxRelay::run`] which loops with a
/// configurable interval).
///
/// # Publish callback
///
/// The `publish` closure receives each [`PendingEvent`] and must return `Ok(())`
/// on success.  The relay calls it sequentially in `sequence` order within
/// each batch.  If it returns `Err`, the relay stops and surfaces the error
/// without advancing the cursor past the failing event, so the event will be
/// retried on the next poll.
pub struct OutboxRelay<S> {
    store: S,
    relay_name: String,
    batch_size: u32,
}

impl<S: OutboxStore> OutboxRelay<S> {
    /// Create a new relay.
    ///
    /// * `store` – outbox persistence layer.
    /// * `relay_name` – must match a row in `outbox_relay_cursor`; use
    ///   `"default"` unless you are sharding the relay.
    /// * `batch_size` – events fetched and published per tick (≥ 1).
    pub fn new(store: S, relay_name: impl Into<String>, batch_size: u32) -> Self {
        assert!(batch_size >= 1, "batch_size must be at least 1");
        Self {
            store,
            relay_name: relay_name.into(),
            batch_size,
        }
    }

    /// Process one batch of pending events.
    ///
    /// Returns the number of events published this tick (0 when the outbox is
    /// empty).
    pub async fn run_once<F, Fut>(&self, publish: F) -> Result<u32, LedgerError>
    where
        F: Fn(PendingEvent) -> Fut,
        Fut: std::future::Future<Output = Result<(), LedgerError>>,
    {
        let cursor = self.store.load_cursor(&self.relay_name).await?;
        let events = self.store.fetch_pending(cursor, self.batch_size).await?;

        if events.is_empty() {
            return Ok(0);
        }

        let mut published = 0u32;
        let mut last_sequence = cursor;

        for event in events {
            let sequence = event.sequence;
            let event_id = event.id;

            publish(event).await?;
            self.store.mark_published(event_id, sequence).await?;

            last_sequence = Some(sequence);
            published = published.saturating_add(1);
        }

        if let Some(seq) = last_sequence {
            self.store.save_cursor(&self.relay_name, seq).await?;
        }

        Ok(published)
    }

    /// Run the relay in a loop with `interval` between ticks until `shutdown`
    /// resolves.
    ///
    /// This is the production entry point: spawn it as a [`tokio::task`].
    #[cfg(feature = "postgres")]
    pub async fn run<F, Fut>(
        &self,
        interval: std::time::Duration,
        mut shutdown: tokio::sync::watch::Receiver<bool>,
        publish: F,
    ) where
        F: Fn(PendingEvent) -> Fut,
        Fut: std::future::Future<Output = Result<(), LedgerError>>,
    {
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    match self.run_once(&publish).await {
                        Ok(n) if n > 0 => {
                            tracing::debug!(published = n, relay = %self.relay_name, "outbox relay published events");
                        }
                        Ok(_) => {}
                        Err(e) => {
                            tracing::error!(error = %e, relay = %self.relay_name, "outbox relay error");
                        }
                    }
                }
                _ = shutdown.changed() => {
                    tracing::info!(relay = %self.relay_name, "outbox relay shutting down");
                    break;
                }
            }
        }
    }
}

// ── PostgreSQL implementation ──────────────────────────────────────────

#[cfg(feature = "postgres")]
pub mod pg {
    use sqlx::{PgPool, Row};
    use uuid::Uuid;

    use super::{DomainEvent, LedgerError, OutboxStore, PendingEvent};
    use crate::postgres::db_err;

    /// Postgres-backed [`OutboxStore`].
    pub struct PostgresOutboxStore {
        pool: PgPool,
    }

    impl PostgresOutboxStore {
        pub fn new(pool: PgPool) -> Self {
            Self { pool }
        }
    }

    impl OutboxStore for PostgresOutboxStore {
        async fn fetch_pending(
            &self,
            after_sequence: Option<i64>,
            limit: u32,
        ) -> Result<Vec<PendingEvent>, LedgerError> {
            let after = after_sequence.unwrap_or(0);
            let rows = sqlx::query(
                "SELECT id, sequence, aggregate_id, event_type, payload, ledger_ref \
                 FROM outbox_events \
                 WHERE published_at IS NULL AND sequence > $1 \
                 ORDER BY sequence ASC \
                 LIMIT $2",
            )
            .bind(after)
            .bind(i64::from(limit))
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;

            let mut out = Vec::with_capacity(rows.len());
            for row in rows {
                let id: Uuid = row.get("id");
                let sequence: i64 = row.get("sequence");
                let aggregate_id: Uuid = row.get("aggregate_id");
                let event_type: String = row.get("event_type");
                let payload: serde_json::Value = row.get("payload");
                let ledger_ref: Option<String> = row.get("ledger_ref");
                out.push(PendingEvent {
                    id,
                    sequence,
                    aggregate_id,
                    event_type,
                    payload,
                    ledger_ref,
                });
            }
            Ok(out)
        }

        async fn mark_published(&self, event_id: Uuid, _sequence: i64) -> Result<(), LedgerError> {
            sqlx::query("UPDATE outbox_events SET published_at = now() WHERE id = $1")
                .bind(event_id)
                .execute(&self.pool)
                .await
                .map_err(db_err)?;
            Ok(())
        }

        async fn load_cursor(&self, relay_name: &str) -> Result<Option<i64>, LedgerError> {
            let row =
                sqlx::query("SELECT last_sequence FROM outbox_relay_cursor WHERE relay_name = $1")
                    .bind(relay_name)
                    .fetch_optional(&self.pool)
                    .await
                    .map_err(db_err)?;

            Ok(row
                .map(|r| r.get::<Option<i64>, _>("last_sequence"))
                .flatten())
        }

        async fn save_cursor(
            &self,
            relay_name: &str,
            last_sequence: i64,
        ) -> Result<(), LedgerError> {
            sqlx::query(
                "UPDATE outbox_relay_cursor \
                 SET last_sequence = $1, updated_at = now() \
                 WHERE relay_name = $2",
            )
            .bind(last_sequence)
            .bind(relay_name)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
            Ok(())
        }

        async fn mark_consumed(
            &self,
            consumer_name: &str,
            event_id: Uuid,
        ) -> Result<bool, LedgerError> {
            let result = sqlx::query(
                "INSERT INTO outbox_consumed (consumer_name, event_id) \
                 VALUES ($1, $2) \
                 ON CONFLICT DO NOTHING",
            )
            .bind(consumer_name)
            .bind(event_id)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;

            Ok(result.rows_affected() == 1)
        }

        async fn is_consumed(
            &self,
            consumer_name: &str,
            event_id: Uuid,
        ) -> Result<bool, LedgerError> {
            let row = sqlx::query(
                "SELECT 1 FROM outbox_consumed \
                 WHERE consumer_name = $1 AND event_id = $2",
            )
            .bind(consumer_name)
            .bind(event_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
            Ok(row.is_some())
        }
    }

    // ── SQL helper: write one event row inside an existing transaction ─────

    /// Insert a single [`DomainEvent`] row into `outbox_events` inside the
    /// supplied open transaction.
    ///
    /// This is called by [`crate::postgres::PostgresLedgerStore`] for every
    /// ledger mutation.
    pub(crate) async fn insert_outbox_event(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        event_id: Uuid,
        aggregate_id: Uuid,
        event: &DomainEvent,
        ledger_ref: Option<&str>,
    ) -> Result<(), LedgerError> {
        let payload = serde_json::to_value(event).map_err(|e| LedgerError::Database {
            code: None,
            message: format!("failed to serialise domain event: {e}"),
        })?;

        sqlx::query(
            "INSERT INTO outbox_events (id, aggregate_id, event_type, payload, ledger_ref) \
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(event_id)
        .bind(aggregate_id)
        .bind(event.event_type())
        .bind(payload)
        .bind(ledger_ref)
        .execute(&mut **tx)
        .await
        .map_err(db_err)?;

        Ok(())
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    // ── Minimal in-memory OutboxStore for unit tests ─────────────────

    #[derive(Default, Clone)]
    struct MemOutbox {
        events: Arc<Mutex<Vec<PendingEvent>>>,
        cursors: Arc<Mutex<HashMap<String, i64>>>,
        consumed: Arc<Mutex<HashMap<(String, Uuid), ()>>>,
        next_seq: Arc<Mutex<i64>>,
    }

    impl OutboxStore for MemOutbox {
        async fn fetch_pending(
            &self,
            after_sequence: Option<i64>,
            limit: u32,
        ) -> Result<Vec<PendingEvent>, LedgerError> {
            let after = after_sequence.unwrap_or(0);
            let events = self.events.lock().unwrap();
            Ok(events
                .iter()
                .filter(|e| e.sequence > after)
                .take(limit as usize)
                .cloned()
                .collect())
        }

        async fn mark_published(&self, event_id: Uuid, _sequence: i64) -> Result<(), LedgerError> {
            // In the memory store we just remove the event from pending.
            self.events.lock().unwrap().retain(|e| e.id != event_id);
            Ok(())
        }

        async fn load_cursor(&self, relay_name: &str) -> Result<Option<i64>, LedgerError> {
            Ok(self.cursors.lock().unwrap().get(relay_name).copied())
        }

        async fn save_cursor(
            &self,
            relay_name: &str,
            last_sequence: i64,
        ) -> Result<(), LedgerError> {
            self.cursors
                .lock()
                .unwrap()
                .insert(relay_name.to_owned(), last_sequence);
            Ok(())
        }

        async fn mark_consumed(
            &self,
            consumer_name: &str,
            event_id: Uuid,
        ) -> Result<bool, LedgerError> {
            let key = (consumer_name.to_owned(), event_id);
            let mut map = self.consumed.lock().unwrap();
            if map.contains_key(&key) {
                return Ok(false);
            }
            map.insert(key, ());
            Ok(true)
        }

        async fn is_consumed(
            &self,
            consumer_name: &str,
            event_id: Uuid,
        ) -> Result<bool, LedgerError> {
            Ok(self
                .consumed
                .lock()
                .unwrap()
                .contains_key(&(consumer_name.to_owned(), event_id)))
        }
    }

    impl MemOutbox {
        /// Push a fake pending event (simulates an outbox insert).
        fn push(&self, event_type: &str) -> Uuid {
            let id = Uuid::new_v4();
            let mut seq = self.next_seq.lock().unwrap();
            *seq = seq.saturating_add(1);
            self.events.lock().unwrap().push(PendingEvent {
                id,
                sequence: *seq,
                aggregate_id: Uuid::new_v4(),
                event_type: event_type.to_owned(),
                payload: serde_json::json!({}),
                ledger_ref: None,
            });
            id
        }
    }

    // ── Test: relay publishes in order and advances cursor ────────────

    #[tokio::test]
    async fn relay_publishes_in_sequence_order_and_advances_cursor() {
        let store = MemOutbox::default();
        let id1 = store.push("funds_deposited");
        let id2 = store.push("transfer_completed");

        let relay = OutboxRelay::new(store.clone(), "default", 10);
        let published: Arc<Mutex<Vec<Uuid>>> = Arc::new(Mutex::new(vec![]));
        let published_clone = published.clone();

        let n = relay
            .run_once(|e| {
                let published = published_clone.clone();
                async move {
                    published.lock().unwrap().push(e.id);
                    Ok(())
                }
            })
            .await
            .unwrap();

        assert_eq!(n, 2);
        let order = published.lock().unwrap().clone();
        assert_eq!(order, vec![id1, id2]);

        // Cursor should now be at the last sequence (2).
        let cursor = store.load_cursor("default").await.unwrap();
        assert_eq!(cursor, Some(2));

        // No more events.
        let n2 = relay.run_once(|_e| async { Ok(()) }).await.unwrap();
        assert_eq!(n2, 0);
    }

    // ── Test: publish error stops relay without advancing cursor ──────

    #[tokio::test]
    async fn relay_stops_on_publish_error_without_advancing_cursor() {
        let store = MemOutbox::default();
        store.push("funds_deposited");
        store.push("transfer_completed");

        let relay = OutboxRelay::new(store.clone(), "default", 10);
        let result = relay
            .run_once(|_e| async {
                Err(LedgerError::Database {
                    code: None,
                    message: "broker down".into(),
                })
            })
            .await;

        assert!(result.is_err());
        // Cursor must still be None — nothing was successfully published.
        let cursor = store.load_cursor("default").await.unwrap();
        assert!(cursor.is_none());
    }

    // ── Test: consumer deduplication ─────────────────────────────────

    #[tokio::test]
    async fn consumer_deduplicates_by_event_id() {
        let store = MemOutbox::default();
        let id = Uuid::new_v4();

        let first = store.mark_consumed("webhook-svc", id).await.unwrap();
        assert!(first, "first time should return true");

        let second = store.mark_consumed("webhook-svc", id).await.unwrap();
        assert!(
            !second,
            "second time should return false (already consumed)"
        );

        assert!(store.is_consumed("webhook-svc", id).await.unwrap());
        assert!(!store.is_consumed("other-svc", id).await.unwrap());
    }

    // ── Test: DomainEvent serialisation round-trip ─────────────────

    #[test]
    fn domain_event_serialises_with_type_tag() {
        let ev = DomainEvent::FundsDeposited {
            user_id: UserId::new(),
            asset: engipay_core::Asset::Usdc,
            amount: 100,
            reference: "dep-1".into(),
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(
            json.contains("\"type\":\"funds_deposited\""),
            "type tag must be present"
        );

        let round: DomainEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(ev, round);
    }

    #[test]
    fn domain_event_event_type_matches_serde_tag() {
        let cases: &[(DomainEvent, &str)] = &[
            (
                DomainEvent::FundsDeposited {
                    user_id: UserId::new(),
                    asset: engipay_core::Asset::Usdc,
                    amount: 1,
                    reference: "r".into(),
                },
                "funds_deposited",
            ),
            (
                DomainEvent::TransferCompleted {
                    from_user_id: UserId::new(),
                    to_user_id: UserId::new(),
                    asset: engipay_core::Asset::Usdc,
                    amount: 1,
                    reference: "r".into(),
                },
                "transfer_completed",
            ),
            (
                DomainEvent::HoldCreated {
                    user_id: UserId::new(),
                    asset: engipay_core::Asset::Usdc,
                    amount: 1,
                    reference: "r".into(),
                },
                "hold_created",
            ),
            (
                DomainEvent::HoldReleased {
                    user_id: UserId::new(),
                    asset: engipay_core::Asset::Usdc,
                    amount: 1,
                    reference: "r".into(),
                },
                "hold_released",
            ),
            (
                DomainEvent::HoldSettled {
                    user_id: UserId::new(),
                    asset: engipay_core::Asset::Usdc,
                    principal: 90,
                    fee: 10,
                    reference: "r".into(),
                },
                "hold_settled",
            ),
        ];

        for (event, expected_type) in cases {
            assert_eq!(event.event_type(), *expected_type);
        }
    }

    // ── Test: relay batch_size is honoured ────────────────────────────

    #[tokio::test]
    async fn relay_respects_batch_size() {
        let store = MemOutbox::default();
        for _ in 0..5 {
            store.push("funds_deposited");
        }

        let relay = OutboxRelay::new(store.clone(), "default", 2);
        let count: Arc<Mutex<u32>> = Arc::new(Mutex::new(0));
        let count_clone = count.clone();

        let n = relay
            .run_once(|_e| {
                let c = count_clone.clone();
                async move {
                    *c.lock().unwrap() = c.lock().unwrap().saturating_add(1);
                    Ok(())
                }
            })
            .await
            .unwrap();

        assert_eq!(n, 2, "only batch_size events should be published per tick");
    }
}
