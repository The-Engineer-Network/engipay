//! SEP-31: Cross-Border Payments API (receiving anchor role).
//!
//! This module implements the receiving-anchor side of Stellar's SEP-31
//! standard, allowing senders abroad to pay EngiPay users. It exposes:
//!
//! * `GET  /sep31/info`             – anchor metadata (assets, fields, limits)
//! * `POST /sep31/transactions`     – create an incoming payment
//! * `GET  /sep31/transactions/:id` – query a payment's status
//! * `POST /sep31/transactions/:id/callback` – sender-facing callback handler
//!
//! Authentication reuses SEP-10: the sender must present a JWT issued by our
//! SEP-10 endpoint. The JWT's `sub` (the sender's Stellar account) is used as
//! the `sender_id` for created transactions.

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::stellar::sep10::{Sep10Auth, Sep10Claims};

/// Status values defined by SEP-31.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Sep31Status {
    /// Transaction created, awaiting sender's payment.
    PendingSender,
    /// Sender's payment received, awaiting processing.
    PendingReceiver,
    /// Funds credited to the recipient.
    Completed,
    /// Transaction could not be completed.
    Error,
    /// Transaction was refunded to the sender.
    Refunded,
    /// Transaction was cancelled.
    Expired,
}

impl Sep31Status {
    /// Whether the transaction is in a terminal state.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Sep31Status::Completed
                | Sep31Status::Error
                | Sep31Status::Refunded
                | Sep31Status::Expired
        )
    }
}

/// A single SEP-31 transaction record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sep31Transaction {
    pub id: String,
    pub status: Sep31Status,
    pub status_eta: Option<i64>,
    pub amount_in: String,
    pub amount_in_asset: String,
    pub amount_out: String,
    pub amount_out_asset: String,
    pub amount_fee: String,
    pub amount_fee_asset: String,
    pub asset_code: String,
    pub asset_issuer: Option<String>,
    pub sender_id: String,
    pub receiver_id: String,
    pub stellar_account_id: String,
    pub stellar_memo: Option<String>,
    pub stellar_memo_type: Option<String>,
    pub started_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub message: Option<String>,
    pub required_info_message: Option<String>,
    pub required_info_updates: Option<Value>,
}

/// Request body for `POST /sep31/transactions`.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateTransactionRequest {
    pub amount: String,
    pub asset_code: String,
    pub asset_issuer: Option<String>,
    pub receiver_id: String,
    #[serde(default)]
    pub sender_id: Option<String>,
    #[serde(default)]
    pub fields: Option<Value>,
    #[serde(default)]
    pub lang: Option<String>,
}

/// Response body for `POST /sep31/transactions`.
#[derive(Debug, Clone, Serialize)]
pub struct CreateTransactionResponse {
    pub id: String,
    pub stellar_account_id: String,
    pub stellar_memo: String,
    pub stellar_memo_type: String,
}

/// Response body for `GET /sep31/transactions/:id`.
#[derive(Debug, Clone, Serialize)]
pub struct TransactionResponse {
    pub transaction: Sep31Transaction,
}

/// Callback payload sent by the sending anchor when the payment is settled.
#[derive(Debug, Clone, Deserialize)]
pub struct CallbackPayload {
    /// The transaction id this callback refers to.
    pub id: String,
    /// The new status the sender is reporting.
    pub status: Sep31Status,
    /// Optional message to surface to the recipient.
    #[serde(default)]
    pub message: Option<String>,
    /// Optional Stellar transaction hash of the payment.
    #[serde(default)]
    pub stellar_transaction_id: Option<String>,
}

/// Shared state for the SEP-31 router.
#[derive(Clone)]
pub struct Sep31State {
    pub auth: Arc<Sep10Auth>,
    pub transactions: Arc<RwLock<HashMap<String, Sep31Transaction>>>,
    pub config: Sep31Config,
}

/// Configuration for the receiving anchor.
#[derive(Debug, Clone)]
pub struct Sep31Config {
    /// Assets we accept, keyed by asset code.
    pub assets: Vec<Sep31Asset>,
    /// The Stellar account that receives incoming payments.
    pub receiving_account: String,
    /// Memo type used for incoming payments ("id" or "hash").
    pub memo_type: String,
    /// Fee percentage applied to incoming amounts (e.g. 0.01 = 1%).
    pub fee_percent: f64,
}

/// An asset accepted by the anchor.
#[derive(Debug, Clone, Serialize)]
pub struct Sep31Asset {
    pub code: String,
    pub issuer: Option<String>,
    pub min_amount: String,
    pub max_amount: String,
    pub fee_fixed: String,
    pub fee_percent: f64,
}

