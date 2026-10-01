//! Withdrawal records and the status machine they move through.
//!
//! One row in `withdrawals` per outbound payment (migration 0009). The chain
//! service advances it as the payment is broadcast, confirmed and settled:
//!
//! ```text
//!   pending_broadcast → broadcast_accepted → confirmed → completed
//!          │                    │               ▲
//!          │                    ▼               │
//!          ├──────────► pending_manual_review ──┘
//!          ▼                    │
//!        failed ◄───────────────┘
//! ```
//!
//! Every move goes through [`WithdrawalStatus::can_move_to`], so a late or
//! duplicated event can never drag a completed withdrawal backwards. Moving to
//! the status a withdrawal is already in is accepted as a replay, which makes
//! each step safe to retry.

use std::future::Future;

use engipay_core::{Asset, Money, UserId};
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WithdrawalStatus {
    /// Created and signed, not yet accepted by the network.
    PendingBroadcast,
    /// Horizon accepted the transaction; `tx_hash` is recorded.
    BroadcastAccepted,
    /// The transaction is in a closed ledger and succeeded.
    Confirmed,
    /// The hold is settled: the money has left EngiPay's books.
    Completed,
    /// The outcome is unknown (timeout, Horizon unreachable). The hold stays
    /// in place until someone, or a later poll, decides.
    PendingManualReview,
    /// Rejected or failed on-chain. The hold is released.
    Failed,
}

impl WithdrawalStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PendingBroadcast => "pending_broadcast",
            Self::BroadcastAccepted => "broadcast_accepted",
            Self::Confirmed => "confirmed",
            Self::Completed => "completed",
            Self::PendingManualReview => "pending_manual_review",
            Self::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|status| status.as_str() == value)
    }

    const ALL: [Self; 6] = [
        Self::PendingBroadcast,
        Self::BroadcastAccepted,
        Self::Confirmed,
        Self::Completed,
        Self::PendingManualReview,
        Self::Failed,
    ];

    /// Whether a withdrawal in `self` may move to `next`.
    pub const fn can_move_to(self, next: Self) -> bool {
        use WithdrawalStatus::*;
        matches!(
            (self, next),
            (PendingBroadcast, BroadcastAccepted)
                | (PendingBroadcast, PendingManualReview)
                | (PendingBroadcast, Failed)
                | (BroadcastAccepted, Confirmed)
                | (BroadcastAccepted, PendingManualReview)
                | (BroadcastAccepted, Failed)
                // A later poll or an operator resolves an unknown outcome.
                | (PendingManualReview, Confirmed)
                | (PendingManualReview, Failed)
                | (Confirmed, Completed)
        )
    }

    /// Every status that may move to `next`.
    pub fn allowed_from(next: Self) -> Vec<Self> {
        Self::ALL
            .into_iter()
            .filter(|status| status.can_move_to(next))
            .collect()
    }
}

impl std::fmt::Display for WithdrawalStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A withdrawal as stored, with amounts in the asset's smallest unit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Withdrawal {
    pub id: Uuid,
    pub user: UserId,
    /// What the destination receives.
    pub amount: Money,
    /// Locked in the hold with the principal; booked to `Fees` on settlement.
    pub fee: Money,
    pub destination: String,
    pub hold_reference: String,
    pub tx_hash: Option<String>,
    pub confirmed_ledger: Option<u64>,
    pub status: WithdrawalStatus,
}

/// What to record alongside a status change. `None` leaves a column as is.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StatusUpdate {
    pub tx_hash: Option<String>,
    pub confirmed_ledger: Option<u64>,
}

#[derive(Debug, thiserror::Error)]
pub enum WithdrawalError {
    #[error("withdrawal {0} does not exist")]
    NotFound(Uuid),
    #[error("withdrawal {id} cannot move from {from} to {to}")]
    InvalidTransition {
        id: Uuid,
        from: WithdrawalStatus,
        to: WithdrawalStatus,
    },
    #[error("withdrawal {id} already has transaction {existing}, not {attempted}")]
    HashConflict {
        id: Uuid,
        existing: String,
        attempted: String,
    },
    #[error("withdrawal store: {0}")]
    Database(String),
}

/// Where withdrawals are read and their status advanced. Postgres in
/// production ([`PgWithdrawalStore`]); an in-memory fake in tests.
pub trait WithdrawalStore: Send + Sync {
    fn get(&self, id: Uuid) -> impl Future<Output = Result<Withdrawal, WithdrawalError>> + Send;

    /// Moves `id` to `to`, recording `update`. Moving to the current status is
    /// a replay and succeeds without changing anything. A `tx_hash` never
    /// overwrites a different hash already recorded.
    fn transition(
        &self,
        id: Uuid,
        to: WithdrawalStatus,
        update: StatusUpdate,
    ) -> impl Future<Output = Result<(), WithdrawalError>> + Send;
}

