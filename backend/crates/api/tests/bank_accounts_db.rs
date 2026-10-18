//! Payout bank accounts, end to end against a real Postgres.
//!
//! Needs DATABASE_URL pointing at a database with every migration applied, so
//! it is ignored by default. Run it with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test bank_accounts_db -- --ignored

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

async fn setup() -> (axum::Router, sqlx::PgPool) {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .unwrap();
    let config = Config::for_tests();
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

async fn send(
    app: &axum::Router,
    method: &str,
    path: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(header::AUTHORIZATION, format!("Bearer {token}"));
    let body = match body {
        Some(json) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            Body::from(json.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(builder.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// Stores an account the way the payout partner's name check would: with a
/// confirmed name. Adding through the API is not possible until that check exists.
async fn verified_account(pool: &sqlx::PgPool, user_id: Uuid, number: &str) -> String {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO bank_accounts (id, user_id, bank_code, account_number, account_name, verified) \
         VALUES ($1, $2, '044', $3, 'TEST ACCOUNT HOLDER', true)",
    )
    .bind(id)
    .bind(user_id)
    .bind(number)
    .execute(pool)
    .await
    .unwrap();
    id.to_string()
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn adding_an_account_waits_for_the_name_check() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    let (status, body) = send(
        &app,
        "POST",
        "/v1/bank-accounts",
        &token,
        Some(json!({ "bank_code": "044", "account_number": "0123456789" })),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    assert_eq!(body["error"]["code"], "unavailable");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_verified_account_is_listed_and_removed() {
    let (app, pool) = setup().await;
    let (user_id, token) = user(&pool).await;
    let id = verified_account(&pool, user_id, "0123456789").await;

    let (status, list) = send(&app, "GET", "/v1/bank-accounts", &token, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list[0]["account_number_last4"], "6789");
    assert_eq!(list[0]["account_name"], "TEST ACCOUNT HOLDER");
    assert_eq!(list[0]["verified"], true);

    let (status, _) = send(
        &app,
        "DELETE",
        &format!("/v1/bank-accounts/{id}"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn another_users_account_cannot_be_removed() {
    let (app, pool) = setup().await;
    let (owner_id, _) = user(&pool).await;
    let (_, stranger) = user(&pool).await;
    let id = verified_account(&pool, owner_id, "1111111111").await;

    let (status, _) = send(
        &app,
        "DELETE",
        &format!("/v1/bank-accounts/{id}"),
        &stranger,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (_, list) = send(&app, "GET", "/v1/bank-accounts", &stranger, None).await;
    assert!(list.as_array().unwrap().is_empty());
}
