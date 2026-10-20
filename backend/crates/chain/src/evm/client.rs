//! Base chain client: deposit watching via `eth_getLogs` for USDC `Transfer`
//! events, plus per-block transaction scanning for native ETH.
//!
//! USDC leaves a log wherever it moves, so a single `eth_getLogs` call covers a
//! whole block range. Native ETH does not: a plain value transfer to an EOA
//! emits no log at all, so `eth_getLogs` is structurally blind to it. The
//! client therefore runs a second scan over the same range — reading every
//! block's transactions and receipts — and merges both result sets into one
//! [`ChainClient::deposits_since`] response.
//!
//! The ETH scan reads **top-level transactions only**. ETH that a contract
//! forwards to a deposit address is an internal transaction: it has no entry
//! in the block's transaction list and no receipt of its own, and seeing it
//! would require `debug_traceBlock`, which most providers do not serve.
//! Internal transfers are deliberately excluded and never credited.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use engipay_core::Chain;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use super::erc20::{BaseNetwork, Log, deposits_from_logs, transfer_filter};
use super::eth;
use super::watcher::{BlockWatcher, FinalizedHeight};
use crate::{ChainClient, ChainError, ObservedDeposit};

/// Base JSON-RPC client for USDC and native ETH deposit detection.
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

/// A JSON-RPC error object, e.g. `{"code": -32601, "message": "..."}`.
#[derive(Debug, Deserialize)]
struct RpcError {
    code: i64,
    message: String,
}

/// A JSON-RPC 2.0 response. Exactly one of `result` or `error` is set.
///
/// `result` is kept as raw JSON and decoded by the caller: a generic
/// `RpcResponse<T>` would force every call site to repeat the same
/// `Deserialize` bounds, and a null result (a block that does not exist yet)
/// has to survive as a value until the caller decides what it means.
#[derive(Debug, Deserialize)]
struct RpcResponse {
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<RpcError>,
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

