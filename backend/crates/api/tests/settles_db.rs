//! POST /v1/settles against a real Postgres (#643): an expired quote, a
//! replayed hold and a hold reference that has never been settled.
//!
//! Needs DATABASE_URL pointing at a database with every migration applied, so
//! it is ignored by default. Run it with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test settles_db -- --ignored

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, config::Config, router};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

/// The seeded transfer schedule: 0.10 USDC flat.
const TRANSFER_SCHEDULE: &str = "00000000-0000-0000-0000-000000000001";
const FEE_MINOR: i64 = 1_000_000;

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

/// Inserts a quote directly. Quotes are append-only, so an expired quote has
/// to be written already expired rather than updated afterwards.
async fn insert_quote(pool: &sqlx::PgPool, expires_in: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO quotes (id, product, asset, gross_minor, fee_minor, schedule_version, expires_at)
         VALUES ($1, 'transfer', 'USDC', 1000000000, $2::numeric, $3::uuid, now() + $4::interval)",
    )
    .bind(id)
    .bind(FEE_MINOR.to_string())
    .bind(TRANSFER_SCHEDULE)
    .bind(expires_in)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn settle(app: &axum::Router, hold_reference: &str, quote_id: Uuid) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/settles")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "hold_reference": hold_reference, "quote_id": quote_id }).to_string(),
                ))
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

async fn settle_rows(pool: &sqlx::PgPool, hold_reference: &str) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM quote_settles WHERE settle_reference = $1")
        .bind(format!("{hold_reference}:settle"))
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn an_expired_quote_is_refused_and_records_nothing() {
    let (app, pool) = setup().await;
    let quote_id = insert_quote(&pool, "-1 second").await;
    let hold = format!("hold-{}", Uuid::new_v4());

    let (status, body) = settle(&app, &hold, quote_id).await;

    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        body.to_string().contains("expired"),
        "error should say the quote expired: {body}"
    );
    assert_eq!(settle_rows(&pool, &hold).await, 0);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_second_call_with_the_same_hold_is_replayed() {
    let (app, pool) = setup().await;
    let quote_id = insert_quote(&pool, "5 minutes").await;
    let hold = format!("hold-{}", Uuid::new_v4());

    let (status, first) = settle(&app, &hold, quote_id).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(first["replayed"], false);
    assert_eq!(first["fee_minor"], FEE_MINOR);
    assert_eq!(first["schedule_version"], TRANSFER_SCHEDULE);

    let (status, second) = settle(&app, &hold, quote_id).await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(second["replayed"], true);
    // The replay returns the original fee and schedule.
    assert_eq!(second["fee_minor"], first["fee_minor"]);
    assert_eq!(second["schedule_version"], first["schedule_version"]);

    // Nothing was booked twice.
    assert_eq!(settle_rows(&pool, &hold).await, 1);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn an_unknown_hold_is_not_reported_as_a_replay() {
    let (app, pool) = setup().await;
    let quote_id = insert_quote(&pool, "5 minutes").await;
    // A hold reference that has never been settled before.
    let hold = format!("unknown-hold-{}", Uuid::new_v4());
    assert_eq!(settle_rows(&pool, &hold).await, 0);

    let (status, body) = settle(&app, &hold, quote_id).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["replayed"], false);
    assert_eq!(body["quote_id"], quote_id.to_string());
    assert_eq!(settle_rows(&pool, &hold).await, 1);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn an_unknown_quote_is_refused() {
    let (app, pool) = setup().await;
    let hold = format!("hold-{}", Uuid::new_v4());

    let (status, body) = settle(&app, &hold, Uuid::new_v4()).await;

    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(settle_rows(&pool, &hold).await, 0);
}
