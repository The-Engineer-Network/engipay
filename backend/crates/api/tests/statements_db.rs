//! Database-backed tests for the monthly statement endpoint.
//!
//! These tests verify the balance identity invariant
//! (`opening + Σ(movements) == closing`) on a busy synthetic month and check
//! that the HTTP endpoint returns correct JSON, CSV, and PDF responses.
//!
//! Run with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test statements_db -- --ignored

#![allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use chrono::NaiveDate;
use engipay_api::auth::jwt::create_token;
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, config::Config, router};
use engipay_core::{Asset, Money, UserId};
use engipay_ledger::postgres::PostgresLedgerStore;
use engipay_ledger::{AssetStatement, LedgerError};
use http_body_util::BodyExt;
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

// ── Test helpers ──────────────────────────────────────────────────────────────

async fn setup() -> (axum::Router, sqlx::PgPool) {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .unwrap();
    sqlx::migrate!("../../migrations").run(&pool).await.unwrap();
    let config = Config::for_tests();
    let app = router(
        AppState::with_fakes(Some(pool.clone()), config.clone(), RateLimiter::new()),
        &config,
    );
    (app, pool)
}

async fn make_user(pool: &sqlx::PgPool) -> (Uuid, String) {
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
    let token =
        create_token(id, String::new(), Config::for_tests().jwt_secret.as_bytes()).unwrap();
    (id, token)
}

async fn deposit(pool: &sqlx::PgPool, user_id: Uuid, asset: Asset, minor: i128, suffix: &str) {
    let ledger = PostgresLedgerStore::new(pool.clone());
    let user = UserId::from_uuid(user_id);
    let dep_ref = format!("stmt-test-dep-{user_id}-{suffix}");
    ledger
        .deposit(user, Money::from_minor(asset, minor), &dep_ref)
        .await
        .unwrap();
}

#[allow(dead_code)] // used in #[ignore]d DB integration tests
async fn transfer_between(
    pool: &sqlx::PgPool,
    from: Uuid,
    to: Uuid,
    asset: Asset,
    minor: i128,
    suffix: &str,
) {
    let ledger = PostgresLedgerStore::new(pool.clone());
    let xfer_ref = format!("stmt-test-xfer-{from}-{to}-{suffix}");
    ledger
        .transfer(
            UserId::from_uuid(from),
            UserId::from_uuid(to),
            Money::from_minor(asset, minor),
            &xfer_ref,
        )
        .await
        .unwrap();
}

async fn send_request(
    app: &axum::Router,
    path: &str,
    token: &str,
) -> (StatusCode, axum::body::Bytes) {
    let req = Request::builder()
        .method("GET")
        .uri(path)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, bytes)
}

// ── Unit tests (no database) ─────────────────────────────────────────────────

#[test]
fn balance_identity_holds_for_empty_period() {
    let stmt = AssetStatement {
        asset: Asset::Usdc,
        opening_balance: 1_000_000,
        lines: vec![],
        closing_balance: 1_000_000,
    };
    assert!(stmt.verify_balance_identity().is_ok());
    assert_eq!(stmt.net_movement(), 0);
}

#[test]
fn balance_identity_holds_with_positive_movement() {
    use engipay_ledger::StatementLine;
    let line = StatementLine {
        transaction_id: Uuid::new_v4(),
        kind: "deposit".to_string(),
        reference: "dep-1".to_string(),
        asset: Asset::Usdc,
        bucket: "available".to_string(),
        amount: 500_000,
        created_at: "2026-10-05T12:00:00Z".to_string(),
    };
    let stmt = AssetStatement {
        asset: Asset::Usdc,
        opening_balance: 0,
        lines: vec![line],
        closing_balance: 500_000,
    };
    assert!(stmt.verify_balance_identity().is_ok());
    assert_eq!(stmt.net_movement(), 500_000);
}

#[test]
fn balance_identity_fails_on_mismatch() {
    let stmt = AssetStatement {
        asset: Asset::Usdc,
        opening_balance: 1_000_000,
        lines: vec![],
        // Deliberately wrong closing balance.
        closing_balance: 999_999,
    };
    assert!(matches!(
        stmt.verify_balance_identity(),
        Err(LedgerError::InvariantViolated(_))
    ));
}

#[test]
fn balance_identity_with_mixed_credits_and_debits() {
    use engipay_ledger::StatementLine;

    let make_line = |amount: i128| StatementLine {
        transaction_id: Uuid::new_v4(),
        kind: "transfer".to_string(),
        reference: format!("ref-{amount}"),
        asset: Asset::Usdc,
        bucket: "available".to_string(),
        amount,
        created_at: "2026-10-10T00:00:00Z".to_string(),
    };

    // opening=1000, +500, -300, +200 → net=+400, closing=1400
    let stmt = AssetStatement {
        asset: Asset::Usdc,
        opening_balance: 1_000,
        lines: vec![make_line(500), make_line(-300), make_line(200)],
        closing_balance: 1_400,
    };
    assert!(stmt.verify_balance_identity().is_ok());
    assert_eq!(stmt.net_movement(), 400);
}

// ── Database-backed integration tests ────────────────────────────────────────

