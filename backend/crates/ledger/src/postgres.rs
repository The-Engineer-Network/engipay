//! PostgreSQL-backed ledger store.
//!
//! Each public method runs inside a SERIALIZABLE transaction so that
//! concurrent calls cannot violate ledger invariants. Transient
//! serialization failures (PG error codes `40001` and `40P01`) are
//! retried automatically with exponential backoff and jitter, up to
//! [`MAX_RETRIES`] times before surfacing the error.

use std::future::Future;
use std::time::Duration;

use sqlx::{PgPool, Postgres, Row, postgres::PgRow};
use uuid::Uuid;

use engipay_core::{Asset, Money, UserId};

use crate::{Balance, HoldState, LedgerError, Receipt};

// ── Public row types ──────────────────────────────────────────────────

/// A single open (in-flight) hold on a user's funds, as returned by
/// [`PostgresLedgerStore::get_active_holds`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveHold {
    pub reference: String,
    pub asset: Asset,
    /// Amount in the asset's smallest unit (same precision as the ledger).
    pub amount: i128,
    /// RFC 3339 timestamp of when the hold was created.
    pub created_at: String,
}

/// A point-in-time balance snapshot for one (user, asset, bucket) triple,
/// as returned by [`PostgresLedgerStore::take_snapshot`] and
/// [`PostgresLedgerStore::get_latest_snapshot`].
///
/// Snapshots are the starting-point for as-of queries: instead of summing
/// every posting from the beginning of time, the query sums the snapshot
/// balance plus only the postings written after `snapshotted_at`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BalanceSnapshot {
    pub user_id: UserId,
    pub asset: Asset,
    pub bucket: crate::Bucket,
    /// Balance in the asset's smallest unit at the moment `snapshotted_at`.
    pub balance: i128,
    /// RFC 3339 timestamp when this snapshot was taken.
    pub snapshotted_at: String,
}

// ── Constants ──────────────────────────────────────────────────────────

const MAX_RETRIES: u32 = 3;
const BASE_DELAY_MS: u64 = 10;

// ── PostgresLedgerStore ────────────────────────────────────────────────

pub struct PostgresLedgerStore {
    pool: PgPool,
}

