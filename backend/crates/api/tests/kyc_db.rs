//! KYC verification session, end to end against a real Postgres.
//!
//! Needs DATABASE_URL pointing at a database with every migration applied, so
//! it is ignored by default. Run it with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test kyc_db -- --ignored

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::auth::jwt::create_token;
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, config::Config, router};
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

async fn post_session(app: &axum::Router, token: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/kyc/session")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
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
async fn verified_outcome_raises_tier() {
    let (app, pool) = setup().await;
    let (user_id, token) = user(&pool).await;

    // Start at tier 0.
    let tier_before: i32 = sqlx::query_scalar("SELECT tier FROM user_profiles WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tier_before, 0);

    // FakeKycProvider returns Verified { tier: 1 }.
    let (status, body) = post_session(&app, &token).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["outcome"], "verified");
    assert_eq!(body["tier"], 1);

    // Database tier should be updated.
    let tier_after: i32 = sqlx::query_scalar("SELECT tier FROM user_profiles WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tier_after, 1);

    // Audit record written without PII.
    let audit: (String, i32, i32) = sqlx::query_as(
        "SELECT outcome, tier_before, tier_after FROM kyc_sessions WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit.0, "verified");
    assert_eq!(audit.1, 0);
    assert_eq!(audit.2, 1);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn tier_only_changes_on_verified_outcome() {
    // Swap in a failing provider by building a custom state.
    use engipay_api::services::kyc_provider::FakeKycProviderFails;
    use std::sync::Arc;

    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .unwrap();
    let config = Config::for_tests();
    let mut state = AppState::with_fakes(Some(pool.clone()), config.clone(), RateLimiter::new());
    state.kyc_provider = Arc::new(FakeKycProviderFails);
    let app = router(state, &config);

    let user_id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id) VALUES ($1)")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO user_profiles (id) VALUES ($1)")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let token = create_token(
        user_id,
        String::new(),
        Config::for_tests().jwt_secret.as_bytes(),
    )
    .unwrap();

    let (status, body) = post_session(&app, &token).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["outcome"], "failed");
    assert_eq!(body["tier"], 0, "failed outcome must not raise tier");

    let tier: i32 = sqlx::query_scalar("SELECT tier FROM user_profiles WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tier, 0);

    // Audit still records the failed outcome.
    let audit_outcome: String =
        sqlx::query_scalar("SELECT outcome FROM kyc_sessions WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(audit_outcome, "failed");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn tier_is_never_lowered() {
    let (app, pool) = setup().await;
    let (user_id, token) = user(&pool).await;

    // Manually set tier to 2.
    sqlx::query("UPDATE user_profiles SET tier = 2 WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();

    // FakeKycProvider returns Verified { tier: 1 } which is lower than 2.
    let (status, body) = post_session(&app, &token).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    // outcome is "verified" but tier stays at 2.
    assert_eq!(body["tier"], 2, "tier must not be lowered");

    let tier: i32 = sqlx::query_scalar("SELECT tier FROM user_profiles WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tier, 2);
}
