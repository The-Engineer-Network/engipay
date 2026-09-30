use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use engipay_ledger::Balance;
use engipay_ledger::postgres::PostgresLedgerStore;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

pub fn routes() -> Router<AppState> {
    Router::new().route("/balances", get(get_balances))
}

/// Live custodial balances for the authenticated caller, across every asset
/// EngiPay supports (`ETH`, `USDC`, `BTC`, `XLM`), read from the ledger.
async fn get_balances(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<Balance>>, ApiError> {
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

    Ok(Json(balances))
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
        let balances = body.as_array().unwrap();
        let usdc = balances
            .iter()
            .find(|b| b["asset"] == "USDC")
            .expect("usdc balance present");
        assert_eq!(usdc["available"], 25_000_000);
        assert_eq!(usdc["held"], 0);
    }
}
