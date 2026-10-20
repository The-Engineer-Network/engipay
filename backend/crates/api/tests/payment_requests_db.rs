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
async fn create_request(
    app: &axum::Router,
    token: &str,
    body: Value,
) -> (StatusCode, Value) {
    send(app, "POST", "/v1/payment-requests", Some(token), Some(body)).await
}

/// GET a payment request (unauthenticated – payer view).
async fn get_request(app: &axum::Router, id: &str) -> (StatusCode, Value) {
    send(app, "GET", &format!("/v1/payment-requests/{id}"), None, None).await
}

/// POST a payment against a request.
async fn pay(app: &axum::Router, id: &str, body: Value) -> (StatusCode, Value) {
    send(
        app,
        "POST",
        &format!("/v1/payment-requests/{id}/pay"),
        None,
        Some(body),
    )
    .await
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

    let (status, body) = create_request(
        &app,
        &token,
        json!({ "asset": "USDC", "amount": "10.0000000" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();
    let requested_minor: i128 = 100_000_000; // 10 USDC × 10^7

    // Record a payment for the exact amount.
    let (pay_status, pay_body) = pay(
        &app,
        &id,
        json!({
            "amount": "10.0000000",
            "chain": "stellar",
            "tx_hash": format!("tx-exact-{}", Uuid::new_v4())
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::CREATED, "{pay_body}");
    assert_eq!(pay_body["request_status"], "paid");
    assert_eq!(
        pay_body["amount_paid"].as_str().unwrap().parse::<i128>().unwrap(),
        requested_minor
    );
    assert_eq!(
        pay_body["amount_remaining"].as_str().unwrap().parse::<i128>().unwrap(),
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

    // First payment: partial.
    let (pay_status, pay_body) = pay(
        &app,
        &id,
        json!({
            "amount": "40.0000000",
            "chain": "base",
            "tx_hash": format!("tx-partial-1-{}", Uuid::new_v4())
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::CREATED, "{pay_body}");
    assert_eq!(pay_body["request_status"], "partially_paid");

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
        json!({
            "amount": "60.0000000",
            "chain": "base",
            "tx_hash": format!("tx-partial-2-{}", Uuid::new_v4())
        }),
    )
    .await;
    assert_eq!(pay2_status, StatusCode::CREATED, "{pay2_body}");
    assert_eq!(pay2_body["request_status"], "paid");
    assert_eq!(
        pay2_body["amount_remaining"].as_str().unwrap().parse::<i128>().unwrap(),
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

    // Attempt to pay more than the requested amount.
    let (pay_status, pay_body) = pay(
        &app,
        &id,
        json!({
            "amount": "60.0000000",   // 10 more than requested
            "chain": "stellar",
            "tx_hash": format!("tx-over-{}", Uuid::new_v4())
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::BAD_REQUEST, "{pay_body}");
    assert!(pay_body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("exceed"));

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

    let (status, body) = create_request(
        &app,
        &token,
        json!({ "asset": "USDC", "amount": "20.0000000", "expiry_minutes": 60 }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();

    // Force expiry.
    expire_request(&pool, &id).await;

    // Attempt to pay.
    let (pay_status, pay_body) = pay(
        &app,
        &id,
        json!({
            "amount": "20.0000000",
            "chain": "internal"
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::BAD_REQUEST, "{pay_body}");
    assert!(pay_body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("expired"));

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

    let (status, body) = create_request(
        &app,
        &token,
        json!({ "asset": "USDC", "amount": "50.0000000" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();

    // Pay less than the full amount – should be refused.
    let (pay_status, pay_body) = pay(
        &app,
        &id,
        json!({
            "amount": "25.0000000",
            "chain": "stellar",
            "tx_hash": format!("tx-partial-disallowed-{}", Uuid::new_v4())
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::BAD_REQUEST, "{pay_body}");
    let msg = pay_body["error"]["message"].as_str().unwrap();
    assert!(
        msg.contains("partial"),
        "expected message about partial payments, got: {msg}"
    );

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

    // Pay less than min_amount.
    let (pay_status, pay_body) = pay(
        &app,
        &id,
        json!({
            "amount": "5.0000000",
            "chain": "base",
            "tx_hash": format!("tx-below-min-{}", Uuid::new_v4())
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::BAD_REQUEST, "{pay_body}");
    assert!(pay_body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("minimum"));
}

// ── #479: Duplicate tx_hash rejected ─────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn duplicate_tx_hash_is_rejected() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

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

    let tx_hash = format!("tx-dup-{}", Uuid::new_v4());

    // First payment.
    let (s1, _) = pay(
        &app,
        &id,
        json!({ "amount": "10.0000000", "chain": "stellar", "tx_hash": tx_hash }),
    )
    .await;
    assert_eq!(s1, StatusCode::CREATED);

    // Same tx_hash again on the same chain.
    let (s2, b2) = pay(
        &app,
        &id,
        json!({ "amount": "10.0000000", "chain": "stellar", "tx_hash": tx_hash }),
    )
    .await;
    assert_eq!(s2, StatusCode::CONFLICT, "{b2}");
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
        let (s, b) = create_request(
            &app,
            &token_a,
            json!({ "asset": "USDC", "amount": amount }),
        )
        .await;
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
    let (list_status, list_body) = send(&app, "GET", "/v1/payment-requests", Some(&token_a), None).await;
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

    // Pay 30 USDC.
    let (_, _) = pay(
        &app,
        &id,
        json!({
            "amount": "30.0000000",
            "chain": "base",
            "tx_hash": format!("tx-list-{}", Uuid::new_v4())
        }),
    )
    .await;

    // The list should show 30 paid and 50 remaining.
    let (_, list) = send(&app, "GET", "/v1/payment-requests", Some(&token), None).await;
    let item = list.as_array().unwrap().iter().find(|i| i["id"] == id).unwrap();
    let paid: i128 = item["amount_paid"].as_str().unwrap().parse().unwrap();
    let remaining: i128 = item["amount_remaining"].as_str().unwrap().parse().unwrap();
    assert_eq!(paid, 300_000_000);      // 30 USDC
    assert_eq!(remaining, 500_000_000); // 50 USDC
    assert_eq!(item["status"], "partially_paid");
}

// ── #483: Split helpers ───────────────────────────────────────────────────────

/// Create a split request and return the response body.
async fn create_split(
    app: &axum::Router,
    token: &str,
    body: Value,
) -> (StatusCode, Value) {
    send(
        app,
        "POST",
        "/v1/payment-requests/split",
        Some(token),
        Some(body),
    )
    .await
}

/// Pay a specific share of a split request.
async fn pay_share(
    app: &axum::Router,
    id: &str,
    share_id: &str,
    body: Value,
) -> (StatusCode, Value) {
    send(
        app,
        "POST",
        &format!("/v1/payment-requests/{id}/shares/{share_id}/pay"),
        None,
        Some(body),
    )
    .await
}

/// Cancel a split request as its creator.
async fn cancel_split(app: &axum::Router, id: &str, token: &str) -> (StatusCode, Value) {
    send(
        app,
        "POST",
        &format!("/v1/payment-requests/{id}/cancel"),
        Some(token),
        Some(json!({})),
    )
    .await
}

/// Sum the `amount` fields of the shares in a split response body.
fn shares_total(body: &Value) -> i128 {
    body["shares"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["amount"].as_str().unwrap().parse::<i128>().unwrap())
        .sum()
}

// ── #483: Equal split with rounding ──────────────────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn equal_split_shares_sum_to_total_and_complete_after_last_share() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    // 10 USDC = 100_000_000 minor units, split across 3 payers does not divide evenly.
    let (status, body) = create_split(
        &app,
        &token,
        json!({
            "asset": "USDC",
            "amount": "10.0000000",
            "split": "equal",
            "payers": 3
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();

    let shares = body["shares"].as_array().unwrap().clone();
    assert_eq!(shares.len(), 3);
    // Rounding must not lose or create a single minor unit.
    assert_eq!(shares_total(&body), 100_000_000);
    // The remainder is distributed so no share differs by more than one unit.
    let amounts: Vec<i128> = shares
        .iter()
        .map(|s| s["amount"].as_str().unwrap().parse().unwrap())
        .collect();
    let min = *amounts.iter().min().unwrap();
    let max = *amounts.iter().max().unwrap();
    assert!(max - min <= 1, "uneven rounding: {amounts:?}");

    let share_ids: Vec<String> = shares
        .iter()
        .map(|s| s["id"].as_str().unwrap().to_string())
        .collect();

    // Pay the first two shares – request must not be complete yet.
    for (i, share_id) in share_ids.iter().take(2).enumerate() {
        let (pay_status, pay_body) = pay_share(
            &app,
            &id,
            share_id,
            json!({
                "chain": "stellar",
                "tx_hash": format!("tx-split-{i}-{}", Uuid::new_v4())
            }),
        )
        .await;
        assert_eq!(pay_status, StatusCode::OK, "{pay_body}");
        assert_eq!(pay_body["share_status"], "paid");
        assert_ne!(pay_body["request_status"], "paid");
    }

    let (_, mid_body) = get_request(&app, &id).await;
    assert_ne!(mid_body["status"], "paid");
    assert_eq!(mid_body["status"], "partially_paid");

    // Pay the final share – now the whole request is complete.
    let (pay_status, pay_body) = pay_share(
        &app,
        &id,
        &share_ids[2],
        json!({
            "chain": "stellar",
            "tx_hash": format!("tx-split-last-{}", Uuid::new_v4())
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::OK, "{pay_body}");
    assert_eq!(pay_body["request_status"], "paid");

    let (_, final_body) = get_request(&app, &id).await;
    assert_eq!(final_body["status"], "paid");
    let paid: i128 = final_body["amount_paid"].as_str().unwrap().parse().unwrap();
    assert_eq!(paid, 100_000_000);
    for share in final_body["shares"].as_array().unwrap() {
        assert_eq!(share["status"], "paid");
    }
}

// ── #483: Custom split that does not sum to the total ────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn custom_split_with_wrong_total_is_rejected() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    // Shares sum to 9 USDC, not the requested 10 USDC.
    let (status, body) = create_split(
        &app,
        &token,
        json!({
            "asset": "USDC",
            "amount": "10.0000000",
            "split": "custom",
            "shares": ["4.0000000", "3.0000000", "2.0000000"]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let msg = body["error"]["message"].as_str().unwrap();
    assert!(
        msg.contains("sum") || msg.contains("total"),
        "expected message about shares summing to total, got: {msg}"
    );
}

// ── #483: Creator cancels a partially paid split ─────────────────────────────

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn creator_can_cancel_partially_paid_split_and_refund() {
    let (app, pool) = setup().await;
    let (_, token) = user(&pool).await;

    let (status, body) = create_split(
        &app,
        &token,
        json!({
            "asset": "USDC",
            "amount": "10.0000000",
            "split": "equal",
            "payers": 2
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["id"].as_str().unwrap().to_string();
    let shares = body["shares"].as_array().unwrap().clone();
    assert_eq!(shares_total(&body), 100_000_000);
    let first_share = shares[0]["id"].as_str().unwrap().to_string();
    let first_amount: i128 = shares[0]["amount"].as_str().unwrap().parse().unwrap();

    // Pay the first share only.
    let (pay_status, pay_body) = pay_share(
        &app,
        &id,
        &first_share,
        json!({
            "chain": "base",
            "tx_hash": format!("tx-cancel-{}", Uuid::new_v4())
        }),
    )
    .await;
    assert_eq!(pay_status, StatusCode::OK, "{pay_body}");

    // Creator cancels the split.
    let (cancel_status, cancel_body) = cancel_split(&app, &id, &token).await;
    assert_eq!(cancel_status, StatusCode::OK, "{cancel_body}");
    assert_eq!(cancel_body["status"], "cancelled");
    let refunded: i128 = cancel_body["amount_refunded"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(refunded, first_amount);

    // The request is cancelled and no further share can be paid.
    let (_, final_body) = get_request(&app, &id).await;
    assert_eq!(final_body["status"], "cancelled");

    let second_share = shares[1]["id"].as_str().unwrap().to_string();
    let (late_status, late_body) = pay_share(
        &app,
        &id,
        &second_share,
        json!({
            "chain": "base",
            "tx_hash": format!("tx-cancel-late-{}", Uuid::new_v4())
        }),
    )
    .await;
    assert_eq!(late_status, StatusCode::BAD_REQUEST, "{late_body}");
}