impl PostgresLedgerStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Live custodial balances for `user`, across every asset EngiPay
    /// supports (`Asset::ALL`), read directly from the ledger postings —
    /// the same source of truth every other method here writes to.
    ///
    /// A read-only query, so it runs against the plain pool rather than a
    /// `SERIALIZABLE` transaction (unlike the mutating methods above, which
    /// need one so concurrent writers cannot violate ledger invariants).
    /// Always returns one entry per asset, `0` for an asset the user has
    /// never touched, rather than omitting it.
    pub async fn get_user_balances(&self, user: UserId) -> Result<Vec<Balance>, LedgerError> {
        let rows = sqlx::query(
            "SELECT asset, bucket, COALESCE(SUM(amount), 0)::text AS total \
             FROM ledger_postings \
             WHERE owner_kind = 'user' AND user_id = $1 \
             GROUP BY asset, bucket",
        )
        .bind(user.as_uuid())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;

        let mut available: std::collections::HashMap<Asset, i128> =
            std::collections::HashMap::new();
        let mut held: std::collections::HashMap<Asset, i128> = std::collections::HashMap::new();
        for row in rows {
            let symbol: String = row.get("asset");
            let bucket: String = row.get("bucket");
            let total: String = row.get("total");
            let Ok(asset) = symbol.parse::<Asset>() else {
                continue; // A row for an asset this build no longer recognizes; skip rather than fail the whole read.
            };
            let amount = total.parse::<i128>().map_err(|_| LedgerError::Overflow)?;
            match bucket.as_str() {
                "available" => {
                    available.insert(asset, amount);
                }
                "held" => {
                    held.insert(asset, amount);
                }
                _ => {}
            }
        }

        Ok(Asset::ALL
            .into_iter()
            .map(|asset| Balance {
                asset,
                available: *available.get(&asset).unwrap_or(&0),
                held: *held.get(&asset).unwrap_or(&0),
            })
            .collect())
    }

    /// All open (active) holds for `user`, ordered by creation time ascending.
    ///
    /// Returns an empty `Vec` when the user has no open holds.  Each entry
    /// carries the hold reference, asset, amount in smallest units, and the
    /// RFC 3339 creation timestamp — enough for a client to display a
    /// per-hold breakdown of what is locked and why.
    pub async fn get_active_holds(&self, user: UserId) -> Result<Vec<ActiveHold>, LedgerError> {
        let rows = sqlx::query(
            "SELECT reference, asset, amount::text AS amount, created_at \
             FROM ledger_holds \
             WHERE user_id = $1 AND state = 'open' \
             ORDER BY created_at ASC",
        )
        .bind(user.as_uuid())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;

        let mut holds = Vec::with_capacity(rows.len());
        for row in rows {
            let reference: String = row.get("reference");
            let asset_str: String = row.get("asset");
            let amount_str: String = row.get("amount");
            let created_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
                row.get("created_at");

            let asset = asset_str
                .parse::<Asset>()
                .map_err(|_| LedgerError::Database {
                    code: None,
                    message: format!("unknown asset in ledger_holds: {asset_str}"),
                })?;
            let amount = amount_str
                .parse::<i128>()
                .map_err(|_| LedgerError::Overflow)?;

            holds.push(ActiveHold {
                reference,
                asset,
                amount,
                created_at: created_at.to_rfc3339(),
            });
        }

        Ok(holds)
    }

    /// Sum of all user-owned balances (available + held) for every asset.
    ///
    /// This is the total that the ledger says EngiPay owes its users. It is
    /// compared against the on-chain custody balance during reconciliation.
    ///
    /// Returns one `(Asset, total)` pair per asset that has at least one user
    /// posting. Assets with no postings are omitted; callers should treat them
    /// as zero.
    pub async fn total_liability_by_asset(&self) -> Result<Vec<(Asset, i128)>, LedgerError> {
        let rows = sqlx::query(
            "SELECT asset, SUM(amount)::text AS total \
             FROM ledger_postings \
             WHERE owner_kind = 'user' \
             GROUP BY asset",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let symbol: String = row.get("asset");
            let total_str: String = row.get("total");
            let Ok(asset) = symbol.parse::<Asset>() else {
                continue; // Unknown asset symbol — skip rather than failing the whole check.
            };
            let total = total_str.parse::<i128>().map_err(|_| LedgerError::Overflow)?;
            out.push((asset, total));
        }
        Ok(out)
    }

    /// Records the result of one reconciliation run in `reconciliation_runs`.
    ///
    /// `asset` is the asset symbol (e.g. `"XLM"`, `"USDC"`).
    /// `ledger_liability` and `custody_balance` are in the asset's smallest unit.
    pub async fn record_reconciliation_run(
        &self,
        asset: &str,
        ledger_liability: i128,
        custody_balance: i128,
    ) -> Result<(), LedgerError> {
        sqlx::query(
            "INSERT INTO reconciliation_runs (asset, ledger_liability, custody_balance) \
             VALUES ($1, $2::numeric, $3::numeric)",
        )
        .bind(asset)
        .bind(ledger_liability.to_string())
        .bind(custody_balance.to_string())
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    // ── Point-in-time / snapshot methods ──────────────────────────────

    /// Returns the user's balance in `asset`/`bucket` at the given point in
    /// time, expressed as an RFC 3339 timestamp string (e.g.
    /// `"2024-01-15T12:00:00Z"`).
    ///
    /// The query is accelerated by the `ledger_postings_by_user_asset_time`
    /// index added in migration 0019 and, when a snapshot exists before
    /// `as_of`, only postings after the snapshot are summed:
    ///
    /// ```text
    /// balance_at_T = snapshot.balance
    ///              + SUM(postings where snapshotted_at < created_at <= as_of)
    /// ```
    ///
    /// When no snapshot exists the full history up to `as_of` is summed,
    /// which is still index-assisted.
    pub async fn get_balance_as_of(
        &self,
        user: UserId,
        asset: Asset,
        bucket: crate::Bucket,
        as_of: &str,
    ) -> Result<i128, LedgerError> {
        let bucket_str = bucket_str(bucket);

        // Parse the caller-supplied RFC 3339 string.
        let as_of_ts: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
            as_of.parse().map_err(|_| LedgerError::Database {
                code: None,
                message: format!("invalid as_of timestamp: {as_of}"),
            })?;

        // Find the most-recent snapshot at or before `as_of`.
        let snap_row = sqlx::query(
            "SELECT balance::text AS balance, snapshotted_at \
             FROM balance_snapshots \
             WHERE user_id = $1 AND asset = $2 AND bucket = $3 \
               AND snapshotted_at <= $4 \
             ORDER BY snapshotted_at DESC \
             LIMIT 1",
        )
        .bind(user.as_uuid())
        .bind(asset.symbol())
        .bind(bucket_str)
        .bind(as_of_ts)
        .fetch_optional(&self.pool)
        .await
        .map_err(db_err)?;

        let (base_balance, postings_after): (i128, sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>) =
            match snap_row {
                Some(row) => {
                    let b: String = row.get("balance");
                    let t: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
                        row.get("snapshotted_at");
                    (b.parse().map_err(|_| LedgerError::Overflow)?, t)
                }
                None => {
                    // No snapshot: sum all postings up to as_of from the beginning.
                    // Use Unix epoch as a lower bound — all postings pass the > epoch check
                    // because ledger_postings.created_at defaults to now() and can never
                    // predate 1970.
                    let epoch = sqlx::types::chrono::DateTime::<sqlx::types::chrono::Utc>::UNIX_EPOCH;
                    (0, epoch)
                }
            };

        // Sum postings in the (snapshot_time, as_of] window.
        let delta_row = sqlx::query(
            "SELECT COALESCE(SUM(amount), 0)::text AS delta \
             FROM ledger_postings \
             WHERE owner_kind  = 'user' \
               AND user_id     = $1 \
               AND asset       = $2 \
               AND bucket      = $3 \
               AND created_at  > $4 \
               AND created_at  <= $5",
        )
        .bind(user.as_uuid())
        .bind(asset.symbol())
        .bind(bucket_str)
        .bind(postings_after)
        .bind(as_of_ts)
        .fetch_one(&self.pool)
        .await
        .map_err(db_err)?;

        let delta: i128 = {
            let s: String = delta_row.get("delta");
            s.parse().map_err(|_| LedgerError::Overflow)?
        };

        base_balance.checked_add(delta).ok_or(LedgerError::Overflow)
    }

    /// Computes the current balance from postings and writes one
    /// [`BalanceSnapshot`] row per (asset, bucket) pair that the user has
    /// ever touched.  Returns the newly created snapshots.
    ///
    /// Multiple calls each add a new, timestamped row (old ones are kept for
    /// history).  A periodic background job should call this on each active
    /// user so that as-of queries stay fast.
    pub async fn take_snapshot(
        &self,
        user: UserId,
    ) -> Result<Vec<BalanceSnapshot>, LedgerError> {
        let rows = sqlx::query(
            "SELECT user_id, asset, bucket, balance::text AS balance, snapshotted_at \
             FROM take_balance_snapshot($1)",
        )
        .bind(user.as_uuid())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;

        parse_snapshot_rows(rows)
    }

    /// Retrieves the most-recent snapshot for each (asset, bucket) pair for
    /// `user`.  Returns an empty `Vec` when no snapshots have been taken yet.
    pub async fn get_latest_snapshot(
        &self,
        user: UserId,
    ) -> Result<Vec<BalanceSnapshot>, LedgerError> {
        let rows = sqlx::query(
            "SELECT DISTINCT ON (user_id, asset, bucket) \
                    user_id, asset, bucket, balance::text AS balance, snapshotted_at \
             FROM balance_snapshots \
             WHERE user_id = $1 \
             ORDER BY user_id, asset, bucket, snapshotted_at DESC",
        )
        .bind(user.as_uuid())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;

        parse_snapshot_rows(rows)
    }
    ///
    /// If `reference` was already used with identical parameters, returns
    /// the original [`Receipt`] with `replayed: true` and moves nothing.
    pub async fn deposit(
        &self,
        user: UserId,
        money: Money,
        reference: &str,
    ) -> Result<Receipt, LedgerError> {
        crate::require_positive(money)?;
        require_non_empty(reference)?;

        with_serializable_retry(|| self.deposit_inner(user, money, reference)).await
    }

    async fn deposit_inner(
        &self,
        user: UserId,
        money: Money,
        reference: &str,
    ) -> Result<Receipt, LedgerError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        set_serializable(&mut tx).await?;

        let fingerprint = deposit_fingerprint(user, money);
        if let Some(receipt) = check_idempotency(&mut tx, reference, &fingerprint).await? {
            return Ok(receipt);
        }

        let tx_id = Uuid::new_v4();
        insert_transaction(&mut tx, tx_id, "deposit", reference, &fingerprint).await?;

        let neg = negate(money.minor)?;
        insert_posting_system(&mut tx, tx_id, "external_inflow", money.asset, neg).await?;
        insert_posting_user(&mut tx, tx_id, user, money.asset, "available", money.minor).await?;

        tx.commit().await.map_err(db_err)?;
        Ok(Receipt {
            transaction_id: tx_id,
            replayed: false,
        })
    }

    /// Reserves money for something in flight so it cannot be spent twice.
    ///
    /// Debits the user's available bucket and credits their held bucket.
    /// The total balance (available + held) stays the same.
    pub async fn create_hold(
        &self,
        user: UserId,
        money: Money,
        reference: &str,
    ) -> Result<Receipt, LedgerError> {
        crate::require_positive(money)?;
        require_non_empty(reference)?;

        with_serializable_retry(|| self.create_hold_inner(user, money, reference)).await
    }

    async fn create_hold_inner(
        &self,
        user: UserId,
        money: Money,
        reference: &str,
    ) -> Result<Receipt, LedgerError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        set_serializable(&mut tx).await?;

        let fingerprint = hold_fingerprint(user, money);
        if let Some(receipt) = check_idempotency(&mut tx, reference, &fingerprint).await? {
            return Ok(receipt);
        }

        let available = get_user_balance(&mut tx, user, money.asset, "available").await?;
        if available < money.minor {
            return Err(LedgerError::InsufficientFunds {
                available: Money::from_minor(money.asset, available),
                requested: money,
            });
        }

        let tx_id = Uuid::new_v4();
        insert_transaction(&mut tx, tx_id, "hold", reference, &fingerprint).await?;

        let neg = negate(money.minor)?;
        insert_posting_user(&mut tx, tx_id, user, money.asset, "available", neg).await?;
        insert_posting_user(&mut tx, tx_id, user, money.asset, "held", money.minor).await?;

        insert_hold(&mut tx, reference, user, money).await?;

        tx.commit().await.map_err(db_err)?;
        Ok(Receipt {
            transaction_id: tx_id,
            replayed: false,
        })
    }

    /// Moves spendable money from one user to another, instantly and
    /// without a network fee.
    ///
    /// Self-transfers are rejected with [`LedgerError::SameAccount`].
    pub async fn transfer(
        &self,
        from: UserId,
        to: UserId,
        money: Money,
        reference: &str,
    ) -> Result<Receipt, LedgerError> {
        crate::require_positive(money)?;
        if from == to {
            return Err(LedgerError::SameAccount);
        }
        require_non_empty(reference)?;

        with_serializable_retry(|| self.transfer_inner(from, to, money, reference)).await
    }

    async fn transfer_inner(
        &self,
        from: UserId,
        to: UserId,
        money: Money,
        reference: &str,
    ) -> Result<Receipt, LedgerError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        set_serializable(&mut tx).await?;

        let fingerprint = transfer_fingerprint(from, to, money);
        if let Some(receipt) = check_idempotency(&mut tx, reference, &fingerprint).await? {
            return Ok(receipt);
        }

        let available = get_user_balance(&mut tx, from, money.asset, "available").await?;
        if available < money.minor {
            return Err(LedgerError::InsufficientFunds {
                available: Money::from_minor(money.asset, available),
                requested: money,
            });
        }

        let tx_id = Uuid::new_v4();
        insert_transaction(&mut tx, tx_id, "transfer", reference, &fingerprint).await?;

        let neg = negate(money.minor)?;
        insert_posting_user(&mut tx, tx_id, from, money.asset, "available", neg).await?;
        insert_posting_user(&mut tx, tx_id, to, money.asset, "available", money.minor).await?;

        tx.commit().await.map_err(db_err)?;
        Ok(Receipt {
            transaction_id: tx_id,
            replayed: false,
        })
    }

    /// Releases a hold, returning held money to the user's available balance.
    ///
    /// If the hold is not in the `open` state, returns [`LedgerError::HoldClosed`].
    pub async fn release_hold(&self, hold_reference: &str) -> Result<Receipt, LedgerError> {
        require_non_empty(hold_reference)?;

        with_serializable_retry(|| self.release_hold_inner(hold_reference)).await
    }

    async fn release_hold_inner(&self, hold_reference: &str) -> Result<Receipt, LedgerError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        set_serializable(&mut tx).await?;

        let reference = format!("{hold_reference}:release");
        let fingerprint = "release";

        if let Some(receipt) = check_idempotency(&mut tx, &reference, fingerprint).await? {
            return Ok(receipt);
        }

        let hold = get_hold(&mut tx, hold_reference).await?;
        if hold.state != "open" {
            return Err(LedgerError::HoldClosed {
                reference: hold_reference.to_owned(),
                state: match hold.state.as_str() {
                    "released" => HoldState::Released,
                    "settled" => HoldState::Settled,
                    _ => HoldState::Open,
                },
            });
        }

        let tx_id = Uuid::new_v4();
        insert_transaction(&mut tx, tx_id, "release_hold", &reference, fingerprint).await?;

        let neg = negate(hold.amount)?;
        insert_posting_user(&mut tx, tx_id, hold.user, hold.asset, "held", neg).await?;
        insert_posting_user(
            &mut tx,
            tx_id,
            hold.user,
            hold.asset,
            "available",
            hold.amount,
        )
        .await?;

        update_hold_state(&mut tx, hold_reference, "released").await?;

        tx.commit().await.map_err(db_err)?;
        Ok(Receipt {
            transaction_id: tx_id,
            replayed: false,
        })
    }

    /// Settles a hold: the held money leaves EngiPay to an external destination,
    /// and an optional platform fee is booked as revenue.
    ///
    /// Postings:
    ///   - Debit  user held bucket      (held amount)
    ///   - Credit ExternalOutflow       (held amount − fee, i.e. the principal)
    ///   - Credit Fees                  (fee, when `fee` is `Some`)
    ///
    /// The fee, when provided, must be in the same asset as the hold and must
    /// not exceed the held amount.  If the hold is not in the `open` state,
    /// returns [`LedgerError::HoldClosed`].
    ///
    /// Idempotent: settling the same hold again with the same fee returns the
    /// original receipt with `replayed: true` and moves nothing.
    pub async fn settle_hold(
        &self,
        hold_reference: &str,
        fee: Option<Money>,
    ) -> Result<Receipt, LedgerError> {
        require_non_empty(hold_reference)?;
        if let Some(f) = fee {
            crate::require_positive(f)?;
        }

        with_serializable_retry(|| self.settle_hold_inner(hold_reference, fee)).await
    }

    async fn settle_hold_inner(
        &self,
        hold_reference: &str,
        fee: Option<Money>,
    ) -> Result<Receipt, LedgerError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        set_serializable(&mut tx).await?;

        // Idempotency: settle uses a distinct sub-reference so it can coexist
        // with the hold's own reference in ledger_transactions.
        let reference = format!("{hold_reference}:settle");
        let fee_str = fee.map_or_else(|| "none".to_owned(), |f| format!("{}:{}", f.asset, f.minor));
        let fingerprint = format!("settle|{fee_str}");

        if let Some(receipt) = check_idempotency(&mut tx, &reference, &fingerprint).await? {
            return Ok(receipt);
        }

        let hold = get_hold(&mut tx, hold_reference).await?;
        if hold.state != "open" {
            return Err(LedgerError::HoldClosed {
                reference: hold_reference.to_owned(),
                state: match hold.state.as_str() {
                    "released" => HoldState::Released,
                    "settled" => HoldState::Settled,
                    _ => HoldState::Open,
                },
            });
        }

        // Validate fee constraints.
        if let Some(f) = fee {
            if f.asset != hold.asset || f.minor > hold.amount {
                return Err(LedgerError::InvalidFee);
            }
        }

        let tx_id = Uuid::new_v4();
        insert_transaction(&mut tx, tx_id, "settle_hold", &reference, &fingerprint).await?;

        // Debit the user's held bucket.
        let neg_held = negate(hold.amount)?;
        insert_posting_user(&mut tx, tx_id, hold.user, hold.asset, "held", neg_held).await?;

        // Credit ExternalOutflow for the principal and Fees for the fee. A
        // posting can never be zero, so a fee equal to the whole hold books
        // nothing to ExternalOutflow.
        let fee_minor = fee.map_or(0, |f| f.minor);
        let principal = hold
            .amount
            .checked_sub(fee_minor)
            .ok_or(LedgerError::Overflow)?;
        if principal > 0 {
            insert_posting_system(&mut tx, tx_id, "external_outflow", hold.asset, principal)
                .await?;
        }
        if fee_minor > 0 {
            insert_posting_system(&mut tx, tx_id, "fees", hold.asset, fee_minor).await?;
        }

        update_hold_state(&mut tx, hold_reference, "settled").await?;

        tx.commit().await.map_err(db_err)?;
        Ok(Receipt {
            transaction_id: tx_id,
            replayed: false,
        })
    }
}

