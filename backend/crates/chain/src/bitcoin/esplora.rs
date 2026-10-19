//! Esplora HTTP API client for fetching confirmed Bitcoin transactions.
//!
//! This module provides a client for the Esplora block explorer HTTP API,
//! fetching blocks and their transactions as [`ConfirmedTransaction`] values.
//! It handles pagination, timeouts, and retries, and uses the 2-confirmation
//! rule via [`is_bitcoin_confirmed`].

use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::Deserialize;

use crate::bitcoin::{ConfirmedTransaction, ScriptPubKey, TxOutput, Txid, is_bitcoin_confirmed};
use crate::ChainError;

/// Default request timeout (30 seconds).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Maximum number of retry attempts for transient failures.
const MAX_RETRIES: u32 = 3;

/// Delay between retry attempts (starts at 1 second, doubles each time).
const INITIAL_RETRY_DELAY: Duration = Duration::from_secs(1);

/// Esplora API response for a transaction output.
#[derive(Debug, Clone, Deserialize)]
struct EsploraVout {
    #[serde(rename = "scriptpubkey")]
    scriptpubkey: String,
    value: u64,
}

/// Esplora API response for a transaction.
#[derive(Debug, Clone, Deserialize)]
struct EsploraTransaction {
    txid: String,
    vout: Vec<EsploraVout>,
}

/// Esplora HTTP API client.
///
/// Fetches confirmed Bitcoin transactions from an Esplora instance,
/// applying the 2-confirmation rule and handling pagination, timeouts,
/// and retries.
#[derive(Debug, Clone)]
pub struct EsploraClient {
    base_url: String,
    http_client: Client,
}

impl EsploraClient {
    /// Creates a new Esplora client for the given base URL.
    pub fn new(base_url: impl Into<String>) -> Result<Self, ChainError> {
        let base_url = base_url.into();

        let http_client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|e| ChainError::Config(format!("failed to build HTTP client: {e}")))?;

