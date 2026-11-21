//! Deletion request anonymisation, end to end against a real Postgres.
//!
//! Regression tests for #635: a deletion request must anonymise profile data
//! while leaving ledger postings intact.  Needs DATABASE_URL.  Run with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test deletion_db -- --ignored

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
        .deposit(uid, Money::from_minor(Asset::Usdc, 10_000_000), &format!("test-fund-{}", user_id))
        .await
        .unwrap();
}

async fn post_json(app: &axum::Router, path: &str, token: &str, body: Value) -> (StatusCode, Value) {
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
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

// ── #649: Deletion anonymisation ─────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn deletion_anonymises_profile_tag() {
    let (app, pool) = setup().await;
    let (user_id, token) = user(&pool).await;
    fund_user(&pool, user_id).await;

    // Give the user a tag so there is something to anonymise.
    sqlx::query("UPDATE user_profiles SET tag = 'alice-to-delete' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();

    // Request deletion.
    let (status, body) = post_json(&app, "/v1/deletion-request", &token, json!({})).await;
    assert!(status.is_success(), "deletion request failed: {body}");

    // Tag must now be NULL.
    let tag: Option<String> =
        sqlx::query_scalar("SELECT tag FROM user_profiles WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(tag.is_none(), "profile tag was not cleared after deletion request");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn deletion_keeps_ledger_postings() {
    let (app, pool) = setup().await;
    let (user_id, token) = user(&pool).await;
    fund_user(&pool, user_id).await;

    let (status, body) = post_json(&app, "/v1/deletion-request", &token, json!({})).await;
    assert!(status.is_success(), "deletion request failed: {body}");

    // Ledger postings must still exist — the deposit balance should still be
    // visible after anonymisation.
    let ledger = PostgresLedgerStore::new(pool.clone());
    let uid = UserId::from_uuid(user_id);
    let balances = ledger.get_user_balances(uid).await.unwrap();
    let usdc = balances.iter().find(|b| b.asset == Asset::Usdc);
    assert!(usdc.is_some(), "ledger balance row was removed by deletion request");
    assert!(usdc.unwrap().available > 0, "ledger balance cleared by deletion request");
}
