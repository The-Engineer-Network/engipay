//! Bitcoin raw transaction broadcast and block inclusion monitoring.
//!
//! Outgoing Bitcoin withdrawals must be serialized and broadcast to the Bitcoin network
//! via an Esplora-compatible `POST /tx` endpoint. This module handles:
//! 1. Validating and submitting raw transaction hex strings to Esplora.
//! 2. Parsing the returned 64-character transaction ID (`txid`).
//! 3. Monitoring the mempool and block confirmation status via `GET /tx/{txid}/status`.
//! 4. Calculating confirmation depth against current chain tip and verifying when the
//!    transaction satisfies [`REQUIRED_CONFIRMATIONS`].

use super::confirmations::{is_bitcoin_confirmed, REQUIRED_CONFIRMATIONS};
use serde::{Deserialize, Serialize};

/// Error types occurring during transaction broadcast or mempool status queries.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BitcoinBroadcastError {
    #[error("raw transaction hex is empty")]
    EmptyTransactionHex,

    #[error("invalid transaction hex string: {0}")]
    InvalidHex(String),

    #[error("network request failed: {0}")]
    NetworkError(String),

    #[error("mempool rejected transaction: {0}")]
    MempoolRejection(String),

    #[error("invalid response from Esplora: {0}")]
    InvalidResponse(String),

    #[error("transaction not found in mempool or blocks: {txid}")]
    TransactionNotFound { txid: String },
}

/// Status of a broadcast Bitcoin transaction as reported by Esplora `/tx/{txid}/status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BitcoinTxStatus {
    /// Whether the transaction has been included in a block.
    pub confirmed: bool,
    /// Block height of inclusion, if confirmed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_height: Option<u64>,
    /// Block hash of inclusion, if confirmed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_hash: Option<String>,
    /// Block timestamp (unix seconds), if confirmed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_time: Option<u64>,
}

impl BitcoinTxStatus {
    /// Creates an unconfirmed (in mempool) transaction status.
    pub fn in_mempool() -> Self {
        Self {
            confirmed: false,
            block_height: None,
            block_hash: None,
            block_time: None,
        }
    }

    /// Creates a confirmed transaction status at a specific block height.
    pub fn confirmed_at(block_height: u64, block_hash: impl Into<String>, block_time: u64) -> Self {
        Self {
            confirmed: true,
            block_height: Some(block_height),
            block_hash: Some(block_hash.into()),
            block_time: Some(block_time),
        }
    }

    /// Calculates the number of block confirmations relative to the current tip height.
    ///
    /// An unconfirmed transaction has 0 confirmations.
    /// A transaction in the tip block has 1 confirmation.
    /// Each block mined above the inclusion block adds 1 confirmation.
    pub fn confirmations(&self, current_tip_height: u64) -> u64 {
        match (self.confirmed, self.block_height) {
            (true, Some(height)) if height <= current_tip_height => {
                current_tip_height - height + 1
            }
            _ => 0,
        }
    }

    /// Determines if the transaction has reached the required confirmation threshold ([`REQUIRED_CONFIRMATIONS`]).
    pub fn is_finalized_for_withdrawal(&self, current_tip_height: u64) -> bool {
        match self.block_height {
            Some(height) => is_bitcoin_confirmed(height, current_tip_height),
            None => false,
        }
    }
}

/// Validates raw transaction hex before submission.
pub fn validate_raw_tx_hex(raw_hex: &str) -> Result<(), BitcoinBroadcastError> {
    let trimmed = raw_hex.trim();
    if trimmed.is_empty() {
        return Err(BitcoinBroadcastError::EmptyTransactionHex);
    }
    if !trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(BitcoinBroadcastError::InvalidHex(
            "contains non-hexadecimal characters".to_string(),
        ));
    }
    if trimmed.len() % 2 != 0 {
        return Err(BitcoinBroadcastError::InvalidHex(
            "odd length hex string".to_string(),
        ));
    }
    // Minimal standard Bitcoin transaction size check (>= 60 bytes = 120 hex chars)
    if trimmed.len() < 120 {
        return Err(BitcoinBroadcastError::InvalidHex(
            "transaction hex is too short to be valid".to_string(),
        ));
    }
    Ok(())
}

