#![cfg(feature = "postgres")]
#![allow(clippy::arithmetic_side_effects, clippy::unwrap_used)]

use engipay_core::{Asset, Money, UserId};
use engipay_ledger::{HoldState, LedgerError, postgres::PostgresLedgerStore};
use sqlx::{PgPool, Row};

async fn setup() -> (PgPool, PostgresLedgerStore, UserId) {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL is required");
    let pool = PgPool::connect(&url).await.unwrap();
    sqlx::migrate!("../../migrations").run(&pool).await.unwrap();
    let user = UserId::new();
    sqlx::query("INSERT INTO users (id) VALUES ($1)")
        .bind(user.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    (pool.clone(), PostgresLedgerStore::new(pool), user)
}

fn usdc(amount: i128) -> Money {
    Money::from_minor(Asset::Usdc, amount)
}

async fn balance(pool: &PgPool, user: UserId, bucket: &str) -> i128 {
    let row = sqlx::query(
        "SELECT COALESCE((SELECT amount FROM account_balances \
         WHERE owner_kind = 'user' AND user_id = $1 AND asset = 'USDC' AND bucket = $2), 0)::text AS amount",
    )
    .bind(user.as_uuid())
    .bind(bucket)
    .fetch_one(pool)
    .await
    .unwrap();
    row.get::<String, _>("amount").parse().unwrap()
}

async fn system_balance(pool: &PgPool, account: &str) -> i128 {
    let row = sqlx::query(
        "SELECT COALESCE((SELECT amount FROM account_balances \
         WHERE owner_kind = 'system' AND system_account = $1 AND asset = 'USDC'), 0)::text AS amount",
    )
    .bind(account)
    .fetch_one(pool)
    .await
    .unwrap();
    row.get::<String, _>("amount").parse().unwrap()
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn create_hold_accepts_entire_available_balance() {
    let (pool, store, user) = setup().await;
    store
        .deposit(user, usdc(100), "hold-test-seed-1")
        .await
        .unwrap();
    store
        .create_hold(user, usdc(100), "hold-test-all")
        .await
        .unwrap();
    assert_eq!(balance(&pool, user, "available").await, 0);
    assert_eq!(balance(&pool, user, "held").await, 100);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn multiple_open_holds_are_reflected_in_account_balances() {
    let (pool, store, user) = setup().await;
    store
        .deposit(user, usdc(100), "hold-test-seed-multiple")
        .await
        .unwrap();
    store
        .create_hold(user, usdc(40), "hold-test-a")
        .await
        .unwrap();
    store
        .create_hold(user, usdc(60), "hold-test-b")
        .await
        .unwrap();
    assert_eq!(balance(&pool, user, "available").await, 0);
    assert_eq!(balance(&pool, user, "held").await, 100);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn create_hold_over_available_balance_is_rejected_without_moving_funds() {
    let (pool, store, user) = setup().await;
    store
        .deposit(user, usdc(100), "hold-test-seed-2")
        .await
        .unwrap();
    let result = store
        .create_hold(user, usdc(101), "hold-test-too-large")
        .await;
    assert!(matches!(result, Err(LedgerError::InsufficientFunds { .. })));
    assert_eq!(balance(&pool, user, "available").await, 100);
    assert_eq!(balance(&pool, user, "held").await, 0);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn release_hold_restores_available_balance_and_is_idempotent() {
    let (pool, store, user) = setup().await;
    store
        .deposit(user, usdc(100), "hold-test-seed-3")
        .await
        .unwrap();
    store
        .create_hold(user, usdc(70), "hold-test-release")
        .await
        .unwrap();
    let first = store.release_hold("hold-test-release").await.unwrap();
    let replay = store.release_hold("hold-test-release").await.unwrap();
    assert!(!first.replayed);
    assert!(replay.replayed);
    assert_eq!(first.transaction_id, replay.transaction_id);
    assert_eq!(balance(&pool, user, "available").await, 100);
    assert_eq!(balance(&pool, user, "held").await, 0);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn release_hold_rejects_a_settled_hold() {
    let (_pool, store, user) = setup().await;
    store
        .deposit(user, usdc(100), "hold-test-seed-4")
        .await
        .unwrap();
    store
        .create_hold(user, usdc(70), "hold-test-settled")
        .await
        .unwrap();
    store.settle_hold("hold-test-settled", None).await.unwrap();
    assert!(matches!(
        store.release_hold("hold-test-settled").await,
        Err(LedgerError::HoldClosed {
            state: HoldState::Settled,
            ..
        })
    ));
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn settle_hold_allocates_principal_and_fee_to_system_accounts() {
    let (pool, store, user) = setup().await;
    let outflow_before = system_balance(&pool, "external_outflow").await;
    let fees_before = system_balance(&pool, "fees").await;
    store
        .deposit(user, usdc(100), "hold-test-seed-5")
        .await
        .unwrap();
    store
        .create_hold(user, usdc(80), "hold-test-settle-fee")
        .await
        .unwrap();
    store
        .settle_hold("hold-test-settle-fee", Some(usdc(5)))
        .await
        .unwrap();
    assert_eq!(balance(&pool, user, "held").await, 0);
    let outflow_delta = system_balance(&pool, "external_outflow").await - outflow_before;
    let fees_delta = system_balance(&pool, "fees").await - fees_before;
    assert_eq!(outflow_delta, 75);
    assert_eq!(fees_delta, 5);
    assert_eq!(outflow_delta + fees_delta, 80);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn settle_hold_rejects_fee_in_another_asset_or_above_principal() {
    let (_pool, store, user) = setup().await;
    store
        .deposit(user, usdc(100), "hold-test-seed-6")
        .await
        .unwrap();
    store
        .create_hold(user, usdc(80), "hold-test-invalid-fee")
        .await
        .unwrap();
    assert_eq!(
        store
            .settle_hold(
                "hold-test-invalid-fee",
                Some(Money::from_minor(Asset::Btc, 1))
            )
            .await,
        Err(LedgerError::InvalidFee)
    );
    assert_eq!(
        store
            .settle_hold("hold-test-invalid-fee", Some(usdc(80)))
            .await,
        Err(LedgerError::InvalidFee)
    );
    assert_eq!(balance(&_pool, user, "held").await, 80);
}
