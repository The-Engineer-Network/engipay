//! Batch payment idempotency, end to end against a real Postgres.
//!
//! Regression test for #625: re-running a batch execute must never pay a row
//! twice.  Needs DATABASE_URL pointing at a database with every migration
//! applied.  Run it with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test batch_idempotency_db -- --ignored

#![allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::auth::jwt::create_token;
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, config::Config, router};
use engipay_core::{Asset, Money, UserId};
use engipay_ledger::postgres::PostgresLedgerStore;
use http_body_util::BodyExt;
use serde_json::Value;
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

async fn fund_user(pool: &sqlx::PgPool, user_id: Uuid, asset: Asset, minor: i128) {
    let ledger = PostgresLedgerStore::new(pool.clone());
    let uid = UserId::from_uuid(user_id);
    let deposit_ref = format!("test-fund-{}-{}", user_id, minor);
    ledger
        .deposit(uid, Money::from_minor(asset, minor), &deposit_ref)
        .await
        .unwrap();
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    token: &str,
    body: Body,
    content_type: Option<&str>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(header::AUTHORIZATION, format!("Bearer {token}"));
    if let Some(ct) = content_type {
        builder = builder.header(header::CONTENT_TYPE, ct);
    }
    let response = app
        .clone()
        .oneshot(builder.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

// ── #648: Batch idempotency ──────────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn batch_execute_never_pays_row_twice() {
    let (app, pool) = setup().await;
    let (user_id, token) = user(&pool).await;

    // Fund the user so the batch rows can be paid.
    fund_user(&pool, user_id, Asset::Usdc, 100_000_000).await;

    // Build a one-row CSV batch.
    let boundary = "----TestBatchBoundary";
    let csv = "destination,asset,amount\ntest-recipient-addr,USDC,0.0000001\n";
    let multipart_body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"csv\"; filename=\"batch.csv\"\r\nContent-Type: text/csv\r\n\r\n{csv}\r\n--{boundary}--\r\n"
    );

    let (status, body) = json_request(
        &app,
        "POST",
        "/v1/batch-payments",
        &token,
        Body::from(multipart_body),
        Some(&format!("multipart/form-data; boundary={boundary}")),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "upload failed: {body}");
    let batch_id = body["batch_id"].as_str().unwrap_or_else(|| body["id"].as_str().unwrap());
    let batch_id = batch_id.to_owned();

    let ledger = PostgresLedgerStore::new(pool.clone());
    let uid = UserId::from_uuid(user_id);

    let bal_before = {
        let bals = ledger.get_user_balances(uid).await.unwrap();
        bals.iter().find(|b| b.asset == Asset::Usdc).map(|b| b.available).unwrap_or(0)
    };

    // First execute.
    let (s1, r1) = json_request(
        &app,
        "POST",
        &format!("/v1/batch-payments/{batch_id}/execute"),
        &token,
        Body::empty(),
        None,
    )
    .await;
    assert!(s1.is_success(), "first execute failed: {r1}");

    let bal_after_first = {
        let bals = ledger.get_user_balances(uid).await.unwrap();
        bals.iter().find(|b| b.asset == Asset::Usdc).map(|b| b.available).unwrap_or(0)
    };

    // Second execute — must be a no-op.
    let (s2, r2) = json_request(
        &app,
        "POST",
        &format!("/v1/batch-payments/{batch_id}/execute"),
        &token,
        Body::empty(),
        None,
    )
    .await;
    assert!(s2.is_success(), "second execute failed: {r2}");

    let bal_after_second = {
        let bals = ledger.get_user_balances(uid).await.unwrap();
        bals.iter().find(|b| b.asset == Asset::Usdc).map(|b| b.available).unwrap_or(0)
    };

    let debited_first = bal_before - bal_after_first;
    let debited_second = bal_after_first - bal_after_second;

    assert!(debited_first > 0, "expected first execute to debit something");
    assert_eq!(debited_second, 0, "second execute debited funds again (not idempotent)");
}