/// Checks a move against the status machine and the recorded hash. Shared by
/// every store so they agree on what is allowed.
pub fn check_transition(
    current: &Withdrawal,
    to: WithdrawalStatus,
    update: &StatusUpdate,
) -> Result<(), WithdrawalError> {
    if let (Some(existing), Some(attempted)) = (&current.tx_hash, &update.tx_hash) {
        if existing != attempted {
            return Err(WithdrawalError::HashConflict {
                id: current.id,
                existing: existing.clone(),
                attempted: attempted.clone(),
            });
        }
    }
    if current.status == to || current.status.can_move_to(to) {
        Ok(())
    } else {
        Err(WithdrawalError::InvalidTransition {
            id: current.id,
            from: current.status,
            to,
        })
    }
}

/// The `withdrawals` table.
#[derive(Debug, Clone)]
pub struct PgWithdrawalStore {
    pool: PgPool,
}

impl PgWithdrawalStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn db_error(error: sqlx::Error) -> WithdrawalError {
    WithdrawalError::Database(error.to_string())
}

fn corrupt(id: Uuid, what: &str) -> WithdrawalError {
    WithdrawalError::Database(format!("withdrawal {id} has an invalid {what}"))
}

impl WithdrawalStore for PgWithdrawalStore {
    async fn get(&self, id: Uuid) -> Result<Withdrawal, WithdrawalError> {
        let row = sqlx::query(
            "SELECT id, user_id, asset, amount::text AS amount, \
                    estimated_fee::text AS estimated_fee, destination, hold_reference, \
                    tx_hash, confirmed_ledger, status \
             FROM withdrawals WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(db_error)?
        .ok_or(WithdrawalError::NotFound(id))?;

        let asset: Asset = row
            .get::<String, _>("asset")
            .parse()
            .map_err(|_| corrupt(id, "asset"))?;
        let minor = |column: &str| -> Result<Money, WithdrawalError> {
            row.get::<String, _>(column)
                .parse::<i128>()
                .map(|minor| Money::from_minor(asset, minor))
                .map_err(|_| corrupt(id, column))
        };
        let confirmed_ledger = row
            .get::<Option<i64>, _>("confirmed_ledger")
            .map(|ledger| u64::try_from(ledger).map_err(|_| corrupt(id, "confirmed_ledger")))
            .transpose()?;
        let status = WithdrawalStatus::parse(&row.get::<String, _>("status"))
            .ok_or_else(|| corrupt(id, "status"))?;

        Ok(Withdrawal {
            id: row.get("id"),
            user: UserId::from_uuid(row.get("user_id")),
            amount: minor("amount")?,
            fee: minor("estimated_fee")?,
            destination: row.get("destination"),
            hold_reference: row.get("hold_reference"),
            tx_hash: row.get("tx_hash"),
            confirmed_ledger,
            status,
        })
    }

    async fn transition(
        &self,
        id: Uuid,
        to: WithdrawalStatus,
        update: StatusUpdate,
    ) -> Result<(), WithdrawalError> {
        let confirmed_ledger = update
            .confirmed_ledger
            .map(|ledger| {
                i64::try_from(ledger)
                    .map_err(|_| WithdrawalError::Database("ledger out of range".to_owned()))
            })
            .transpose()?;
        let allowed_from: Vec<&str> = WithdrawalStatus::allowed_from(to)
            .into_iter()
            .map(WithdrawalStatus::as_str)
            .collect();

        // The status guard and the hash guard live in the WHERE clause, so
        // two workers racing on the same withdrawal cannot both win.
        let updated = sqlx::query(
            "UPDATE withdrawals \
             SET status = $2, \
                 tx_hash = COALESCE($3, tx_hash), \
                 confirmed_ledger = COALESCE($4, confirmed_ledger), \
                 updated_at = now() \
             WHERE id = $1 \
               AND status = ANY($5) \
               AND ($3::text IS NULL OR tx_hash IS NULL OR tx_hash = $3)",
        )
        .bind(id)
        .bind(to.as_str())
        .bind(update.tx_hash.as_deref())
        .bind(confirmed_ledger)
        .bind(&allowed_from)
        .execute(&self.pool)
        .await
        .map_err(db_error)?
        .rows_affected();

        if updated == 1 {
            return Ok(());
        }
        // Nothing changed: either a replay (already in `to`) or a refusal.
        // Re-read to say which.
        let current = self.get(id).await?;
        check_transition(&current, to, &update)?;
        if current.status == to {
            return Ok(());
        }
        Err(WithdrawalError::InvalidTransition {
            id,
            from: current.status,
            to,
        })
    }
}

#[cfg(test)]
pub(crate) mod fake {
    //! An in-memory [`WithdrawalStore`] for unit tests.

    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::*;

