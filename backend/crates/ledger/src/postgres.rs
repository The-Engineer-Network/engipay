//! PostgreSQL-backed ledger store.
//!
//! Each public method runs inside a SERIALIZABLE transaction so that
//! concurrent calls cannot violate ledger invariants. Transient
//! serialization failures (PG error codes `40001` and `40P01`) are
//! retried automatically with exponential backoff and jitter, up to
//! [`MAX_RETRIES`] times before surfacing the error.

use std::future::Future;
use std::time::Duration;

use sqlx::{PgPool, Postgres, Row};
use uuid::Uuid;

use engipay_core::{Asset, Money, UserId};

use crate::{Balance, HoldState, LedgerError, Receipt};

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

    /// Credits a user with money that arrived from outside EngiPay.
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
        sqlx::query("SELECT user_id, asset, amount, state FROM ledger_holds WHERE reference = $1")
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

fn db_err(e: sqlx::Error) -> LedgerError {
    let code = match &e {
        sqlx::Error::Database(db_err) => {
            let code = db_err.code().map(|c| c.to_string());
            match code.as_deref() {
                Some("23514") => {
                    return LedgerError::InvariantViolated("database constraint violated");
                }
                Some("23505") => {
                    return LedgerError::IdempotencyConflict {
                        reference: "conflict".to_owned(),
                    };
                }
                Some("23503") => {
                    return LedgerError::InvariantViolated("foreign key constraint violation");
                }
                _ => {}
            };
            code
        }
        _ => None,
    };

    LedgerError::Database {
        code,
        message: e.to_string(),
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

    async fn test_pool() -> PgPool {
        let url =
            std::env::var("DATABASE_URL").expect("DATABASE_URL is required for ignored tests");
        let pool = PgPool::connect(&url)
            .await
            .expect("connect to the test database");
        sqlx::migrate!("../../migrations")
            .run(&pool)
            .await
            .expect("apply the test database migrations");
        pool
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
        let pool = test_pool().await;
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
        let pool = test_pool().await;
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
        let pool = test_pool().await;
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
        let pool = test_pool().await;
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
        let pool = test_pool().await;
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
        let pool = test_pool().await;
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
        let pool = test_pool().await;
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
        let pool = test_pool().await;
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

    // ── Release hold tests ─────────────────────────────────────────

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn release_hold_returns_money_to_available() {
        let pool = test_pool().await;
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
        let pool = test_pool().await;
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
    async fn release_hold_on_settled_hold_fails() {
        let pool = test_pool().await;
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
        // A repeated release is an idempotent success (tested above). A hold
        // closed by settlement instead must reject an attempt to release it.
        sqlx::query(
            "UPDATE ledger_holds SET state = 'settled', closed_at = now() WHERE reference = $1",
        )
        .bind("hold-closed")
        .execute(&pool)
        .await
        .unwrap();

        // Try to release the settled hold.
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
        let pool = test_pool().await;
        let store = PostgresLedgerStore::new(pool.clone());

        let result = store.release_hold("nonexistent").await;

        assert!(matches!(result, Err(LedgerError::HoldNotFound { .. })));
    }

    // ── Idempotency conflict tests ─────────────────────────────────

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn deposit_idempotency_detects_fingerprint_mismatch() {
        let pool = test_pool().await;
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
        let pool = test_pool().await;
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
        let pool = test_pool().await;
        let store = PostgresLedgerStore::new(pool);
        // If we got here, the pool initialized successfully.
        // The store is created and ready for use.
        assert!(!store.pool.is_closed());
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn connection_pool_health_ping_succeeds() {
        let pool = test_pool().await;
        // Perform a simple health check by pinging the database
        let result = sqlx::query("SELECT 1 AS health_check")
            .fetch_optional(&pool)
            .await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_some());
    }

    // Helper to read balance from the pool directly (outside the store).
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
}
