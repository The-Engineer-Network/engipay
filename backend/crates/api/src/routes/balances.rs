use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use engipay_core::Asset;
use engipay_ledger::Balance;
use engipay_ledger::postgres::{ActiveHold, PostgresLedgerStore};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

pub fn routes() -> Router<AppState> {
    Router::new().route("/balances", get(get_balances))
}

/// Query parameters accepted by `GET /v1/balances`.
#[derive(Debug, Default, Deserialize)]
pub struct BalancesQuery {
    /// When `true`, include a per-hold breakdown in each balance entry.
    #[serde(default)]
    pub include_holds: bool,
}

/// One active (open) hold, included when `?include_holds=true`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HoldItem {
    /// The idempotency reference that created this hold.
    pub reference: String,
    pub asset: Asset,
    /// Raw integer in the asset's smallest unit.
    pub amount_minor: i128,
    /// Fixed-decimal string with exactly `asset.decimals()` fractional digits.
    pub amount: String,
    /// RFC 3339 creation timestamp.
    pub created_at: String,
}

impl HoldItem {
    pub fn from_active_hold(hold: ActiveHold) -> Self {
        let amount = format_minor(hold.asset, hold.amount);
        Self {
            reference: hold.reference,
            asset: hold.asset,
            amount_minor: hold.amount,
            amount,
            created_at: hold.created_at,
        }
    }
}

