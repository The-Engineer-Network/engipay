use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use engipay_ledger::postgres::PostgresLedgerStore;
use engipay_ledger::{Balance, HoldItem};
use serde::{Deserialize, Serialize};
use engipay_core::Asset;
use engipay_ledger::Balance;
use engipay_ledger::postgres::PostgresLedgerStore;
use serde::Serialize;

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
/// API response shape for a single asset balance.
///
/// Both raw minor-unit integers and fixed-decimal strings are returned so
/// frontend clients can display amounts without floating-point arithmetic.
///
/// Example for 1.5 USDC (7 decimals):
/// ```json
/// {
///   "asset": "USDC",
///   "available_minor": 15000000,
///   "available": "1.5000000",
///   "held_minor": 0,
///   "held": "0.0000000"
/// }
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BalanceResponse {
    pub asset: Asset,
    /// Raw integer in the asset's smallest unit.
    pub available_minor: i128,
    /// Fixed-decimal string with exactly `asset.decimals()` fractional digits.
    pub available: String,
    /// Raw integer in the asset's smallest unit.
    pub held_minor: i128,
    /// Fixed-decimal string with exactly `asset.decimals()` fractional digits.
    pub held: String,
}

impl BalanceResponse {
    pub fn from_balance(balance: Balance) -> Self {
        let available = format_minor(balance.asset, balance.available);
        let held = format_minor(balance.asset, balance.held);
        Self {
            asset: balance.asset,
            available_minor: balance.available,
            available,
            held_minor: balance.held,
            held,
        }
    }
}

