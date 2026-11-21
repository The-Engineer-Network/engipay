//! Esplora HTTP client that wraps [`UtxoWatcher`] as a [`ChainClient`].
//!
//! Esplora (`GET /blocks/tip/height`, `GET /address/:addr/txs`) gives us the
//! current block height and confirmed transactions for a set of custody
//! addresses. The [`BitcoinEsploraClient`] adapts those two calls to the
//! [`ChainClient`] interface so the generic [`watch_chain`] loop can drive it
//! just like Stellar or Base.

use std::time::Duration;

use engipay_core::Chain;
use reqwest::Client;
use serde::Deserialize;

use crate::{ChainClient, ChainError, ObservedDeposit};
use super::utxo::{ConfirmedTransaction, ScriptPubKey, TxOutput, Txid, UtxoWatcher, sats_to_money};

/// An Esplora-backed deposit watcher that implements [`ChainClient`].
pub struct BitcoinEsploraClient {
    base_url: String,
    http: Client,
    watcher: UtxoWatcher,
    custody_addresses: Vec<String>,
}

impl BitcoinEsploraClient {
    pub fn new(esplora_url: impl Into<String>, watcher: UtxoWatcher, custody_addresses: Vec<String>) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("engipay-chain/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("reqwest client build should not fail with these settings");
        Self {
            base_url: esplora_url.into().trim_end_matches('/').to_owned(),
            http,
            watcher,
            custody_addresses,
        }
    }
}

#[derive(Debug, Deserialize)]
struct EsploraVout {
    value: u64,
    scriptpubkey: String,
}

#[derive(Debug, Deserialize)]
struct EsploraStatus {
    confirmed: bool,
    block_height: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct EsploraTransaction {
    txid: String,
    vout: Vec<EsploraVout>,
    status: EsploraStatus,
}

impl ChainClient for BitcoinEsploraClient {
    fn chain(&self) -> Chain {
        Chain::Bitcoin
    }

    async fn latest_height(&self) -> Result<u64, ChainError> {
        let url = format!("{}/blocks/tip/height", self.base_url);
        let text = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| ChainError::Unavailable(e.to_string()))?
            .text()
            .await
            .map_err(|e| ChainError::Unavailable(e.to_string()))?;
        text.trim()
            .parse::<u64>()
            .map_err(|e| ChainError::Unavailable(format!("unexpected tip response: {e}")))
    }

    async fn deposits_since(&self, height: u64) -> Result<Vec<ObservedDeposit>, ChainError> {
        let tip = self.latest_height().await?;
        let mut deposits = Vec::new();

        for address in &self.custody_addresses {
            let url = format!("{}/address/{}/txs", self.base_url, address);
            let raw_txs: Vec<EsploraTransaction> = self
                .http
                .get(&url)
                .send()
                .await
                .map_err(|e| ChainError::Unavailable(e.to_string()))?
                .json()
                .await
                .map_err(|e| ChainError::Unavailable(format!("address tx parse error: {e}")))?;

            // Keep txid → block_height mapping before consuming raw_txs.
            let height_by_txid: std::collections::HashMap<Txid, u64> = raw_txs
                .iter()
                .filter_map(|tx| tx.status.block_height.map(|h| (parse_txid(&tx.txid), h)))
                .collect();

            let confirmed: Vec<ConfirmedTransaction> = raw_txs
                .into_iter()
                .filter(|tx| {
                    tx.status.confirmed
                        && tx.status.block_height.map_or(false, |h| h >= height)
                })
                .map(|tx| {
                    let outputs = tx
                        .vout
                        .into_iter()
                        .map(|v| TxOutput {
                            value_sats: v.value,
                            script_pubkey: ScriptPubKey::new(
                                hex::decode(&v.scriptpubkey).unwrap_or_default(),
                            ),
                        })
                        .collect();
                    ConfirmedTransaction {
                        txid: parse_txid(&tx.txid),
                        outputs,
                    }
                })
                .collect();

            match self.watcher.inspect_confirmed(&confirmed) {
                Ok(detected) => {
                    for utxo in detected {
                        let block_height =
                            height_by_txid.get(&utxo.txid).copied().unwrap_or(height);
                        let confirmations = if tip >= block_height {
                            (tip - block_height + 1) as u32
                        } else {
                            0
                        };
                        deposits.push(ObservedDeposit {
                            address: utxo.address.clone(),
                            money: sats_to_money(utxo.value_sats),
                            reference: format!(
                                "bitcoin:{}-{}",
                                hex::encode(utxo.txid.as_bytes()),
                                utxo.vout
                            ),
                            confirmations,
                        });
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, address = %address, "bitcoin UTXO inspection error");
                }
            }
        }
        Ok(deposits)
    }
}

fn parse_txid(hex_str: &str) -> Txid {
    let bytes = hex::decode(hex_str).unwrap_or_default();
    let mut arr = [0u8; 32];
    let len = bytes.len().min(32);
    arr[..len].copy_from_slice(&bytes[..len]);
    Txid::from_bytes(arr)
}
