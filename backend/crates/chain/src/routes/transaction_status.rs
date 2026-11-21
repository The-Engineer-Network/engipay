//! GET /internal/transactions/{chain}/{hash}
//!
//! Returns the status and confirmation count for a transaction.
//! Currently implemented for Stellar; returns 501 for other chains.

use std::sync::Arc;

use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;

use engipay_core::Chain;

use crate::stellar::StellarClient;

/// Shared Stellar client injected into the route.
#[derive(Clone)]
pub struct TransactionStatusState {
    pub stellar: Option<Arc<StellarClient>>,
}

#[derive(Serialize)]
pub struct TransactionStatusResponse {
    pub chain: String,
    pub hash: String,
    pub status: &'static str,
    pub confirmations: Option<u64>,
}

pub async fn get_transaction_status(
    axum::extract::State(state): axum::extract::State<TransactionStatusState>,
    Path((chain_str, hash)): Path<(String, String)>,
) -> impl IntoResponse {
    let chain = match chain_str.to_lowercase().as_str() {
        "stellar" => Chain::Stellar,
        "base" => Chain::Base,
        "bitcoin" => Chain::Bitcoin,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": { "code": "unknown_chain", "message": format!("unknown chain {:?}", chain_str) }
                })),
            )
                .into_response();
        }
    };

    match chain {
        Chain::Stellar => {
            let Some(client) = &state.stellar else {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(serde_json::json!({
                        "error": { "code": "not_configured", "message": "Stellar client not configured" }
                    })),
                )
                    .into_response();
            };

            match client.find_transaction(&hash).await {
                Ok(Some(tx)) => {
                    let (status, confirmations) = if tx.successful {
                        ("confirmed", Some(tx.ledger))
                    } else {
                        ("failed", None)
                    };
                    (
                        StatusCode::OK,
                        Json(serde_json::json!({
                            "chain": chain_str,
                            "hash": hash,
                            "status": status,
                            "confirmations": confirmations,
                        })),
                    )
                        .into_response()
                }
                Ok(None) => (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({
                        "error": { "code": "not_found", "message": "transaction not found" }
                    })),
                )
                    .into_response(),
                Err(error) => (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({
                        "error": { "code": "upstream_error", "message": error.to_string() }
                    })),
                )
                    .into_response(),
            }
        }
        _ => (
            StatusCode::NOT_IMPLEMENTED,
            Json(serde_json::json!({
                "error": { "code": "not_implemented", "message": format!("{chain:?} transaction lookup not yet implemented") }
            })),
        )
            .into_response(),
    }
}
