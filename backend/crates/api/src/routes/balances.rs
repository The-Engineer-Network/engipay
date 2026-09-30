use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use engipay_ledger::postgres::PostgresLedgerStore;
use engipay_ledger::{Balance, HoldItem};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

pub fn routes() -> Router<AppState> {
    Router::new().route("/balances", get(get_balances))
}

/// Query parameters accepted by `GET /v1/balances`.
#[derive(Debug, Deserialize, Default)]
pub struct BalancesQuery {
    /// When `true`, the response includes a `holds` array listing every active
    /// (open) hold with its reference ID, asset, locked amount, and creation
    /// timestamp.  Defaults to `false`.
    #[serde(default)]
    pub include_holds: bool,
}

/// Response body for `GET /v1/balances`.
#[derive(Debug, Serialize)]
pub struct BalancesResponse {
    pub balances: Vec<Balance>,
    /// Present only when `include_holds=true` was requested.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub holds: Option<Vec<HoldItem>>,
}

/// Live custodial balances for the authenticated caller, across every asset
/// EngiPay supports (`ETH`, `USDC`, `BTC`, `XLM`), read from the ledger.
///
/// Pass `?include_holds=true` to also receive a breakdown of every active hold
/// (funds locked in an in-flight withdrawal, conversion, or off-ramp).
async fn get_balances(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(params): Query<BalancesQuery>,
) -> Result<Json<BalancesResponse>, ApiError> {
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

    let holds = if params.include_holds {
        let items = store
            .get_active_holds(user_id)
            .await
            .map_err(|err| ApiError::Internal(anyhow::anyhow!(err.to_string())))?;
        Some(items)
    } else {
        None
    };

    Ok(Json(BalancesResponse { balances, holds }))
}

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
    async fn rejects_without_bearer_token_when_include_holds_set() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/v1/balances?include_holds=true")
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

    /// Requires `DATABASE_URL`: creates a ledger posting for a fresh user via
    /// the real store, then asserts `GET /v1/balances` returns it.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn returns_the_callers_live_balances() {
        use engipay_core::{Asset, Money, UserId};
        use engipay_ledger::postgres::PostgresLedgerStore;

        let Ok(database_url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let pool = sqlx::PgPool::connect(&database_url).await.unwrap();
        sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

        let user = UserId::new();
        sqlx::query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(user.as_uuid())
            .execute(&pool)
            .await
            .unwrap();

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

        // Response now uses { balances: [...], holds: null/absent }.
        let balances = body["balances"].as_array().unwrap();
        let usdc = balances
            .iter()
            .find(|b| b["asset"] == "USDC")
            .expect("usdc balance present");
        assert_eq!(usdc["available"], 25_000_000);
        assert_eq!(usdc["held"], 0);

        // Without include_holds, the holds field is absent.
        assert!(body.get("holds").is_none() || body["holds"].is_null());
    }

    /// Requires `DATABASE_URL`: deposits, creates a hold, then calls
    /// `?include_holds=true` and verifies the hold appears in the response.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn include_holds_returns_active_holds() {
        use engipay_core::{Asset, Money, UserId};
        use engipay_ledger::postgres::PostgresLedgerStore;

        let Ok(database_url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let pool = sqlx::PgPool::connect(&database_url).await.unwrap();
        sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

        let user = UserId::new();
        sqlx::query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(user.as_uuid())
            .execute(&pool)
            .await
            .unwrap();

        let store = PostgresLedgerStore::new(pool.clone());
        let deposit = Money::from_minor(Asset::Usdc, 100_000_000);
        store
            .deposit(
                user,
                deposit,
                &format!("holds-test-dep-{}", user.as_uuid()),
            )
            .await
            .unwrap();

        let hold_ref = format!("holds-test-hold-{}", user.as_uuid());
        store
            .create_hold(user, Money::from_minor(Asset::Usdc, 40_000_000), &hold_ref)
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

        // Balances: 60 available, 40 held.
        let balances = body["balances"].as_array().unwrap();
        let usdc = balances
            .iter()
            .find(|b| b["asset"] == "USDC")
            .expect("usdc balance present");
        assert_eq!(usdc["available"], 60_000_000);
        assert_eq!(usdc["held"], 40_000_000);

        // Holds array must be present and contain the hold we just created.
        let holds = body["holds"].as_array().expect("holds array present");
        assert!(!holds.is_empty(), "holds array must not be empty");
        let hold = holds
            .iter()
            .find(|h| h["reference"] == hold_ref)
            .expect("our hold must appear in the holds array");
        assert_eq!(hold["asset"], "USDC");
        assert_eq!(hold["amount"], 40_000_000);
        assert!(
            hold["created_at"].as_str().is_some(),
            "created_at must be present"
        );
    }

    /// Requires `DATABASE_URL`: verifies that released/settled holds do NOT
    /// appear when `include_holds=true` is set.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn include_holds_excludes_released_and_settled_holds() {
        use engipay_core::{Asset, Money, UserId};
        use engipay_ledger::postgres::PostgresLedgerStore;

        let Ok(database_url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let pool = sqlx::PgPool::connect(&database_url).await.unwrap();
        sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

        let user = UserId::new();
        sqlx::query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(user.as_uuid())
            .execute(&pool)
            .await
            .unwrap();

        let store = PostgresLedgerStore::new(pool.clone());
        let deposit = Money::from_minor(Asset::Usdc, 200_000_000);
        store
            .deposit(
                user,
                deposit,
                &format!("holds-excl-dep-{}", user.as_uuid()),
            )
            .await
            .unwrap();

        // Create and release one hold.
        let released_ref = format!("holds-excl-rel-{}", user.as_uuid());
        store
            .create_hold(user, Money::from_minor(Asset::Usdc, 20_000_000), &released_ref)
            .await
            .unwrap();
        store.release_hold(&released_ref).await.unwrap();

        // Create one hold that stays open.
        let open_ref = format!("holds-excl-open-{}", user.as_uuid());
        store
            .create_hold(user, Money::from_minor(Asset::Usdc, 30_000_000), &open_ref)
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

        let holds = body["holds"].as_array().expect("holds array present");

        // Released hold must not appear.
        assert!(
            !holds.iter().any(|h| h["reference"] == released_ref),
            "released hold must not appear in the holds array"
        );

        // Open hold must appear.
        assert!(
            holds.iter().any(|h| h["reference"] == open_ref),
            "open hold must appear in the holds array"
        );
    }

    /// Requires `DATABASE_URL`: verifies that when no holds exist and
    /// `include_holds=true`, the holds array is present but empty.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn include_holds_returns_empty_array_when_no_holds() {
        use engipay_core::{Asset, Money, UserId};
        use engipay_ledger::postgres::PostgresLedgerStore;

        let Ok(database_url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let pool = sqlx::PgPool::connect(&database_url).await.unwrap();
        sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

        let user = UserId::new();
        sqlx::query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(user.as_uuid())
            .execute(&pool)
            .await
            .unwrap();

        let store = PostgresLedgerStore::new(pool.clone());
        store
            .deposit(
                user,
                Money::from_minor(Asset::Usdc, 50_000_000),
                &format!("holds-empty-dep-{}", user.as_uuid()),
            )
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

        let holds = body["holds"].as_array().expect("holds must be an array");
        assert!(holds.is_empty(), "holds array must be empty when no holds exist");
    }
}
