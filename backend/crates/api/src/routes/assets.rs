use axum::routing::get;
use axum::{Json, Router};
use engipay_core::{Asset, Chain};
use serde::Serialize;
use utoipa::ToSchema;

use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/assets", get(list_assets))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AssetInfo {
    pub symbol: &'static str,
    pub name: &'static str,
    /// Precision the ledger stores and reports balances in.
    pub decimals: u32,
    /// Every network this asset can be deposited from or withdrawn to.
    pub networks: Vec<NetworkInfo>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct NetworkInfo {
    pub chain: Chain,
    /// On-chain precision, which can be coarser than the ledger's (Base USDC).
    pub decimals: u32,
}

/// List every asset EngiPay supports.
///
/// Returns a stable list derived from the single source of truth in
/// `engipay-core`, so the app never shows an asset the backend cannot move.
#[utoipa::path(
    get,
    path = "/v1/assets",
    responses(
        (status = 200, description = "Supported assets", body = Vec<AssetInfo>)
    ),
    tag = "assets"
)]
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
