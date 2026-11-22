use axum::routing::get;
use axum::{Json, Router};
use engipay_core::{Asset, Chain};
use serde::Serialize;

use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/assets", get(list_assets))
}

#[derive(Debug, Serialize)]
pub struct AssetInfo {
    pub symbol: &'static str,
    pub name: &'static str,
    /// Precision the ledger stores and reports balances in.
    pub decimals: u32,
    /// Every network this asset can be deposited from or withdrawn to.
    pub networks: Vec<NetworkInfo>,
}

#[derive(Debug, Serialize)]
pub struct NetworkInfo {
    pub chain: Chain,
    /// On-chain precision, which can be coarser than the ledger's (Base USDC).
    pub decimals: u32,
}

/// The assets EngiPay supports, from the single definition in `engipay-core`,
/// so the app never shows an asset or network the backend cannot move.
async fn list_assets() -> Json<Vec<AssetInfo>> {
    Json(
        Asset::ALL
            .into_iter()
            .map(|asset| AssetInfo {
                symbol: asset.symbol(),
                name: asset.name(),
                decimals: asset.decimals(),
                networks: asset
                    .networks()
                    .iter()
                    .filter_map(|&chain| {
                        asset
                            .network_decimals(chain)
                            .map(|decimals| NetworkInfo { chain, decimals })
                    })
                    .collect(),
            })
            .collect(),
    )
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::ServiceExt;

    use super::*;
    use crate::config::Config;
    use crate::middleware::rate_limit::RateLimiter;

    fn test_app() -> Router {
        let config = Config::for_tests();
        routes().with_state(AppState::with_fakes(None, config, RateLimiter::new()))
    }

    #[tokio::test]
    async fn list_assets_returns_usdc_xlm_eth_and_btc_with_decimals() {
        let Json(assets) = list_assets().await;

        let usdc = assets
            .iter()
            .find(|a| a.symbol == "USDC")
            .expect("USDC must be present");
        assert_eq!(usdc.name, "USD Coin");
        assert_eq!(usdc.decimals, 7);

        let xlm = assets
            .iter()
            .find(|a| a.symbol == "XLM")
            .expect("XLM must be present");
        assert_eq!(xlm.name, "Stellar Lumens");
        assert_eq!(xlm.decimals, 7);

        let eth = assets
            .iter()
            .find(|a| a.symbol == "ETH")
            .expect("ETH must be present");
        assert_eq!(eth.name, "Ether");
        assert_eq!(eth.decimals, 18);

        let btc = assets
            .iter()
            .find(|a| a.symbol == "BTC")
            .expect("BTC must be present");
        assert_eq!(btc.name, "Bitcoin");
        assert_eq!(btc.decimals, 8);
    }

    #[tokio::test]
    async fn assets_endpoint_returns_200_and_lists_assets_with_decimals() {
        let app = test_app();
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/assets")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        let assets = body.as_array().expect("response must be a JSON array");

        let find_asset = |sym: &str| {
            assets
                .iter()
                .find(|a| a["symbol"] == sym)
                .unwrap_or_else(|| panic!("{sym} must be present in response"))
        };

        let usdc = find_asset("USDC");
        assert_eq!(usdc["decimals"], 7);

        let xlm = find_asset("XLM");
        assert_eq!(xlm["decimals"], 7);

        let eth = find_asset("ETH");
        assert_eq!(eth["decimals"], 18);

        let btc = find_asset("BTC");
        assert_eq!(btc["decimals"], 8);
    }
}