/// Formats a signed minor-unit integer as a fixed-decimal string using the
/// asset's full precision (e.g. 15_000_000 USDC → "1.5000000").
///
/// The number of fractional digits is always exactly `asset.decimals()`, so
/// clients can rely on a stable string length for any given asset.
pub fn format_minor(asset: Asset, minor: i128) -> String {
    let decimals = asset.decimals() as usize;

    if decimals == 0 {
        return minor.to_string();
    }

    let sign = if minor < 0 { "-" } else { "" };
    let abs = minor.unsigned_abs();
    let digits = abs.to_string();
    // Pad to at least `decimals + 1` characters so the whole part is never empty.
    let padded = format!("{digits:0>width$}", width = decimals.saturating_add(1));
    let split = padded.len().saturating_sub(decimals);
    let (whole, fraction) = padded.split_at(split);
    format!("{sign}{whole}.{fraction}")
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
) -> Result<Json<Vec<BalanceResponse>>, ApiError> {
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
    let response: Vec<BalanceResponse> = balances
        .into_iter()
        .map(BalanceResponse::from_balance)
        .collect();

    Ok(Json(response))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use engipay_core::Asset;
    use engipay_ledger::Balance;

    use super::{BalanceResponse, format_minor};

    // ── format_minor unit tests ──────────────────────────────────────────────

    #[test]
    fn formats_usdc_with_seven_decimals() {
        // 1.5 USDC = 15_000_000 minor units
        assert_eq!(format_minor(Asset::Usdc, 15_000_000), "1.5000000");
        assert_eq!(format_minor(Asset::Usdc, 0), "0.0000000");
        assert_eq!(format_minor(Asset::Usdc, 1), "0.0000001");
        assert_eq!(format_minor(Asset::Usdc, 250_000_000), "25.0000000");
    }

    #[test]
    fn formats_xlm_with_seven_decimals() {
        assert_eq!(format_minor(Asset::Xlm, 10_000_000), "1.0000000");
        assert_eq!(format_minor(Asset::Xlm, 0), "0.0000000");
        assert_eq!(format_minor(Asset::Xlm, 1), "0.0000001");
        assert_eq!(format_minor(Asset::Xlm, 12_345_678), "1.2345678");
    }

    #[test]
    fn formats_btc_with_eight_decimals() {
        // 1 satoshi
        assert_eq!(format_minor(Asset::Btc, 1), "0.00000001");
        assert_eq!(format_minor(Asset::Btc, 0), "0.00000000");
        assert_eq!(format_minor(Asset::Btc, 100_000_000), "1.00000000");
        assert_eq!(format_minor(Asset::Btc, 250_000_000), "2.50000000");
    }

    #[test]
    fn formats_eth_with_eighteen_decimals() {
        // 1 ETH = 1_000_000_000_000_000_000 wei
        assert_eq!(
            format_minor(Asset::Eth, 1_000_000_000_000_000_000),
            "1.000000000000000000"
        );
        assert_eq!(
            format_minor(Asset::Eth, 0),
            "0.000000000000000000"
        );
        assert_eq!(
            format_minor(Asset::Eth, 1),
            "0.000000000000000001"
        );
        // 1.5 ETH
        assert_eq!(
            format_minor(Asset::Eth, 1_500_000_000_000_000_000),
            "1.500000000000000000"
        );
    }

    #[test]
    fn formats_negative_amounts() {
        assert_eq!(format_minor(Asset::Usdc, -15_000_000), "-1.5000000");
        assert_eq!(format_minor(Asset::Btc, -1), "-0.00000001");
        assert_eq!(format_minor(Asset::Eth, -1_000_000_000_000_000_000), "-1.000000000000000000");
    }

    #[test]
    fn decimal_places_match_asset_decimals_for_all_assets() {
        for asset in Asset::ALL {
            let formatted = format_minor(asset, 0);
            let (_, frac) = formatted.split_once('.').expect("has decimal point");
            assert_eq!(
                frac.len(),
                asset.decimals() as usize,
                "{asset} should have {} decimal places, got formatted: {formatted}",
                asset.decimals()
            );
        }
    }

    // ── BalanceResponse serialization tests ─────────────────────────────────

    #[test]
    fn balance_response_fields_match_issue_example() {
        // Issue example: 1.50 USDC → available_minor=15000000, available="1.5000000"
        let balance = Balance {
            asset: Asset::Usdc,
            available: 15_000_000,
            held: 0,
        };
        let resp = BalanceResponse::from_balance(balance);

        assert_eq!(resp.asset, Asset::Usdc);
        assert_eq!(resp.available_minor, 15_000_000);
        assert_eq!(resp.available, "1.5000000");
        assert_eq!(resp.held_minor, 0);
        assert_eq!(resp.held, "0.0000000");
    }

    #[test]
    fn balance_response_serializes_to_expected_json() {
        let balance = Balance {
            asset: Asset::Usdc,
            available: 15_000_000,
            held: 5_000_000,
        };
        let resp = BalanceResponse::from_balance(balance);
        let json = serde_json::to_value(&resp).unwrap();

        assert_eq!(json["asset"], "USDC");
        assert_eq!(json["available_minor"], 15_000_000_i64);
        assert_eq!(json["available"], "1.5000000");
        assert_eq!(json["held_minor"], 5_000_000_i64);
        assert_eq!(json["held"], "0.5000000");
    }

    #[test]
    fn balance_response_for_all_assets() {
        let cases: &[(Asset, i128, &str, i128, &str)] = &[
            (Asset::Usdc, 15_000_000, "1.5000000", 0, "0.0000000"),
            (Asset::Xlm, 10_000_000, "1.0000000", 5_000_000, "0.5000000"),
            (Asset::Btc, 100_000_000, "1.00000000", 0, "0.00000000"),
            (
                Asset::Eth,
                1_000_000_000_000_000_000,
                "1.000000000000000000",
                0,
                "0.000000000000000000",
            ),
        ];

        for &(asset, avail, avail_str, held, held_str) in cases {
            let resp = BalanceResponse::from_balance(Balance {
                asset,
                available: avail,
                held,
            });
            assert_eq!(resp.available_minor, avail, "{asset}");
            assert_eq!(resp.available, avail_str, "{asset}");
            assert_eq!(resp.held_minor, held, "{asset}");
            assert_eq!(resp.held, held_str, "{asset}");
        }
    }

    #[test]
    fn balance_response_with_held_amount() {
        let balance = Balance {
            asset: Asset::Btc,
            available: 50_000_000,
            held: 10_000_000,
        };
        let resp = BalanceResponse::from_balance(balance);

        assert_eq!(resp.available_minor, 50_000_000);
        assert_eq!(resp.available, "0.50000000");
        assert_eq!(resp.held_minor, 10_000_000);
        assert_eq!(resp.held, "0.10000000");
    }

    // ── HTTP integration tests ───────────────────────────────────────────────

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
    /// the real store, then asserts `GET /v1/balances` returns the new response
    /// shape with minor-unit integers and fixed-decimal strings.
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

        // Verify the new response shape: minor-unit integers and decimal strings.
        assert_eq!(usdc["available_minor"], 25_000_000);
        assert_eq!(usdc["available"], "2.5000000");
        assert_eq!(usdc["held_minor"], 0);
        assert_eq!(usdc["held"], "0.0000000");
    }
}
