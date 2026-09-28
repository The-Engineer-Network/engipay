//! PostgreSQL persistence for the double-entry ledger.
//!
//! Every mutation is committed as one database transaction. Sender operations
//! lock the corresponding `users` row before reading the derived balance, so
//! concurrent requests cannot both spend the same available funds.

use std::str::FromStr;

use engipay_core::{Asset, Money, UserId};
use sqlx::{PgPool, Postgres, Row, Transaction as SqlTransaction};
use uuid::Uuid;

use crate::{Balance, Hold, HoldState, LedgerError, Receipt};

#[derive(Clone, Debug)]
pub struct PostgresLedgerStore {
    pool: PgPool,
}

impl PostgresLedgerStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn get_user_balance(
        &self,
        user_id: UserId,
        asset: Asset,
    ) -> Result<Balance, LedgerError> {
        get_user_balance(&self.pool, user_id, asset).await
    }

    pub async fn get_active_holds(&self, user_id: UserId) -> Result<Vec<Hold>, LedgerError> {
        get_active_holds(&self.pool, user_id).await
    }

    /// Record incoming funds. `reference` must be unique to the source event.
    pub async fn deposit(
        &self,
        user_id: UserId,
        money: Money,
        reference: &str,
    ) -> Result<Receipt, LedgerError> {
        require_positive(money)?;
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        let request = format!("deposit:{user_id}:{}:{}", money.asset, money.minor);
        let Some(receipt) = insert_transaction(&mut tx, "deposit", reference, &request).await?
        else {
            return replay_or_conflict(&mut tx, reference, &request).await;
        };
        insert_posting(
            &mut tx,
            receipt.transaction_id,
            "system",
            None,
            Some("external_inflow"),
            money.asset,
            "available",
            negate(money.minor)?,
        )
        .await?;
        insert_posting(
            &mut tx,
            receipt.transaction_id,
            "user",
            Some(user_id),
            None,
            money.asset,
            "available",
            money.minor,
        )
        .await?;
        tx.commit().await.map_err(db_error)?;
        Ok(receipt)
    }

    /// Transfer available funds. Sender rows are locked in UUID order to avoid
    /// deadlocks when two users transfer to each other concurrently.
    pub async fn transfer(
        &self,
        from: UserId,
        to: UserId,
        money: Money,
        reference: &str,
    ) -> Result<Receipt, LedgerError> {
        require_positive(money)?;
        if from == to {
            return Err(LedgerError::SameAccount);
        }
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        lock_users(&mut tx, &[from, to]).await?;
        let request = format!("transfer:{from}:{to}:{}:{}", money.asset, money.minor);
        let Some(receipt) = insert_transaction(&mut tx, "transfer", reference, &request).await?
        else {
            return replay_or_conflict(&mut tx, reference, &request).await;
        };
        require_available(&mut tx, from, money).await?;
        insert_posting(
            &mut tx,
            receipt.transaction_id,
            "user",
            Some(from),
            None,
            money.asset,
            "available",
            negate(money.minor)?,
        )
        .await?;
        insert_posting(
            &mut tx,
            receipt.transaction_id,
            "user",
            Some(to),
            None,
            money.asset,
            "available",
            money.minor,
        )
        .await?;
        tx.commit().await.map_err(db_error)?;
        Ok(receipt)
    }

    /// Reserve available funds under a hold reference.
    pub async fn hold(
        &self,
        user_id: UserId,
        money: Money,
        reference: &str,
    ) -> Result<Receipt, LedgerError> {
        require_positive(money)?;
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        lock_users(&mut tx, &[user_id]).await?;
        let request = format!("hold:{user_id}:{}:{}", money.asset, money.minor);
        let Some(receipt) = insert_transaction(&mut tx, "hold", reference, &request).await? else {
            return replay_or_conflict(&mut tx, reference, &request).await;
        };
        require_available(&mut tx, user_id, money).await?;
        insert_posting(
            &mut tx,
            receipt.transaction_id,
            "user",
            Some(user_id),
            None,
            money.asset,
            "available",
            negate(money.minor)?,
        )
        .await?;
        insert_posting(
            &mut tx,
            receipt.transaction_id,
            "user",
            Some(user_id),
            None,
            money.asset,
            "held",
            money.minor,
        )
        .await?;
        sqlx::query("INSERT INTO ledger_holds (reference, user_id, asset, amount) VALUES ($1, $2, $3, $4::numeric)")
        .bind(reference).bind(user_id.as_uuid()).bind(money.asset.symbol()).bind(money.minor.to_string())
            .execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        Ok(receipt)
    }

    pub async fn release_hold(&self, hold_reference: &str) -> Result<Receipt, LedgerError> {
        self.close_hold_kind(hold_reference, None, "release").await
    }

    /// Settle an open hold after an outflow is confirmed. Any optional fee is
    /// credited to the fees system account; the remaining principal is outflow.
    pub async fn settle_hold(
        &self,
        hold_reference: &str,
        fee: Option<Money>,
    ) -> Result<Receipt, LedgerError> {
        self.close_hold_kind(hold_reference, fee, "settle").await
    }

    async fn close_hold_kind(
        &self,
        hold_reference: &str,
        fee: Option<Money>,
        action: &str,
    ) -> Result<Receipt, LedgerError> {
        if hold_reference.trim().is_empty() {
            return Err(LedgerError::EmptyReference);
        }
        let reference = format!("{hold_reference}:{action}");
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        let row = sqlx::query("SELECT user_id FROM ledger_holds WHERE reference = $1")
            .bind(hold_reference)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?
            .ok_or_else(|| LedgerError::HoldNotFound {
                reference: hold_reference.to_owned(),
            })?;
        let user_id = UserId::from_uuid(row.try_get("user_id").map_err(db_error)?);
        lock_users(&mut tx, &[user_id]).await?;
        let row = sqlx::query("SELECT asset, amount::text AS amount, state FROM ledger_holds WHERE reference = $1 FOR UPDATE")
            .bind(hold_reference).fetch_optional(&mut *tx).await.map_err(db_error)?
            .ok_or_else(|| LedgerError::HoldNotFound { reference: hold_reference.to_owned() })?;
        let state: String = row.try_get("state").map_err(db_error)?;
        let asset = parse_asset(row.try_get::<String, _>("asset").map_err(db_error)?)?;
        let amount = parse_minor(row.try_get("amount").map_err(db_error)?)?;
        let principal = Money::from_minor(asset, amount);
        let state = parse_state(&state)?;
        let fee_minor = match (action, fee) {
            ("release", None) => 0,
            ("settle", None) => 0,
            ("settle", Some(value))
                if value.asset == asset && value.minor >= 0 && value.minor < amount =>
            {
                value.minor
            }
            _ => return Err(LedgerError::InvalidFee),
        };
        let request = if action == "settle" {
            format!("settle:{fee_minor}")
        } else {
            "release".to_owned()
        };
        let Some(receipt) = insert_transaction(
            &mut tx,
            if action == "settle" {
                "settle_hold"
            } else {
                "release_hold"
            },
            &reference,
            &request,
        )
        .await?
        else {
            return replay_or_conflict(&mut tx, &reference, &request).await;
        };
        if state != HoldState::Open {
            return Err(LedgerError::HoldClosed {
                reference: hold_reference.to_owned(),
                state,
            });
        }
        sqlx::query("UPDATE ledger_holds SET state = $2, closed_at = now() WHERE reference = $1")
            .bind(hold_reference)
            .bind(if action == "settle" {
                "settled"
            } else {
                "released"
            })
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        insert_posting(
            &mut tx,
            receipt.transaction_id,
            "user",
            Some(user_id),
            None,
            asset,
            "held",
            negate(principal.minor)?,
        )
        .await?;
        if action == "release" {
            insert_posting(
                &mut tx,
                receipt.transaction_id,
                "user",
                Some(user_id),
                None,
                asset,
                "available",
                principal.minor,
            )
            .await?;
        } else {
            insert_posting(
                &mut tx,
                receipt.transaction_id,
                "system",
                None,
                Some("external_outflow"),
                asset,
                "available",
                principal
                    .minor
                    .checked_sub(fee_minor)
                    .ok_or(LedgerError::Overflow)?,
            )
            .await?;
            if fee_minor > 0 {
                insert_posting(
                    &mut tx,
                    receipt.transaction_id,
                    "system",
                    None,
                    Some("fees"),
                    asset,
                    "available",
                    fee_minor,
                )
                .await?;
            }
        }
        tx.commit().await.map_err(db_error)?;
        Ok(receipt)
    }
}

