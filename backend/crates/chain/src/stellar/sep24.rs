//! SEP-24: Hosted Deposit and Withdrawal
//!
//! Implements the interactive flow for deposits (fiat -> crypto) and
//! withdrawals (crypto -> fiat) through Stellar anchors.
//!
//! See: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// SEP-24 errors.
#[derive(Debug, thiserror::Error)]
pub enum Sep24Error {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("anchor rejected request: {0}")]
    Rejected(String),
    #[error("transaction not found: {0}")]
    NotFound(String),
}

/// Start a deposit (fiat -> crypto) with an anchor.
#[derive(Debug, Serialize)]
pub struct DepositRequest {
    /// Asset code (e.g., "USDC")
    pub asset_code: String,
    /// Stellar account that will receive the deposit
    pub account: String,
    /// Optional amount
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<String>,
    /// Optional memo to attach to the Stellar transaction
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
    /// Optional memo type ("text", "id", "hash")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo_type: Option<String>,
}

/// Start a withdrawal (crypto -> fiat) with an anchor.
#[derive(Debug, Serialize)]
pub struct WithdrawRequest {
    /// Asset code (e.g., "USDC")
    pub asset_code: String,
    /// Type of withdrawal (e.g., "bank_account")
    pub type_: String,
    /// Optional amount
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<String>,
    /// Additional fields (bank details, etc.)
    #[serde(flatten)]
    pub fields: HashMap<String, String>,
}

/// Response when starting a deposit or withdrawal.
#[derive(Debug, Deserialize)]
pub struct InteractiveResponse {
    /// Transaction ID for polling status
    pub id: String,
    /// URL for the user to complete KYC/bank details
    pub url: String,
    #[serde(rename = "type")]
    pub response_type: String,
}

/// Transaction status from SEP-24.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransactionStatus {
    /// Deposit/withdrawal created but user hasn't completed interactive flow
    Incomplete,
    /// User has submitted info, pending approval
    PendingUserTransferStart,
    /// Anchor is processing
    PendingAnchor,
    /// User needs to send funds to anchor
    PendingStellar,
    /// External system (bank) is processing
    PendingExternal,
    /// User needs to take action
    PendingUser,
    /// Deposit/withdrawal completed successfully
    Completed,
    /// Too much time passed, transaction expired
    Expired,
    /// Transaction failed or was rejected
    Error,
}

/// Full transaction information from SEP-24.
#[derive(Debug, Deserialize)]
pub struct TransactionInfo {
    pub id: String,
    pub status: TransactionStatus,
    #[serde(default)]
    pub status_message: Option<String>,
    pub amount_in: Option<String>,
    pub amount_out: Option<String>,
    pub amount_fee: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub stellar_transaction_id: Option<String>,
    pub external_transaction_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TransactionResponse {
    transaction: TransactionInfo,
}

/// Start an interactive deposit flow.
///
/// Returns the transaction ID and the URL where the user completes KYC
/// and provides bank details.
pub async fn start_deposit(
    http_client: &Client,
    anchor_url: &str,
    jwt: &str,
    request: &DepositRequest,
) -> Result<InteractiveResponse, Sep24Error> {
    let url = format!(
        "{}/sep24/transactions/deposit/interactive",
        anchor_url.trim_end_matches('/')
    );

    let response = http_client
        .post(&url)
        .bearer_auth(jwt)
        .form(request)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| Sep24Error::Rejected(e.to_string()))?;

    let interactive: InteractiveResponse = response.json().await?;
    Ok(interactive)
}

/// Start an interactive withdrawal flow.
pub async fn start_withdraw(
    http_client: &Client,
    anchor_url: &str,
    jwt: &str,
    request: &WithdrawRequest,
) -> Result<InteractiveResponse, Sep24Error> {
    let url = format!(
        "{}/sep24/transactions/withdraw/interactive",
        anchor_url.trim_end_matches('/')
    );

    let response = http_client
        .post(&url)
        .bearer_auth(jwt)
        .form(request)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| Sep24Error::Rejected(e.to_string()))?;

    let interactive: InteractiveResponse = response.json().await?;
    Ok(interactive)
}

/// Get the status of a transaction.
///
/// Poll this endpoint to track the progress of a deposit or withdrawal.
pub async fn get_transaction(
    http_client: &Client,
    anchor_url: &str,
    jwt: &str,
    transaction_id: &str,
) -> Result<TransactionInfo, Sep24Error> {
    let url = format!("{}/sep24/transaction", anchor_url.trim_end_matches('/'));

    let response = http_client
        .get(&url)
        .bearer_auth(jwt)
        .query(&[("id", transaction_id)])
        .send()
        .await?
        .error_for_status()
        .map_err(|e| Sep24Error::NotFound(e.to_string()))?;

    let wrapper: TransactionResponse = response.json().await?;
    Ok(wrapper.transaction)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deposit_request_serializes_with_optional_fields() {
        let req = DepositRequest {
            asset_code: "USDC".to_owned(),
            account: "GABC123...".to_owned(),
            amount: Some("100.00".to_owned()),
            memo: Some("deposit-123".to_owned()),
            memo_type: Some("text".to_owned()),
        };
        let params = serde_urlencoded::to_string(&req).unwrap();
        assert!(params.contains("asset_code=USDC"));
        assert!(params.contains("account=GABC123"));
        assert!(params.contains("amount=100.00"));
    }

    #[test]
    fn withdraw_request_includes_bank_fields() {
        let mut fields = HashMap::new();
        fields.insert("bank_account".to_owned(), "1234567890".to_owned());
        fields.insert("bank_code".to_owned(), "044".to_owned());

        let req = WithdrawRequest {
            asset_code: "NGN".to_owned(),
            type_: "bank_account".to_owned(),
            amount: Some("50000".to_owned()),
            fields,
        };

        let params = serde_urlencoded::to_string(&req).unwrap();
        assert!(params.contains("asset_code=NGN"));
        assert!(params.contains("bank_account=1234567890"));
    }

    #[test]
    fn transaction_status_deserializes() {
        let json = r#"{"status": "completed"}"#;
        let info: serde_json::Value = serde_json::from_str(json).unwrap();
        let status: TransactionStatus = serde_json::from_value(info["status"].clone()).unwrap();
        assert_eq!(status, TransactionStatus::Completed);
    }
}
