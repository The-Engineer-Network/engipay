//! Base chain client: deposit watching via eth_getLogs for USDC Transfer events.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use engipay_core::Chain;
use serde::Deserialize;
use serde_json::json;

use super::erc20::{BaseNetwork, deposits_from_logs};
use super::watcher::{BlockWatcher, FinalizedHeight};
use crate::{ChainClient, ChainError, ObservedDeposit};

/// Base JSON-RPC client for USDC deposit detection.
#[derive(Debug, Clone)]
pub struct BaseClient {
    network: BaseNetwork,
    rpc_url: String,
    http: reqwest::Client,
    /// Deposit addresses to watch, normalized to lowercase.
    deposit_addresses: Arc<HashSet<String>>,
    /// Shared finalized height from the block watcher.
    finalized_height: Option<FinalizedHeight>,
}

/// JSON-RPC 2.0 response for `eth_getLogs`.
#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    #[serde(default)]
    result: Option<T>,
    #[serde(default)]
    error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
struct RpcError {
    code: i64,
    message: String,
}

impl BaseClient {
    /// Creates a new Base client. `deposit_addresses` are normalized internally.
    ///
    /// # Errors
    ///
    /// Returns [`ChainError::Config`] if any deposit address is malformed.
    pub fn new(
        network: BaseNetwork,
        rpc_url: impl Into<String>,
        deposit_addresses: &[String],
    ) -> Result<Self, ChainError> {
        let normalized: Result<HashSet<String>, ChainError> = deposit_addresses
            .iter()
            .map(|addr| {
                super::normalize_address(addr)
                    .ok_or_else(|| ChainError::Config(format!("invalid deposit address: {addr}")))
            })
            .collect();

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("engipay-chain/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| ChainError::Unavailable(e.to_string()))?;

        Ok(Self {
            network,
            rpc_url: rpc_url.into(),
            http,
            deposit_addresses: Arc::new(normalized?),
            finalized_height: None,
        })
    }

    /// Attaches a block watcher so `latest_height()` reads from the shared
    /// finalized height without making an RPC call per poll.
    pub fn with_watcher(mut self, watcher: &BlockWatcher) -> Self {
        self.finalized_height = Some(watcher.height().clone());
        self
    }

    /// The network this client watches; decides which USDC contract counts.
    pub const fn network(&self) -> BaseNetwork {
        self.network
    }

    /// The deposit addresses this client matches `Transfer` logs against,
    /// normalized to lowercase.
    pub fn deposit_addresses(&self) -> &HashSet<String> {
        &self.deposit_addresses
    }

    /// Queries `eth_getLogs` for USDC Transfer events in the given block range.
    async fn get_logs(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<super::erc20::Log>, ChainError> {
        let params = super::erc20::transfer_filter(
            self.network,
            from_block,
            to_block,
            &self.deposit_addresses,
        );
        let request = json!({
            "jsonrpc": "2.0",
            "method": "eth_getLogs",
            "params": params,
            "id": 1
        });

        let response = self
            .http
            .post(&self.rpc_url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ChainError::Unavailable(e.to_string()))?;

        if !response.status().is_success() {
            return Err(ChainError::Unavailable(format!(
                "Base RPC returned HTTP {}",
                response.status()
            )));
        }

        let rpc: RpcResponse<Vec<super::erc20::Log>> = response
            .json()
            .await
            .map_err(|e| ChainError::Unavailable(format!("could not parse RPC response: {e}")))?;

        if let Some(error) = rpc.error {
            return Err(ChainError::Unavailable(format!(
                "eth_getLogs error {}: {}",
                error.code, error.message
            )));
        }

        rpc.result
            .ok_or_else(|| ChainError::Unavailable("eth_getLogs returned no result".to_owned()))
    }

    /// Fetches the latest finalized block number via `eth_getBlockByNumber("finalized", false)`.
    async fn fetch_latest_finalized(&self) -> Result<u64, ChainError> {
        let request = json!({
            "jsonrpc": "2.0",
            "method": "eth_getBlockByNumber",
            "params": ["finalized", false],
            "id": 1
        });

        let response = self
            .http
            .post(&self.rpc_url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ChainError::Unavailable(e.to_string()))?;

        if !response.status().is_success() {
            return Err(ChainError::Unavailable(format!(
                "Base RPC returned HTTP {}",
                response.status()
            )));
        }

        #[derive(Deserialize)]
        struct BlockHeader {
            number: String,
        }

        let rpc: RpcResponse<Option<BlockHeader>> = response
            .json()
            .await
            .map_err(|e| ChainError::Unavailable(format!("could not parse RPC response: {e}")))?;

        if let Some(error) = rpc.error {
            return Err(ChainError::Unavailable(format!(
                "eth_getBlockByNumber error {}: {}",
                error.code, error.message
            )));
        }

        let block = rpc
            .result
            .ok_or_else(|| ChainError::Unavailable("no finalized block yet".to_owned()))?
            .ok_or_else(|| ChainError::Unavailable("finalized block is null".to_owned()))?;

        super::parse_u64(&block.number).ok_or_else(|| {
            ChainError::Unavailable(format!("invalid block number: {}", block.number))
        })
    }

    /// Fetches one block header by height via `eth_getBlockByNumber`, for
    /// reorg detection in [`crate::reorg::ReorgSafeWatcher`].
    ///
    /// Returns `Ok(None)` when the node reports no block at that height
    /// (pruned or not yet produced).
    async fn fetch_block_record(
        &self,
        height: u64,
    ) -> Result<Option<crate::reorg::BlockRecord>, ChainError> {
        let request = json!({
            "jsonrpc": "2.0",
            "method": "eth_getBlockByNumber",
            "params": [format!("{height:#x}"), false],
            "id": 1
        });

        let response = self
            .http
            .post(&self.rpc_url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ChainError::Unavailable(e.to_string()))?;

        if !response.status().is_success() {
            return Err(ChainError::Unavailable(format!(
                "Base RPC returned HTTP {}",
                response.status()
            )));
        }

        #[derive(Deserialize)]
        struct Header {
            number: String,
            hash: String,
            #[serde(rename = "parentHash")]
            parent_hash: String,
        }

        /// Same shape as [`RpcResponse`], but non-generic: the shared struct's
        /// `#[serde(default)]` would demand `Header: Default`.
        #[derive(Deserialize)]
        struct HeaderResponse {
            #[serde(default)]
            result: Option<Header>,
            #[serde(default)]
            error: Option<RpcError>,
        }

        let rpc: HeaderResponse = response
            .json()
            .await
            .map_err(|e| ChainError::Unavailable(format!("could not parse RPC response: {e}")))?;

        if let Some(error) = rpc.error {
            return Err(ChainError::Unavailable(format!(
                "eth_getBlockByNumber error {}: {}",
                error.code, error.message
            )));
        }

        // A missing `result` means the node has no block at that height.
        let Some(header) = rpc.result else {
            return Ok(None);
        };
        let Some(parsed_height) = super::parse_u64(&header.number) else {
            return Err(ChainError::Unavailable(format!(
                "invalid block number: {}",
                header.number
            )));
        };

        Ok(Some(crate::reorg::BlockRecord {
            height: parsed_height,
            hash: header.hash.to_ascii_lowercase(),
            parent_hash: header.parent_hash.to_ascii_lowercase(),
        }))
    }
}

impl ChainClient for BaseClient {
    fn chain(&self) -> Chain {
        Chain::Base
    }

    async fn latest_height(&self) -> Result<u64, ChainError> {
        // Prefer the watcher's cached value if available.
        if let Some(ref height) = self.finalized_height {
            let h = height.get();
            if h > 0 {
                return Ok(h);
            }
        }
        // Fall back to an explicit RPC call if no watcher is attached or it
        // hasn't seen a block yet.
        self.fetch_latest_finalized().await
    }

    async fn block_record(
        &self,
        height: u64,
    ) -> Result<Option<crate::reorg::BlockRecord>, ChainError> {
        self.fetch_block_record(height).await
    }

    async fn deposits_since(&self, height: u64) -> Result<Vec<ObservedDeposit>, ChainError> {
        let current_block = self.latest_height().await?;
        let logs = self.get_logs(height, current_block).await?;
        Ok(deposits_from_logs(
            &logs,
            self.network,
            current_block,
            &self.deposit_addresses,
        ))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use engipay_core::{Asset, Money};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const USER: &str = "0xabc0000000000000000000000000000000000001";

    #[tokio::test]
    async fn detects_usdc_deposits_from_logs() {
        let server = MockServer::start().await;

        // Mock eth_getBlockByNumber("finalized")
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "number": "0x6e",  // 110
                    "hash": "0xabc"
                }
            })))
            .up_to_n_times(1)
            .mount(&server)
            .await;

        // Mock eth_getLogs for USDC Transfer events
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": [{
                    "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                    "topics": [
                        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                        "0x0000000000000000000000001111111111111111111111111111111111111111",
                        "0x000000000000000000000000abc0000000000000000000000000000000000001"
                    ],
                    "data": "0x00000000000000000000000000000000000000000000000000000000002625a0",
                    "blockNumber": "0x64",
                    "transactionHash": "0xfeed",
                    "logIndex": "0x5"
                }]
            })))
            .mount(&server)
            .await;

        let client =
            BaseClient::new(BaseNetwork::Mainnet, server.uri(), &[USER.to_owned()]).unwrap();

        let deposits = client.deposits_since(100).await.unwrap();
        assert_eq!(deposits.len(), 1);
        assert_eq!(
            deposits[0].money,
            Money::from_minor(Asset::Usdc, 25_000_000)
        );
        assert_eq!(deposits[0].address, USER);
        assert_eq!(deposits[0].reference, "base:0xfeed:5");
        assert_eq!(deposits[0].confirmations, 11);
    }

    #[tokio::test]
    async fn eth_getlogs_error_surfaces_as_unavailable() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": { "number": "0x64", "hash": "0xabc" }
            })))
            .up_to_n_times(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "error": { "code": -32000, "message": "filter not found" }
            })))
            .mount(&server)
            .await;

        let client =
            BaseClient::new(BaseNetwork::Mainnet, server.uri(), &[USER.to_owned()]).unwrap();

        let result = client.deposits_since(100).await;
        assert!(matches!(result, Err(ChainError::Unavailable(_))));
    }

    #[tokio::test]
    async fn unauthorized_usdc_contracts_are_discarded() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": { "number": "0x64", "hash": "0xabc" }
            })))
            .up_to_n_times(1)
            .mount(&server)
            .await;

        // Fake USDC contract
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": [{
                    "address": "0x9999999999999999999999999999999999999999",
                    "topics": [
                        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                        "0x0000000000000000000000001111111111111111111111111111111111111111",
                        "0x000000000000000000000000abc0000000000000000000000000000000000001"
                    ],
                    "data": "0x00000000000000000000000000000000000000000000000000000000002625a0",
                    "blockNumber": "0x64",
                    "transactionHash": "0xfake",
                    "logIndex": "0x1"
                }]
            })))
            .mount(&server)
            .await;

        let client =
            BaseClient::new(BaseNetwork::Mainnet, server.uri(), &[USER.to_owned()]).unwrap();

        let deposits = client.deposits_since(100).await.unwrap();
        assert_eq!(
            deposits.len(),
            0,
            "deposits from unauthorized contracts must not be credited"
        );
    }

    #[test]
    fn malformed_deposit_address_is_config_error() {
        let result = BaseClient::new(
            BaseNetwork::Mainnet,
            "http://localhost",
            &["invalid".to_owned()],
        );
        assert!(matches!(result, Err(ChainError::Config(_))));
    }

    #[tokio::test]
    async fn zero_value_transfers_are_ignored() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": { "number": "0x64", "hash": "0xabc" }
            })))
            .up_to_n_times(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": [{
                    "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                    "topics": [
                        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                        "0x0000000000000000000000001111111111111111111111111111111111111111",
                        "0x000000000000000000000000abc0000000000000000000000000000000000001"
                    ],
                    "data": "0x0000000000000000000000000000000000000000000000000000000000000000",
                    "blockNumber": "0x64",
                    "transactionHash": "0xzero",
                    "logIndex": "0x1"
                }]
            })))
            .mount(&server)
            .await;

        let client =
            BaseClient::new(BaseNetwork::Mainnet, server.uri(), &[USER.to_owned()]).unwrap();

        let deposits = client.deposits_since(100).await.unwrap();
        assert_eq!(
            deposits.len(),
            0,
            "zero-value transfers must not be credited"
        );
    }
}