/// Fetch one asset's two buckets from the derived balance view. Missing rows
/// represent zero balances and are returned as zero rather than omitted.
pub async fn get_user_balance(
    pool: &PgPool,
    user_id: UserId,
    asset: Asset,
) -> Result<Balance, LedgerError> {
    let rows = sqlx::query("SELECT bucket, amount::text AS amount FROM account_balances WHERE owner_kind = 'user' AND user_id = $1 AND asset = $2")
        .bind(user_id.as_uuid()).bind(asset.symbol()).fetch_all(pool).await.map_err(db_error)?;
    let mut balance = Balance {
        asset,
        available: 0,
        held: 0,
    };
    for row in rows {
        let bucket: String = row.try_get("bucket").map_err(db_error)?;
        let amount = parse_minor(row.try_get("amount").map_err(db_error)?)?;
        match bucket.as_str() {
            "available" => balance.available = amount,
            "held" => balance.held = amount,
            _ => {
                return Err(LedgerError::Database(format!(
                    "unknown ledger bucket {bucket}"
                )));
            }
        }
    }
    Ok(balance)
}

/// Return only open holds, ordered by creation time and reference for stable
/// API responses.
pub async fn get_active_holds(pool: &PgPool, user_id: UserId) -> Result<Vec<Hold>, LedgerError> {
    let rows = sqlx::query("SELECT asset, amount::text AS amount FROM ledger_holds WHERE user_id = $1 AND state = 'open' ORDER BY created_at, reference")
        .bind(user_id.as_uuid()).fetch_all(pool).await.map_err(db_error)?;
    rows.into_iter()
        .map(|row| {
            let asset = parse_asset(row.try_get::<String, _>("asset").map_err(db_error)?)?;
            let amount = parse_minor(row.try_get("amount").map_err(db_error)?)?;
            Ok(Hold {
                user: user_id,
                money: Money::from_minor(asset, amount),
                state: HoldState::Open,
            })
        })
        .collect()
}

