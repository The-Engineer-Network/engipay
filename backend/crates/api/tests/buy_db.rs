//! Naira buy quotes and orders, end to end against a real Postgres.
//!
//! Needs DATABASE_URL pointing at a database with every migration applied, so
//! it is ignored by default. Run it with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test buy_db -- --ignored

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::auth::jwt::create_token;
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, config::Config, router};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

/// Terms the tests price with: ₦1,500 per USDC, 1% fee.
const KOBO_PER_USDC: i128 = 150_000;
const FEE_BPS: u32 = 100;

async fn setup() -> (axum::Router, sqlx::PgPool) {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .unwrap();
    let mut config = Config::for_tests();
    config.buy_kobo_per_usdc = Some(KOBO_PER_USDC);
    config.buy_fee_bps = Some(FEE_BPS);
    let app = router(
        AppState {
            database: Some(pool.clone()),
            config: config.clone(),
            rate_limiter: RateLimiter::new(),
        },
        &config,
    );
    (app, pool)
}

/// Makes a user and a session token for them.
async fn user(pool: &sqlx::PgPool) -> (Uuid, String) {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id) VALUES ($1)")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    let token = create_token(id, String::new(), Config::for_tests().jwt_secret.as_bytes()).unwrap();
    (id, token)
}

async fn post(app: &axum::Router, path: &str, token: &str, body: Value) -> (StatusCode, Value) {
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn quote(app: &axum::Router, token: &str, naira: &str) -> (StatusCode, Value) {
    post(
        app,
        "/v1/buy/quotes",
        token,
        json!({ "naira_amount": naira, "asset": "USDC" }),
    )
    .await
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_quote_becomes_one_order_and_cannot_be_reused() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    let (status, body) = quote(&app, &token, "5000").await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    // ₦5,000 less 1% fee leaves ₦4,950 = 495_000 kobo; at 150_000 kobo per USDC
    // that is 3.3 USDC.
    assert_eq!(body["receive"], "3.3000000");
    assert_eq!(body["fee_kobo"], "5000");
    let quote_id = body["id"].as_str().unwrap().to_string();

    let (status, order) = post(
        &app,
        "/v1/buy/orders",
        &token,
        json!({ "quote_id": quote_id }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{order}");
    assert_eq!(order["status"], "awaiting_partner");

    let (status, again) = post(
        &app,
        "/v1/buy/orders",
        &token,
        json!({ "quote_id": quote_id }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{again}");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn an_expired_quote_cannot_become_an_order() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    let (_, body) = quote(&app, &token, "5000").await;
    let quote_id: Uuid = body["id"].as_str().unwrap().parse().unwrap();
    sqlx::query("UPDATE buy_quotes SET expires_at = now() - interval '1 second' WHERE id = $1")
        .bind(quote_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, order) = post(
        &app,
        "/v1/buy/orders",
        &token,
        json!({ "quote_id": quote_id }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{order}");
    assert_eq!(order["error"]["code"], "conflict");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn another_users_quote_is_not_found() {
    let (app, pool) = setup().await;
    let (_, owner) = user(&pool).await;
    let (_, stranger) = user(&pool).await;

    let (_, body) = quote(&app, &owner, "5000").await;
    let quote_id = body["id"].as_str().unwrap();

    let (status, _) = post(
        &app,
        "/v1/buy/orders",
        &stranger,
        json!({ "quote_id": quote_id }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