/// API response shape for a single asset balance.
///
/// Both raw minor-unit integers and exact fixed-decimal strings are returned
/// so frontend clients can display amounts without floating-point arithmetic.
///
/// Example for 1.5 USDC (7 decimals) without holds:
/// ```json
/// {
///   "asset": "USDC",
///   "available_minor": 15000000,
///   "available": "1.5000000",
///   "held_minor": 0,
///   "held": "0.0000000",
///   "holds": null
/// }
/// ```
///
/// With `?include_holds=true`, `holds` is an array (possibly empty):
/// ```json
/// {
///   "asset": "USDC",
///   "available_minor": 15000000,
///   "available": "1.5000000",
///   "held_minor": 5000000,
///   "held": "0.5000000",
///   "holds": [
///     {
///       "reference": "wd-abc123",
///       "asset": "USDC",
///       "amount_minor": 5000000,
///       "amount": "0.5000000",
///       "created_at": "2026-09-30T11:00:00Z"
///     }
///   ]
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
    /// Per-hold breakdown. `None` unless `?include_holds=true` was requested.
    /// An empty array means the user has no open holds for this asset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub holds: Option<Vec<HoldItem>>,
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
            holds: None,
        }
    }

    pub fn with_holds(mut self, holds: Vec<HoldItem>) -> Self {
        self.holds = Some(holds);
        self
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
/// Pass `?include_holds=true` to receive a per-hold breakdown under each
/// balance's `holds` field.
async fn get_balances(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(params): Query<BalancesQuery>,
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

    let response: Vec<BalanceResponse> = if params.include_holds {
        let active_holds = store
            .get_active_holds(user_id)
            .await
            .map_err(|err| ApiError::Internal(anyhow::anyhow!(err.to_string())))?;

        balances
            .into_iter()
            .map(|b| {
                let asset = b.asset;
                let hold_items: Vec<HoldItem> = active_holds
                    .iter()
                    .filter(|h| h.asset == asset)
                    .cloned()
                    .map(HoldItem::from_active_hold)
                    .collect();
                BalanceResponse::from_balance(b).with_holds(hold_items)
            })
            .collect()
    } else {
        balances
            .into_iter()
            .map(BalanceResponse::from_balance)
            .collect()
    };

    Ok(Json(response))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use engipay_core::Asset;
    use engipay_ledger::Balance;
    use engipay_ledger::postgres::ActiveHold;

    use super::{BalanceResponse, HoldItem, format_minor};

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
        assert_eq!(format_minor(Asset::Btc, 1), "0.00000001");
        assert_eq!(format_minor(Asset::Btc, 0), "0.00000000");
        assert_eq!(format_minor(Asset::Btc, 100_000_000), "1.00000000");
        assert_eq!(format_minor(Asset::Btc, 250_000_000), "2.50000000");
    }

    #[test]
    fn formats_eth_with_eighteen_decimals() {
        assert_eq!(
            format_minor(Asset::Eth, 1_000_000_000_000_000_000),
            "1.000000000000000000"
        );
        assert_eq!(format_minor(Asset::Eth, 0), "0.000000000000000000");
        assert_eq!(format_minor(Asset::Eth, 1), "0.000000000000000001");
        assert_eq!(
            format_minor(Asset::Eth, 1_500_000_000_000_000_000),
            "1.500000000000000000"
        );
    }

    #[test]
    fn formats_negative_amounts() {
        assert_eq!(format_minor(Asset::Usdc, -15_000_000), "-1.5000000");
        assert_eq!(format_minor(Asset::Btc, -1), "-0.00000001");
        assert_eq!(
            format_minor(Asset::Eth, -1_000_000_000_000_000_000),
            "-1.000000000000000000"
        );
    }

    #[test]
    fn decimal_places_match_asset_decimals_for_all_assets() {
        for asset in Asset::ALL {
            let formatted = format_minor(asset, 0);
            let (_, frac) = formatted.split_once('.').expect("has decimal point");
            assert_eq!(
                frac.len(),
                asset.decimals() as usize,
                "{asset} should have {} decimal places, got: {formatted}",
                asset.decimals()
            );
        }
    }

    // ── BalanceResponse (without holds) tests ────────────────────────────────

    #[test]
    fn balance_response_fields_match_issue_example() {
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
        assert!(resp.holds.is_none(), "holds absent when not requested");
    }

    #[test]
    fn balance_response_serializes_without_holds_field_when_none() {
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
        // holds field should be absent entirely (skip_serializing_if = None)
        assert!(
            json.get("holds").is_none(),
            "holds key must be absent when None"
        );
    }

    #[test]
    fn balance_response_for_all_assets_without_holds() {
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
            assert!(resp.holds.is_none(), "{asset} holds should be None");
        }
    }

    // ── HoldItem tests ───────────────────────────────────────────────────────

    #[test]
    fn hold_item_from_active_hold_formats_amount() {
        let hold = ActiveHold {
            reference: "wd-abc123".to_string(),
            asset: Asset::Usdc,
            amount: 5_000_000,
            created_at: "2026-09-30T11:00:00+00:00".to_string(),
        };
        let item = HoldItem::from_active_hold(hold);

        assert_eq!(item.reference, "wd-abc123");
        assert_eq!(item.asset, Asset::Usdc);
        assert_eq!(item.amount_minor, 5_000_000);
        assert_eq!(item.amount, "0.5000000");
        assert_eq!(item.created_at, "2026-09-30T11:00:00+00:00");
    }

    #[test]
    fn hold_item_serializes_to_expected_json() {
        let hold = ActiveHold {
            reference: "wd-xyz".to_string(),
            asset: Asset::Btc,
            amount: 100_000_000,
            created_at: "2026-09-30T12:00:00+00:00".to_string(),
        };
        let item = HoldItem::from_active_hold(hold);
        let json = serde_json::to_value(&item).unwrap();

        assert_eq!(json["reference"], "wd-xyz");
        assert_eq!(json["asset"], "BTC");
        assert_eq!(json["amount_minor"], 100_000_000_i64);
        assert_eq!(json["amount"], "1.00000000");
        assert_eq!(json["created_at"], "2026-09-30T12:00:00+00:00");
    }

    // ── BalanceResponse with holds tests ─────────────────────────────────────

    #[test]
    fn balance_response_with_holds_includes_holds_array() {
        let balance = Balance {
            asset: Asset::Usdc,
            available: 10_000_000,
            held: 5_000_000,
        };
        let hold_item = HoldItem::from_active_hold(ActiveHold {
            reference: "wd-hold1".to_string(),
            asset: Asset::Usdc,
            amount: 5_000_000,
            created_at: "2026-09-30T10:00:00+00:00".to_string(),
        });
        let resp = BalanceResponse::from_balance(balance).with_holds(vec![hold_item]);

        assert_eq!(resp.holds.as_ref().unwrap().len(), 1);
        let h = &resp.holds.as_ref().unwrap()[0];
        assert_eq!(h.reference, "wd-hold1");
        assert_eq!(h.amount_minor, 5_000_000);
        assert_eq!(h.amount, "0.5000000");
    }

    #[test]
    fn balance_response_with_empty_holds_array_serializes_correctly() {
        let balance = Balance {
            asset: Asset::Usdc,
            available: 10_000_000,
            held: 0,
        };
        let resp = BalanceResponse::from_balance(balance).with_holds(vec![]);
        let json = serde_json::to_value(&resp).unwrap();

        // holds key is present with an empty array
        assert_eq!(json["holds"], serde_json::json!([]));
    }

    #[test]
    fn balance_response_holds_serializes_full_shape() {
        let balance = Balance {
            asset: Asset::Usdc,
            available: 20_000_000,
            held: 15_000_000,
        };
        let hold_items = vec![
            HoldItem::from_active_hold(ActiveHold {
                reference: "wd-1".to_string(),
                asset: Asset::Usdc,
                amount: 10_000_000,
                created_at: "2026-09-30T09:00:00+00:00".to_string(),
            }),
            HoldItem::from_active_hold(ActiveHold {
                reference: "wd-2".to_string(),
                asset: Asset::Usdc,
                amount: 5_000_000,
                created_at: "2026-09-30T10:00:00+00:00".to_string(),
            }),
        ];
        let resp = BalanceResponse::from_balance(balance).with_holds(hold_items);
        let json = serde_json::to_value(&resp).unwrap();

        let holds = json["holds"].as_array().unwrap();
        assert_eq!(holds.len(), 2);
        assert_eq!(holds[0]["reference"], "wd-1");
        assert_eq!(holds[0]["amount_minor"], 10_000_000_i64);
        assert_eq!(holds[0]["amount"], "1.0000000");
        assert_eq!(holds[1]["reference"], "wd-2");
        assert_eq!(holds[1]["amount_minor"], 5_000_000_i64);
        assert_eq!(holds[1]["amount"], "0.5000000");
    }

    #[test]
    fn holds_only_include_matching_asset() {
        // Simulate two holds: one USDC, one XLM — only USDC should appear in
        // the USDC balance's holds list.
        let usdc_balance = Balance {
            asset: Asset::Usdc,
            available: 10_000_000,
            held: 5_000_000,
        };
        let all_holds = vec![
            ActiveHold {
                reference: "wd-usdc".to_string(),
                asset: Asset::Usdc,
                amount: 5_000_000,
                created_at: "2026-09-30T10:00:00+00:00".to_string(),
            },
            ActiveHold {
                reference: "wd-xlm".to_string(),
                asset: Asset::Xlm,
                amount: 10_000_000,
                created_at: "2026-09-30T10:01:00+00:00".to_string(),
            },
        ];

        let asset = usdc_balance.asset;
        let hold_items: Vec<HoldItem> = all_holds
            .into_iter()
            .filter(|h| h.asset == asset)
            .map(HoldItem::from_active_hold)
            .collect();
        let resp = BalanceResponse::from_balance(usdc_balance).with_holds(hold_items);

        assert_eq!(resp.holds.as_ref().unwrap().len(), 1);
        assert_eq!(resp.holds.as_ref().unwrap()[0].reference, "wd-usdc");
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
    async fn rejects_include_holds_without_a_bearer_token() {
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

    /// Requires `DATABASE_URL`: deposit + hold, then assert `?include_holds=true`
    /// returns the hold in the response.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn include_holds_true_populates_holds_array() {
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
        let ref_id = format!("holds-test-dep-{}", user.as_uuid());
        store.deposit(user, deposit, &ref_id).await.unwrap();

        let hold_ref = format!("holds-test-hold-{}", user.as_uuid());
        let hold_amount = Money::from_minor(Asset::Usdc, 10_000_000);
        store.create_hold(user, hold_amount, &hold_ref).await.unwrap();

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

        // Without include_holds: holds field absent
        let response = app
            .clone()
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
        let usdc = body
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["asset"] == "USDC")
            .expect("USDC balance present");
        assert!(usdc.get("holds").is_none(), "holds absent without param");

        // With include_holds=true: holds array present and populated
        let response_with_holds = app
            .oneshot(
                Request::builder()
                    .uri("/v1/balances?include_holds=true")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response_with_holds.status(), StatusCode::OK);
        let bytes = response_with_holds
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        let usdc = body
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["asset"] == "USDC")
            .expect("USDC balance present");

        assert_eq!(usdc["available_minor"], 15_000_000);
        assert_eq!(usdc["available"], "1.5000000");
        assert_eq!(usdc["held_minor"], 10_000_000);
        assert_eq!(usdc["held"], "1.0000000");

        let holds = usdc["holds"].as_array().expect("holds array present");
        assert_eq!(holds.len(), 1);
        assert_eq!(holds[0]["reference"], hold_ref);
        assert_eq!(holds[0]["asset"], "USDC");
        assert_eq!(holds[0]["amount_minor"], 10_000_000_i64);
        assert_eq!(holds[0]["amount"], "1.0000000");
        assert!(
            holds[0]["created_at"].as_str().unwrap().contains('T'),
            "created_at is RFC 3339"
        );
    }

    /// Requires `DATABASE_URL`: no holds → holds is an empty array when
    /// `?include_holds=true`.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn include_holds_true_with_no_holds_returns_empty_array() {
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
                Money::from_minor(Asset::Usdc, 10_000_000),
                &format!("no-holds-dep-{}", user.as_uuid()),
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
        let usdc = body
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["asset"] == "USDC")
            .expect("USDC balance present");

        let holds = usdc["holds"].as_array().expect("holds key present");
        assert!(holds.is_empty(), "no active holds → empty array");
    }

    /// Requires `DATABASE_URL`: verifies the new response shape with minor-unit
    /// integers and fixed-decimal strings (regression test from #116).
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

        assert_eq!(usdc["available_minor"], 25_000_000);
        assert_eq!(usdc["available"], "2.5000000");
        assert_eq!(usdc["held_minor"], 0);
        assert_eq!(usdc["held"], "0.0000000");
        // holds absent when not requested
        assert!(usdc.get("holds").is_none());
    }
}
