//! `GET /internal/balances` — reports the current on-chain custody balance
//! for each configured chain.
//!
//! Used by the API service to compare on-chain holdings against the ledger
//! without each process needing its own chain access.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::response::IntoResponse;
use serde::Serialize;

use crate::bitcoin::BitcoinEsploraClient;
use crate::evm::BaseClient;
use crate::stellar::StellarClient;

/// One entry in the balances response.
#[derive(Debug, Serialize)]
pub struct ChainBalance {
    pub chain: &'static str,
    pub asset: &'static str,
    /// Balance in the asset's smallest ledger units (stroops, wei, satoshis, …).
    pub balance_minor: String,
}

/// State the balances handler is extracted from.
#[derive(Clone)]
pub struct BalancesState {
    pub stellar: Option<Arc<StellarClient>>,
    pub base: Option<Arc<BaseClient>>,
    pub bitcoin: Option<Arc<BitcoinEsploraClient>>,
}

impl BalancesState {
    pub fn new() -> Self {
        Self {
            stellar: None,
            base: None,
            bitcoin: None,
        }
    }

    pub fn with_stellar(mut self, client: StellarClient) -> Self {
        self.stellar = Some(Arc::new(client));
        self
    }

    pub fn with_base(mut self, client: BaseClient) -> Self {
        self.base = Some(Arc::new(client));
        self
    }

    pub fn with_bitcoin(mut self, client: BitcoinEsploraClient) -> Self {
        self.bitcoin = Some(Arc::new(client));
        self
    }
}

pub async fn get_balances(State(state): State<BalancesState>) -> impl IntoResponse {
    let mut balances: Vec<ChainBalance> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    if let Some(ref stellar) = state.stellar {
        match stellar.custody_balances().await {
            Ok(bals) => {
                for (asset, minor) in bals {
                    balances.push(ChainBalance {
                        chain: "stellar",
                        asset: asset.symbol(),
                        balance_minor: minor.to_string(),
                    });
                }
            }
            Err(e) => errors.push(format!("stellar: {e}")),
        }
    }

    if let Some(ref base) = state.base {
        match base.custody_balances().await {
            Ok(bals) => {
                for (asset, minor) in bals {
                    balances.push(ChainBalance {
                        chain: "base",
                        asset: asset.symbol(),
                        balance_minor: minor.to_string(),
                    });
                }
            }
            Err(e) => errors.push(format!("base: {e}")),
        }
    }

    if let Some(ref btc) = state.bitcoin {
        match btc.custody_balance_sats().await {
            Ok(sats) => {
                balances.push(ChainBalance {
                    chain: "bitcoin",
                    asset: "BTC",
                    balance_minor: sats.to_string(),
                });
            }
            Err(e) => errors.push(format!("bitcoin: {e}")),
        }
    }

    Json(serde_json::json!({
        "balances": balances,
        "errors": errors,
    }))
}


