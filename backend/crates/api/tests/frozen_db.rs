//! Frozen account checks, end to end against a real Postgres.
//!
//! Regression tests for #624: every money-moving endpoint must refuse a frozen
//! account.  Needs DATABASE_URL.  Run with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test frozen_db -- --ignored

#![allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::auth::jwt::create_token;
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, config::Config, router};
use engipay_core::{Asset, Money, UserId};
use engipay_ledger::postgres::PostgresLedgerStore;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

async fn setup() -> (axum::Router, sqlx::PgPool) {
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
    (app, pool)
}

async fn user(pool: &sqlx::PgPool) -> (Uuid, String) {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id) VALUES ($1)")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO user_profiles (id) VALUES ($1)")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    let token = create_token(id, String::new(), Config::for_tests().jwt_secret.as_bytes()).unwrap();
    (id, token)
}

async fn fund_user(pool: &sqlx::PgPool, user_id: Uuid) {
    let ledger = PostgresLedgerStore::new(pool.clone());
    let uid = UserId::from_uuid(user_id);
    ledger
        .deposit(uid, Money::from_minor(Asset::Usdc, 100_000_000), &format!("test-fund-{}", user_id))
        .await
        .unwrap();
}

async fn freeze_user(pool: &sqlx::PgPool, user_id: Uuid) {
    sqlx::query("UPDATE user_profiles SET frozen = true WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn post_json(app: &axum::Router, path: &str, token: &str, body: Value) -> StatusCode {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    response.status()
}

// ── #650: Frozen accounts refused by every money-moving endpoint ──────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn frozen_account_cannot_transfer() {
    let (app, pool) = setup().await;
    let (user_id, token) = user(&pool).await;
    fund_user(&pool, user_id).await;
    freeze_user(&pool, user_id).await;

    let status = post_json(
        &app,
        "/v1/transfers",
        &token,
        json!({ "destination": "GDEST...", "asset": "USDC", "amount": "1000000" }),
    )
    .await;
    assert!(status.is_client_error(), "frozen account transfer expected 4xx, got {status}");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn frozen_account_cannot_withdraw() {
    let (app, pool) = setup().await;
    let (user_id, token) = user(&pool).await;
    fund_user(&pool, user_id).await;
    freeze_user(&pool, user_id).await;

    let status = post_json(
        &app,
        "/v1/withdrawals",
        &token,
        json!({ "asset": "USDC", "amount": "1000000", "destination": "GDEST..." }),
    )
    .await;
    assert!(status.is_client_error(), "frozen account withdrawal expected 4xx, got {status}");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn frozen_account_cannot_send_payment_request() {
    let (app, pool) = setup().await;
    let (user_id, token) = user(&pool).await;
    fund_user(&pool, user_id).await;
    freeze_user(&pool, user_id).await;

    let status = post_json(
        &app,
        "/v1/payment-requests",
        &token,
        json!({ "asset": "USDC", "amount": "1000000" }),
    )
    .await;
    assert!(status.is_client_error(), "frozen account payment-request expected 4xx, got {status}");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn frozen_account_cannot_naira_withdraw() {
    let (app, pool) = setup().await;
    let (user_id, token) = user(&pool).await;
    fund_user(&pool, user_id).await;
    freeze_user(&pool, user_id).await;

    let status = post_json(
        &app,
        "/v1/naira/withdrawals",
        &token,
        json!({ "amount_kobo": 100, "bank_account_id": Uuid::new_v4() }),
    )
    .await;
    assert!(status.is_client_error(), "frozen account naira withdrawal expected 4xx, got {status}");
}