    #[derive(Debug, Default)]
    pub struct FakeWithdrawalStore {
        rows: Mutex<HashMap<Uuid, Withdrawal>>,
    }

    impl FakeWithdrawalStore {
        pub fn with(withdrawal: Withdrawal) -> Self {
            let store = Self::default();
            store
                .rows
                .lock()
                .expect("fake store lock")
                .insert(withdrawal.id, withdrawal);
            store
        }

        pub fn snapshot(&self, id: Uuid) -> Withdrawal {
            self.rows.lock().expect("fake store lock")[&id].clone()
        }
    }

    impl WithdrawalStore for FakeWithdrawalStore {
        async fn get(&self, id: Uuid) -> Result<Withdrawal, WithdrawalError> {
            self.rows
                .lock()
                .expect("fake store lock")
                .get(&id)
                .cloned()
                .ok_or(WithdrawalError::NotFound(id))
        }

        async fn transition(
            &self,
            id: Uuid,
            to: WithdrawalStatus,
            update: StatusUpdate,
        ) -> Result<(), WithdrawalError> {
            let mut rows = self.rows.lock().expect("fake store lock");
            let row = rows.get_mut(&id).ok_or(WithdrawalError::NotFound(id))?;
            check_transition(row, to, &update)?;
            row.status = to;
            if update.tx_hash.is_some() {
                row.tx_hash = update.tx_hash;
            }
            if update.confirmed_ledger.is_some() {
                row.confirmed_ledger = update.confirmed_ledger;
            }
            Ok(())
        }
    }

