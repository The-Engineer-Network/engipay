//! Regression test for #622: accepting a money request moves the amount
//! exactly once (#646).
//!
//! Drives `POST /v1/money-requests/:id/accept` against a real Postgres and
//! checks ledger balances directly, rather than trusting the HTTP response
//! alone: a second accept with the *same* idempotency key must be a no-op,
//! and a third accept with a *different* key (after the request is already
//! resolved) must also move nothing.
//!
//! Needs DATABASE_URL pointing at a database with every migration applied,
//! so it is ignored by default. Run it with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test money_requests_accept_db -- --ignored

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, auth::jwt::create_token, config::Config, router};
use engipay_core::{Asset, Money, UserId};
use engipay_ledger::postgres::PostgresLedgerStore;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

async fn setup() -> (axum::Router, sqlx::PgPool, Config) {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .unwrap();
    let config = Config::for_tests();
    let app = router(
        AppState::with_fakes(Some(pool.clone()), config.clone(), RateLimiter::new()),
        &config,
    );
    (app, pool, config)
}

async fn insert_user(pool: &sqlx::PgPool) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id) VALUES ($1)")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    id
}

/// Inserts a pending money request directly, bypassing `POST
/// /v1/money-requests` (out of scope here; see #646).
///
/// `payer` is `recipient_id` in the schema — the person the request was
/// addressed to, who pays on accept. `payee` is `requester_id` — the person
/// who asked to be paid and receives the money.
async fn insert_request(pool: &sqlx::PgPool, payer: Uuid, payee: Uuid, amount_minor: i128) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO p2p_money_requests
             (id, requester_id, recipient_id, recipient_tag, asset, amount, expires_at)
         VALUES ($1, $2, $3, 'payer', 'USDC', $4, now() + interval '1 hour')",
    )
    .bind(id)
    .bind(payee)
    .bind(payer)
    .bind(amount_minor.to_string())
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn available_balance(pool: &sqlx::PgPool, user: Uuid) -> i128 {
    let store = PostgresLedgerStore::new(pool.clone());
    store
        .get_user_balances(UserId::from_uuid(user))
        .await
        .unwrap()
        .into_iter()
        .find(|b| b.asset == Asset::Usdc)
        .unwrap()
        .available
}

async fn accept(
    app: &axum::Router,
    token: &str,
    request_id: Uuid,
    idempotency_key: Uuid,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/money-requests/{request_id}/accept"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(
                    json!({ "idempotency_key": idempotency_key }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn accepting_twice_with_the_same_key_moves_the_amount_once() {
    let (app, pool, config) = setup().await;
    let (payer, payee) = (insert_user(&pool).await, insert_user(&pool).await);

    let store = PostgresLedgerStore::new(pool.clone());
    store
        .deposit(
            UserId::from_uuid(payer),
            Money::from_minor(Asset::Usdc, 1_000),
            &format!("seed-{}", Uuid::new_v4()),
        )
        .await
        .unwrap();

    let amount = 300_i128;
    let request_id = insert_request(&pool, payer, payee, amount).await;
    let token = create_token(payer, String::new(), config.jwt_secret.as_bytes()).unwrap();
    let key = Uuid::new_v4();

    let (status, body) = accept(&app, &token, request_id, key).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(available_balance(&pool, payer).await, 1_000 - amount);
    assert_eq!(available_balance(&pool, payee).await, amount);

    // Same key again: must be a no-op, not a second transfer.
    let (status, body) = accept(&app, &token, request_id, key).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(available_balance(&pool, payer).await, 1_000 - amount);
    assert_eq!(available_balance(&pool, payee).await, amount);

    // A different key on an already-resolved request must also move nothing.
    let other_key = Uuid::new_v4();
    let (status, _) = accept(&app, &token, request_id, other_key).await;
    assert_ne!(
        status,
        StatusCode::OK,
        "a resolved request must not accept again"
    );
    assert_eq!(available_balance(&pool, payer).await, 1_000 - amount);
    assert_eq!(available_balance(&pool, payee).await, amount);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn accept_without_enough_balance_moves_nothing() {
    let (app, pool, config) = setup().await;
    let (payer, payee) = (insert_user(&pool).await, insert_user(&pool).await);

    // No deposit: the payer has a zero balance.
    let request_id = insert_request(&pool, payer, payee, 50).await;
    let token = create_token(payer, String::new(), config.jwt_secret.as_bytes()).unwrap();

    let (status, _) = accept(&app, &token, request_id, Uuid::new_v4()).await;
    assert_ne!(status, StatusCode::OK);
    assert_eq!(available_balance(&pool, payer).await, 0);
    assert_eq!(available_balance(&pool, payee).await, 0);

    let status_after: String =
        sqlx::query_scalar("SELECT status FROM p2p_money_requests WHERE id = $1")
            .bind(request_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        status_after, "pending",
        "an unfunded accept must not resolve the request"
    );
}