/// Broadcasts a raw serialized Bitcoin transaction hex to an Esplora `POST /tx` endpoint.
///
/// On success (HTTP 200), Esplora returns the 64-character lowercase hex `txid`.
/// On failure (e.g. HTTP 400), Esplora returns an error message detailing why the mempool rejected it.
pub async fn broadcast_raw_bitcoin_tx(
    client: &reqwest::Client,
    esplora_url: &str,
    raw_hex: &str,
) -> Result<String, BitcoinBroadcastError> {
    validate_raw_tx_hex(raw_hex)?;

    let url = format!("{}/tx", esplora_url.trim_end_matches('/'));
    let response = client
        .post(&url)
        .body(raw_hex.trim().to_string())
        .send()
        .await
        .map_err(|e| BitcoinBroadcastError::NetworkError(e.to_string()))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| BitcoinBroadcastError::NetworkError(e.to_string()))?;

    if status.is_success() {
        let txid = body.trim().to_string();
        if txid.len() == 64 && txid.chars().all(|c| c.is_ascii_hexdigit()) {
            Ok(txid)
        } else {
            Err(BitcoinBroadcastError::InvalidResponse(format!(
                "expected 64-char txid, got: {txid}"
            )))
        }
    } else {
        Err(BitcoinBroadcastError::MempoolRejection(body.trim().to_string()))
    }
}

/// Fetches the inclusion status of a broadcast transaction from Esplora `GET /tx/{txid}/status`.
pub async fn get_transaction_status(
    client: &reqwest::Client,
    esplora_url: &str,
    txid: &str,
) -> Result<BitcoinTxStatus, BitcoinBroadcastError> {
    let url = format!("{}/tx/{}/status", esplora_url.trim_end_matches('/'), txid.trim());
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| BitcoinBroadcastError::NetworkError(e.to_string()))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(BitcoinBroadcastError::TransactionNotFound {
            txid: txid.to_string(),
        });
    }

    if !response.status().is_success() {
        return Err(BitcoinBroadcastError::NetworkError(format!(
            "esplora returned status {}",
            response.status()
        )));
    }

    response
        .json::<BitcoinTxStatus>()
        .await
        .map_err(|e| BitcoinBroadcastError::InvalidResponse(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_empty_hex_rejected() {
        assert_eq!(
            validate_raw_tx_hex(""),
            Err(BitcoinBroadcastError::EmptyTransactionHex)
        );
        assert_eq!(
            validate_raw_tx_hex("   "),
            Err(BitcoinBroadcastError::EmptyTransactionHex)
        );
    }

    #[test]
    fn validates_non_hex_rejected() {
        assert!(matches!(
            validate_raw_tx_hex("0200000001nothex"),
            Err(BitcoinBroadcastError::InvalidHex(_))
        ));
    }

    #[test]
    fn validates_odd_length_hex_rejected() {
        assert!(matches!(
            validate_raw_tx_hex("020000001"),
            Err(BitcoinBroadcastError::InvalidHex(_))
        ));
    }

    #[test]
    fn validates_too_short_hex_rejected() {
        assert!(matches!(
            validate_raw_tx_hex("02000000010000000000000000"),
            Err(BitcoinBroadcastError::InvalidHex(_))
        ));
    }

    #[test]
    fn validates_standard_tx_hex() {
        let valid_hex = "0200000000010100000000000000000000000000000000000000000000000000000000000000000000000000ffffffff0100e1f50500000000160014000000000000000000000000000000000000000000000000";
        assert!(validate_raw_tx_hex(valid_hex).is_ok());
    }

    #[test]
    fn mempool_status_confirmations_and_finality() {
        let mempool = BitcoinTxStatus::in_mempool();
        assert_eq!(mempool.confirmations(100), 0);
        assert!(!mempool.is_finalized_for_withdrawal(100));

        // Tip height 100, inclusion at 100 -> 1 confirmation (not finalized)
        let confirmed_tip = BitcoinTxStatus::confirmed_at(100, "00000000blockhash", 1700000000);
        assert_eq!(confirmed_tip.confirmations(100), 1);
        assert!(!confirmed_tip.is_finalized_for_withdrawal(100));

        // Tip height 101, inclusion at 100 -> 2 confirmations (finalized!)
        assert_eq!(confirmed_tip.confirmations(101), 2);
        assert!(confirmed_tip.is_finalized_for_withdrawal(101));

        // Tip height 110, inclusion at 100 -> 11 confirmations (finalized)
        assert_eq!(confirmed_tip.confirmations(110), 11);
        assert!(confirmed_tip.is_finalized_for_withdrawal(110));

        // Tip height 99 (reorg or stale tip) -> 0 confirmations
        assert_eq!(confirmed_tip.confirmations(99), 0);
        assert!(!confirmed_tip.is_finalized_for_withdrawal(99));
    }
}