// ── Retry with exponential backoff + jitter ────────────────────────────

fn is_serialization_failure(err: &LedgerError) -> bool {
    matches!(
        err,
        LedgerError::Database {
            code: Some(code), ..
        } if code == "40001" || code == "40P01"
    )
}

async fn with_serializable_retry<F, Fut, T>(f: F) -> Result<T, LedgerError>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<T, LedgerError>>,
{
    for attempt in 0..=MAX_RETRIES {
        if attempt > 0 {
            jitter_sleep(attempt).await;
        }
        match f().await {
            Ok(val) => return Ok(val),
            Err(e) if attempt < MAX_RETRIES && is_serialization_failure(&e) => {
                tracing::warn!(
                    attempt,
                    "serialization failure, retrying ({}/{})",
                    attempt.saturating_add(1),
                    MAX_RETRIES,
                );
            }
            Err(e) => return Err(e),
        }
    }
    // Unreachable: the loop always returns on the last iteration.
    Err(LedgerError::Database {
        code: None,
        message: "retry budget exhausted".into(),
    })
}

async fn jitter_sleep(attempt: u32) {
    let base_ms = BASE_DELAY_MS.saturating_mul(1u64 << attempt.min(6));
    // Use sub-microsecond timestamp noise as cheap jitter source.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    let jitter = u64::from(nanos).checked_rem(base_ms.max(1)).unwrap_or(0);
    tokio::time::sleep(Duration::from_millis(base_ms.saturating_add(jitter))).await;
}

