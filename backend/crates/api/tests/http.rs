//! Drives the real router in memory, with no socket and no database.

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, config::Config, router};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

fn app() -> axum::Router {
    let config = Config::for_tests();
    router(
        AppState::with_fakes(None, config.clone(), RateLimiter::new()),
        &config,
    )
}

async fn get_json(path: &str) -> (StatusCode, Value) {
    let response = app()
        .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

#[tokio::test]
async fn health_reports_ok_without_a_database() {
    let (status, body) = get_json("/healthz").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
    assert_eq!(body["database"], "not_configured");
}

/// Building the router panics on duplicate or invalid routes, so this test
/// fails if such a route is added.
#[tokio::test]
async fn router_builds_and_serves_healthz() {
    let config = Config::for_tests();
    let app = router(
        AppState::with_fakes(None, config.clone(), RateLimiter::new()),
        &config,
    );
    let response = app
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn sign_in_endpoints_report_no_database_instead_of_pretending() {
    let verify_body = r#"{"message":"Sign in\nNonce: abcdef1234","signature":"0x00","address":"0x0000000000000000000000000000000000000001"}"#;
    for (path, body) in [("/v1/auth/nonce", ""), ("/v1/auth/verify-evm", verify_body)] {
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
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE, "{path}");
    }
}

#[tokio::test]
async fn me_requires_a_bearer_token() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/v1/me")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn lists_exactly_the_supported_assets() {
    let (status, body) = get_json("/v1/assets").await;
    assert_eq!(status, StatusCode::OK);
    let symbols: Vec<&str> = body
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["symbol"].as_str().unwrap())
        .collect();
    assert_eq!(symbols, ["ETH", "USDC", "BTC", "XLM"]);

    // USDC: one balance at ledger precision, reachable on two networks with
    // their own on-chain precision.
    let usdc = &body[1];
    assert_eq!(usdc["decimals"], 7);
    assert_eq!(usdc["networks"][0]["chain"], "base");
    assert_eq!(usdc["networks"][0]["decimals"], 6);
    assert_eq!(usdc["networks"][1]["chain"], "stellar");
    assert_eq!(usdc["networks"][1]["decimals"], 7);

    assert_eq!(body[2]["networks"][0]["chain"], "bitcoin");
    assert_eq!(body[3]["networks"][0]["chain"], "stellar");
}

#[tokio::test]
async fn unknown_routes_are_404() {
    let (status, _) = get_json("/v1/nope").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn only_the_configured_web_origin_is_allowed() {
    let preflight = |origin: &'static str| {
        Request::builder()
            .method("OPTIONS")
            .uri("/v1/assets")
            .header(header::ORIGIN, origin)
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
            .body(Body::empty())
            .unwrap()
    };

    let allowed = app()
        .oneshot(preflight("http://localhost:3000"))
        .await
        .unwrap();
    assert_eq!(
        allowed
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .map(|v| v.to_str().unwrap()),
        Some("http://localhost:3000")
    );

    let refused = app()
        .oneshot(preflight("https://evil.example"))
        .await
        .unwrap();
    assert!(
        refused
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none()
    );
}

/// SEP-7: `web+stellar:pay?destination=<account>`.
fn stellar_payment_uri(destination: &str) -> String {
    format!("web+stellar:pay?destination={destination}")
}

/// EIP-681: `ethereum:<address>@<chain_id>`.
fn base_payment_uri(address: &str) -> String {
    format!("ethereum:{address}@8453")
}

/// BIP-21: `bitcoin:<address>`.
fn bitcoin_payment_uri(address: &str) -> String {
    format!("bitcoin:{address}")
}

#[test]
fn stellar_payment_uri_follows_sep7() {
    let uri = stellar_payment_uri("GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ");
    assert!(uri.starts_with("web+stellar:pay?"));
    assert_eq!(
        uri,
        "web+stellar:pay?destination=GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ"
    );
}

#[test]
fn base_payment_uri_follows_eip681() {
    let uri = base_payment_uri("0x4200000000000000000000000000000000000006");
    assert!(uri.starts_with("ethereum:0x"));
    assert!(uri.ends_with("@8453"));
    assert_eq!(
        uri,
        "ethereum:0x4200000000000000000000000000000000000006@8453"
    );
}

