//! Drives the real router in memory, with no socket and no database.

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::chain_client::ChainClient;
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, config::Config, router};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

fn app() -> axum::Router {
    let config = Config::for_tests();
    router(
        AppState {
            database: None,
            config: config.clone(),
            rate_limiter: RateLimiter::new(),
            chain_client: ChainClient::new(&config),
        },
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

// --- Chain service client -------------------------------------------------

mod chain_client {
    use super::*;
    use engipay_api::chain_client::ChainClient;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn app_with_chain(base_url: &str) -> axum::Router {
        let mut config = Config::for_tests();
        config.chain_service_url = Some(base_url.to_owned());
        router(
            AppState {
                database: None,
                config: config.clone(),
                rate_limiter: RateLimiter::new(),
                chain_client: ChainClient::new(&config),
            },
            &config,
        )
    }

    fn withdrawal_request() -> Request<Body> {
        let body = serde_json::json!({
            "asset": "XLM",
            "chain": "stellar",
            "amount": "10.0000000",
            "destination": "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        });
        Request::builder()
            .method("POST")
            .uri("/v1/withdrawals")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    #[tokio::test]
    async fn withdrawal_fee_comes_from_the_chain_service() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/internal/estimate-fee"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "fee": "1234",
                "asset": "XLM",
                "chain": "stellar",
            })))
            .mount(&server)
            .await;

        let response = app_with_chain(&server.uri())
            .oneshot(withdrawal_request())
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

        assert_eq!(status, StatusCode::CREATED, "body: {body}");
        assert_eq!(body["estimated_network_fee"], "1234");
    }

    #[tokio::test]
    async fn chain_service_outage_is_a_503() {
        // Bind then drop a listener so the port is (almost certainly) closed.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);

        let response = app_with_chain(&format!("http://{addr}"))
            .oneshot(withdrawal_request())
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "body: {body}");
        assert_eq!(body["type"], "service_unavailable");
    }

    #[tokio::test]
    async fn chain_service_timeout_is_a_503() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/internal/estimate-fee"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(std::time::Duration::from_secs(30))
                    .set_body_json(serde_json::json!({ "fee": "1" })),
            )
            .mount(&server)
            .await;

        let response = app_with_chain(&server.uri())
            .oneshot(withdrawal_request())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
}

// --- Custody configuration ------------------------------------------------

mod custody {
    use super::*;

    async fn deposit_address(chain: &str) -> (StatusCode, String) {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri(format!("/v1/deposit-address?chain={chain}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    #[tokio::test]
    async fn stellar_without_custody_address_is_a_503() {
        let (status, body) = deposit_address("stellar").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "body: {body}");
        assert!(!body.contains("CUSTODY_STELLAR"));
    }

    #[tokio::test]
    async fn base_without_custody_address_is_a_503() {
        let (status, body) = deposit_address("base").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "body: {body}");
        assert!(!body.contains("CUSTODY_BASE"));
    }

    #[tokio::test]
    async fn bitcoin_without_custody_address_is_a_503() {
        let (status, body) = deposit_address("bitcoin").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "body: {body}");
        assert!(!body.contains("CUSTODY_BITCOIN"));
    }
}

// --- Derivation parity ----------------------------------------------------

#[test]
fn api_and_chain_derive_the_same_stellar_address() {
    use engipay_core::custody::derive_stellar;
    use uuid::Uuid;

    let user = Uuid::parse_str("018f3b1c-0000-7000-8000-000000000001").unwrap();
    let custody = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

    let from_core = derive_stellar(user, custody);
    let from_api = engipay_api::routes::deposits::derive_stellar(user, custody);
    assert_eq!(from_api, from_core);
}

// --- Concurrent index allocation -----------------------------------------

/// Requires `TEST_DATABASE_URL`; skipped otherwise.
#[tokio::test]
async fn concurrent_deposit_requests_get_distinct_indexes() {
    let Ok(database_url) = std::env::var("TEST_DATABASE_URL") else {
        eprintln!("skipping: TEST_DATABASE_URL is not set");
        return;
    };

    let pool = sqlx::PgPool::connect(&database_url).await.unwrap();
    let user = uuid::Uuid::new_v4();
    sqlx::query("INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(user)
        .bind(format!("{user}@example.test"))
        .execute(&pool)
        .await
        .unwrap();

    let mut config = Config::for_tests();
    config.custody_stellar = Some(
        "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ".to_owned(),
    );

    let mut handles = Vec::new();
    for _ in 0..16 {
        let pool = pool.clone();
        let config = config.clone();
        handles.push(tokio::spawn(async move {
            let app = router(
                AppState {
                    database: Some(pool),
                    config: config.clone(),
                    rate_limiter: RateLimiter::new(),
                    chain_client: ChainClient::new(&config),
                },
                &config,
            );
            app.oneshot(
                Request::builder()
                    .uri("/v1/deposit-address?chain=stellar")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
        }));
    }

    for handle in handles {
        assert_eq!(handle.await.unwrap(), StatusCode::OK);
    }

    let indexes: Vec<i64> = sqlx::query_scalar(
        "SELECT derivation_index FROM deposit_addresses WHERE chain = 'stellar'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let mut unique = indexes.clone();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(unique.len(), indexes.len(), "duplicate derivation indexes");
}
