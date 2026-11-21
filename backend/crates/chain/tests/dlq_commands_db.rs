//! Database-backed integration tests for the `dlq` subcommands.
//!
//! Requires `DATABASE_URL` pointing at a Postgres database with all migrations
//! applied.  Run with:
//!
//!   DATABASE_URL=postgres://... cargo test -p engipay-chain --test dlq_commands_db -- --ignored

#![allow(clippy::unwrap_used)]

use engipay_chain::dlq_commands;
use sqlx::postgres::PgPoolOptions;

async fn pool() -> sqlx::PgPool {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    PgPoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await
        .unwrap()
}

/// Inserts a row directly into `uncredited_deposits` and returns its id.
async fn seed_row(pool: &sqlx::PgPool, reason: &str) -> i64 {
    let payload = serde_json::json!({
        "reference": format!("stellar:test:{}:{}", reason, uuid::Uuid::new_v4()),
        "address": "MABC",
        "amount_minor": 10_000_000i64,
        "asset": "Xlm",
        "confirmations": 1
    });
    sqlx::query_scalar(
        r#"
        INSERT INTO uncredited_deposits (reason, raw_payload)
        VALUES ($1, $2)
        RETURNING id
        "#,
    )
    .bind(reason)
    .bind(&payload)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Returns the status of a row by id.
async fn status(pool: &sqlx::PgPool, id: i64) -> String {
    sqlx::query_scalar("SELECT status FROM uncredited_deposits WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore]
async fn list_returns_pending_investigation_rows() {
    let pool = pool().await;
    let id = seed_row(&pool, "unknown_recipient").await;

    let rows = dlq_commands::list(&pool).await.unwrap();

    assert!(
        rows.iter().any(|r| r.id == id),
        "seeded row {id} must appear in list()"
    );
    for row in &rows {
        assert_eq!(row.status, "pending_investigation");
    }

    // cleanup
    sqlx::query("DELETE FROM uncredited_deposits WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore]
async fn list_excludes_resolved_rows() {
    let pool = pool().await;
    let id = seed_row(&pool, "other:test").await;
    sqlx::query("UPDATE uncredited_deposits SET status = 'resolved' WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

    let rows = dlq_commands::list(&pool).await.unwrap();

    assert!(
        !rows.iter().any(|r| r.id == id),
        "resolved row {id} must not appear in list()"
    );

    sqlx::query("DELETE FROM uncredited_deposits WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore]
async fn resolve_marks_row_resolved() {
    let pool = pool().await;
    let id = seed_row(&pool, "unknown_recipient").await;

    dlq_commands::resolve(&pool, id, "account was created after the fact")
        .await
        .unwrap();

    assert_eq!(status(&pool, id).await, "resolved");

    sqlx::query("DELETE FROM uncredited_deposits WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore]
async fn resolve_rejects_non_pending_row() {
    let pool = pool().await;
    let id = seed_row(&pool, "unknown_recipient").await;

    // Resolve it once.
    dlq_commands::resolve(&pool, id, "first resolution").await.unwrap();

    // Trying to resolve again must fail.
    let err = dlq_commands::resolve(&pool, id, "second resolution")
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains("resolved"),
        "error message should mention status: {err}"
    );

    sqlx::query("DELETE FROM uncredited_deposits WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore]
async fn resolve_missing_id_returns_error() {
    let pool = pool().await;
    let err = dlq_commands::resolve(&pool, i64::MAX, "note").await.unwrap_err();
    assert!(
        err.to_string().contains("not found"),
        "error should mention not found: {err}"
    );
}

#[tokio::test]
#[ignore]
async fn reprocess_rejects_non_pending_row() {
    use engipay_chain::deposit_creditor::DepositCreditor;
    let pool = pool().await;
    let id = seed_row(&pool, "unknown_recipient").await;
    dlq_commands::resolve(&pool, id, "pre-resolved").await.unwrap();

    let creditor = DepositCreditor::new(pool.clone());
    let err = dlq_commands::reprocess(&pool, id, &creditor)
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains("resolved"),
        "error should mention status: {err}"
    );

    sqlx::query("DELETE FROM uncredited_deposits WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore]
async fn reprocess_missing_id_returns_error() {
    use engipay_chain::deposit_creditor::DepositCreditor;
    let pool = pool().await;
    let creditor = DepositCreditor::new(pool.clone());
    let err = dlq_commands::reprocess(&pool, i64::MAX, &creditor)
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains("not found"),
        "error should mention not found: {err}"
    );
}