impl Default for Sep31Config {
    fn default() -> Self {
        Self {
            assets: vec![Sep31Asset {
                code: "USDC".to_string(),
                issuer: None,
                min_amount: "1".to_string(),
                max_amount: "1000000".to_string(),
                fee_fixed: "0".to_string(),
                fee_percent: 0.01,
            }],
            receiving_account: String::new(),
            memo_type: "id".to_string(),
            fee_percent: 0.01,
        }
    }
}

/// Builds the SEP-31 router.
pub fn router(state: Sep31State) -> Router {
    Router::new()
        .route("/sep31/info", get(get_info))
        .route("/sep31/transactions", post(create_transaction))
        .route("/sep31/transactions/:id", get(get_transaction))
        .route("/sep31/transactions/:id/callback", post(handle_callback))
        .with_state(state)
}

/// Extracts and validates the SEP-10 JWT from the `Authorization` header.
fn authenticate(
    state: &Sep31State,
    headers: &axum::http::HeaderMap,
) -> Result<Sep10Claims, Response> {
    let header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| unauthorized("missing Authorization header"))?;

    let token = header
        .strip_prefix("Bearer ")
        .ok_or_else(|| unauthorized("invalid Authorization scheme"))?;

    state
        .auth
        .validate_token(token)
        .map_err(|_| unauthorized("invalid or expired token"))
}

fn unauthorized(msg: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": msg })),
    )
        .into_response()
}

fn bad_request(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": msg }))).into_response()
}

fn not_found(msg: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": msg }))).into_response()
}

/// `GET /sep31/info` – returns anchor metadata.
async fn get_info(State(state): State<Sep31State>) -> impl IntoResponse {
    let mut receive: HashMap<String, Value> = HashMap::new();

    for asset in &state.config.assets {
        receive.insert(
            asset.code.clone(),
            json!({
                "enabled": true,
                "min_amount": asset.min_amount,
                "max_amount": asset.max_amount,
                "fee_fixed": asset.fee_fixed,
                "fee_percent": asset.fee_percent,
                "sep12": {
                    "sender": { "types": { "sep31-sender": { "description": "Sender" } } },
                    "receiver": { "types": { "sep31-receiver": { "description": "Recipient" } } }
                },
                "fields": {
                    "transaction": {
                        "receiver_id": {
                            "description": "Recipient identifier",
                            "optional": false
                        }
                    }
                }
            }),
        );
    }

    Json(json!({
        "receive": receive
    }))
}

/// `POST /sep31/transactions` – creates a new incoming payment.
async fn create_transaction(
    State(state): State<Sep31State>,
    headers: axum::http::HeaderMap,
    Json(req): Json<CreateTransactionRequest>,
) -> Response {
    let claims = match authenticate(&state, &headers) {
        Ok(c) => c,
        Err(resp) => return resp,
    };

    // Validate asset.
    let asset = match state
        .config
        .assets
        .iter()
        .find(|a| a.code == req.asset_code)
    {
        Some(a) => a.clone(),
        None => return bad_request("unsupported asset_code"),
    };

    // Validate amount.
    let amount: f64 = match req.amount.parse() {
        Ok(a) => a,
        Err(_) => return bad_request("invalid amount"),
    };
    let min: f64 = asset.min_amount.parse().unwrap_or(0.0);
    let max: f64 = asset.max_amount.parse().unwrap_or(f64::MAX);
    if amount < min || amount > max {
        return bad_request("amount out of bounds");
    }

    if req.receiver_id.trim().is_empty() {
        return bad_request("receiver_id is required");
    }

    // Compute fee and net amount.
    let fee = amount * state.config.fee_percent;
    let net = amount - fee;

    let id = Uuid::new_v4().to_string();
    let now = Utc::now();

    let tx = Sep31Transaction {
        id: id.clone(),
        status: Sep31Status::PendingSender,
        status_eta: Some(3600),
        amount_in: format!("{:.7}", amount),
        amount_in_asset: format_asset(&asset),
        amount_out: format!("{:.7}", net),
        amount_out_asset: format_asset(&asset),
        amount_fee: format!("{:.7}", fee),
        amount_fee_asset: format_asset(&asset),
        asset_code: asset.code.clone(),
        asset_issuer: asset.issuer.clone(),
        sender_id: req.sender_id.unwrap_or_else(|| claims.sub.clone()),
        receiver_id: req.receiver_id,
        stellar_account_id: state.config.receiving_account.clone(),
        stellar_memo: Some(id.clone()),
        stellar_memo_type: Some(state.config.memo_type.clone()),
        started_at: now,
        updated_at: now,
        completed_at: None,
        message: None,
        required_info_message: None,
        required_info_updates: None,
    };

    state
        .transactions
        .write()
        .await
        .insert(id.clone(), tx);

    Json(CreateTransactionResponse {
        id: id.clone(),
        stellar_account_id: state.config.receiving_account.clone(),
        stellar_memo: id,
        stellar_memo_type: state.config.memo_type.clone(),
    })
    .into_response()
}