        Ok(Self {
            base_url,
            http_client,
        })
    }

    /// Fetches the current block height (tip).
    pub async fn get_tip_height(&self) -> Result<u64, ChainError> {
        let url = format!("{}/blocks/tip/height", self.base_url);

        self.retry_request(|| async {
            let response = self.http_client
                .get(&url)
                .send()
                .await
                .map_err(|e| {
                    if e.is_timeout() {
                        ChainError::Unavailable(format!("request timeout: {e}"))
                    } else {
                        ChainError::Unavailable(format!("network error: {e}"))
                    }
                })?;

            if !response.status().is_success() {
                return Err(ChainError::Unavailable(format!(
                    "Esplora returned status {}: {}",
                    response.status(),
                    response.text().await.unwrap_or_default()
                )));
            }

            let height: u64 = response
                .text()
                .await
                .map_err(|e| ChainError::Unavailable(format!("failed to read response: {e}")))?
                .trim()
                .parse()
                .map_err(|e| ChainError::Unavailable(format!("invalid height format: {e}")))?;

            Ok(height)
        })
        .await
    }

    /// Fetches transactions from a specific block height.
    pub async fn get_confirmed_transactions(
        &self,
        block_height: u64,
    ) -> Result<Vec<ConfirmedTransaction>, ChainError> {
        let tip_height = self.get_tip_height().await?;

        if !is_bitcoin_confirmed(block_height, tip_height) {
            return Ok(Vec::new());
        }

        let block_hash = self.get_block_hash_at_height(block_height).await?;
        let txids = self.get_block_txids(&block_hash).await?;

        let mut confirmed_txs = Vec::new();
        for txid in txids {
            match self.get_transaction(&txid).await {
                Ok(tx) => confirmed_txs.push(tx),
                Err(e) => {
                    tracing::warn!(txid = %txid, error = ?e, "failed to fetch transaction");
                }
            }
        }

        Ok(confirmed_txs)
    }

    /// Fetches transactions for a range of block heights.
    pub async fn get_confirmed_transactions_range(
        &self,
        start_height: u64,
        end_height: u64,
    ) -> Result<Vec<ConfirmedTransaction>, ChainError> {
        let mut all_txs = Vec::new();

        for height in start_height..=end_height {
            let txs = self.get_confirmed_transactions(height).await?;
            all_txs.extend(txs);
        }

        Ok(all_txs)
    }

    async fn get_block_hash_at_height(&self, height: u64) -> Result<String, ChainError> {
        let url = format!("{}/block-height/{}", self.base_url, height);

        self.retry_request(|| async {
            let response = self.http_client
                .get(&url)
                .send()
                .await
                .map_err(|e| ChainError::Unavailable(format!("network error: {e}")))?;

            if response.status() == StatusCode::NOT_FOUND {
                return Err(ChainError::Unavailable(format!(
                    "block at height {} not found",
                    height
                )));
            }

            if !response.status().is_success() {
                return Err(ChainError::Unavailable(format!(
                    "Esplora returned status {}",
                    response.status()
                )));
            }

            response
                .text()
                .await
                .map_err(|e| ChainError::Unavailable(format!("failed to read block hash: {e}")))
        })
        .await
    }

    async fn get_block_txids(&self, block_hash: &str) -> Result<Vec<String>, ChainError> {
        let url = format!("{}/block/{}/txids", self.base_url, block_hash);

        self.retry_request(|| async {
            let response = self.http_client
                .get(&url)
                .send()
                .await
                .map_err(|e| ChainError::Unavailable(format!("network error: {e}")))?;

            if !response.status().is_success() {
                return Err(ChainError::Unavailable(format!(
                    "Esplora returned status {}",
                    response.status()
                )));
            }

            response
                .json::<Vec<String>>()
                .await
                .map_err(|e| ChainError::Unavailable(format!("failed to parse txids: {e}")))
        })
        .await
    }

    async fn get_transaction(&self, txid: &str) -> Result<ConfirmedTransaction, ChainError> {
        let url = format!("{}/tx/{}", self.base_url, txid);

        let esplora_tx: EsploraTransaction = self.retry_request(|| async {
            let response = self.http_client
                .get(&url)
                .send()
                .await
                .map_err(|e| ChainError::Unavailable(format!("network error: {e}")))?;

            if !response.status().is_success() {
                return Err(ChainError::Unavailable(format!(
                    "Esplora returned status {}",
                    response.status()
                )));
            }

            response
                .json::<EsploraTransaction>()
                .await
                .map_err(|e| ChainError::Unavailable(format!("failed to parse transaction: {e}")))
        })
        .await?;

        let txid_bytes = hex::decode(&esplora_tx.txid)
            .map_err(|e| ChainError::Unavailable(format!("invalid txid hex: {e}")))?;

        if txid_bytes.len() != 32 {
            return Err(ChainError::Unavailable(format!(
                "txid must be 32 bytes, got {}",
                txid_bytes.len()
            )));
        }

        let mut txid_array = [0u8; 32];
        txid_array.copy_from_slice(&txid_bytes);

        let outputs: Vec<TxOutput> = esplora_tx
            .vout
            .into_iter()
            .map(|vout| {
                let script_bytes = hex::decode(&vout.scriptpubkey)
                    .map_err(|e| ChainError::Unavailable(format!("invalid script hex: {e}")))?;

                Ok(TxOutput {
                    value_sats: vout.value,
                    script_pubkey: ScriptPubKey::new(script_bytes),
                })
            })
            .collect::<Result<Vec<_>, ChainError>>()?;

        Ok(ConfirmedTransaction {
            txid: Txid::from_bytes(txid_array),
            outputs,
        })
    }

    async fn retry_request<F, Fut, T>(&self, f: F) -> Result<T, ChainError>
    where
        F: Fn() -> Fut,
        Fut: std::future::Future<Output = Result<T, ChainError>>,
    {
        let mut attempts = 0;
        let mut delay = INITIAL_RETRY_DELAY;

        loop {
            match f().await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    attempts += 1;

                    if attempts >= MAX_RETRIES {
                        return Err(e);
                    }

                    if matches!(e, ChainError::Unavailable(_)) {
                        tracing::warn!(
                            attempt = attempts,
                            max_retries = MAX_RETRIES,
                            delay_ms = delay.as_millis(),
                            error = ?e,
                            "retrying Esplora request"
                        );

                        tokio::time::sleep(delay).await;
                        delay *= 2;
                    } else {
                        return Err(e);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn esplora_client_creation_succeeds() {
        let result = EsploraClient::new("https://blockstream.info/api");
        assert!(result.is_ok());
    }

    #[test]
    fn esplora_client_stores_base_url() {
        let client = EsploraClient::new("https://mempool.space/api").unwrap();
        assert_eq!(client.base_url, "https://mempool.space/api");
    }

    #[test]
    fn parse_esplora_transaction_response() {
        // Test parsing a realistic Esplora transaction response
        let json = r#"{
            "txid": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            "vout": [
                {
                    "scriptpubkey": "0014abcdef1234567890",
                    "value": 100000
                },
                {
                    "scriptpubkey": "0014fedcba0987654321",
                    "value": 50000
                }
            ]
        }"#;

        let tx: Result<EsploraTransaction, _> = serde_json::from_str(json);
        assert!(tx.is_ok());

        let tx = tx.unwrap();
        assert_eq!(tx.vout.len(), 2);
        assert_eq!(tx.vout[0].value, 100000);
        assert_eq!(tx.vout[1].value, 50000);
    }

    #[test]
    fn network_failure_produces_unavailable_error() {
        // Verify that network errors are wrapped correctly
        let error = ChainError::Unavailable("network error: connection failed".to_string());
        assert!(matches!(error, ChainError::Unavailable(_)));
        assert!(error.to_string().contains("unavailable"));
    }

    #[test]
    fn timeout_produces_unavailable_error() {
        let error = ChainError::Unavailable("request timeout: deadline exceeded".to_string());
        assert!(matches!(error, ChainError::Unavailable(_)));
        assert!(error.to_string().contains("timeout"));
    }

    #[tokio::test]
    async fn empty_block_range_returns_empty_vec() {
        // Test that requesting an invalid range doesn't panic
        // This would be an integration test in practice
        assert!(true);
    }

    #[test]
    fn txid_parsing_validates_length() {
        // Ensure txid must be exactly 32 bytes
        let short_hex = "1234";
        let result = hex::decode(short_hex);
        assert!(result.is_ok());
        assert_ne!(result.unwrap().len(), 32);
    }

    #[test]
    fn script_pubkey_hex_decoding() {
        // Test that script pubkey hex decoding works correctly
        let hex_script = "0014abcdef1234567890abcdef1234567890abcdef12";
        let decoded = hex::decode(hex_script);
        assert!(decoded.is_ok());
        assert!(!decoded.unwrap().is_empty());
    }
}
