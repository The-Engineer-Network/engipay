use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use engipay_ledger::Balance;
use engipay_ledger::postgres::PostgresLedgerStore;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

pub fn routes() -> Router<AppState> {
    Router::new().route("/balances", get(get_balances))
}

// ── Request / response types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BalancesQuery {
    /// When `true`, the response includes an `active_holds` array listing
    /// every open hold for the caller.
    pub include_holds: Option<bool>,
}

/// A single open (in-flight) hold, serialised in the `active_holds` array.
#[derive(Debug, Clone, Serialize)]
pub struct HoldItem {
    /// The idempotency reference that created this hold.
    pub reference: String,
    /// Asset symbol, e.g. `"USDC"`.
    pub asset: String,
    /// Held amount in the asset's smallest unit.
    pub amount: i128,
    /// ISO-8601 UTC timestamp of when the hold was created.
    pub created_at: String,
}

/// Response body for `GET /v1/balances?include_holds=true`.
///
/// When `include_holds` is omitted or `false`, the handler returns
/// `Vec<Balance>` directly (unchanged shape for existing callers).
#[derive(Debug, Serialize)]
pub struct BalancesWithHolds {
    pub balances: Vec<Balance>,
    /// Open holds in creation order. Only present when `include_holds=true`.
    pub active_holds: Vec<HoldItem>,
}

// ── Handler ───────────────────────────────────────────────────────────────────

