//! Payment-request integration tests (#479): expiry, partial payments and status.
//!
//! Needs DATABASE_URL pointing at a Postgres database with every migration applied.
//! Run with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test payment_requests_db -- --ignored

#![allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]

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

// ── Test infrastructure ───────────────────────────────────────────────────────

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

/// Create a fresh user and return their id and JWT.
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

/// Fire an HTTP request and return (status, parsed JSON body).
async fn send(
    app: &axum::Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(tok) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {tok}"));
    }
    let req_body = match body {
        Some(json) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            Body::from(json.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(builder.body(req_body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// Create a payment request and return the response body.
async fn create_request(app: &axum::Router, token: &str, body: Value) -> (StatusCode, Value) {
    send(app, "POST", "/v1/payment-requests", Some(token), Some(body)).await
}

/// GET a payment request (unauthenticated – payer view).
async fn get_request(app: &axum::Router, id: &str) -> (StatusCode, Value) {
    send(
        app,
        "GET",
        &format!("/v1/payment-requests/{id}"),
        None,
        None,
    )
    .await
}

/// POST a payment against a request as the given payer.
async fn pay(app: &axum::Router, id: &str, token: &str, body: Value) -> (StatusCode, Value) {
    send(
        app,
        "POST",
        &format!("/v1/payment-requests/{id}/pay"),
        Some(token),
        Some(body),
    )
    .await
}

/// Credit a user's internal balance so they can pay.
async fn fund(pool: &sqlx::PgPool, user_id: Uuid, amount_minor: i128) {
    sqlx::query(
        "INSERT INTO balances (user_id, asset, available) VALUES ($1, 'USDC', $2) \
         ON CONFLICT (user_id, asset) DO UPDATE SET available = balances.available + $2",
    )
    .bind(user_id)
    .bind(amount_minor)
    .execute(pool)
    .await
    .unwrap();
}

/// Read a user's available internal balance for USDC.
async fn balance(pool: &sqlx::PgPool, user_id: Uuid) -> i128 {
    let row: Option<(i128,)> =
        sqlx::query_as("SELECT available FROM balances WHERE user_id = $1 AND asset = 'USDC'")
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .unwrap();
    row.map(|(v,)| v).unwrap_or(0)
}

/// Count payment rows recorded for a request.
async fn payment_count(pool: &sqlx::PgPool, request_id: &str) -> i64 {
    let (count,): (i64,) =
        sqlx::query_as("SELECT count(*) FROM payment_request_payments WHERE request_id = $1")
            .bind(uuid::Uuid::parse_str(request_id).unwrap())
            .fetch_one(pool)
            .await
            .unwrap();
    count
}

/// Force-expire a request in the database.
async fn expire_request(pool: &sqlx::PgPool, id: &str) {
    sqlx::query(
        "UPDATE payment_requests SET expires_at = now() - interval '1 second' WHERE id = $1",
    )
    .bind(uuid::Uuid::parse_str(id).unwrap())
    .execute(pool)
    .await
    .unwrap();
}

// ── #479: Exact payment ───────────────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn exact_payment_marks_request_paid() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;
    let (payer_id, payer_token) = user(&pool).await;

    let (status, body) = create_request(
        &app,
        &token,
        json!({ "asset": "USDC", "amount": "10.0000000" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();
    let requested_minor: i128 = 100_000_000; // 10 USDC × 10^7

    fund(&pool, payer_id, requested_minor).await;

    // Record an internal payment for the exact amount.
    let (pay_status, pay_body) = pay(
        &app,
        &id,
        &payer_token,
        json!({
            "amount": "10.0000000",
            "chain": "internal"
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::CREATED, "{pay_body}");
    assert_eq!(balance(&pool, payer_id).await, 0);
    assert_eq!(pay_body["request_status"], "paid");
    assert_eq!(
        pay_body["amount_paid"]
            .as_str()
            .unwrap()
            .parse::<i128>()
            .unwrap(),
        requested_minor
    );
    assert_eq!(
        pay_body["amount_remaining"]
            .as_str()
            .unwrap()
            .parse::<i128>()
            .unwrap(),
        0
    );

    // GET should reflect the paid status.
    let (get_status, get_body) = get_request(&app, &id).await;
    assert_eq!(get_status, StatusCode::OK, "{get_body}");
    assert_eq!(get_body["status"], "paid");
    assert_eq!(get_body["payments"].as_array().unwrap().len(), 1);
}

// ── #479: Partial payment ─────────────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn partial_payment_sets_partially_paid_status() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;
    let (payer_id, payer_token) = user(&pool).await;

    let (status, body) = create_request(
        &app,
        &token,
        json!({
            "asset": "USDC",
            "amount": "100.0000000",
            "allow_partial": true,
            "min_amount": "10.0000000"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();

    fund(&pool, payer_id, 1_000_000_000).await;

    // First payment: partial.
    let (pay_status, pay_body) = pay(
        &app,
        &id,
        &payer_token,
        json!({
            "amount": "40.0000000",
            "chain": "internal"
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::CREATED, "{pay_body}");
    assert_eq!(pay_body["request_status"], "partially_paid");
    assert_eq!(balance(&pool, payer_id).await, 600_000_000);

    let (get_status, get_body) = get_request(&app, &id).await;
    assert_eq!(get_status, StatusCode::OK);
    assert_eq!(get_body["status"], "partially_paid");
    let amount_paid: i128 = get_body["amount_paid"].as_str().unwrap().parse().unwrap();
    assert_eq!(amount_paid, 400_000_000); // 40 USDC
    let amount_remaining: i128 = get_body["amount_remaining"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(amount_remaining, 600_000_000); // 60 USDC remaining
    assert_eq!(get_body["payments"].as_array().unwrap().len(), 1);

    // Second payment: completes the request.
    let (pay2_status, pay2_body) = pay(
        &app,
        &id,
        &payer_token,
        json!({
            "amount": "60.0000000",
            "chain": "internal"
        }),
    )
    .await;
    assert_eq!(pay2_status, StatusCode::CREATED, "{pay2_body}");
    assert_eq!(pay2_body["request_status"], "paid");
    assert_eq!(balance(&pool, payer_id).await, 0);
    assert_eq!(
        pay2_body["amount_remaining"]
            .as_str()
            .unwrap()
            .parse::<i128>()
            .unwrap(),
        0
    );

    // Final state.
    let (_, final_body) = get_request(&app, &id).await;
    assert_eq!(final_body["status"], "paid");
    assert_eq!(final_body["payments"].as_array().unwrap().len(), 2);
}

// ── #479: Over-payment rejected ───────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn over_payment_is_rejected() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;
    let (payer_id, payer_token) = user(&pool).await;

    let (status, body) = create_request(
        &app,
        &token,
        json!({
            "asset": "USDC",
            "amount": "50.0000000",
            "allow_partial": true
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();

    fund(&pool, payer_id, 1_000_000_000).await;

    // Attempt to pay more than the requested amount.
    let (pay_status, pay_body) = pay(
        &app,
        &id,
        &payer_token,
        json!({
            "amount": "60.0000000",   // 10 more than requested
            "chain": "internal"
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::BAD_REQUEST, "{pay_body}");
    assert!(
        pay_body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("exceed")
    );

    // No payment row and no balance movement.
    assert_eq!(payment_count(&pool, &id).await, 0);
    assert_eq!(balance(&pool, payer_id).await, 1_000_000_000);

    // Request should still be open (pending).
    let (_, state_body) = get_request(&app, &id).await;
    assert_eq!(state_body["status"], "pending");
}

// ── #479: Late (expired) payment rejected ────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn late_payment_is_rejected_after_expiry() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;
    let (payer_id, payer_token) = user(&pool).await;

    let (status, body) = create_request(
        &app,
        &token,
        json!({ "asset": "USDC", "amount": "20.0000000", "expiry_minutes": 60 }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();

    fund(&pool, payer_id, 200_000_000).await;

    // Force expiry.
    expire_request(&pool, &id).await;

    // Attempt to pay.
    let (pay_status, pay_body) = pay(
        &app,
        &id,
        &payer_token,
        json!({
            "amount": "20.0000000",
            "chain": "internal"
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::BAD_REQUEST, "{pay_body}");
    assert!(
        pay_body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("expired")
    );
    assert_eq!(payment_count(&pool, &id).await, 0);
    assert_eq!(balance(&pool, payer_id).await, 200_000_000);

    // GET should show expired status.
    let (_, get_body) = get_request(&app, &id).await;
    assert_eq!(get_body["status"], "expired");
}

// ── #479: Partial payments disabled ──────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn partial_payment_rejected_when_allow_partial_is_false() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;
    let (payer_id, payer_token) = user(&pool).await;

    let (status, body) = create_request(
        &app,
        &token,
        json!({ "asset": "USDC", "amount": "50.0000000" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();

    fund(&pool, payer_id, 500_000_000).await;

    // Pay less than the full amount – should be refused.
    let (pay_status, pay_body) = pay(
        &app,
        &id,
        &payer_token,
        json!({
            "amount": "25.0000000",
            "chain": "internal"
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::BAD_REQUEST, "{pay_body}");
    let msg = pay_body["error"]["message"].as_str().unwrap();
    assert!(
        msg.contains("partial"),
        "expected message about partial payments, got: {msg}"
    );
    assert_eq!(payment_count(&pool, &id).await, 0);
    assert_eq!(balance(&pool, payer_id).await, 500_000_000);

    // Request should still be open.
    let (_, state_body) = get_request(&app, &id).await;
    assert_eq!(state_body["status"], "pending");
}

// ── #479: Below min_amount rejected ──────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn payment_below_min_amount_is_rejected() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;
    let (payer_id, payer_token) = user(&pool).await;

    let (status, body) = create_request(
        &app,
        &token,
        json!({
            "asset": "USDC",
            "amount": "100.0000000",
            "allow_partial": true,
            "min_amount": "20.0000000"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();

    fund(&pool, payer_id, 1_000_000_000).await;

    // Pay less than min_amount.
    let (pay_status, pay_body) = pay(
        &app,
        &id,
        &payer_token,
        json!({
            "amount": "5.0000000",
            "chain": "internal"
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::BAD_REQUEST, "{pay_body}");
    assert!(
        pay_body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("minimum")
    );
    assert_eq!(payment_count(&pool, &id).await, 0);
    assert_eq!(balance(&pool, payer_id).await, 1_000_000_000);
}

// ── #479: Duplicate tx_hash rejected ─────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn duplicate_tx_hash_is_rejected() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;
    let (payer_id, payer_token) = user(&pool).await;

    let (status, body) = create_request(
        &app,
        &token,
        json!({
            "asset": "USDC",
            "amount": "100.0000000",
            "allow_partial": true
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();

    fund(&pool, payer_id, 1_000_000_000).await;

    let tx_hash = format!("tx-dup-{}", Uuid::new_v4());

    // First payment.
    let (s1, _) = pay(
        &app,
        &id,
        &payer_token,
        json!({ "amount": "10.0000000", "chain": "internal", "tx_hash": tx_hash }),
    )
    .await;
    assert_eq!(s1, StatusCode::CREATED);

    // Same tx_hash again on the same chain.
    let (s2, b2) = pay(
        &app,
        &id,
        &payer_token,
        json!({ "amount": "10.0000000", "chain": "internal", "tx_hash": tx_hash }),
    )
    .await;
    assert_eq!(s2, StatusCode::CONFLICT, "{b2}");
    assert_eq!(payment_count(&pool, &id).await, 1);
    assert_eq!(balance(&pool, payer_id).await, 900_000_000);
}

// ── #479: Merchant list ───────────────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn merchant_can_list_their_own_requests() {
    let (app, pool) = setup().await;
    let (_, token_a) = user(&pool).await;
    let (_, token_b) = user(&pool).await;

    // User A creates two requests.
    for amount in ["10.0000000", "20.0000000"] {
        let (s, b) =
            create_request(&app, &token_a, json!({ "asset": "USDC", "amount": amount })).await;
        assert_eq!(s, StatusCode::CREATED, "{b}");
    }

    // User B creates one request.
    let (s, b) = create_request(
        &app,
        &token_b,
        json!({ "asset": "USDC", "amount": "5.0000000" }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{b}");

    // User A's list should contain exactly 2 items.
    let (list_status, list_body) =
        send(&app, "GET", "/v1/payment-requests", Some(&token_a), None).await;
    assert_eq!(list_status, StatusCode::OK, "{list_body}");
    let items = list_body.as_array().unwrap();
    assert_eq!(items.len(), 2);

    // User B's list should contain exactly 1 item.
    let (_, list_b) = send(&app, "GET", "/v1/payment-requests", Some(&token_b), None).await;
    assert_eq!(list_b.as_array().unwrap().len(), 1);
}

// ── #479: GET returns paid amount in summary ──────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn list_reflects_partial_paid_amount() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;
    let (payer_id, payer_token) = user(&pool).await;

    let (status, body) = create_request(
        &app,
        &token,
        json!({
            "asset": "USDC",
            "amount": "80.0000000",
            "allow_partial": true
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();

    fund(&pool, payer_id, 800_000_000).await;

    // Pay 30 USDC.
    let (pay_status, pay_body) = pay(
        &app,
        &id,
        &payer_token,
        json!({
            "amount": "30.0000000",
            "chain": "internal"
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::CREATED, "{pay_body}");
    assert_eq!(balance(&pool, payer_id).await, 500_000_000);

    // The list should show 30 paid and 50 remaining.
    let (_, list) = send(&app, "GET", "/v1/payment-requests", Some(&token), None).await;
    let item = list
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == id)
        .unwrap();
    let paid: i128 = item["amount_paid"].as_str().unwrap().parse().unwrap();
    let remaining: i128 = item["amount_remaining"].as_str().unwrap().parse().unwrap();
    assert_eq!(paid, 300_000_000); // 30 USDC
    assert_eq!(remaining, 500_000_000); // 50 USDC
    assert_eq!(item["status"], "partially_paid");
}

// ── #620: Authentication required ────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn unauthenticated_payment_is_rejected() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    let (status, body) = create_request(
        &app,
        &token,
        json!({ "asset": "USDC", "amount": "10.0000000" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();

    let (pay_status, pay_body) = send(
        &app,
        "POST",
        &format!("/v1/payment-requests/{id}/pay"),
        None,
        Some(json!({ "amount": "10.0000000", "chain": "internal" })),
    )
    .await;
    assert_eq!(pay_status, StatusCode::UNAUTHORIZED, "{pay_body}");
    assert_eq!(payment_count(&pool, &id).await, 0);
}

// ── #620: On-chain claims rejected ───────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn on_chain_payment_claim_is_rejected() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;
    let (payer_id, payer_token) = user(&pool).await;

    let (status, body) = create_request(
        &app,
        &token,
        json!({ "asset": "USDC", "amount": "10.0000000" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();

    fund(&pool, payer_id, 100_000_000).await;

    for chain in ["stellar", "base"] {
        let (pay_status, pay_body) = pay(
            &app,
            &id,
            &payer_token,
            json!({
                "amount": "10.0000000",
                "chain": chain,
                "tx_hash": format!("tx-onchain-{}", Uuid::new_v4())
            }),
        )
        .await;
        assert_eq!(pay_status, StatusCode::BAD_REQUEST, "{pay_body}");
    }

    assert_eq!(payment_count(&pool, &id).await, 0);
    assert_eq!(balance(&pool, payer_id).await, 100_000_000);
}

// ── #620: Insufficient balance rejected ──────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn payment_without_funds_is_rejected() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;
    let (payer_id, payer_token) = user(&pool).await;

    let (status, body) = create_request(
        &app,
        &token,
        json!({ "asset": "USDC", "amount": "10.0000000" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();

    // Payer has no balance.
    let (pay_status, pay_body) = pay(
        &app,
        &id,
        &payer_token,
        json!({ "amount": "10.0000000", "chain": "internal" }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::BAD_REQUEST, "{pay_body}");
    assert_eq!(payment_count(&pool, &id).await, 0);
    assert_eq!(balance(&pool, payer_id).await, 0);
}

// ── #647: Concurrent payments cannot overpay ─────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn concurrent_payments_cannot_overpay_a_payment_request() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;
    let (payer_id, payer_token) = user(&pool).await;

    // Create a payment request for exactly 10 USDC.
    let (status, body) = create_request(
        &app,
        &token,
        json!({
            "asset": "USDC",
            "amount": "10.0000000",
            "allow_partial": true
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();

    // Give the payer enough for every attempt so only the overpay guard can reject.
    fund(&pool, payer_id, 200_000_000).await;

    // Fire 5 concurrent payments of 4 USDC each (total 20 USDC > 10 USDC limit).
    let handles: Vec<_> = (0..5)
        .map(|_| {
            let app = app.clone();
            let id = id.clone();
            let payer_token = payer_token.clone();
            tokio::spawn(async move {
                pay(
                    &app,
                    &id,
                    &payer_token,
                    json!({ "amount": "4.0000000", "chain": "internal" }),
                )
                .await
            })
        })
        .collect();

    let mut paid_count = 0u32;
    let mut rejected_count = 0u32;
    for h in handles {
        let (status, _) = h.await.unwrap();
        if status.is_success() {
            paid_count += 1;
        } else {
            rejected_count += 1;
        }
    }

    // At least one payment must have been rejected to prevent overpay.
    assert!(
        rejected_count >= 1,
        "expected at least one rejection but all {paid_count} payments succeeded"
    );

    // The payer must not have been charged more than the 10 USDC requested.
    let spent = 200_000_000 - balance(&pool, payer_id).await;
    assert!(spent <= 100_000_000, "overpaid: payer was charged {spent} minor units");
}