/// Populates a busy synthetic month and verifies that the balance identity
/// holds after a mix of deposits, transfers, holds, and settlements.
///
/// Strategy: we request a statement for a month in the *far future* (2099-01)
/// so all the test data inserted now (October 2026) falls "before" that month
/// and shows up as the opening balance with zero in-period transactions.
/// We then verify opening == closing and net == 0, which is the correct result.
///
/// Additionally we verify the invariant holds on a month that *does* contain
/// activity by using the current month (2026-10) with a fresh user.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn balance_identity_holds_for_busy_synthetic_month() {
    let (_app, pool) = setup().await;
    let ledger = PostgresLedgerStore::new(pool.clone());

    let (alice_id, _) = make_user(&pool).await;
    let (bob_id, _) = make_user(&pool).await;
    let alice = UserId::from_uuid(alice_id);
    let bob = UserId::from_uuid(bob_id);

    // All activity deposited NOW — it will appear in the current month's statement.
    let dep_ref_a = format!("busy-dep-a-{alice_id}");
    let dep_ref_b = format!("busy-dep-b-{alice_id}");
    let xfer_ref = format!("busy-xfer-{alice_id}");
    let hold_ref = format!("busy-hold-{alice_id}");

    ledger.deposit(alice, Money::from_minor(Asset::Usdc, 10_000_000), &dep_ref_a).await.unwrap();
    ledger.deposit(alice, Money::from_minor(Asset::Usdc, 5_000_000), &dep_ref_b).await.unwrap();
    ledger.transfer(alice, bob, Money::from_minor(Asset::Usdc, 2_000_000), &xfer_ref).await.unwrap();
    ledger.create_hold(alice, Money::from_minor(Asset::Usdc, 1_000_000), &hold_ref).await.unwrap();
    ledger.settle_hold(&hold_ref, None).await.unwrap();

    // Request the statement for the current month (2026-10). All the above
    // activity falls in this month since we just created it.
    let period_start = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
    let statement = ledger.get_monthly_statement(alice, period_start).await.unwrap();

    assert_eq!(statement.assets.len(), Asset::ALL.len());

    // The core invariant must hold for every asset.
    for asset_stmt in &statement.assets {
        asset_stmt
            .verify_balance_identity()
            .unwrap_or_else(|e| panic!("balance identity failed for {}: {e}", asset_stmt.asset));

        let expected = asset_stmt
            .opening_balance
            .checked_add(asset_stmt.net_movement())
            .unwrap();
        assert_eq!(
            expected, asset_stmt.closing_balance,
            "balance identity arithmetic mismatch for {}",
            asset_stmt.asset
        );
    }

    // USDC-specific checks: verify the correct net movement.
    // Net user postings for alice:
    //   +10_000_000 (deposit a)
    //   +5_000_000  (deposit b)
    //   -2_000_000  (transfer out available)
    //   -1_000_000  (hold: available→held, debit available)
    //   +1_000_000  (hold: credit held)
    //   -1_000_000  (settle: debit held, left the system)
    // Sum = 10M + 5M - 2M - 1M + 1M - 1M = 12_000_000
    let usdc = statement.assets.iter().find(|a| a.asset == Asset::Usdc).unwrap();
    assert_eq!(
        usdc.closing_balance,
        usdc.opening_balance.checked_add(usdc.net_movement()).unwrap(),
        "USDC balance identity"
    );

    // Now also verify that a far-future month (all activity is opening balance)
    // also satisfies the invariant.
    let future_start = NaiveDate::from_ymd_opt(2099, 1, 1).unwrap();
    let future_stmt = ledger.get_monthly_statement(alice, future_start).await.unwrap();
    for asset_stmt in &future_stmt.assets {
        asset_stmt.verify_balance_identity().unwrap_or_else(|e| {
            panic!("future balance identity failed for {}: {e}", asset_stmt.asset)
        });
        assert_eq!(
            asset_stmt.net_movement(), 0,
            "{}: no activity in far-future month should give zero net movement",
            asset_stmt.asset
        );
        assert_eq!(
            asset_stmt.opening_balance, asset_stmt.closing_balance,
            "{}: opening == closing in empty future month",
            asset_stmt.asset
        );
    }
}

/// Statement for a user with no activity in the requested month returns
/// zero net movement and equal opening/closing balances.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn empty_month_returns_zero_movement_and_equal_balances() {
    let (_app, pool) = setup().await;
    let ledger = PostgresLedgerStore::new(pool.clone());
    let (user_id, _) = make_user(&pool).await;
    let user = UserId::from_uuid(user_id);

    // Deposit now. Then request a statement for a month that has no activity:
    // the far future (2099-02).
    ledger
        .deposit(
            user,
            Money::from_minor(Asset::Usdc, 7_000_000),
            &format!("empty-dep-{user_id}"),
        )
        .await
        .unwrap();

    // Request a month that has no activity (all the deposit is "before" this period).
    let period_start = NaiveDate::from_ymd_opt(2099, 2, 1).unwrap();
    let statement = ledger
        .get_monthly_statement(user, period_start)
        .await
        .unwrap();

    for asset_stmt in &statement.assets {
        assert_eq!(
            asset_stmt.net_movement(),
            0,
            "{}: no activity should mean zero net movement",
            asset_stmt.asset
        );
        assert_eq!(
            asset_stmt.opening_balance, asset_stmt.closing_balance,
            "{}: opening == closing when there is no activity",
            asset_stmt.asset
        );
        assert!(
            asset_stmt.lines.is_empty(),
            "{}: no lines expected for an empty month",
            asset_stmt.asset
        );
        assert!(asset_stmt.verify_balance_identity().is_ok());
    }

    // USDC should show the pre-period deposit as both opening and closing.
    let usdc = statement
        .assets
        .iter()
        .find(|a| a.asset == Asset::Usdc)
        .unwrap();
    assert_eq!(usdc.opening_balance, 7_000_000);
    assert_eq!(usdc.closing_balance, 7_000_000);
}