    pub fn pending(asset: Asset, amount: i128, fee: i128) -> Withdrawal {
        Withdrawal {
            id: Uuid::new_v4(),
            user: UserId::new(),
            amount: Money::from_minor(asset, amount),
            fee: Money::from_minor(asset, fee),
            destination: "GDESTINATION".to_owned(),
            hold_reference: format!("withdrawal-{}", Uuid::new_v4()),
            tx_hash: None,
            confirmed_ledger: None,
            status: WithdrawalStatus::PendingBroadcast,
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::fake::{FakeWithdrawalStore, pending};
    use super::*;
    use WithdrawalStatus::*;

    #[test]
    fn statuses_round_trip_through_their_column_value() {
        for status in WithdrawalStatus::ALL {
            assert_eq!(WithdrawalStatus::parse(status.as_str()), Some(status));
        }
        assert_eq!(WithdrawalStatus::parse("settled"), None);
    }

    #[test]
    fn the_happy_path_is_allowed() {
        assert!(PendingBroadcast.can_move_to(BroadcastAccepted));
        assert!(BroadcastAccepted.can_move_to(Confirmed));
        assert!(Confirmed.can_move_to(Completed));
    }

    #[test]
    fn finished_withdrawals_never_move_again() {
        for next in WithdrawalStatus::ALL {
            assert!(!Completed.can_move_to(next), "completed → {next}");
            assert!(!Failed.can_move_to(next), "failed → {next}");
        }
    }

    #[test]
    fn a_confirmed_withdrawal_cannot_be_failed_or_skipped_to_completed_early() {
        assert!(!Confirmed.can_move_to(Failed));
        assert!(!Confirmed.can_move_to(PendingManualReview));
        assert!(!BroadcastAccepted.can_move_to(Completed));
        assert!(!PendingBroadcast.can_move_to(Confirmed));
    }

    #[test]
    fn allowed_from_matches_the_table() {
        assert_eq!(WithdrawalStatus::allowed_from(Completed), vec![Confirmed]);
        assert_eq!(
            WithdrawalStatus::allowed_from(Confirmed),
            vec![BroadcastAccepted, PendingManualReview]
        );
    }

    #[tokio::test]
    async fn moving_to_the_current_status_is_a_replay() {
        let withdrawal = pending(Asset::Usdc, 100, 1);
        let id = withdrawal.id;
        let store = FakeWithdrawalStore::with(withdrawal);
        let update = StatusUpdate {
            tx_hash: Some("aa".to_owned()),
            confirmed_ledger: None,
        };
        store
            .transition(id, BroadcastAccepted, update.clone())
            .await
            .unwrap();
        store
            .transition(id, BroadcastAccepted, update)
            .await
            .unwrap();
        assert_eq!(store.snapshot(id).status, BroadcastAccepted);
    }

    #[tokio::test]
    async fn a_recorded_hash_is_never_overwritten() {
        let withdrawal = pending(Asset::Usdc, 100, 1);
        let id = withdrawal.id;
        let store = FakeWithdrawalStore::with(withdrawal);
        store
            .transition(
                id,
                BroadcastAccepted,
                StatusUpdate {
                    tx_hash: Some("aa".to_owned()),
                    confirmed_ledger: None,
                },
            )
            .await
            .unwrap();

        let err = store
            .transition(
                id,
                PendingManualReview,
                StatusUpdate {
                    tx_hash: Some("bb".to_owned()),
                    confirmed_ledger: None,
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(err, WithdrawalError::HashConflict { .. }));
        assert_eq!(store.snapshot(id).tx_hash.as_deref(), Some("aa"));
    }

    // ── Postgres ─────────────────────────────────────────────────────────────
    //
    // Run with a migrated database:
    //   DATABASE_URL=postgres://... cargo test -p engipay-chain withdrawals -- --ignored

    async fn test_pool() -> Option<PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        PgPool::connect(&url).await.ok()
    }

    /// Inserts a user, a funded hold and a pending withdrawal against it.
    async fn insert_withdrawal(pool: &PgPool) -> Uuid {
        use engipay_ledger::postgres::PostgresLedgerStore;

        let user = UserId::new();
        sqlx::query("INSERT INTO users (id) VALUES ($1)")
            .bind(user.as_uuid())
            .execute(pool)
            .await
            .unwrap();
        let ledger = PostgresLedgerStore::new(pool.clone());
        let hold_reference = format!("withdrawal-{}", Uuid::new_v4());
        ledger
            .deposit(
                user,
                Money::from_minor(Asset::Usdc, 1_000),
                &format!("dep-{}", Uuid::new_v4()),
            )
            .await
            .unwrap();
        ledger
            .create_hold(user, Money::from_minor(Asset::Usdc, 1_000), &hold_reference)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO withdrawals \
                (user_id, asset, amount, estimated_fee, destination, hold_reference) \
             VALUES ($1, 'USDC', 900, 100, 'GDESTINATION', $2) RETURNING id",
        )
        .bind(user.as_uuid())
        .bind(&hold_reference)
        .fetch_one(pool)
        .await
        .unwrap()
        .get("id")
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn postgres_store_records_the_hash_and_enforces_the_status_machine() {
        let pool = test_pool().await.unwrap();
        let store = PgWithdrawalStore::new(pool.clone());
        let id = insert_withdrawal(&pool).await;
        let hash = format!("{:064x}", id.as_u128());

        let before = store.get(id).await.unwrap();
        assert_eq!(before.status, PendingBroadcast);
        assert_eq!(before.amount, Money::from_minor(Asset::Usdc, 900));
        assert_eq!(before.fee, Money::from_minor(Asset::Usdc, 100));
        assert_eq!(before.tx_hash, None);

        let accepted = StatusUpdate {
            tx_hash: Some(hash.clone()),
            confirmed_ledger: None,
        };
        store
            .transition(id, BroadcastAccepted, accepted.clone())
            .await
            .unwrap();
        // Replays are accepted.
        store
            .transition(id, BroadcastAccepted, accepted)
            .await
            .unwrap();

        let after = store.get(id).await.unwrap();
        assert_eq!(after.status, BroadcastAccepted);
        assert_eq!(after.tx_hash, Some(hash.clone()));

        // A different hash is refused and the original kept.
        let conflict = store
            .transition(
                id,
                Confirmed,
                StatusUpdate {
                    tx_hash: Some("ff".repeat(32)),
                    confirmed_ledger: Some(7),
                },
            )
            .await;
        assert!(matches!(
            conflict,
            Err(WithdrawalError::HashConflict { .. })
        ));

        store
            .transition(
                id,
                Confirmed,
                StatusUpdate {
                    tx_hash: None,
                    confirmed_ledger: Some(7),
                },
            )
            .await
            .unwrap();
        // Confirmed cannot go back to failed.
        let backwards = store.transition(id, Failed, StatusUpdate::default()).await;
        assert!(matches!(
            backwards,
            Err(WithdrawalError::InvalidTransition {
                from: Confirmed,
                to: Failed,
                ..
            })
        ));

        let confirmed = store.get(id).await.unwrap();
        assert_eq!(confirmed.confirmed_ledger, Some(7));
        assert_eq!(confirmed.tx_hash, Some(hash));
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn postgres_store_reports_missing_withdrawals() {
        let pool = test_pool().await.unwrap();
        let store = PgWithdrawalStore::new(pool);
        let missing = Uuid::new_v4();
        assert!(matches!(
            store.get(missing).await,
            Err(WithdrawalError::NotFound(id)) if id == missing
        ));
        assert!(matches!(
            store
                .transition(missing, Failed, StatusUpdate::default())
                .await,
            Err(WithdrawalError::NotFound(_))
        ));
    }
}
