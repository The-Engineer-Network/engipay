//! The in-app notification feed, end to end against a real Postgres.
//!
//! Needs DATABASE_URL pointing at a database with every migration applied, so
//! it is ignored by default. Run it with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test notifications_db -- --ignored

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::auth::jwt::create_token;
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::services::notifications::{NewNotification, record};
use engipay_api::{AppState, config::Config, router};
use engipay_core::UserId;
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
    let token = create_token(id, String::new(), Config::for_tests().jwt_secret.as_bytes()).unwrap();
    (id, token)
}

async fn send(app: &axum::Router, method: &str, path: &str, token: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn emit(pool: &sqlx::PgPool, user: Uuid, key: &str) {
    record(
        pool,
        &NewNotification {
            user: UserId::from_uuid(user),
            kind: "deposit".to_string(),
            title: format!("Event {key}"),
            body: "Funds arrived.".to_string(),
            dedupe_key: key.to_string(),
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn emitting_the_same_event_twice_records_one_notification() {
    let (_app, pool) = setup().await;
    let (id, _token) = user(&pool).await;

    emit(&pool, id, "deposit:abc").await;
    emit(&pool, id, "deposit:abc").await;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notifications WHERE user_id = $1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1, "a replayed event must not create a second entry");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn list_pages_newest_first_and_stops_at_the_end() {
    let (app, pool) = setup().await;
    let (id, token) = user(&pool).await;
    for key in ["e1", "e2", "e3"] {
        emit(&pool, id, key).await;
    }

    let (status, first) = send(&app, "GET", "/v1/notifications?limit=2", &token).await;
    assert_eq!(status, StatusCode::OK);
    let first_items = first["items"].as_array().unwrap();
    assert_eq!(first_items.len(), 2);
    assert_eq!(first["unread_count"], 3);
    let cursor = first["next_before"].as_str().expect("a second page exists");

    let (status, second) = send(
        &app,
        "GET",
        &format!("/v1/notifications?limit=2&before={cursor}"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let second_items = second["items"].as_array().unwrap();
    assert_eq!(
        second_items.len(),
        1,
        "the last page holds the remaining item"
    );
    assert!(
        second["next_before"].is_null(),
        "no page after the last one"
    );

    // No item may appear on both pages.
    let seen: Vec<&str> = first_items
        .iter()
        .chain(second_items.iter())
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    let mut unique = seen.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), 3);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn mark_read_clears_one_item_and_mark_all_clears_the_rest() {
    let (app, pool) = setup().await;
    let (id, token) = user(&pool).await;
    emit(&pool, id, "a").await;
    emit(&pool, id, "b").await;

    let item: Uuid =
        sqlx::query_scalar("SELECT id FROM notifications WHERE user_id = $1 AND dedupe_key = 'a'")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();

    let (status, _) = send(
        &app,
        "POST",
        &format!("/v1/notifications/{item}/read"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (_, page) = send(&app, "GET", "/v1/notifications", &token).await;
    assert_eq!(page["unread_count"], 1);

    let (status, all) = send(&app, "POST", "/v1/notifications/read-all", &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(all["updated"], 1, "only the unread item is updated");

    let (_, page) = send(&app, "GET", "/v1/notifications", &token).await;
    assert_eq!(page["unread_count"], 0);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn another_users_notification_is_not_found() {
    let (app, pool) = setup().await;
    let (owner, _owner_token) = user(&pool).await;
    let (_other, other_token) = user(&pool).await;
    emit(&pool, owner, "private").await;

    let item: Uuid = sqlx::query_scalar("SELECT id FROM notifications WHERE user_id = $1")
        .bind(owner)
        .fetch_one(&pool)
        .await
        .unwrap();

    let (status, _) = send(
        &app,
        "POST",
        &format!("/v1/notifications/{item}/read"),
        &other_token,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let still_unread: bool =
        sqlx::query_scalar("SELECT read_at IS NULL FROM notifications WHERE id = $1")
            .bind(item)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        still_unread,
        "the owner's item must not be changed by another user"
    );
}