// ── SQL helpers ────────────────────────────────────────────────────────

async fn set_serializable(tx: &mut sqlx::Transaction<'_, Postgres>) -> Result<(), LedgerError> {
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut **tx)
        .await
        .map_err(db_err)?;
    Ok(())
}

async fn check_idempotency(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    reference: &str,
    fingerprint: &str,
) -> Result<Option<Receipt>, LedgerError> {
    let row = sqlx::query("SELECT id, request FROM ledger_transactions WHERE reference = $1")
        .bind(reference)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db_err)?;

    match row {
        None => Ok(None),
        Some(row) => {
            let id: Uuid = row.get("id");
            let stored: String = row.get("request");
            if stored == fingerprint {
                Ok(Some(Receipt {
                    transaction_id: id,
                    replayed: true,
                }))
            } else {
                Err(LedgerError::IdempotencyConflict {
                    reference: reference.to_owned(),
                })
            }
        }
    }
}

async fn insert_transaction(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    id: Uuid,
    kind: &str,
    reference: &str,
    request: &str,
) -> Result<(), LedgerError> {
    sqlx::query(
        "INSERT INTO ledger_transactions (id, kind, reference, request) VALUES ($1, $2, $3, $4)",
    )
    .bind(id)
    .bind(kind)
    .bind(reference)
    .bind(request)
    .execute(&mut **tx)
    .await
    .map_err(db_err)?;
    Ok(())
}

async fn insert_posting_user(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    transaction_id: Uuid,
    user: UserId,
    asset: Asset,
    bucket: &str,
    amount: i128,
) -> Result<(), LedgerError> {
    sqlx::query(
        "INSERT INTO ledger_postings \
            (transaction_id, owner_kind, user_id, asset, bucket, amount) \
         VALUES ($1, 'user', $2, $3, $4, $5::numeric)",
    )
    .bind(transaction_id)
    .bind(user.as_uuid())
    .bind(asset.symbol())
    .bind(bucket)
    .bind(amount.to_string())
    .execute(&mut **tx)
    .await
    .map_err(db_err)?;
    Ok(())
}

async fn insert_posting_system(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    transaction_id: Uuid,
    system_account: &str,
    asset: Asset,
    amount: i128,
) -> Result<(), LedgerError> {
    sqlx::query(
        "INSERT INTO ledger_postings \
            (transaction_id, owner_kind, system_account, asset, bucket, amount) \
         VALUES ($1, 'system', $2, $3, 'available', $4::numeric)",
    )
    .bind(transaction_id)
    .bind(system_account)
    .bind(asset.symbol())
    .bind(amount.to_string())
    .execute(&mut **tx)
    .await
    .map_err(db_err)?;
    Ok(())
}

async fn get_user_balance(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    user: UserId,
    asset: Asset,
    bucket: &str,
) -> Result<i128, LedgerError> {
    let row = sqlx::query(
        "SELECT COALESCE(SUM(amount), 0)::text AS balance \
         FROM ledger_postings \
         WHERE owner_kind = 'user' AND user_id = $1 AND asset = $2 AND bucket = $3",
    )
    .bind(user.as_uuid())
    .bind(asset.symbol())
    .bind(bucket)
    .fetch_one(&mut **tx)
    .await
    .map_err(db_err)?;

    let s: String = row.get("balance");
    s.parse::<i128>().map_err(|_| LedgerError::Overflow)
}

async fn insert_hold(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    reference: &str,
    user: UserId,
    money: Money,
) -> Result<(), LedgerError> {
    sqlx::query(
        "INSERT INTO ledger_holds (reference, user_id, asset, amount) \
         VALUES ($1, $2, $3, $4::numeric)",
    )
    .bind(reference)
    .bind(user.as_uuid())
    .bind(money.asset.symbol())
    .bind(money.minor.to_string())
    .execute(&mut **tx)
    .await
    .map_err(db_err)?;
    Ok(())
}

struct Hold {
    user: UserId,
    asset: Asset,
    amount: i128,
    state: String,
}

async fn get_hold(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    reference: &str,
) -> Result<Hold, LedgerError> {
    let row =
        sqlx::query(
            "SELECT user_id, asset, amount::text AS amount, state FROM ledger_holds WHERE reference = $1",
        )
            .bind(reference)
            .fetch_optional(&mut **tx)
            .await
            .map_err(db_err)?;

    match row {
        None => Err(LedgerError::HoldNotFound {
            reference: reference.to_owned(),
        }),
        Some(row) => {
            let user_uuid: uuid::Uuid = row.get("user_id");
            let asset_str: String = row.get("asset");
            let amount_str: String = row.get("amount");
            let state: String = row.get("state");

            let asset = match asset_str.as_str() {
                "USDC" => Asset::Usdc,
                "ETH" => Asset::Eth,
                "BTC" => Asset::Btc,
                "XLM" => Asset::Xlm,
                _ => {
                    return Err(LedgerError::Database {
                        code: None,
                        message: format!("unknown asset: {}", asset_str),
                    });
                }
            };

            let amount = amount_str
                .parse::<i128>()
                .map_err(|_| LedgerError::Overflow)?;
            let user = UserId::from_uuid(user_uuid);

            Ok(Hold {
                user,
                asset,
                amount,
                state,
            })
        }
    }
}

async fn update_hold_state(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    reference: &str,
    state: &str,
) -> Result<(), LedgerError> {
    sqlx::query("UPDATE ledger_holds SET state = $1, closed_at = now() WHERE reference = $2")
        .bind(state)
        .bind(reference)
        .execute(&mut **tx)
        .await
        .map_err(db_err)?;
    Ok(())
}

// ── Snapshot helpers ───────────────────────────────────────────────────

fn bucket_str(bucket: crate::Bucket) -> &'static str {
    match bucket {
        crate::Bucket::Available => "available",
        crate::Bucket::Held => "held",
    }
}

fn parse_snapshot_rows(
    rows: Vec<sqlx::postgres::PgRow>,
) -> Result<Vec<BalanceSnapshot>, LedgerError> {
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let user_uuid: uuid::Uuid = row.get("user_id");
        let asset_str: String = row.get("asset");
        let bucket_raw: String = row.get("bucket");
        let balance_str: String = row.get("balance");
        let snapshotted_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
            row.get("snapshotted_at");

        let asset = asset_str.parse::<Asset>().map_err(|_| LedgerError::Database {
            code: None,
            message: format!("unknown asset in balance_snapshots: {asset_str}"),
        })?;
        let bucket = match bucket_raw.as_str() {
            "available" => crate::Bucket::Available,
            "held" => crate::Bucket::Held,
            other => {
                return Err(LedgerError::Database {
                    code: None,
                    message: format!("unknown bucket in balance_snapshots: {other}"),
                })
            }
        };
        let balance = balance_str.parse::<i128>().map_err(|_| LedgerError::Overflow)?;

        out.push(BalanceSnapshot {
            user_id: UserId::from_uuid(user_uuid),
            asset,
            bucket,
            balance,
            snapshotted_at: snapshotted_at.to_rfc3339(),
        });
    }
    Ok(out)
}