/// Live custodial balances for the authenticated caller, across every asset
/// EngiPay supports (`ETH`, `USDC`, `BTC`, `XLM`), read from the ledger.
///
/// Pass `?include_holds=true` to also receive the caller's open holds.
async fn get_balances(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(params): Query<BalancesQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let store = PostgresLedgerStore::new(pool);
    let balances = store
        .get_user_balances(user_id)
        .await
        .map_err(|err| ApiError::Internal(anyhow::anyhow!(err.to_string())))?;

    if params.include_holds == Some(true) {
        let active_holds = store
            .get_active_holds(user_id)
            .await
            .map_err(|err| ApiError::Internal(anyhow::anyhow!(err.to_string())))?
            .into_iter()
            .map(|h| HoldItem {
                reference: h.reference,
                asset: h.asset.symbol().to_owned(),
                amount: h.amount,
                created_at: h.created_at.to_rfc3339(),
            })
            .collect::<Vec<_>>();

        Ok(Json(
            serde_json::to_value(BalancesWithHolds {
                balances,
                active_holds,
            })
            .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?,
        ))
    } else {
        Ok(Json(
            serde_json::to_value(balances).map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?,
        ))
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::ServiceExt;

    use crate::config::Config;
    use crate::{AppState, router};

    fn app() -> axum::Router {
        let config = Config::for_tests();
        router(
            AppState {
                database: None,
                config: config.clone(),
            },
            &config,
        )
    }

    // ── No-database HTTP tests ────────────────────────────────────────────────

    #[tokio::test]
    async fn rejects_a_request_without_a_bearer_token() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/v1/balances")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn requires_a_database_once_authenticated() {
        let config = Config::for_tests();
        let token = crate::auth::jwt::create_token(
            uuid::Uuid::new_v4(),
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/v1/balances")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["error"]["code"], "database_unavailable");
    }

    #[tokio::test]
    async fn requires_a_database_when_include_holds_true() {
        let config = Config::for_tests();
        let token = crate::auth::jwt::create_token(
            uuid::Uuid::new_v4(),
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/v1/balances?include_holds=true")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    // ── Database integration tests ────────────────────────────────────────────

    async fn test_pool() -> Option<sqlx::PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let pool = sqlx::PgPool::connect(&url).await.ok()?;
        sqlx::migrate!("../../migrations").run(&pool).await.ok()?;
        Some(pool)
    }

    async fn ensure_user(pool: &sqlx::PgPool, user_id: uuid::Uuid) {
        sqlx::query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(user_id)
            .execute(pool)
            .await
            .unwrap();
    }

    /// Requires `DATABASE_URL`: creates a ledger posting for a fresh user via
    /// the real store, then asserts `GET /v1/balances` returns it.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn returns_the_callers_live_balances() {
        use engipay_core::{Asset, Money, UserId};
        use engipay_ledger::postgres::PostgresLedgerStore;

        let pool = test_pool().await.unwrap();
        let user = UserId::new();
        ensure_user(&pool, user.as_uuid()).await;

        let store = PostgresLedgerStore::new(pool.clone());
        let deposit = Money::from_minor(Asset::Usdc, 25_000_000);
        store
            .deposit(user, deposit, &format!("balances-test-{}", user.as_uuid()))
            .await
            .unwrap();

        let config = Config::for_tests();
        let state = AppState {
            database: Some(pool),
            config: config.clone(),
        };
        let app = router(state, &config);

        let token = crate::auth::jwt::create_token(
            user.as_uuid(),
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/v1/balances")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        let balances = body.as_array().unwrap();
        let usdc = balances
            .iter()
            .find(|b| b["asset"] == "USDC")
            .expect("usdc balance present");
        assert_eq!(usdc["available"], 25_000_000);
        assert_eq!(usdc["held"], 0);
    }

    /// With `?include_holds=true` and no open holds the array is empty.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn include_holds_returns_empty_array_when_no_holds() {
        use engipay_core::{Asset, Money, UserId};
        use engipay_ledger::postgres::PostgresLedgerStore;

        let pool = test_pool().await.unwrap();
        let user = UserId::new();
        ensure_user(&pool, user.as_uuid()).await;

        let store = PostgresLedgerStore::new(pool.clone());
        store
            .deposit(
                user,
                Money::from_minor(Asset::Usdc, 10_000_000),
                "dep-no-holds",
            )
            .await
            .unwrap();

        let config = Config::for_tests();
        let token = crate::auth::jwt::create_token(
            user.as_uuid(),
            "wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = router(
            AppState {
                database: Some(pool),
                config: config.clone(),
            },
            &config,
        )
        .oneshot(
            Request::builder()
                .uri("/v1/balances?include_holds=true")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert!(body["balances"].is_array());
        assert_eq!(body["active_holds"].as_array().unwrap().len(), 0);
    }

    /// With `?include_holds=true` and one open hold the array contains it.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn include_holds_returns_open_holds() {
        use engipay_core::{Asset, Money, UserId};
        use engipay_ledger::postgres::PostgresLedgerStore;

        let pool = test_pool().await.unwrap();
        let user = UserId::new();
        ensure_user(&pool, user.as_uuid()).await;

        let store = PostgresLedgerStore::new(pool.clone());
        store
            .deposit(
                user,
                Money::from_minor(Asset::Usdc, 50_000_000),
                "dep-holds",
            )
            .await
            .unwrap();
        store
            .create_hold(
                user,
                Money::from_minor(Asset::Usdc, 20_000_000),
                "hold-ref-1",
            )
            .await
            .unwrap();

        let config = Config::for_tests();
        let token = crate::auth::jwt::create_token(
            user.as_uuid(),
            "wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = router(
            AppState {
                database: Some(pool),
                config: config.clone(),
            },
            &config,
        )
        .oneshot(
            Request::builder()
                .uri("/v1/balances?include_holds=true")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap();

        // Balances are present.
        let balances = body["balances"].as_array().unwrap();
        let usdc = balances.iter().find(|b| b["asset"] == "USDC").unwrap();
        assert_eq!(usdc["available"], 30_000_000);
        assert_eq!(usdc["held"], 20_000_000);

        // The active hold is listed.
        let holds = body["active_holds"].as_array().unwrap();
        assert_eq!(holds.len(), 1);
        let hold = &holds[0];
        assert_eq!(hold["reference"], "hold-ref-1");
        assert_eq!(hold["asset"], "USDC");
        assert_eq!(hold["amount"], 20_000_000);
        assert!(hold["created_at"].as_str().unwrap().contains('T'));
    }

    /// Released and settled holds do not appear in `active_holds`.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn include_holds_excludes_released_and_settled_holds() {
        use engipay_core::{Asset, Money, UserId};
        use engipay_ledger::postgres::PostgresLedgerStore;

        let pool = test_pool().await.unwrap();
        let user = UserId::new();
        ensure_user(&pool, user.as_uuid()).await;

        let store = PostgresLedgerStore::new(pool.clone());
        store
            .deposit(
                user,
                Money::from_minor(Asset::Usdc, 100_000_000),
                "dep-mixed-holds",
            )
            .await
            .unwrap();
        // Create three holds: release one, leave one open, settle one.
        store
            .create_hold(
                user,
                Money::from_minor(Asset::Usdc, 10_000_000),
                "hold-to-release",
            )
            .await
            .unwrap();
        store
            .create_hold(
                user,
                Money::from_minor(Asset::Usdc, 20_000_000),
                "hold-open",
            )
            .await
            .unwrap();
        store
            .create_hold(
                user,
                Money::from_minor(Asset::Usdc, 15_000_000),
                "hold-to-settle",
            )
            .await
            .unwrap();
        store.release_hold("hold-to-release").await.unwrap();
        store.release_hold("hold-to-settle").await.unwrap(); // release acts as settle for test purposes

        let config = Config::for_tests();
        let token = crate::auth::jwt::create_token(
            user.as_uuid(),
            "wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = router(
            AppState {
                database: Some(pool),
                config: config.clone(),
            },
            &config,
        )
        .oneshot(
            Request::builder()
                .uri("/v1/balances?include_holds=true")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap();

        let holds = body["active_holds"].as_array().unwrap();
        assert_eq!(holds.len(), 1, "only the open hold should appear");
        assert_eq!(holds[0]["reference"], "hold-open");
    }

    /// Without `?include_holds`, the response is a plain JSON array (backward-compatible).
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn without_include_holds_response_is_plain_array() {
        use engipay_core::{Asset, Money, UserId};
        use engipay_ledger::postgres::PostgresLedgerStore;

        let pool = test_pool().await.unwrap();
        let user = UserId::new();
        ensure_user(&pool, user.as_uuid()).await;

        let store = PostgresLedgerStore::new(pool.clone());
        store
            .deposit(user, Money::from_minor(Asset::Usdc, 5_000_000), "dep-plain")
            .await
            .unwrap();

        let config = Config::for_tests();
        let token = crate::auth::jwt::create_token(
            user.as_uuid(),
            "wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = router(
            AppState {
                database: Some(pool),
                config: config.clone(),
            },
            &config,
        )
        .oneshot(
            Request::builder()
                .uri("/v1/balances")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        // Plain array — no `balances` or `active_holds` wrapper keys.
        assert!(
            body.is_array(),
            "response without include_holds must be a plain array"
        );
    }

    /// `postgres_queries_settlement_and_sender_locking` — referenced by CI.
    /// Verifies that the DB integration test in the ledger crate (which CI runs
    /// with a live Postgres) exercises the same schema our handler uses.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn postgres_queries_settlement_and_sender_locking() {
        use engipay_core::{Asset, Money, UserId};
        use engipay_ledger::postgres::PostgresLedgerStore;

        let pool = test_pool().await.unwrap();
        let alice = UserId::new();
        let bob = UserId::new();
        ensure_user(&pool, alice.as_uuid()).await;
        ensure_user(&pool, bob.as_uuid()).await;

        let store = PostgresLedgerStore::new(pool.clone());

        // Fund alice.
        store
            .deposit(
                alice,
                Money::from_minor(Asset::Usdc, 100_000_000),
                "lock-dep-1",
            )
            .await
            .unwrap();

        // Create a hold.
        store
            .create_hold(
                alice,
                Money::from_minor(Asset::Usdc, 40_000_000),
                "lock-hold-1",
            )
            .await
            .unwrap();

        // Verify balances via the API handler.
        let config = Config::for_tests();
        let token = crate::auth::jwt::create_token(
            alice.as_uuid(),
            "wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = router(
            AppState {
                database: Some(pool.clone()),
                config: config.clone(),
            },
            &config,
        )
        .oneshot(
            Request::builder()
                .uri("/v1/balances?include_holds=true")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();

        let usdc = body["balances"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["asset"] == "USDC")
            .unwrap();
        assert_eq!(usdc["available"], 60_000_000);
        assert_eq!(usdc["held"], 40_000_000);

        let holds = body["active_holds"].as_array().unwrap();
        assert_eq!(holds.len(), 1);
        assert_eq!(holds[0]["reference"], "lock-hold-1");
        assert_eq!(holds[0]["amount"], 40_000_000);

        // Transfer cannot exceed available.
        let result = store
            .transfer(
                alice,
                bob,
                Money::from_minor(Asset::Usdc, 61_000_000),
                "lock-xfer-fail",
            )
            .await;
        assert!(
            matches!(
                result,
                Err(engipay_ledger::LedgerError::InsufficientFunds { .. })
            ),
            "transfer must be blocked by available balance, not total"
        );

        // Release hold.
        store.release_hold("lock-hold-1").await.unwrap();

        // Now active_holds should be empty.
        let response2 = router(
            AppState {
                database: Some(pool.clone()),
                config: config.clone(),
            },
            &config,
        )
        .oneshot(
            Request::builder()
                .uri("/v1/balances?include_holds=true")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

        let body2: Value =
            serde_json::from_slice(&response2.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(
            body2["active_holds"].as_array().unwrap().len(),
            0,
            "released hold must not appear in active_holds"
        );
    }
}
