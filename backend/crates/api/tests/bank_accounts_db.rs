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
        AppState::with_fakes(Some(pool.clone()), config.clone(), RateLimiter::new()),
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

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn add_list_and_remove_a_bank_account() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    // Add an account — FakeBankNameCheck always succeeds.
    let (status, body) = send(
        &app,
        "POST",
        "/v1/bank-accounts",
        &token,
        Some(json!({ "bank_code": "044", "account_number": "0123456789" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["account_number_last4"], "6789");
    assert!(!body["account_name"].as_str().unwrap().is_empty());
    assert_eq!(body["verified"], true);
    let id = body["id"].as_str().unwrap().to_string();

    // List — only the last 4 digits are returned.
    let (status, list) = send(&app, "GET", "/v1/bank-accounts", &token, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list[0]["account_number_last4"], "6789");
    assert_eq!(list[0]["account_name"], body["account_name"]);

    // Remove.
    let (status, _) = send(
        &app,
        "DELETE",
        &format!("/v1/bank-accounts/{id}"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Gone.
    let (_, empty) = send(&app, "GET", "/v1/bank-accounts", &token, None).await;
    assert!(empty.as_array().unwrap().is_empty());
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn full_account_number_never_returned() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    send(
        &app,
        "POST",
        "/v1/bank-accounts",
        &token,
        Some(json!({ "bank_code": "044", "account_number": "9876543210" })),
    )
    .await;

    let (_, list) = send(&app, "GET", "/v1/bank-accounts", &token, None).await;
    let item = &list[0];
    // Only last4 key exists; no full number in response.
    assert!(item.get("account_number").is_none());
    assert_eq!(item["account_number_last4"], "3210");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn invalid_account_number_is_rejected() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    // Too short
    let (status, body) = send(
        &app,
        "POST",
        "/v1/bank-accounts",
        &token,
        Some(json!({ "bank_code": "044", "account_number": "012345678" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

    // Letters
    let (status, body) = send(
        &app,
        "POST",
        "/v1/bank-accounts",
        &token,
        Some(json!({ "bank_code": "044", "account_number": "012345678a" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn another_users_account_cannot_be_removed() {
    let (app, pool) = setup().await;
    let (owner_id, _) = user(&pool).await;
    let (_, stranger) = user(&pool).await;

    // Insert directly so we don't depend on add flow.
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO bank_accounts (id, user_id, bank_code, account_number, account_name, verified) \
         VALUES ($1, $2, '044', '1111111111', 'TEST ACCOUNT HOLDER', true)",
    )
    .bind(id)
    .bind(owner_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, _) = send(
        &app,
        "DELETE",
        &format!("/v1/bank-accounts/{id}"),
        &stranger,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // The owner's list is unaffected.
    let (_, list) = send(&app, "GET", "/v1/bank-accounts", &stranger, None).await;
    assert!(list.as_array().unwrap().is_empty());
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_user_sees_only_their_own_accounts() {
    let (app, pool) = setup().await;
    let (user1_id, token1) = user(&pool).await;
    let (user2_id, token2) = user(&pool).await;

    // Insert one account per user directly.
    for (uid, num) in [(user1_id, "1111111111"), (user2_id, "2222222222")] {
        sqlx::query(
            "INSERT INTO bank_accounts (id, user_id, bank_code, account_number, account_name, verified) \
             VALUES (gen_random_uuid(), $1, '044', $2, 'TEST', true)",
        )
        .bind(uid)
        .bind(num)
        .execute(&pool)
        .await
        .unwrap();
    }

    let (_, list1) = send(&app, "GET", "/v1/bank-accounts", &token1, None).await;
    let (_, list2) = send(&app, "GET", "/v1/bank-accounts", &token2, None).await;

    assert_eq!(list1.as_array().unwrap().len(), 1);
    assert_eq!(list2.as_array().unwrap().len(), 1);
    assert_eq!(list1[0]["account_number_last4"], "1111");
    assert_eq!(list2[0]["account_number_last4"], "2222");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn adding_same_account_twice_is_idempotent() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    let req = json!({ "bank_code": "044", "account_number": "0123456789" });

    let (s1, _) = send(&app, "POST", "/v1/bank-accounts", &token, Some(req.clone())).await;
    let (s2, _) = send(&app, "POST", "/v1/bank-accounts", &token, Some(req)).await;

    assert_eq!(s1, StatusCode::CREATED);
    // ON CONFLICT DO UPDATE returns the same row — CREATED or OK both acceptable.
    assert!(
        s2 == StatusCode::CREATED || s2 == StatusCode::OK,
        "second add: {s2}"
    );

    let (_, list) = send(&app, "GET", "/v1/bank-accounts", &token, None).await;
    assert_eq!(list.as_array().unwrap().len(), 1, "must not duplicate");
}