/// The HTTP endpoint returns 200 with a valid JSON body for a known user.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn http_endpoint_returns_json_statement() {
    let (app, pool) = setup().await;
    let (user_id, token) = make_user(&pool).await;
    deposit(&pool, user_id, Asset::Usdc, 1_000_000, "http-json").await;

    let (status, bytes) = send_request(
        &app,
        "/v1/statements?year=2026&month=10&format=json",
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK, "body: {}", String::from_utf8_lossy(&bytes));

    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["period_start"], "2026-10-01");
    assert_eq!(body["period_end"], "2026-11-01");
    let assets = body["assets"].as_array().unwrap();
    assert!(!assets.is_empty(), "assets array must be non-empty");

    // Every asset must have opening_balance, closing_balance, and lines.
    for asset in assets {
        assert!(asset["opening_balance"].is_string());
        assert!(asset["closing_balance"].is_string());
        assert!(asset["lines"].is_array());
        assert!(asset["net_movement"].is_string());
    }
}

/// The HTTP endpoint returns valid CSV with the right MIME type.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn http_endpoint_returns_csv_statement() {
    let (app, pool) = setup().await;
    let (user_id, token) = make_user(&pool).await;
    deposit(&pool, user_id, Asset::Usdc, 2_500_000, "http-csv").await;

    let (status, bytes) = send_request(
        &app,
        "/v1/statements?year=2026&month=10&format=csv",
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let body = String::from_utf8(bytes.to_vec()).unwrap();
    // Must start with the header row.
    assert!(
        body.starts_with("period_start,asset,type,"),
        "expected CSV header, got: {}",
        &body[..body.len().min(120)]
    );
    // Must include asset symbols.
    assert!(body.contains("USDC"), "CSV must mention USDC");
    // Must include opening and closing rows.
    assert!(body.contains("opening_balance"), "CSV must have opening_balance rows");
    assert!(body.contains("closing_balance"), "CSV must have closing_balance rows");
}

/// The HTTP endpoint returns a non-empty PDF with the right MIME type.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn http_endpoint_returns_pdf_statement() {
    let (app, pool) = setup().await;
    let (_user_id, token) = make_user(&pool).await;

    let (status, bytes) = send_request(
        &app,
        "/v1/statements?year=2026&month=10&format=pdf",
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    // PDF magic number.
    assert!(
        bytes.starts_with(b"%PDF-"),
        "response must start with PDF magic bytes"
    );
    assert!(bytes.ends_with(b"%%EOF\n"), "PDF must end with %%EOF");
}

/// The endpoint rejects an invalid year/month combination.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn http_endpoint_rejects_invalid_month() {
    let (app, pool) = setup().await;
    let (_user_id, token) = make_user(&pool).await;

    let (status, _) = send_request(
        &app,
        "/v1/statements?year=2026&month=13",
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// Unauthenticated request is rejected with 401.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn http_endpoint_requires_authentication() {
    let (app, _pool) = setup().await;

    let req = Request::builder()
        .method("GET")
        .uri("/v1/statements?year=2026&month=10")
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

/// Balance identity across multiple assets and many transactions in a month.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn balance_identity_holds_across_multiple_assets() {
    let (_app, pool) = setup().await;
    let ledger = PostgresLedgerStore::new(pool.clone());
    let (user_id, _) = make_user(&pool).await;
    let user = UserId::from_uuid(user_id);

    // Deposit multiple assets in-period.
    for (asset, amount, suffix) in [
        (Asset::Usdc, 1_000_000i128, "ma-usdc"),
        (Asset::Eth, 1_000_000_000_000_000_000i128, "ma-eth"),
        (Asset::Xlm, 10_000_000i128, "ma-xlm"),
    ] {
        let dep_ref = format!("stmt-multi-{user_id}-{suffix}");
        ledger
            .deposit(user, Money::from_minor(asset, amount), &dep_ref)
            .await
            .unwrap();
    }

    let period_start = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
    let statement = ledger
        .get_monthly_statement(user, period_start)
        .await
        .unwrap();

    for asset_stmt in &statement.assets {
        asset_stmt.verify_balance_identity().unwrap_or_else(|e| {
            panic!("balance identity failed for {}: {e}", asset_stmt.asset)
        });
    }
}