async fn insert_transaction(
    tx: &mut SqlTransaction<'_, Postgres>,
    kind: &str,
    reference: &str,
    request: &str,
) -> Result<Option<Receipt>, LedgerError> {
    if reference.trim().is_empty() {
        return Err(LedgerError::EmptyReference);
    }
    let id = Uuid::new_v4();
    let inserted = sqlx::query("INSERT INTO ledger_transactions (id, kind, reference, request) VALUES ($1, $2, $3, $4) ON CONFLICT (reference) DO NOTHING RETURNING id")
        .bind(id).bind(kind).bind(reference).bind(request).fetch_optional(&mut **tx).await.map_err(db_error)?;
    Ok(inserted.map(|_| Receipt {
        transaction_id: id,
        replayed: false,
    }))
}

async fn replay_or_conflict(
    tx: &mut SqlTransaction<'_, Postgres>,
    reference: &str,
    request: &str,
) -> Result<Receipt, LedgerError> {
    let row = sqlx::query("SELECT id, request FROM ledger_transactions WHERE reference = $1")
        .bind(reference)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db_error)?;
    let Some(row) = row else {
        return Err(LedgerError::Database(
            "idempotency reference disappeared".to_owned(),
        ));
    };
    let existing: String = row.try_get("request").map_err(db_error)?;
    if existing != request {
        return Err(LedgerError::IdempotencyConflict {
            reference: reference.to_owned(),
        });
    }
    let id: Uuid = row.try_get("id").map_err(db_error)?;
    Ok(Receipt {
        transaction_id: id,
        replayed: true,
    })
}

