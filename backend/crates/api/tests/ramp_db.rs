//! Naira ramp endpoints: integration tests against a real Postgres database.
//!
//! Needs DATABASE_URL pointing at a database with every migration applied.
//! Run with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test ramp_db -- --ignored

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::auth::jwt::create_token;
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::services::ramp_partner::{
    FakeRampPartner, FakeRampPartnerTerms, hmac_sha256_hex,
};
use engipay_api::{AppState, config::Config, router};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::Row;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

const WEBHOOK_SECRET: &str = "test-webhook-secret-ramp";

async fn setup() -> (axum::Router, sqlx::PgPool) {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .unwrap();
    let config = Config::for_tests();
    let partner = FakeRampPartner::new(FakeRampPartnerTerms::default(), WEBHOOK_SECRET);
    let mut state = AppState::with_fakes(Some(pool.clone()), config.clone(), RateLimiter::new());
    state.ramp_partner = Arc::new(partner);
    let app = router(state, &config);
    (app, pool)
}

async fn make_user(pool: &sqlx::PgPool) -> (Uuid, String) {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id) VALUES ($1)")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    let token =
        create_token(id, String::new(), Config::for_tests().jwt_secret.as_bytes()).unwrap();
    (id, token)
}

async fn post_json(
    app: &axum::Router,
    path: &str,
    token: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method("POST")
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(t) = token {
        req = req.header(header::AUTHORIZATION, format!("Bearer {t}"));
    }
    let response = app
        .clone()
        .oneshot(req.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn post_webhook(
    app: &axum::Router,
    payload: &str,
    signature: &str,
) -> StatusCode {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/ramp/webhook")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-ramp-signature", signature)
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    response.status()
}

// ── #405: POST /v1/ramp/quote ─────────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn quote_buy_usdc_returns_rate_fee_and_expiry() {
    let (app, pool) = setup().await;
    let (_, token) = make_user(&pool).await;

    let (status, body) = post_json(
        &app,
        "/v1/ramp/quote",
        Some(&token),
        json!({
            "direction": "on_ramp",
            "asset": "USDC",
            "crypto_amount": "10.0000000"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["asset"], "USDC");
    assert_eq!(body["direction"], "on_ramp");
    // 10 USDC × 150,000 kobo = 1,500,000 kobo
    assert_eq!(body["ngn_kobo"], "1500000");
    assert_eq!(body["rate_kobo_per_unit"], "150000");
    assert!(body["id"].as_str().is_some(), "should have a uuid id");
    assert!(body["expires_at"].as_str().is_some(), "should have expiry");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn quote_sell_unsupported_by_fake_returns_bad_request() {
    let (app, pool) = setup().await;
    let (_, token) = make_user(&pool).await;

    let (status, _) = post_json(
        &app,
        "/v1/ramp/quote",
        Some(&token),
        json!({
            "direction": "off_ramp",
            "asset": "USDC",
            "crypto_amount": "10.0000000"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn quote_unsupported_asset_returns_bad_request() {
    let (app, pool) = setup().await;
    let (_, token) = make_user(&pool).await;

    let (status, _) = post_json(
        &app,
        "/v1/ramp/quote",
        Some(&token),
        json!({
            "direction": "on_ramp",
            "asset": "ETH",
            "crypto_amount": "1.000000000000000000"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn quote_too_many_decimals_is_refused() {
    let (app, pool) = setup().await;
    let (_, token) = make_user(&pool).await;

    // USDC has 7 dp; 8 dp should be refused.
    let (status, _) = post_json(
        &app,
        "/v1/ramp/quote",
        Some(&token),
        json!({
            "direction": "on_ramp",
            "asset": "USDC",
            "crypto_amount": "1.00000001"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ── #406: POST /v1/ramp/webhook ───────────────────────────────────────────────

/// Helper: create a quoted ramp order in the DB directly (partner_ref is needed).
async fn seed_ramp_order(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    partner_ref: &str,
) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO ramp_orders
             (id, user_id, direction, asset, crypto_amount, ngn_amount, rate, fee, partner, partner_ref, status)
         VALUES ($1, $2, 'on_ramp', 'USDC', 10000000, 1500.00, 150000, 100000, 'fake', $3, 'awaiting_payment')",
    )
    .bind(id)
    .bind(user_id)
    .bind(partner_ref)
    .execute(pool)
    .await
    .unwrap();
    id
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn bad_signature_is_rejected() {
    let (app, pool) = setup().await;
    let (user_id, _) = make_user(&pool).await;
    let partner_ref = format!("fake-order-{}", Uuid::new_v4());
    seed_ramp_order(&pool, user_id, &partner_ref).await;

    let payload = json!({
        "event_id": format!("evt-{}", Uuid::new_v4()),
        "order_ref": partner_ref,
        "status": "completed"
    })
    .to_string();

    let status = post_webhook(&app, &payload, "bad-signature").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn replayed_event_is_acknowledged_and_changes_nothing() {
    let (app, pool) = setup().await;
    let (user_id, _) = make_user(&pool).await;
    let partner_ref = format!("fake-order-{}", Uuid::new_v4());
    seed_ramp_order(&pool, user_id, &partner_ref).await;

    let event_id = format!("evt-replay-{}", Uuid::new_v4());
    let payload = json!({
        "event_id": event_id,
        "order_ref": partner_ref,
        "status": "processing"
    })
    .to_string();
    let sig = hmac_sha256_hex(WEBHOOK_SECRET.as_bytes(), payload.as_bytes());

    // First delivery
    let s1 = post_webhook(&app, &payload, &sig).await;
    assert_eq!(s1, StatusCode::OK);

    // Replay — same event_id, must be a no-op.
    let s2 = post_webhook(&app, &payload, &sig).await;
    assert_eq!(s2, StatusCode::OK);

    // Only one row in webhook_events.
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM webhook_events WHERE provider = 'fake' AND event_id = $1",
    )
    .bind(&event_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn completed_webhook_credits_the_ledger_exactly_once() {
    let (app, pool) = setup().await;
    let (user_id, _) = make_user(&pool).await;
    let partner_ref = format!("fake-order-{}", Uuid::new_v4());
    seed_ramp_order(&pool, user_id, &partner_ref).await;

    let event_id = format!("evt-credit-{}", Uuid::new_v4());
    let payload = json!({
        "event_id": event_id,
        "order_ref": partner_ref,
        "status": "completed"
    })
    .to_string();
    let sig = hmac_sha256_hex(WEBHOOK_SECRET.as_bytes(), payload.as_bytes());

    // First delivery: should credit.
    let s1 = post_webhook(&app, &payload, &sig).await;
    assert_eq!(s1, StatusCode::OK);

    // Replay: no double-credit.
    let s2 = post_webhook(&app, &payload, &sig).await;
    assert_eq!(s2, StatusCode::OK);

    // Exactly one ledger credit (one row in transactions with our reference).
    let reference = format!("ramp:fake:{event_id}");
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ledger_transactions WHERE reference = $1",
    )
    .bind(&reference)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1, "ledger should have exactly one credit");

    // The user's available USDC balance reflects the credit (10_000_000 minor).
    let balance: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount), 0)::bigint
         FROM ledger_postings lp
         JOIN ledger_transactions lt ON lt.id = lp.transaction_id
         WHERE lp.owner_kind = 'user' AND lp.owner_id = $1
           AND lp.asset = 'USDC' AND lp.bucket = 'available'",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(balance, 10_000_000, "user should have 10 USDC credited");
}
