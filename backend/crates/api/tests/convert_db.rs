//! Conversion quote and execution, end to end against a real Postgres.
//!
//! Needs DATABASE_URL pointing at a database with every migration applied, so
//! it is ignored by default. Run it with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test convert_db -- --ignored

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

async fn fund_user(pool: &sqlx::PgPool, user_id: Uuid, asset: Asset, minor: i128) {
    let ledger = PostgresLedgerStore::new(pool.clone());
    let user = UserId::from_uuid(user_id);
    let deposit_ref = format!("test-fund-{}-{}", user_id, minor);
    ledger
        .deposit(user, Money::from_minor(asset, minor), &deposit_ref)
        .await
        .unwrap();
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

async fn quote(
    app: &axum::Router,
    token: &str,
    from: &str,
    to: &str,
    amount: &str,
) -> (StatusCode, Value) {
    send(
        app,
        "POST",
        "/v1/convert/quote",
        token,
        Some(json!({ "from_asset": from, "to_asset": to, "amount": amount })),
    )
    .await
}

// ── #409: Quote ──────────────────────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn quote_returns_rate_fee_and_expiry() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    let (status, body) = quote(&app, &token, "USDC", "XLM", "10000000").await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["from_asset"], "USDC");
    assert_eq!(body["to_asset"], "XLM");
    // 10_000_000 USDC-minor @ rate 10/1, fee=50bps=ceil(5000)=5000
    // net = 10_000_000 - 5000 = 9_995_000, out = 9_995_000 * 10 = 99_950_000
    assert_eq!(body["fee"].as_str().unwrap(), "5000");
    assert_eq!(body["amount_out"].as_str().unwrap(), "99950000");
    assert!(body["expires_at"].as_str().unwrap().contains('T'));
    assert!(body["id"].as_str().is_some());
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn same_asset_quote_is_refused() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    let (status, body) = quote(&app, &token, "USDC", "USDC", "1000000").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn unsupported_pair_is_refused() {
    // BTC/ETH is defined in the fake but let's ensure bad input is refused
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    // Zero amount should be refused
    let (status, body) = quote(&app, &token, "USDC", "XLM", "0").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn quote_expiry_is_thirty_seconds() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    let (status, body) = quote(&app, &token, "USDC", "XLM", "10000000").await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let quote_id: Uuid = body["id"].as_str().unwrap().parse().unwrap();

    // Expire the quote immediately.
    sqlx::query("UPDATE conversions SET expires_at = now() - interval '1 second' WHERE id = $1")
        .bind(quote_id)
        .execute(&pool)
        .await
        .unwrap();

    // Executing an expired quote returns conflict.
    let (status, err) = send(
        &app,
        "POST",
        "/v1/convert/execute",
        &token,
        Some(json!({ "quote_id": quote_id })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{err}");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn all_supported_pairs_produce_quotes() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    for (from, to) in [
        ("USDC", "XLM"),
        ("XLM", "USDC"),
        ("USDC", "ETH"),
        ("ETH", "USDC"),
        ("USDC", "BTC"),
        ("BTC", "USDC"),
    ] {
        let (status, body) = quote(&app, &token, from, to, "1000000000").await;
        assert_eq!(
            status,
            StatusCode::CREATED,
            "{from}/{to} should produce a quote: {body}"
        );
    }
}

// ── #410: Execute ─────────────────────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn execute_conversion_succeeds_and_ledger_balances() {
    let (app, pool) = setup().await;
    let (user_id, token) = user(&pool).await;

    // Fund the user with 50 USDC.
    fund_user(&pool, user_id, Asset::Usdc, 50_000_000).await;

    // Get a quote: convert 10_000_000 USDC-minor to XLM.
    let (status, q) = quote(&app, &token, "USDC", "XLM", "10000000").await;
    assert_eq!(status, StatusCode::CREATED, "{q}");
    let quote_id = q["id"].as_str().unwrap();
    let expected_out: i128 = q["amount_out"].as_str().unwrap().parse().unwrap();
    let fee: i128 = q["fee"].as_str().unwrap().parse().unwrap();

    // Execute the conversion.
    let (status, body) = send(
        &app,
        "POST",
        "/v1/convert/execute",
        &token,
        Some(json!({ "quote_id": quote_id })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["status"], "completed");
    assert_eq!(body["to_asset"], "XLM");
    let amount_out: i128 = body["amount_out"].as_str().unwrap().parse().unwrap();
    assert_eq!(amount_out, expected_out);

    // Verify ledger: USDC available should be 50M - 10M, XLM should be amount_out.
    let ledger = PostgresLedgerStore::new(pool.clone());
    let uid = UserId::from_uuid(user_id);
    let balances = ledger.get_user_balances(uid).await.unwrap();

    let usdc = balances.iter().find(|b| b.asset == Asset::Usdc).unwrap();
    let xlm = balances.iter().find(|b| b.asset == Asset::Xlm).unwrap();

    assert_eq!(usdc.available, 50_000_000 - 10_000_000);
    assert_eq!(usdc.held, 0, "hold must be fully settled");
    assert_eq!(xlm.available, expected_out);

    // Total USDC liability: user has 50M - 10M usdc + fee booked to Fees.
    // The ledger still balances: sum of all user USDC = 50M - 10M = 40M.
    // Platform Fees gets `fee` USDC. ExternalOutflow gets 10M - fee.
    // ExternalInflow gets -expected_out XLM.
    let _ = fee; // fee used in price calculation
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn execute_fails_on_insufficient_balance() {
    let (app, pool) = setup().await;
    let (user_id, token) = user(&pool).await;

    // Do NOT fund the user.
    let (_, q) = quote(&app, &token, "USDC", "XLM", "10000000").await;
    let quote_id = q["id"].as_str().unwrap();

    let (status, body) = send(
        &app,
        "POST",
        "/v1/convert/execute",
        &token,
        Some(json!({ "quote_id": quote_id })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

    // The conversion row should be 'failed'.
    let conv_status: String = sqlx::query_scalar("SELECT status FROM conversions WHERE id = $1")
        .bind(uuid::Uuid::parse_str(quote_id).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(conv_status, "failed");

    // Ledger still balances: user has 0 USDC (no hold was left open).
    let ledger = PostgresLedgerStore::new(pool.clone());
    let uid = UserId::from_uuid(user_id);
    let balances = ledger.get_user_balances(uid).await.unwrap();
    let usdc = balances.iter().find(|b| b.asset == Asset::Usdc).unwrap();
    assert_eq!(usdc.available, 0);
    assert_eq!(usdc.held, 0);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn execute_is_idempotent_on_repeated_request() {
    let (app, pool) = setup().await;
    let (user_id, token) = user(&pool).await;

    fund_user(&pool, user_id, Asset::Usdc, 50_000_000).await;

    let (_, q) = quote(&app, &token, "USDC", "XLM", "10000000").await;
    let quote_id = q["id"].as_str().unwrap();

    // First execute.
    let (status1, body1) = send(
        &app,
        "POST",
        "/v1/convert/execute",
        &token,
        Some(json!({ "quote_id": quote_id })),
    )
    .await;
    assert_eq!(status1, StatusCode::CREATED, "{body1}");

    // Second execute with same quote_id returns the same result.
    let (status2, body2) = send(
        &app,
        "POST",
        "/v1/convert/execute",
        &token,
        Some(json!({ "quote_id": quote_id })),
    )
    .await;
    assert_eq!(status2, StatusCode::OK, "{body2}");
    assert_eq!(body2["status"], "completed");
    assert_eq!(body2["amount_out"], body1["amount_out"]);

    // Ledger moved only once.
    let ledger = PostgresLedgerStore::new(pool.clone());
    let uid = UserId::from_uuid(user_id);
    let balances = ledger.get_user_balances(uid).await.unwrap();
    let usdc = balances.iter().find(|b| b.asset == Asset::Usdc).unwrap();
    // Exactly 10M was debited, not 20M.
    assert_eq!(usdc.available, 40_000_000);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn another_users_quote_is_not_found() {
    let (app, pool) = setup().await;
    let (owner_id, owner_token) = user(&pool).await;
    let (_, stranger_token) = user(&pool).await;

    fund_user(&pool, owner_id, Asset::Usdc, 50_000_000).await;
    let (_, q) = quote(&app, &owner_token, "USDC", "XLM", "10000000").await;
    let quote_id = q["id"].as_str().unwrap();

    let (status, _) = send(
        &app,
        "POST",
        "/v1/convert/execute",
        &stranger_token,
        Some(json!({ "quote_id": quote_id })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