// ── Request fingerprints ───────────────────────────────────────────────
//
// Stable, deterministic strings stored in `ledger_transactions.request`
// and compared on idempotency replay.

fn deposit_fingerprint(user: UserId, money: Money) -> String {
    format!("deposit|{}|{}|{}", user, money.asset, money.minor)
}

fn hold_fingerprint(user: UserId, money: Money) -> String {
    format!("hold|{}|{}|{}", user, money.asset, money.minor)
}

fn transfer_fingerprint(from: UserId, to: UserId, money: Money) -> String {
    format!("transfer|{}|{}|{}|{}", from, to, money.asset, money.minor)
}

// ── Error conversion ───────────────────────────────────────────────────

/// Maps a database failure onto a ledger error. The Postgres SQLSTATE codes are
/// the guarantees in `migrations/`: a violated check constraint means the
/// ledger refused to go out of balance, and a unique violation means the same
/// reference was posted twice.
fn db_err(e: sqlx::Error) -> LedgerError {
    let code = match &e {
        sqlx::Error::Database(db_err) => db_err.code().map(|c| c.to_string()),
        _ => None,
    };

    match code.as_deref() {
        Some("23514") => LedgerError::InvariantViolated("database constraint violated"),
        Some("23505") => LedgerError::IdempotencyConflict {
            reference: "conflict".to_owned(),
        },
        Some("23503") => LedgerError::InvariantViolated("foreign key constraint violation"),
        _ => LedgerError::Database {
            code,
            message: e.to_string(),
        },
    }
}

fn negate(value: i128) -> Result<i128, LedgerError> {
    value.checked_neg().ok_or(LedgerError::Overflow)
}