    /// Sends one JSON-RPC 2.0 call and decodes its `result` field.
    ///
    /// Transport failures, non-2xx responses and JSON-RPC errors all surface
    /// as [`ChainError::Unavailable`]: the watch loop logs the reason and
    /// retries the same height, so no block is ever skipped because a single
    /// RPC call failed.
    async fn rpc_raw(&self, method: &str, params: Value) -> Result<Value, ChainError> {
        let request = json!({
            "jsonrpc": "2.0",
            "method": method,
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

        let rpc: RpcResponse = response
            .json()
            .await
            .map_err(|e| ChainError::Unavailable(format!("could not parse RPC response: {e}")))?;

        if let Some(error) = rpc.error {
            return Err(ChainError::Unavailable(format!(
                "{method} error {}: {}",
                error.code, error.message
            )));
        }

        rpc.result
            .ok_or_else(|| ChainError::Unavailable(format!("{method} returned no result")))
    }

    /// Sends one JSON-RPC 2.0 call and decodes its `result` into `T`.
    async fn rpc<T: DeserializeOwned>(&self, method: &str, params: Value) -> Result<T, ChainError> {
        let result = self.rpc_raw(method, params).await?;
        serde_json::from_value(result)
            .map_err(|e| ChainError::Unavailable(format!("could not decode {method} result: {e}")))
    }

    /// Queries `eth_getLogs` for USDC Transfer events in the given block range.
    async fn get_logs(&self, from_block: u64, to_block: u64) -> Result<Vec<Log>, ChainError> {
        let params = transfer_filter(self.network, from_block, to_block, &self.deposit_addresses);
        self.rpc("eth_getLogs", params).await
    }

    /// `eth_getBlockByNumber(n, true)`: one block with its full transaction
    /// objects. Native ETH transfers live only here — they emit no log.
    async fn get_block(&self, block_number: u64) -> Result<eth::Block, ChainError> {
        self.rpc(
            "eth_getBlockByNumber",
            json!([format!("{block_number:#x}"), true]),
        )
        .await
        .map_err(|error| match error {
            ChainError::Unavailable(message) => {
                ChainError::Unavailable(format!("base: block {block_number}: {message}"))
            }
            other => other,
        })
    }

    /// `eth_getBlockReceipts(n)`: the receipt of every transaction in the
    /// block. A reverted transaction still carries a non-zero `value` on the
    /// transaction object, so its receipt (`status: "0x0"`) is the only way to
    /// tell it apart from a transfer that actually moved funds.
    async fn get_receipts(&self, block_number: u64) -> Result<Vec<eth::Receipt>, ChainError> {
        self.rpc(
            "eth_getBlockReceipts",
            json!([format!("{block_number:#x}")]),
        )
        .await
        .map_err(|error| match error {
            ChainError::Unavailable(message) => ChainError::Unavailable(format!(
                "base: receipts for block {block_number}: {message}"
            )),
            other => other,
        })
    }

    /// Fetches the latest finalized block number via `eth_getBlockByNumber("finalized", false)`.
    async fn fetch_latest_finalized(&self) -> Result<u64, ChainError> {
        #[derive(Deserialize)]
        struct BlockHeader {
            number: String,
        }

        let block: Option<BlockHeader> = self
            .rpc("eth_getBlockByNumber", json!(["finalized", false]))
            .await?;

        let block =
            block.ok_or_else(|| ChainError::Unavailable("finalized block is null".into()))?;

        super::parse_u64(&block.number).ok_or_else(|| {
            ChainError::Unavailable(format!("invalid block number: {}", block.number))
        })
    }

    /// Every native ETH deposit in the blocks `[from, to]`, inclusive.
    ///
    /// A plain ETH transfer emits no log, so the transactions of each block in
    /// the range are read directly; a block whose transactions never address a
    /// deposit address skips the receipt call entirely, which keeps the common
    /// case at one RPC per block.
    ///
    /// The cost is one `eth_getBlockByNumber` per block in the range, so a
    /// wide range is slow. The watch loop only ever asks for the blocks since
    /// the last poll (one or two), and an operator-requested backfill is
    /// expected to take its time rather than skip blocks.
    ///
    /// Only **top-level** transactions are considered. ETH forwarded by a
    /// contract to a deposit address is an internal transaction, invisible in
    /// `eth_getBlockByNumber`; detecting those would need `debug_traceBlock`,
    /// so internal transfers are deliberately excluded and never credited.
    ///
    /// A failed block or receipt call aborts the whole poll rather than
    /// returning a partial result: the watch loop logs the error and retries
    /// the same height, so a transient RPC failure costs time, never deposits.
    async fn eth_deposits_between(
        &self,
        from: u64,
        to: u64,
    ) -> Result<Vec<ObservedDeposit>, ChainError> {
        let mut deposits = Vec::new();

        for block_number in from..=to {
            let block = self.get_block(block_number).await?;

            if !block
                .transactions
                .iter()
                .any(|tx| eth::touches_deposit_address(tx, &self.deposit_addresses))
            {
                continue;
            }

            let receipts = self.get_receipts(block_number).await?;
            let found = eth::deposits_in_block(&block, &receipts, to, &self.deposit_addresses)
                .map_err(|reason| {
                    ChainError::Unavailable(format!(
                        "base: block {block_number} could not be scanned for ETH: {reason:?}"
                    ))
                })?;
            deposits.extend(found);
        }

        Ok(deposits)
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

    async fn deposits_since(&self, height: u64) -> Result<Vec<ObservedDeposit>, ChainError> {
        let current_block = self.latest_height().await?;

        // USDC: one eth_getLogs call covers the whole range.
        let logs = self.get_logs(height, current_block).await?;
        let mut deposits =
            deposits_from_logs(&logs, self.network, current_block, &self.deposit_addresses);

        // Native ETH: no log exists, so each block's transactions are read.
        deposits.extend(self.eth_deposits_between(height, current_block).await?);

        Ok(deposits)
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use engipay_core::{Asset, Money};
    use wiremock::matchers::{body_partial_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const USER: &str = "0xabc0000000000000000000000000000000000001";

    /// Mounts the `eth_getBlockByNumber("finalized", false)` response.
    async fn mount_finalized(server: &MockServer, number_hex: &str) {
        Mock::given(method("POST"))
            .and(path("/"))
            .and(body_partial_json(json!({
                "method": "eth_getBlockByNumber",
                "params": ["finalized", false]
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0", "id": 1,
                "result": { "number": number_hex, "hash": "0xabc" }
            })))
            .mount(server)
            .await;
    }

    /// Mounts the `eth_getLogs` response with the given `result` field.
    async fn mount_logs(server: &MockServer, result: Value) {
        Mock::given(method("POST"))
            .and(path("/"))
            .and(body_partial_json(json!({ "method": "eth_getLogs" })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0", "id": 1, "result": result
            })))
            .mount(server)
            .await;
    }

    /// Mounts a JSON-RPC error for `eth_getLogs`.
    async fn mount_logs_error(server: &MockServer, code: i64, message: &str) {
        Mock::given(method("POST"))
            .and(path("/"))
            .and(body_partial_json(json!({ "method": "eth_getLogs" })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0", "id": 1,
                "error": { "code": code, "message": message }
            })))
            .mount(server)
            .await;
    }

    /// Mounts one recorded `eth_getBlockByNumber(n, true)` response.
    async fn mount_block(server: &MockServer, number_hex: &str, block: Value) {
        Mock::given(method("POST"))
            .and(path("/"))
            .and(body_partial_json(json!({
                "method": "eth_getBlockByNumber",
                "params": [number_hex, true]
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0", "id": 1, "result": block
            })))
            .mount(server)
            .await;
    }

    /// Mounts the recorded `eth_getBlockReceipts(n)` response.
    async fn mount_receipts(server: &MockServer, number_hex: &str, receipts: Value) {
        Mock::given(method("POST"))
            .and(path("/"))
            .and(body_partial_json(json!({
                "method": "eth_getBlockReceipts",
                "params": [number_hex]
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0", "id": 1, "result": receipts
            })))
            .mount(server)
            .await;
    }

    /// Mounts a JSON-RPC error for `eth_getBlockReceipts`.
    async fn mount_receipts_error(server: &MockServer, number_hex: &str) {
        Mock::given(method("POST"))
            .and(path("/"))
            .and(body_partial_json(json!({
                "method": "eth_getBlockReceipts",
                "params": [number_hex]
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0", "id": 1,
                "error": { "code": -32000, "message": "missing trie node" }
            })))
            .mount(server)
            .await;
    }

    /// An empty block: the common case, where the receipt call is skipped.
    async fn mount_empty_block(server: &MockServer, number: u64) {
        mount_block(
            server,
            &format!("{number:#x}"),
            json!({
                "number": format!("{number:#x}"),
                "hash": format!("0x{number:x}"),
                "transactions": []
            }),
        )
        .await;
    }

    /// Mounts empty blocks for every height in `[from, to]`, inclusive.
    async fn mount_empty_blocks(server: &MockServer, from: u64, to: u64) {
        for number in from..=to {
            mount_empty_block(server, number).await;
        }
    }

    fn client(server: &MockServer) -> BaseClient {
        BaseClient::new(BaseNetwork::Mainnet, server.uri(), &[USER.to_owned()]).unwrap()
    }

    /// A `Transfer` log for 2.5 USDC arriving at `USER` in block 100.
    fn usdc_transfer_log() -> Value {
        json!({
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
        })
    }

    #[tokio::test]
    async fn detects_usdc_deposits_from_logs() {
        let server = MockServer::start().await;
        mount_finalized(&server, "0x6e").await;
        mount_logs(&server, json!([usdc_transfer_log()])).await;
        // The native-ETH scan walks every block in the range; these hold no
        // transactions, so no receipt call is attempted.
        mount_empty_blocks(&server, 100, 110).await;

        let client = client(&server);
        let deposits = client.deposits_since(100).await.unwrap();

        assert_eq!(deposits.len(), 1);
        let d = &deposits[0];
        assert_eq!(d.money, Money::from_minor(Asset::Usdc, 25_000_000));
        assert_eq!(d.address, USER);
        assert_eq!(d.reference, "base:0xfeed:5");
        assert_eq!(d.confirmations, 11);
    }

    #[tokio::test]
    async fn eth_getlogs_error_surfaces_as_unavailable() {
        let server = MockServer::start().await;
        mount_finalized(&server, "0x64").await;
        mount_logs_error(&server, -32000, "filter not found").await;

        let client = client(&server);
        let result = client.deposits_since(100).await;

        assert!(matches!(result, Err(ChainError::Unavailable(_))));
    }

    #[tokio::test]
    async fn unauthorized_usdc_contracts_are_discarded() {
        let server = MockServer::start().await;
        mount_finalized(&server, "0x64").await;
        // Same Transfer topic, but from a token we don't track.
        let mut log = usdc_transfer_log();
        log["address"] = json!("0xdead000000000000000000000000000000000000");
        mount_logs(&server, json!([log])).await;
        mount_empty_block(&server, 100).await;

        let client = client(&server);
        let deposits = client.deposits_since(100).await.unwrap();

        assert!(deposits.is_empty());
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
        mount_finalized(&server, "0x64").await;
        let log = json!({
            "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            "topics": [
                "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                "0x0000000000000000000000001111111111111111111111111111111111111111",
                "0x000000000000000000000000abc0000000000000000000000000000000000001"
            ],
            "data": "0x0000000000000000000000000000000000000000000000000000000000000000",
            "blockNumber": "0x64",
            "transactionHash": "0xbeef",
            "logIndex": "0x0"
        });
        mount_logs(&server, json!([log])).await;
        mount_empty_block(&server, 100).await;

        let client = client(&server);
        let deposits = client.deposits_since(100).await.unwrap();

        assert!(deposits.is_empty());
    }