async fn lock_users(
    tx: &mut SqlTransaction<'_, Postgres>,
    users: &[UserId],
) -> Result<(), LedgerError> {
    let mut ids: Vec<Uuid> = users.iter().map(UserId::as_uuid).collect();
    ids.sort_unstable();
    ids.dedup();
    for id in ids {
        let row = sqlx::query("SELECT id FROM users WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(db_error)?;
        if row.is_none() {
            return Err(LedgerError::Database(format!("user {id} does not exist")));
        }
    }
    Ok(())
}

async fn require_available(
    tx: &mut SqlTransaction<'_, Postgres>,
    user: UserId,
    money: Money,
) -> Result<(), LedgerError> {
    let row = sqlx::query("SELECT COALESCE(SUM(amount), 0)::text AS amount FROM account_balances WHERE owner_kind = 'user' AND user_id = $1 AND asset = $2 AND bucket = 'available'")
        .bind(user.as_uuid()).bind(money.asset.symbol()).fetch_one(&mut **tx).await.map_err(db_error)?;
    let available = parse_minor(row.try_get("amount").map_err(db_error)?)?;
    if available < money.minor {
        return Err(LedgerError::InsufficientFunds {
            available: Money::from_minor(money.asset, available),
            requested: money,
        });
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn insert_posting(
    tx: &mut SqlTransaction<'_, Postgres>,
    transaction_id: Uuid,
    owner_kind: &str,
    user_id: Option<UserId>,
    system_account: Option<&str>,
    asset: Asset,
    bucket: &str,
    amount: i128,
) -> Result<(), LedgerError> {
    if amount == 0 {
        return Ok(());
    }
    sqlx::query("INSERT INTO ledger_postings (transaction_id, owner_kind, user_id, system_account, asset, bucket, amount) VALUES ($1, $2, $3, $4, $5, $6, $7::numeric)")
        .bind(transaction_id).bind(owner_kind).bind(user_id.map(|value| value.as_uuid())).bind(system_account).bind(asset.symbol()).bind(bucket).bind(amount.to_string())
        .execute(&mut **tx).await.map_err(db_error)?;
    Ok(())
}

fn require_positive(money: Money) -> Result<(), LedgerError> {
    if money.is_positive() {
        Ok(())
    } else {
        Err(LedgerError::NonPositiveAmount)
    }
}
fn negate(value: i128) -> Result<i128, LedgerError> {
    value.checked_neg().ok_or(LedgerError::Overflow)
}
fn parse_minor(value: String) -> Result<i128, LedgerError> {
    value.parse().map_err(|_| LedgerError::Overflow)
}
fn parse_asset(value: String) -> Result<Asset, LedgerError> {
    Asset::from_str(&value).map_err(|error| LedgerError::Database(error.to_string()))
}
fn parse_state(value: &str) -> Result<HoldState, LedgerError> {
    match value {
        "open" => Ok(HoldState::Open),
        "released" => Ok(HoldState::Released),
        "settled" => Ok(HoldState::Settled),
        _ => Err(LedgerError::Database(format!("unknown hold state {value}"))),
    }
}
fn db_error(error: sqlx::Error) -> LedgerError {
    LedgerError::Database(error.to_string())
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;
    use std::env;
    use tokio::task::JoinSet;

    // CI's Postgres job sets DATABASE_URL. Local `cargo test` remains usable
    // without Docker, while still running this full integration case in CI.
    #[tokio::test]
    async fn postgres_queries_settlement_and_sender_locking()
    -> Result<(), Box<dyn std::error::Error>> {
        let Ok(url) = env::var("DATABASE_URL") else {
            eprintln!("skipping PostgreSQL integration test: DATABASE_URL is unset");
            return Ok(());
        };
        let admin = PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await?;
        let schema = format!("ledger_test_{}", Uuid::new_v4().simple());
        sqlx::query(&format!("CREATE SCHEMA {schema}"))
            .execute(&admin)
            .await?;
        let connection_schema = schema.clone();
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .after_connect(move |conn, _| {
                let statement = format!("SET search_path TO {connection_schema}");
                Box::pin(async move {
                    sqlx::query(&statement).execute(conn).await?;
                    Ok(())
                })
            })
            .connect(&url)
            .await?;
        let result = async {
            sqlx::raw_sql(include_str!("../../../migrations/0001_ledger.sql"))
                .execute(&pool)
                .await?;
            sqlx::raw_sql(include_str!("../../../migrations/0002_add_xlm.sql"))
                .execute(&pool)
                .await?;
            let alice = UserId::new();
            let bob = UserId::new();
            sqlx::query("INSERT INTO users (id) VALUES ($1), ($2)")
                .bind(alice.as_uuid())
                .bind(bob.as_uuid())
                .execute(&pool)
                .await?;
            let store = PostgresLedgerStore::new(pool.clone());
            let usdc = Money::from_minor(Asset::Usdc, 100);
            store.deposit(alice, usdc, "seed").await?;

            store
                .hold(alice, Money::from_minor(Asset::Usdc, 10), "withdraw-1")
                .await?;
            store
                .hold(alice, Money::from_minor(Asset::Usdc, 20), "withdraw-2")
                .await?;
            store
                .hold(alice, Money::from_minor(Asset::Usdc, 30), "withdraw-3")
                .await?;
            store
                .deposit(alice, Money::from_minor(Asset::Btc, 60), "seed-btc")
                .await?;
            store
                .hold(alice, Money::from_minor(Asset::Btc, 60), "btc-withdrawal")
                .await?;
            let held_only = store.get_user_balance(alice, Asset::Btc).await?;
            assert_eq!((held_only.available, held_only.held), (0, 60));
            let held_balance = store.get_user_balance(alice, Asset::Usdc).await?;
            assert_eq!((held_balance.available, held_balance.held), (40, 60));
            store
                .settle_hold("withdraw-1", Some(Money::from_minor(Asset::Usdc, 2)))
                .await?;
            assert!(
                store
                    .settle_hold("withdraw-1", Some(Money::from_minor(Asset::Usdc, 2)))
                    .await?
                    .replayed
            );
            store.release_hold("withdraw-2").await?;
            let active = store.get_active_holds(alice).await?;
            assert_eq!(active.len(), 2);
            assert!(
                active
                    .iter()
                    .any(|hold| hold.money == Money::from_minor(Asset::Usdc, 30))
            );
            assert!(
                active
                    .iter()
                    .any(|hold| hold.money == Money::from_minor(Asset::Btc, 60))
            );

            let mut tasks = JoinSet::new();
            for reference in ["parallel-1", "parallel-2"] {
                let store = store.clone();
                tasks.spawn(async move {
                    store
                        .transfer(alice, bob, Money::from_minor(Asset::Usdc, 50), reference)
                        .await
                });
            }
            let mut successes = 0_u8;
            let mut refusals = 0_u8;
            while let Some(result) = tasks.join_next().await {
                match result? {
                    Ok(_) => successes += 1,
                    Err(LedgerError::InsufficientFunds { .. }) => refusals += 1,
                    Err(error) => return Err(Box::<dyn std::error::Error>::from(error)),
                }
            }
            assert_eq!((successes, refusals), (1, 1));
            let alice_balance = store.get_user_balance(alice, Asset::Usdc).await?;
            let bob_balance = store.get_user_balance(bob, Asset::Usdc).await?;
            assert_eq!(alice_balance.available, 10);
            assert_eq!(alice_balance.held, 30);
            assert_eq!(bob_balance.available, 50);
            Ok::<(), Box<dyn std::error::Error>>(())
        }
        .await;
        pool.close().await;
        let cleanup = sqlx::query(&format!("DROP SCHEMA {schema} CASCADE"))
            .execute(&admin)
            .await;
        admin.close().await;
        cleanup?;
        result
    }
}