#[test]
fn bitcoin_payment_uri_follows_bip21() {
    let uri = bitcoin_payment_uri("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
    assert!(uri.starts_with("bitcoin:"));
    assert_eq!(uri, "bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
}

#[tokio::test]
async fn buy_quotes_require_a_bearer_token() {
    let response = app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/buy/quotes")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"naira_amount":"5000","asset":"USDC"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn buy_quotes_report_no_database_instead_of_pretending() {
    // Without pricing configured, the check is the same: no quote is invented.
    // The database check comes after auth, so use a signed token here.
    let config = Config::for_tests();
    let token = engipay_api::auth::jwt::create_token(
        uuid::Uuid::new_v4(),
        String::new(),
        config.jwt_secret.as_bytes(),
    )
    .unwrap();
    let response = app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/buy/quotes")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"naira_amount":"5000","asset":"USDC"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

/// Database-backed tests for the withdrawal endpoints.
///
/// These only run when `DATABASE_URL` points at a reachable test database, so
/// the plain `cargo test` job keeps working without one. The CI database job
/// sets `DATABASE_URL` and runs them.
mod withdrawals {
    #![allow(clippy::unwrap_used)]

    use axum::body::Body;
    use axum::http::{Request, StatusCode, header};
    use engipay_api::middleware::rate_limit::RateLimiter;
    use engipay_api::{AppState, config::Config, router};
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use sqlx::PgPool;
    use sqlx::postgres::PgPoolOptions;
    use tower::ServiceExt;
    use uuid::Uuid;

    /// Returns a pool when a test database is configured, otherwise `None`.
    async fn test_pool() -> Option<PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        if url.trim().is_empty() {
            return None;
        }
        match PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
        {
            Ok(pool) => Some(pool),
            Err(error) => {
                eprintln!("skipping withdrawal tests: cannot reach DATABASE_URL: {error}");
                None
            }
        }
    }

    fn app_with(pool: PgPool) -> axum::Router {
        let config = Config::for_tests();
        router(
            AppState::with_fakes(Some(pool), config.clone(), RateLimiter::new()),
            &config,
        )
    }

    fn token_for(user_id: Uuid) -> String {
        let config = Config::for_tests();
        engipay_api::auth::jwt::create_token(user_id, String::new(), config.jwt_secret.as_bytes())
            .unwrap()
    }

    /// Inserts a user and returns its id.
    async fn insert_user(pool: &PgPool) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO users (id, created_at, updated_at) VALUES ($1, now(), now())")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
        id
    }

    /// Credits `amount` of `asset` to `user_id`'s available balance.
    async fn credit(pool: &PgPool, user_id: Uuid, asset: &str, amount: &str) {
        sqlx::query(
            "INSERT INTO balances (user_id, asset, available, held, created_at, updated_at) \
             VALUES ($1, $2, $3::numeric, 0, now(), now()) \
             ON CONFLICT (user_id, asset) DO UPDATE \
             SET available = balances.available + EXCLUDED.available, updated_at = now()",
        )
        .bind(user_id)
        .bind(asset)
        .bind(amount)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn withdrawal_count(pool: &PgPool, user_id: Uuid) -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM withdrawals WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn post_withdrawal(
        app: axum::Router,
        token: Option<&str>,
        body: Value,
    ) -> (StatusCode, Value) {
        let mut request = Request::builder()
            .method("POST")
            .uri("/v1/withdrawals")
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = token {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let response = app
            .oneshot(request.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, json)
    }

    async fn get_withdrawal(app: axum::Router, token: &str, id: Uuid) -> StatusCode {
        app.oneshot(
            Request::builder()
                .uri(format!("/v1/withdrawals/{id}"))
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
    }

    fn withdrawal_body(asset: &str, amount: &str) -> Value {
        json!({
            "asset": asset,
            "amount": amount,
            "network": "base",
            "address": "0x4200000000000000000000000000000000000006",
        })
    }

    #[tokio::test]
    async fn withdrawal_requires_a_bearer_token() {
        let Some(pool) = test_pool().await else {
            return;
        };
        let (status, _) =
            post_withdrawal(app_with(pool), None, withdrawal_body("USDC", "1")).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn insufficient_balance_creates_no_withdrawal_row() {
        let Some(pool) = test_pool().await else {
            return;
        };
        let user_id = insert_user(&pool).await;
        let token = token_for(user_id);

        let (status, _) = post_withdrawal(
            app_with(pool.clone()),
            Some(&token),
            withdrawal_body("USDC", "1000"),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(withdrawal_count(&pool, user_id).await, 0);
    }

    #[tokio::test]
    async fn successful_withdrawal_places_a_hold() {
        let Some(pool) = test_pool().await else {
            return;
        };
        let user_id = insert_user(&pool).await;
        credit(&pool, user_id, "USDC", "10").await;
        let token = token_for(user_id);

        let (status, body) = post_withdrawal(
            app_with(pool.clone()),
            Some(&token),
            withdrawal_body("USDC", "4"),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        assert!(body["hold_reference"].as_str().is_some_and(|r| !r.is_empty()));

        let held: rust_decimal::Decimal =
            sqlx::query_scalar("SELECT held FROM balances WHERE user_id = $1 AND asset = 'USDC'")
                .bind(user_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(held, rust_decimal::Decimal::new(4, 0));
        assert_eq!(withdrawal_count(&pool, user_id).await, 1);
    }

    #[tokio::test]
    async fn another_users_withdrawal_is_not_found() {
        let Some(pool) = test_pool().await else {
            return;
        };
        let owner = insert_user(&pool).await;
        credit(&pool, owner, "USDC", "10").await;
        let owner_token = token_for(owner);

        let (status, body) = post_withdrawal(
            app_with(pool.clone()),
            Some(&owner_token),
            withdrawal_body("USDC", "2"),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        let id: Uuid = body["id"].as_str().unwrap().parse().unwrap();

        let stranger = insert_user(&pool).await;
        let stranger_token = token_for(stranger);
        let status = get_withdrawal(app_with(pool), &stranger_token, id).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}

/// Every POST, PATCH and DELETE under /v1 that moves money must refuse requests
/// that carry no Bearer token with 401. A test failure here means a new
/// unauthenticated money-moving route was added — open an issue per endpoint
/// and fix it before merging.
#[tokio::test]
async fn money_moving_endpoints_return_401_without_a_token() {
    // (method, path, body)
    // Sign-in routes (/auth/nonce, /auth/verify-evm, /auth/stellar/verify) are
    // excluded — they are intentionally unauthenticated.
    let unauthenticated_app = app();

    let routes: &[(&str, &str, &str)] = &[
        ("POST",   "/v1/withdrawals",                          r#"{"destination":"G...","amount":"1","asset":"USDC"}"#),
        ("POST",   "/v1/transfers",                            r#"{"to":"G...","amount":"1","asset":"USDC"}"#),
        ("POST",   "/v1/convert/quote",                        r#"{"from_asset":"USDC","to_asset":"XLM","from_amount":"1"}"#),
        ("POST",   "/v1/convert/execute",                      r#"{"quote_id":"00000000-0000-0000-0000-000000000000"}"#),
        ("POST",   "/v1/settles",                              r#"{"hold_id":"00000000-0000-0000-0000-000000000000"}"#),
        ("POST",   "/v1/quotes",                               r#"{"from_asset":"USDC","to_asset":"XLM","from_amount":"1"}"#),
        ("POST",   "/v1/payment-requests",                     r#"{"amount":"1","asset":"USDC"}"#),
        ("POST",   "/v1/payment-requests/00000000-0000-0000-0000-000000000000/pay", r#"{"tx_hash":"abc"}"#),
        ("POST",   "/v1/money-requests/00000000-0000-0000-0000-000000000000/accept",  ""),
        ("POST",   "/v1/money-requests/00000000-0000-0000-0000-000000000000/decline", ""),
        ("POST",   "/v1/kyc/session",                         ""),
        // /v1/kyc/webhook uses provider-signature auth, not bearer-token auth — excluded.
        ("POST",   "/v1/bank-accounts",                       r#"{"account_number":"0123456789","bank_code":"044","account_name":"Test"}"#),
        ("DELETE", "/v1/bank-accounts/00000000-0000-0000-0000-000000000000", ""),
        ("POST",   "/v1/batch-payments",                      ""),
        ("POST",   "/v1/batch-payments/00000000-0000-0000-0000-000000000000/approve",  ""),
        ("POST",   "/v1/batch-payments/00000000-0000-0000-0000-000000000000/execute",  ""),
        ("POST",   "/v1/batch-payments/00000000-0000-0000-0000-000000000000/cancel",   ""),
        ("POST",   "/v1/buy/quotes",                          r#"{"amount_usdc":"1"}"#),
        ("POST",   "/v1/buy/orders",                          r#"{"quote_id":"00000000-0000-0000-0000-000000000000"}"#),
        ("POST",   "/v1/naira/deposits",                      r#"{"amount":"1"}"#),
        ("POST",   "/v1/naira/withdrawals",                   r#"{"amount":"1","bank_account_id":"00000000-0000-0000-0000-000000000000"}"#),
        ("POST",   "/v1/deletion-request",                    ""),
        ("PATCH",  "/v1/me",                                  r#"{"display_name":"Test"}"#),
    ];

    for &(method, path, body) in routes {
        let mut req = Request::builder()
            .method(method)
            .uri(path)
            .header(header::CONTENT_TYPE, "application/json");
        let request = req.body(Body::from(body.to_string())).unwrap();
        let response = unauthenticated_app
            .clone()
            .oneshot(request)
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "{method} {path} should return 401 without a token"
        );
    }
}
