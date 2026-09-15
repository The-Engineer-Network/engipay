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
    pub decimals: u32,
    pub chain: Chain,
}

/// The assets EngiPay supports, from the single definition in `engipay-core`,
/// so the app never shows an asset the backend cannot move.
async fn list_assets() -> Json<Vec<AssetInfo>> {
    Json(
        Asset::ALL
            .into_iter()
            .map(|asset| AssetInfo {
                symbol: asset.symbol(),
                name: asset.name(),
                decimals: asset.decimals(),
                chain: asset.chain(),
            })
            .collect(),
    )
}