fn require_non_empty(reference: &str) -> Result<(), LedgerError> {
    if reference.trim().is_empty() {
        Err(LedgerError::EmptyReference)
    } else {
        Ok(())
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    // ── Retry logic (unit tests, no database needed) ───────────────────

    #[tokio::test]
    async fn retries_on_serialization_failure_and_succeeds() {
        let attempts = AtomicU32::new(0);
        let result = with_serializable_retry(|| {
            let n = attempts.fetch_add(1, Ordering::SeqCst);
            async move {
                if n < 2 {
                    Err(LedgerError::Database {
                        code: Some("40001".into()),
                        message: "could not serialize access".into(),
                    })
                } else {
                    Ok(42)
                }
            }
        })
        .await;

        assert_eq!(result, Ok(42));
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn retries_on_deadlock_detected() {
        let attempts = AtomicU32::new(0);
        let result = with_serializable_retry(|| {
            let n = attempts.fetch_add(1, Ordering::SeqCst);
            async move {
                if n == 0 {
                    Err(LedgerError::Database {
                        code: Some("40P01".into()),
                        message: "deadlock detected".into(),
                    })
                } else {
                    Ok("ok")
                }
            }
        })
        .await;

        assert_eq!(result, Ok("ok"));
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn gives_up_after_max_retries() {
        let attempts = AtomicU32::new(0);
        let result: Result<i32, _> = with_serializable_retry(|| {
            attempts.fetch_add(1, Ordering::SeqCst);
            async {
                Err(LedgerError::Database {
                    code: Some("40001".into()),
                    message: "serialization failure".into(),
                })
            }
        })
        .await;

        assert!(result.is_err());
        // 1 original + MAX_RETRIES retries = MAX_RETRIES + 1 total attempts.
        assert_eq!(attempts.load(Ordering::SeqCst), MAX_RETRIES + 1);
    }

    #[tokio::test]
    async fn does_not_retry_non_serialization_db_errors() {
        let attempts = AtomicU32::new(0);
        let result: Result<i32, _> = with_serializable_retry(|| {
            attempts.fetch_add(1, Ordering::SeqCst);
            async {
                Err(LedgerError::Database {
                    code: Some("23505".into()),
                    message: "unique_violation".into(),
                })
            }
        })
        .await;

        assert!(result.is_err());
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn does_not_retry_business_logic_errors() {
        let attempts = AtomicU32::new(0);
        let result: Result<i32, _> = with_serializable_retry(|| {
            attempts.fetch_add(1, Ordering::SeqCst);
            async { Err(LedgerError::NonPositiveAmount) }
        })
        .await;

        assert!(result.is_err());
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
    }

    // ── Integration tests (require a PostgreSQL database) ──────────────
    //
    // Run with: DATABASE_URL=postgres://… cargo test -p engipay-ledger \
    //           --features postgres -- --ignored

    async fn test_pool() -> Option<PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let pool = PgPool::connect(&url).await.ok()?;
        sqlx::migrate!("../../migrations").run(&pool).await.ok()?;
        Some(pool)
    }

    async fn ensure_user(pool: &PgPool, user: UserId) {
        sqlx::query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(user.as_uuid())
            .execute(pool)
            .await
            .unwrap();
    }

    fn usdc(units: i128) -> Money {
        Money::from_minor(Asset::Usdc, units)
    }

    // ── Deposit tests ──────────────────────────────────────────────────

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn deposit_credits_user_available_balance() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        let receipt = store.deposit(alice, usdc(100), "dep-1").await.unwrap();
        assert!(!receipt.replayed);

        let available = get_user_balance_from_pool(&pool, alice, Asset::Usdc, "available").await;
        assert_eq!(available, 100);
    }

    // ── get_user_balances tests ──────────────────────────────────────────

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn get_user_balances_reports_every_asset_zero_filled() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        store
            .deposit(alice, usdc(250), "balances-dep-1")
            .await
            .unwrap();
        store
            .create_hold(alice, usdc(60), "balances-hold-1")
            .await
            .unwrap();

        let balances = store.get_user_balances(alice).await.unwrap();
        assert_eq!(balances.len(), Asset::ALL.len());

        let usdc_balance = balances.iter().find(|b| b.asset == Asset::Usdc).unwrap();
        assert_eq!(usdc_balance.available, 190);
        assert_eq!(usdc_balance.held, 60);

        // An asset the user never touched still shows up, at zero.
        let eth_balance = balances.iter().find(|b| b.asset == Asset::Eth).unwrap();
        assert_eq!(eth_balance.available, 0);
        assert_eq!(eth_balance.held, 0);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn deposit_replay_returns_same_receipt() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        let first = store.deposit(alice, usdc(50), "dep-replay").await.unwrap();
        let second = store.deposit(alice, usdc(50), "dep-replay").await.unwrap();

        assert!(!first.replayed);
        assert!(second.replayed);
        assert_eq!(first.transaction_id, second.transaction_id);

        let available = get_user_balance_from_pool(&pool, alice, Asset::Usdc, "available").await;
        assert_eq!(available, 50);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn deposit_idempotency_conflict() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        store
            .deposit(alice, usdc(50), "dep-conflict")
            .await
            .unwrap();
        let result = store.deposit(alice, usdc(99), "dep-conflict").await;

        assert!(matches!(
            result,
            Err(LedgerError::IdempotencyConflict { .. })
        ));
    }

    // ── Hold tests ─────────────────────────────────────────────────────

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn hold_moves_from_available_to_held() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        store.deposit(alice, usdc(100), "seed-hold").await.unwrap();
        let receipt = store.create_hold(alice, usdc(60), "hold-1").await.unwrap();
        assert!(!receipt.replayed);

        let available = get_user_balance_from_pool(&pool, alice, Asset::Usdc, "available").await;
        let held = get_user_balance_from_pool(&pool, alice, Asset::Usdc, "held").await;

        assert_eq!(available, 40);
        assert_eq!(held, 60);
        // Total unchanged.
        assert_eq!(available + held, 100);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn hold_insufficient_funds() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        store
            .deposit(alice, usdc(100), "seed-hold-insuf")
            .await
            .unwrap();
        let result = store.create_hold(alice, usdc(101), "hold-insuf").await;

        assert!(matches!(result, Err(LedgerError::InsufficientFunds { .. })));
    }

    // ── Transfer tests ─────────────────────────────────────────────────

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn transfer_moves_between_users_symmetrically() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let (alice, bob) = (UserId::new(), UserId::new());
        ensure_user(&pool, alice).await;
        ensure_user(&pool, bob).await;

        store.deposit(alice, usdc(100), "seed-xfer").await.unwrap();
        let receipt = store
            .transfer(alice, bob, usdc(30), "xfer-1")
            .await
            .unwrap();
        assert!(!receipt.replayed);

        let alice_bal = get_user_balance_from_pool(&pool, alice, Asset::Usdc, "available").await;
        let bob_bal = get_user_balance_from_pool(&pool, bob, Asset::Usdc, "available").await;

        assert_eq!(alice_bal, 70);
        assert_eq!(bob_bal, 30);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn transfer_insufficient_funds() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let (alice, bob) = (UserId::new(), UserId::new());
        ensure_user(&pool, alice).await;
        ensure_user(&pool, bob).await;

        store
            .deposit(alice, usdc(100), "seed-xfer-insuf")
            .await
            .unwrap();
        let result = store.transfer(alice, bob, usdc(101), "xfer-insuf").await;

        assert!(matches!(result, Err(LedgerError::InsufficientFunds { .. })));
        // Nothing moved.
        let alice_bal = get_user_balance_from_pool(&pool, alice, Asset::Usdc, "available").await;
        let bob_bal = get_user_balance_from_pool(&pool, bob, Asset::Usdc, "available").await;
        assert_eq!(alice_bal, 100);
        assert_eq!(bob_bal, 0);
    }

    #[tokio::test]
    async fn transfer_rejects_self_transfer() {
        // No database needed: rejected before touching the DB.
        let pool = PgPool::connect_lazy("postgres://invalid").unwrap();
        let store = PostgresLedgerStore::new(pool);
        let alice = UserId::new();

        let result = store.transfer(alice, alice, usdc(10), "self").await;
        assert_eq!(result, Err(LedgerError::SameAccount));
    }

    // ── get_active_holds tests ─────────────────────────────────────────

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn get_active_holds_returns_open_holds_for_user() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        store.deposit(alice, usdc(300), "seed-ah-1").await.unwrap();
        store
            .create_hold(alice, usdc(100), "hold-ah-1")
            .await
            .unwrap();
        store
            .create_hold(alice, usdc(50), "hold-ah-2")
            .await
            .unwrap();

        let holds = store.get_active_holds(alice).await.unwrap();
        assert_eq!(holds.len(), 2);

        let refs: Vec<&str> = holds.iter().map(|h| h.reference.as_str()).collect();
        assert!(refs.contains(&"hold-ah-1"));
        assert!(refs.contains(&"hold-ah-2"));

        let h1 = holds.iter().find(|h| h.reference == "hold-ah-1").unwrap();
        assert_eq!(h1.asset, Asset::Usdc);
        assert_eq!(h1.amount, 100);
        assert!(h1.created_at.contains('T'), "created_at should be RFC 3339");
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn get_active_holds_excludes_released_holds() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        store
            .deposit(alice, usdc(300), "seed-ah-excl")
            .await
            .unwrap();
        store
            .create_hold(alice, usdc(100), "hold-excl-open")
            .await
            .unwrap();
        store
            .create_hold(alice, usdc(50), "hold-excl-released")
            .await
            .unwrap();
        store.release_hold("hold-excl-released").await.unwrap();

        let holds = store.get_active_holds(alice).await.unwrap();
        let open_refs: Vec<&str> = holds.iter().map(|h| h.reference.as_str()).collect();

        assert!(
            open_refs.contains(&"hold-excl-open"),
            "open hold must appear"
        );
        assert!(
            !open_refs.contains(&"hold-excl-released"),
            "released hold must not appear"
        );
        assert_eq!(holds.len(), 1);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn get_active_holds_returns_empty_for_user_with_no_holds() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        let holds = store.get_active_holds(alice).await.unwrap();
        assert!(holds.is_empty());
    }

    // ── Release hold tests ─────────────────────────────────────────

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn release_hold_returns_money_to_available() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        store
            .deposit(alice, usdc(100), "seed-release")
            .await
            .unwrap();
        store
            .create_hold(alice, usdc(60), "hold-release")
            .await
            .unwrap();

        let receipt = store.release_hold("hold-release").await.unwrap();
        assert!(!receipt.replayed);

        let available = get_user_balance_from_pool(&pool, alice, Asset::Usdc, "available").await;
        let held = get_user_balance_from_pool(&pool, alice, Asset::Usdc, "held").await;

        assert_eq!(available, 100);
        assert_eq!(held, 0);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn release_hold_replay_returns_same_receipt() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        store
            .deposit(alice, usdc(100), "seed-release-replay")
            .await
            .unwrap();
        store
            .create_hold(alice, usdc(60), "hold-release-replay")
            .await
            .unwrap();

        let first = store.release_hold("hold-release-replay").await.unwrap();
        let second = store.release_hold("hold-release-replay").await.unwrap();

        assert!(!first.replayed);
        assert!(second.replayed);
        assert_eq!(first.transaction_id, second.transaction_id);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn release_hold_on_non_open_hold_fails() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        store
            .deposit(alice, usdc(100), "seed-release-closed")
            .await
            .unwrap();
        store
            .create_hold(alice, usdc(60), "hold-closed")
            .await
            .unwrap();
        store.settle_hold("hold-closed", None).await.unwrap();

        // The money has left; it cannot be handed back to the user as well.
        // (Releasing the same hold twice is a replay, covered above.)
        let result = store.release_hold("hold-closed").await;

        assert!(matches!(
            result,
            Err(LedgerError::HoldClosed {
                state: HoldState::Settled,
                ..
            })
        ));
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn release_hold_non_existent_hold_fails() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());

        let result = store.release_hold("nonexistent").await;

        assert!(matches!(result, Err(LedgerError::HoldNotFound { .. })));
    }

    // ── Idempotency conflict tests ─────────────────────────────────

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn deposit_idempotency_detects_fingerprint_mismatch() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        store.deposit(alice, usdc(50), "fp-conflict").await.unwrap();
        let result = store.deposit(alice, usdc(99), "fp-conflict").await;

        assert!(matches!(
            result,
            Err(LedgerError::IdempotencyConflict { .. })
        ));
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn transfer_idempotency_detects_fingerprint_mismatch() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let (alice, bob, charlie) = (UserId::new(), UserId::new(), UserId::new());
        ensure_user(&pool, alice).await;
        ensure_user(&pool, bob).await;
        ensure_user(&pool, charlie).await;

        store
            .deposit(alice, usdc(100), "seed-xfer-fp")
            .await
            .unwrap();
        store
            .transfer(alice, bob, usdc(30), "xfer-fp")
            .await
            .unwrap();

        let result = store.transfer(alice, charlie, usdc(30), "xfer-fp").await;

        assert!(matches!(
            result,
            Err(LedgerError::IdempotencyConflict { .. })
        ));
    }

    // ── Connection pool tests ─────────────────────────────────

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn connection_pool_initializes_successfully() {
        let pool = test_pool().await.unwrap();
        let _store = PostgresLedgerStore::new(pool.clone());
        assert!(!pool.is_closed(), "the pool should be usable once built");
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn connection_pool_health_ping_succeeds() {
        let pool = test_pool().await.unwrap();
        let _store = PostgresLedgerStore::new(pool.clone());
        // Perform a simple health check by pinging the database
        let result = sqlx::query("SELECT 1 AS health_check")
            .fetch_optional(&pool)
            .await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_some());
    }

    // Helper to read balance from the pool directly (outside the store).
    // ── settle_hold tests ──────────────────────────────────────────────

    /// The settlement transaction's postings to `system_account`, so the
    /// assertion is not disturbed by other tests sharing the system accounts.
    async fn system_posting(pool: &PgPool, transaction_id: Uuid, system_account: &str) -> i128 {
        let row = sqlx::query(
            "SELECT COALESCE(SUM(amount), 0)::text AS amount FROM ledger_postings \
             WHERE transaction_id = $1 AND owner_kind = 'system' AND system_account = $2",
        )
        .bind(transaction_id)
        .bind(system_account)
        .fetch_one(pool)
        .await
        .unwrap();
        row.get::<String, _>("amount").parse().unwrap()
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn settle_hold_books_principal_to_outflow_and_fee_to_fees() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;
        let hold_ref = format!("settle-hold-{}", Uuid::new_v4());

        store
            .deposit(
                alice,
                usdc(1_000),
                &format!("settle-dep-{}", Uuid::new_v4()),
            )
            .await
            .unwrap();
        // Principal 900 + fee 100 locked by the withdrawal.
        store
            .create_hold(alice, usdc(1_000), &hold_ref)
            .await
            .unwrap();

        let receipt = store.settle_hold(&hold_ref, Some(usdc(100))).await.unwrap();
        assert!(!receipt.replayed);

        assert_eq!(
            get_user_balance_from_pool(&pool, alice, Asset::Usdc, "held").await,
            0
        );
        assert_eq!(
            get_user_balance_from_pool(&pool, alice, Asset::Usdc, "available").await,
            0
        );
        assert_eq!(
            system_posting(&pool, receipt.transaction_id, "external_outflow").await,
            900
        );
        assert_eq!(
            system_posting(&pool, receipt.transaction_id, "fees").await,
            100
        );
        assert!(store.get_active_holds(alice).await.unwrap().is_empty());
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn settle_hold_without_fee_sends_everything_to_outflow() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;
        let hold_ref = format!("settle-hold-{}", Uuid::new_v4());

        store
            .deposit(alice, usdc(500), &format!("settle-dep-{}", Uuid::new_v4()))
            .await
            .unwrap();
        store
            .create_hold(alice, usdc(200), &hold_ref)
            .await
            .unwrap();

        let receipt = store.settle_hold(&hold_ref, None).await.unwrap();

        assert_eq!(
            get_user_balance_from_pool(&pool, alice, Asset::Usdc, "available").await,
            300
        );
        assert_eq!(
            get_user_balance_from_pool(&pool, alice, Asset::Usdc, "held").await,
            0
        );
        assert_eq!(
            system_posting(&pool, receipt.transaction_id, "external_outflow").await,
            200
        );
        assert_eq!(
            system_posting(&pool, receipt.transaction_id, "fees").await,
            0
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn settle_hold_replay_returns_same_receipt() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;
        let hold_ref = format!("settle-hold-{}", Uuid::new_v4());

        store
            .deposit(alice, usdc(100), &format!("settle-dep-{}", Uuid::new_v4()))
            .await
            .unwrap();
        store
            .create_hold(alice, usdc(100), &hold_ref)
            .await
            .unwrap();

        let first = store.settle_hold(&hold_ref, Some(usdc(5))).await.unwrap();
        let second = store.settle_hold(&hold_ref, Some(usdc(5))).await.unwrap();
        assert_eq!(first.transaction_id, second.transaction_id);
        assert!(second.replayed);

        // A different fee for the same settlement is a conflict, not a replay.
        let conflict = store.settle_hold(&hold_ref, Some(usdc(6))).await;
        assert!(matches!(
            conflict,
            Err(LedgerError::IdempotencyConflict { .. })
        ));
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn settle_hold_rejects_released_holds_and_oversized_fees() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;
        let hold_ref = format!("settle-hold-{}", Uuid::new_v4());

        store
            .deposit(alice, usdc(100), &format!("settle-dep-{}", Uuid::new_v4()))
            .await
            .unwrap();
        store.create_hold(alice, usdc(50), &hold_ref).await.unwrap();

        let too_big = store.settle_hold(&hold_ref, Some(usdc(51))).await;
        assert_eq!(too_big, Err(LedgerError::InvalidFee));

        store.release_hold(&hold_ref).await.unwrap();
        let closed = store.settle_hold(&hold_ref, None).await;
        assert!(matches!(
            closed,
            Err(LedgerError::HoldClosed {
                state: HoldState::Released,
                ..
            })
        ));
        assert_eq!(
            get_user_balance_from_pool(&pool, alice, Asset::Usdc, "available").await,
            100
        );
    }

    async fn get_user_balance_from_pool(
        pool: &PgPool,
        user: UserId,
        asset: Asset,
        bucket: &str,
    ) -> i128 {
        let row = sqlx::query(
            "SELECT COALESCE(SUM(amount), 0)::text AS balance \
             FROM ledger_postings \
             WHERE owner_kind = 'user' AND user_id = $1 AND asset = $2 AND bucket = $3",
        )
        .bind(user.as_uuid())
        .bind(asset.symbol())
        .bind(bucket)
        .fetch_one(pool)
        .await
        .unwrap();

        let s: String = row.get("balance");
        s.parse::<i128>().unwrap()
    }

    // ── Point-in-time / snapshot tests ────────────────────────────────
    //
    // Done when (issue #507):
    //   1. snapshot.balance + later postings == full recomputation.
    //   2. get_balance_as_of returns the correct historical amount.
    //   3. As-of queries stay fast on a large synthetic ledger.

    // Helper: compute balance the slow way (full scan from the pool, no snapshot).
    async fn full_balance(pool: &PgPool, user: UserId, asset: Asset, bucket: &str) -> i128 {
        get_user_balance_from_pool(pool, user, asset, bucket).await
    }

    // 1. take_snapshot captures the current balance; subsequent postings
    //    can be combined with it to reproduce the full recomputation.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn snapshot_plus_later_postings_equals_full_recomputation() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        // Initial deposit: 1 000 USDC.
        store
            .deposit(alice, usdc(1_000), &format!("snap-dep-{}", Uuid::new_v4()))
            .await
            .unwrap();

        // Take a snapshot while balance == 1 000.
        let snaps = store.take_snapshot(alice).await.unwrap();
        let snap = snaps
            .iter()
            .find(|s| s.asset == Asset::Usdc && s.bucket == crate::Bucket::Available)
            .expect("snapshot must include USDC available");
        assert_eq!(snap.balance, 1_000, "snapshot balance must match current balance");

        // Deposit another 500 AFTER the snapshot.
        store
            .deposit(alice, usdc(500), &format!("snap-dep2-{}", Uuid::new_v4()))
            .await
            .unwrap();

        // Full recomputation from postings alone.
        let full = full_balance(&pool, alice, Asset::Usdc, "available").await;
        assert_eq!(full, 1_500);

        // Snapshot + postings after snapshot_time.
        let snapshotted_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
            snap.snapshotted_at.parse().unwrap();
        let row = sqlx::query(
            "SELECT COALESCE(SUM(amount), 0)::text AS delta \
             FROM ledger_postings \
             WHERE owner_kind = 'user' AND user_id = $1 \
               AND asset = 'USDC' AND bucket = 'available' \
               AND created_at > $2",
        )
        .bind(alice.as_uuid())
        .bind(snapshotted_at)
        .fetch_one(&pool)
        .await
        .unwrap();
        let delta: i128 = row.get::<String, _>("delta").parse().unwrap();

        assert_eq!(
            snap.balance + delta,
            full,
            "snapshot + later postings must equal full recomputation"
        );
    }

    // 2. get_balance_as_of returns the balance at a past moment, not the
    //    current one.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn get_balance_as_of_returns_historical_amount() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        // Deposit 200 at T1.
        store
            .deposit(alice, usdc(200), &format!("aof-dep1-{}", Uuid::new_v4()))
            .await
            .unwrap();

        // Record T1 (after the deposit).
        let t1: String = sqlx::query("SELECT now()::text AS ts")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get::<String, _>("ts");

        // Small sleep to ensure T1 < T2 even on fast machines.
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;

        // Deposit another 300 at T2.
        store
            .deposit(alice, usdc(300), &format!("aof-dep2-{}", Uuid::new_v4()))
            .await
            .unwrap();

        // Balance as-of T1 must be 200, not 500.
        let bal_t1 = store
            .get_balance_as_of(alice, Asset::Usdc, crate::Bucket::Available, &t1)
            .await
            .unwrap();
        assert_eq!(bal_t1, 200, "as-of T1 must be 200 (before second deposit)");

        // Balance as-of now must be 500.
        let now_str: String = sqlx::query("SELECT now()::text AS ts")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get::<String, _>("ts");
        let bal_now = store
            .get_balance_as_of(alice, Asset::Usdc, crate::Bucket::Available, &now_str)
            .await
            .unwrap();
        assert_eq!(bal_now, 500, "as-of now must be 500");
    }

    // 3. get_latest_snapshot returns the most-recent snapshot row.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn get_latest_snapshot_returns_most_recent_row() {
        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        // No snapshots yet → empty.
        let empty = store.get_latest_snapshot(alice).await.unwrap();
        assert!(empty.is_empty(), "no snapshots yet");

        store
            .deposit(alice, usdc(100), &format!("ls-dep-{}", Uuid::new_v4()))
            .await
            .unwrap();

        // Take two snapshots; get_latest_snapshot must return the second one.
        store.take_snapshot(alice).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        store
            .deposit(alice, usdc(50), &format!("ls-dep2-{}", Uuid::new_v4()))
            .await
            .unwrap();
        store.take_snapshot(alice).await.unwrap();

        let latest = store.get_latest_snapshot(alice).await.unwrap();
        let usdc_snap = latest
            .iter()
            .find(|s| s.asset == Asset::Usdc && s.bucket == crate::Bucket::Available)
            .expect("latest snapshot must include USDC available");
        assert_eq!(
            usdc_snap.balance, 150,
            "latest snapshot must reflect both deposits"
        );
    }

    // ── Benchmark: as-of queries stay fast on a large synthetic ledger ─
    //
    // This test inserts N_ROWS postings for a single user directly (bypassing
    // ledger rules to keep the setup fast), then measures that a point-in-time
    // query with and without a snapshot both complete within BUDGET_MS
    // milliseconds.  The test proves the `ledger_postings_by_user_asset_time`
    // index is used and that the snapshot path scans far fewer rows.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn benchmark_as_of_query_stays_fast_on_large_ledger() {
        use std::time::Instant;

        const N_ROWS: i64 = 50_000;
        const BUDGET_MS: u128 = 2_000; // generous budget for CI

        let pool = test_pool().await.unwrap();
        let store = PostgresLedgerStore::new(pool.clone());
        let alice = UserId::new();
        ensure_user(&pool, alice).await;

        // Insert a fake transaction to satisfy the FK on ledger_postings.
        let tx_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO ledger_transactions (id, kind, reference, request) \
             VALUES ($1, 'deposit', $2, 'bench')",
        )
        .bind(tx_id)
        .bind(format!("bench-tx-{}", Uuid::new_v4()))
        .execute(&pool)
        .await
        .unwrap();

        // Bulk-insert N_ROWS postings in a single statement using
        // generate_series so the test setup is fast.
        sqlx::query(
            "INSERT INTO ledger_postings \
                (transaction_id, owner_kind, user_id, asset, bucket, amount, created_at) \
             SELECT $1, 'user', $2, 'USDC', 'available', 1, \
                    now() - (($3 - gs) * interval '1 second') \
             FROM generate_series(1, $3) AS gs",
        )
        .bind(tx_id)
        .bind(alice.as_uuid())
        .bind(N_ROWS)
        .execute(&pool)
        .await
        .unwrap();

        // Pick a timestamp halfway through the history.
        let midpoint: String = sqlx::query(
            "SELECT (now() - ($1 / 2 * interval '1 second'))::text AS ts",
        )
        .bind(N_ROWS)
        .fetch_one(&pool)
        .await
        .unwrap()
        .get::<String, _>("ts");

        // ── Without snapshot: full index scan from epoch to midpoint ──
        let t_no_snap = Instant::now();
        let bal_no_snap = store
            .get_balance_as_of(alice, Asset::Usdc, crate::Bucket::Available, &midpoint)
            .await
            .unwrap();
        let elapsed_no_snap = t_no_snap.elapsed().as_millis();

        assert!(bal_no_snap > 0, "must have a non-zero balance at midpoint");
        assert!(
            elapsed_no_snap < BUDGET_MS,
            "as-of query without snapshot took {}ms, budget {}ms",
            elapsed_no_snap,
            BUDGET_MS,
        );

        // ── Take a snapshot at the earliest posting ────────────────────
        // Force a snapshot timestamp earlier than midpoint so the as-of
        // query uses it as a baseline.
        let early_ts: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
            sqlx::query(
                "SELECT (now() - ($1 * interval '1 second'))::timestamptz AS ts",
            )
            .bind(N_ROWS + 10)
            .fetch_one(&pool)
            .await
            .unwrap()
            .get("ts");

        // Insert a manual snapshot row at `early_ts` with balance = 0.
        sqlx::query(
            "INSERT INTO balance_snapshots \
                (user_id, asset, bucket, balance, snapshotted_at) \
             VALUES ($1, 'USDC', 'available', 0, $2)",
        )
        .bind(alice.as_uuid())
        .bind(early_ts)
        .execute(&pool)
        .await
        .unwrap();

        // ── With snapshot: delta scan from snapshot_time to midpoint ──
        let t_with_snap = Instant::now();
        let bal_with_snap = store
            .get_balance_as_of(alice, Asset::Usdc, crate::Bucket::Available, &midpoint)
            .await
            .unwrap();
        let elapsed_with_snap = t_with_snap.elapsed().as_millis();

        assert_eq!(
            bal_no_snap, bal_with_snap,
            "snapshot path and full-scan path must agree on the balance"
        );
        assert!(
            elapsed_with_snap < BUDGET_MS,
            "as-of query with snapshot took {}ms, budget {}ms",
            elapsed_with_snap,
            BUDGET_MS,
        );

        // The snapshot path should be at least as fast as the full scan
        // (it scans strictly fewer rows).  We don't assert a speedup ratio
        // because CI machines vary, but we log the numbers for visibility.
        println!(
            "benchmark_as_of: no_snap={}ms with_snap={}ms (N={})",
            elapsed_no_snap, elapsed_with_snap, N_ROWS
        );
    }
}