    #[tokio::test]
    async fn native_eth_transfer_is_credited_from_block_transactions() {
        // A plain ETH send leaves no log — only the block's transaction list
        // can show it. This is the whole point of the block scan.
        let server = MockServer::start().await;
        mount_finalized(&server, "0x64").await;
        mount_logs(&server, json!([])).await;
        mount_block(
            &server,
            "0x64",
            json!({
                "number": "0x64",
                "hash": "0xb10c",
                "transactions": [{
                    "hash": "0xeth01",
                    "to": USER,
                    "value": "0xde0b6b3a7640000" // 1 ETH
                }]
            }),
        )
        .await;
        mount_receipts(
            &server,
            "0x64",
            json!([{ "transactionHash": "0xeth01", "status": "0x1" }]),
        )
        .await;

        let client = client(&server);
        let deposits = client.deposits_since(100).await.unwrap();

        assert_eq!(
            deposits,
            vec![ObservedDeposit {
                money: Money::from_minor(Asset::Eth, 1_000_000_000_000_000_000),
                address: USER.to_owned(),
                reference: "base:eth:0xeth01".to_owned(),
                confirmations: 1,
            }]
        );
    }

    #[tokio::test]
    async fn blocks_without_custody_transactions_skip_the_receipts_call() {
        // No receipt mock is mounted here: if the client asked for receipts of
        // this block it would receive a 404 and fail the poll.
        let server = MockServer::start().await;
        mount_finalized(&server, "0x64").await;
        mount_logs(&server, json!([])).await;
        mount_empty_block(&server, 100).await;

        let client = client(&server);
        let deposits = client.deposits_since(100).await.unwrap();

        assert!(deposits.is_empty());
    }

    #[tokio::test]
    async fn receipt_lookup_failure_fails_the_poll() {
        // The block contains a transfer to the custody address, but its
        // receipts are unavailable. Crediting without a receipt would risk
        // paying out on a reverted transaction, so the poll fails loudly and
        // the watch loop retries the same height.
        let server = MockServer::start().await;
        mount_finalized(&server, "0x64").await;
        mount_logs(&server, json!([])).await;
        mount_block(
            &server,
            "0x64",
            json!({
                "number": "0x64",
                "hash": "0xb10c",
                "transactions": [{ "hash": "0xeth01", "to": USER, "value": "0x1" }]
            }),
        )
        .await;
        mount_receipts_error(&server, "0x64").await;

        let client = client(&server);
        let result = client.deposits_since(100).await;

        assert!(matches!(result, Err(ChainError::Unavailable(_))));
    }
}
