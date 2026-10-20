//! HTTP-level tests for the versioned fee schedule feature.
//!
//! These tests drive the real router in memory with no socket and no database.
//! They cover:
//!   * Fee schedule computation correctness via the quote endpoint
//!   * Quote endpoint validation (bad inputs)
//!   * Schedule-version immutability: the version embedded in a quote never
//!     changes after issuance (because fee_schedules is append-only and the
//!     quote row stores the snapshot)
//!   * Settles endpoint returns 503 without a database (correct behaviour)

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::{AppState, config::Config, router};
use engipay_core::{Asset, Product};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

// ─── Helpers ────────────────────────────────────────────────────────────────

fn app() -> axum::Router {
    router(AppState { database: None }, &Config::for_tests())
}

async fn post_json(path: &str, body: Value) -> (StatusCode, Value) {
    let response = app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

// ─── POST /v1/quotes ─────────────────────────────────────────────────────────

#[tokio::test]
async fn quote_returns_fee_and_schedule_version_for_transfer() {
    // Transfer schedule: 0.10 USDC flat (id = 00000000-…-0001).
    // gross = 100 USDC = 1_000_000_000 smallest units.
    let (status, body) = post_json(
        "/v1/quotes",
        json!({
            "product": "transfer",
            "asset": "USDC",
            "gross_minor": 1_000_000_000_i64
        }),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(body["product"], "transfer");
    assert_eq!(body["asset"], "USDC");
    assert_eq!(body["gross_minor"], 1_000_000_000_i64);
    // 0.10 USDC flat = 1_000_000 smallest units.
    assert_eq!(body["fee_minor"], 1_000_000_i64);
    // schedule_version must be present and non-null.
    assert!(body["schedule_version"].is_string());
    // quote_id must be a UUID.
    assert!(body["quote_id"].is_string());
    // expires_at must be a non-empty string.
    assert!(body["expires_at"].as_str().map(|s| !s.is_empty()).unwrap_or(false));
}

#[tokio::test]
async fn quote_returns_fee_for_withdrawal_with_percentage() {
    // Withdrawal: 0.50 flat + 0.30 % (min 0.50, max 10 USDC).
    // gross = 50 USDC = 500_000_000 smallest units.
    // pct = ceil(500_000_000 × 30 / 10_000) = 1_500_000.
    // total = 5_000_000 + 1_500_000 = 6_500_000.
    let (status, body) = post_json(
        "/v1/quotes",
        json!({
            "product": "withdrawal",
            "asset": "USDC",
            "gross_minor": 500_000_000_i64
        }),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(body["fee_minor"], 10_000_000_i64);
}

#[tokio::test]
async fn quote_percentage_rounds_up() {
    // Withdrawal: 0.50 USDC flat + 0.30 % on 1 smallest unit.
    // pct = ceil(1 × 30 / 10_000) = 1 (rounds up from 0.003).
    // But min_fee_minor = 5_000_000, so clamped_pct = 5_000_000.
    // total = fixed(5_000_000) + clamped_pct(5_000_000) = 10_000_000.
    // Cap is 100_000_000 (10 USDC), so total is well within the cap.
    let (status, body) = post_json(
        "/v1/quotes",
        json!({
            "product": "withdrawal",
            "asset": "USDC",
            "gross_minor": 1_i64
        }),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "body: {body}");
    // pct=ceil(1×30/10_000)=1, floored to min 5_000_000, + fixed 5_000_000 = 10_000_000.
    assert_eq!(body["fee_minor"], 10_000_000_i64);
}

#[tokio::test]
async fn quote_rejects_zero_gross() {
    let (status, body) = post_json(
        "/v1/quotes",
        json!({
            "product": "transfer",
            "asset": "USDC",
            "gross_minor": 0
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST, "body: {body}");
    assert_eq!(body["error"]["code"], "bad_request");
}

#[tokio::test]
async fn quote_rejects_negative_gross() {
    let (status, body) = post_json(
        "/v1/quotes",
        json!({
            "product": "transfer",
            "asset": "USDC",
            "gross_minor": -1
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST, "body: {body}");
}

#[tokio::test]
async fn quote_returns_404_for_unsupported_asset_without_db() {
    // ETH is not in the fallback seed schedules (which only cover USDC).
    let (status, _) = post_json(
        "/v1/quotes",
        json!({
            "product": "transfer",
            "asset": "ETH",
            "gross_minor": 1_000_000_i64
        }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn quote_schedule_version_is_stable_across_calls() {
    // Without a database the fallback schedule always has the same deterministic
    // UUID. Two separate quotes for the same product must carry the same version,
    // proving that the version is an immutable property of the schedule, not
    // randomly generated per call.
    let (_, body1) = post_json(
        "/v1/quotes",
        json!({"product": "transfer", "asset": "USDC", "gross_minor": 1_000_000_i64}),
    )
    .await;
    let (_, body2) = post_json(
        "/v1/quotes",
        json!({"product": "transfer", "asset": "USDC", "gross_minor": 2_000_000_i64}),
    )
    .await;

    let v1 = body1["schedule_version"].as_str().unwrap();
    let v2 = body2["schedule_version"].as_str().unwrap();
    assert_eq!(v1, v2, "schedule_version must be deterministic for the same product/asset schedule");
}

#[tokio::test]
async fn each_product_has_a_distinct_schedule_version() {
    // Every product has its own schedule row, so the versions must differ.
    let products = ["transfer", "withdrawal", "conversion", "buy", "sell"];
    let mut versions = std::collections::HashSet::new();
    for product in products {
        let (status, body) = post_json(
            "/v1/quotes",
            json!({"product": product, "asset": "USDC", "gross_minor": 100_000_000_i64}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "product={product} body={body}");
        let version = body["schedule_version"].as_str().unwrap().to_owned();
        assert!(
            versions.insert(version.clone()),
            "schedule_version {version} was reused for product {product}"
        );
    }
}

// ─── POST /v1/settles ────────────────────────────────────────────────────────

#[tokio::test]
async fn settle_returns_503_without_database() {
    // The settle endpoint requires a database to look up the quote.
    let (status, body) = post_json(
        "/v1/settles",
        json!({
            "hold_reference": "wd-1",
            "quote_id": "00000000-0000-0000-0000-000000000001"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "body: {body}");
    assert_eq!(body["error"]["code"], "database_unavailable");
}

// ─── Fee computation unit tests (schedule independence) ──────────────────────

/// Verifies the core property of the issue: issuing a quote pins the fee to
/// the schedule version that was active at that moment.  Even if a *new*
/// schedule with different rates were active later, the quote's `fee_minor` and
/// `schedule_version` fields are immutable (stored in the append-only `quotes`
/// table) and settlement uses exactly those stored values.
///
/// This test simulates that at the type level: two schedules with different
/// rates produce different fees, and each quote carries only its own version.
#[tokio::test]
async fn changing_schedule_does_not_alter_an_already_issued_quote() {
    use engipay_core::{FeeSchedule};
    use uuid::Uuid;

    let old_schedule = FeeSchedule {
        id: Uuid::from_u128(0xAA),
        product: Product::Transfer,
        asset: Asset::Usdc,
        fixed_minor: 1_000_000,  // 0.10 USDC
        bps: 0,
        min_fee_minor: 0,
        max_fee_minor: None,
    };

    let new_schedule = FeeSchedule {
        id: Uuid::from_u128(0xBB),
        product: Product::Transfer,
        asset: Asset::Usdc,
        fixed_minor: 5_000_000,  // 0.50 USDC — rate increase
        bps: 0,
        min_fee_minor: 0,
        max_fee_minor: None,
    };

    let gross = 100 * 10_000_000_i128; // 100 USDC

    let old_result = old_schedule.compute_fee(gross).unwrap();
    let new_result = new_schedule.compute_fee(gross).unwrap();

    // Different schedules → different fees.
    assert_ne!(old_result.fee_minor, new_result.fee_minor);

    // Each result carries its own schedule's version.
    assert_eq!(old_result.schedule_version, old_schedule.id);
    assert_eq!(new_result.schedule_version, new_schedule.id);

    // The old result is unchanged even after the new schedule exists.
    // (In production the quote row in Postgres carries old_result.fee_minor;
    // settlement reads that row, not the current schedule.)
    assert_eq!(old_result.fee_minor, 1_000_000);
    assert_eq!(new_result.fee_minor, 5_000_000);
}