/// `GET /sep31/transactions/:id` – returns the current status of a payment.
async fn get_transaction(
    State(state): State<Sep31State>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(resp) = authenticate(&state, &headers) {
        return resp;
    }

    let txs = state.transactions.read().await;
    match txs.get(&id) {
        Some(tx) => Json(TransactionResponse {
            transaction: tx.clone(),
        })
        .into_response(),
        None => not_found("transaction not found"),
    }
}

/// `POST /sep31/transactions/:id/callback` – sender reports a status update.
///
/// When the sender reports the payment as settled (`pending_receiver`), we
/// transition the transaction and credit the recipient.
async fn handle_callback(
    State(state): State<Sep31State>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<CallbackPayload>,
) -> Response {
    if let Err(resp) = authenticate(&state, &headers) {
        return resp;
    }

    if payload.id != id {
        return bad_request("callback id does not match path id");
    }

    let mut txs = state.transactions.write().await;
    let tx = match txs.get_mut(&id) {
        Some(t) => t,
        None => return not_found("transaction not found"),
    };

    if tx.status.is_terminal() {
        return bad_request("transaction is already in a terminal state");
    }

    // Apply the reported status transition.
    match payload.status {
        Sep31Status::PendingReceiver => {
            tx.status = Sep31Status::PendingReceiver;
            tx.message = payload.message.clone();
            tx.updated_at = Utc::now();
            // Credit the recipient: mark completed once funds are received.
            credit_recipient(tx);
        }
        Sep31Status::Completed => {
            tx.status = Sep31Status::Completed;
            tx.completed_at = Some(Utc::now());
            tx.updated_at = Utc::now();
            tx.message = payload.message.clone();
        }
        Sep31Status::Error => {
            tx.status = Sep31Status::Error;
            tx.updated_at = Utc::now();
            tx.message = payload.message.clone();
        }
        Sep31Status::Refunded => {
            tx.status = Sep31Status::Refunded;
            tx.updated_at = Utc::now();
            tx.message = payload.message.clone();
        }
        Sep31Status::Expired => {
            tx.status = Sep31Status::Expired;
            tx.updated_at = Utc::now();
            tx.message = payload.message.clone();
        }
        Sep31Status::PendingSender => {
            return bad_request("cannot transition back to pending_sender");
        }
    }

    let response = TransactionResponse {
        transaction: tx.clone(),
    };
    Json(response).into_response()
}

/// Credits the recipient once funds have arrived.
///
/// In a full implementation this would enqueue a ledger credit for the
/// recipient's EngiPay account. Here we transition the transaction to
/// `completed` and stamp the completion time.
fn credit_recipient(tx: &mut Sep31Transaction) {
    tx.status = Sep31Status::Completed;
    tx.completed_at = Some(Utc::now());
    tx.updated_at = Utc::now();
}

/// Formats an asset as `CODE:ISSUER` (or just `CODE` for native assets).
fn format_asset(asset: &Sep31Asset) -> String {
    match &asset.issuer {
        Some(issuer) if !issuer.is_empty() => format!("{}:{}", asset.code, issuer),
        _ => asset.code.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_terminal() {
        assert!(Sep31Status::Completed.is_terminal());
        assert!(Sep31Status::Error.is_terminal());
        assert!(Sep31Status::Refunded.is_terminal());
        assert!(Sep31Status::Expired.is_terminal());
        assert!(!Sep31Status::PendingSender.is_terminal());
        assert!(!Sep31Status::PendingReceiver.is_terminal());
    }

    #[test]
    fn format_asset_with_issuer() {
        let asset = Sep31Asset {
            code: "USDC".to_string(),
            issuer: Some("GABC".to_string()),
            min_amount: "1".to_string(),
            max_amount: "100".to_string(),
            fee_fixed: "0".to_string(),
            fee_percent: 0.0,
        };
        assert_eq!(format_asset(&asset), "USDC:GABC");
    }

    #[test]
    fn format_asset_native() {
        let asset = Sep31Asset {
            code: "XLM".to_string(),
            issuer: None,
            min_amount: "1".to_string(),
            max_amount: "100".to_string(),
            fee_fixed: "0".to_string(),
            fee_percent: 0.0,
        };
        assert_eq!(format_asset(&asset), "XLM");
    }
}