//! Base block header polling loop.
//!
//! # Design
//!
//! The watcher polls `eth_getBlockByNumber("finalized", false)` every 2 seconds
//! (matching Base's block time) and tracks the highest finalized block number
//! seen. The finalized height is stored in an [`AtomicU64`] so it can be read
//! without holding a lock.
//!
//! Everything in the parsing layer is pure — no network, no clock — following
//! the same pattern as `stellar/horizon.rs`. This keeps the rules that decide
//! whether a block response is valid in one small, easily-tested place.
//!
//! # JSON-RPC transport
//!
//! Rather than pulling in `alloy` or `ethers`, the watcher uses `reqwest` and
//! `serde_json` (already in the workspace) to make raw JSON-RPC 2.0 calls.
//! This avoids a large dependency for what is currently a single RPC method.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

use crate::ChainError;

/// How often the watcher polls Base for a new finalized block.
/// Base produces a block roughly every 2 seconds.
pub const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Sentinel value for "no block seen yet".
pub const NO_BLOCK: u64 = 0;

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC types (pure — no network, no clock)
// ─────────────────────────────────────────────────────────────────────────────

/// A JSON-RPC 2.0 request body.
#[derive(Debug, Serialize)]
pub struct RpcRequest<'a> {
    pub jsonrpc: &'a str,
    pub method: &'a str,
    pub params: serde_json::Value,
    pub id: u64,
}

impl<'a> RpcRequest<'a> {
    /// Builds the standard `eth_getBlockByNumber("finalized", false)` request.
    pub fn get_finalized_block(id: u64) -> Self {
        Self {
            jsonrpc: "2.0",
            method: "eth_getBlockByNumber",
            params: serde_json::json!(["finalized", false]),
            id,
        }
    }
}

/// A JSON-RPC 2.0 response envelope.
#[derive(Debug, Deserialize)]
pub struct RpcResponse {
    pub id: u64,
    /// `Some(Value::Null)` when the node returned `"result": null` (no finalized block yet).
    /// `None` when the `result` field was absent entirely (malformed response).
    #[serde(default, deserialize_with = "deserialize_result_field")]
    pub result: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<RpcError>,
}

/// Deserializer that distinguishes a JSON `null` value from a missing field.
///
/// Serde's default `Option<T>` deserializer maps both absent fields and `null`
/// values to `None`. For JSON-RPC, `"result": null` means "no block yet" while
/// an absent `result` field means a malformed response. We need to tell these
/// apart, so `null` → `Some(Value::Null)` and absent → `None`.
fn deserialize_result_field<'de, D>(
    deserializer: D,
) -> Result<Option<serde_json::Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Deserialise whatever JSON value is present (including null). This is
    // called only when the field *exists* in the input (because `#[serde(default)]`
    // handles the absent-field case and returns `None` without calling us).
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(Some(value))
}

/// A JSON-RPC error object.
#[derive(Debug, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

/// The fields from an `eth_getBlockByNumber` result that the watcher cares
/// about. `number` is a `0x`-prefixed hex string in the Ethereum JSON-RPC.
#[derive(Debug, Clone, Deserialize)]
pub struct BlockHeader {
    /// Block number as a `0x`-prefixed hex string, e.g. `"0x1a2b3c"`.
    pub number: String,
    /// Block hash (32-byte hex).
    pub hash: String,
    /// Parent hash (32-byte hex).
    #[serde(rename = "parentHash")]
    pub parent_hash: String,
    /// Unix timestamp as a `0x`-prefixed hex string.
    pub timestamp: String,
}

/// Outcome of parsing one RPC response. Separating the parse decision from the
/// network call lets every branch be tested without a running node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedBlock {
    /// A valid finalized block with its number.
    Ok { number: u64, hash: String },
    /// The node returned `null` — block production is delayed or the node is
    /// catching up. The watcher should log and retry.
    Null,
    /// The response was structurally invalid or the node returned an error.
    Invalid(String),
}

/// Extracts the finalized block number from a raw RPC response.
///
/// Returns [`ParsedBlock::Ok`] on success, [`ParsedBlock::Null`] when the node
/// has not yet produced a finalized block (result is JSON `null`), and
/// [`ParsedBlock::Invalid`] for any other error condition.
pub fn parse_block_response(response: &RpcResponse) -> ParsedBlock {
    if let Some(error) = &response.error {
        return ParsedBlock::Invalid(format!("JSON-RPC error {}: {}", error.code, error.message));
    }

    let result = match &response.result {
        None => return ParsedBlock::Invalid("response has no `result` field".to_owned()),
        Some(v) => v,
    };

    if result.is_null() {
        return ParsedBlock::Null;
    }

    let header: BlockHeader = match serde_json::from_value(result.clone()) {
        Ok(h) => h,
        Err(err) => return ParsedBlock::Invalid(format!("could not deserialise block: {err}")),
    };

    match parse_hex_u64(&header.number) {
        Some(n) => ParsedBlock::Ok {
            number: n,
            hash: header.hash,
        },
        None => ParsedBlock::Invalid(format!(
            "block number {:?} is not a valid 0x-prefixed hex u64",
            header.number
        )),
    }
}

/// Parses a `0x`-prefixed hex string (e.g. `"0x1a2b"`) into a `u64`.
/// Returns `None` for anything that does not fit the format.
pub fn parse_hex_u64(s: &str) -> Option<u64> {
    let hex = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X"))?;
    if hex.is_empty() {
        return None;
    }
    u64::from_str_radix(hex, 16).ok()
}

// ─────────────────────────────────────────────────────────────────────────────
// BlockWatcher — stateful poller
// ─────────────────────────────────────────────────────────────────────────────

/// Shared, lock-free view of the latest finalized block height.
///
/// The watcher background task writes to this; callers read from it with
/// [`FinalizedHeight::get`] without needing a lock.
#[derive(Debug, Clone)]
pub struct FinalizedHeight(Arc<AtomicU64>);

impl FinalizedHeight {
    fn new() -> Self {
        Self(Arc::new(AtomicU64::new(NO_BLOCK)))
    }

    /// The highest finalized block number seen so far, or [`NO_BLOCK`] (`0`)
    /// if the watcher has not received a valid response yet.
    pub fn get(&self) -> u64 {
        self.0.load(Ordering::Acquire)
    }

    fn set(&self, n: u64) {
        self.0.store(n, Ordering::Release);
    }
}

/// Configuration for the Base block watcher.
#[derive(Debug, Clone)]
pub struct WatcherConfig {
    /// The Base RPC URL, e.g. `https://mainnet.base.org` or a local node.
    pub rpc_url: String,
    /// How often to poll. Defaults to [`POLL_INTERVAL`] (2 seconds).
    pub poll_interval: Duration,
}

impl WatcherConfig {
    pub fn new(rpc_url: impl Into<String>) -> Self {
        Self {
            rpc_url: rpc_url.into(),
            poll_interval: POLL_INTERVAL,
        }
    }

    /// Override the poll interval (useful in tests to speed things up).
    pub fn with_poll_interval(mut self, interval: Duration) -> Self {
        self.poll_interval = interval;
        self
    }
}

/// Background worker that polls `eth_getBlockByNumber("finalized", false)` and
/// updates the shared [`FinalizedHeight`].
///
/// Spawn with [`BlockWatcher::spawn`]. The returned [`FinalizedHeight`] handle
/// is cheap to clone and share across tasks.
pub struct BlockWatcher {
    config: WatcherConfig,
    http: reqwest::Client,
    height: FinalizedHeight,
}

impl BlockWatcher {
    /// Creates a new watcher. Does not start polling until [`BlockWatcher::run`]
    /// or [`BlockWatcher::spawn`] is called.
    pub fn new(config: WatcherConfig) -> Result<(Self, FinalizedHeight), ChainError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent(concat!("engipay-chain/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| ChainError::Unavailable(e.to_string()))?;
        let height = FinalizedHeight::new();
        let watcher = Self {
            config,
            http,
            height: height.clone(),
        };
        Ok((watcher, height))
    }

    /// Returns the current finalized height without polling.
    pub fn height(&self) -> &FinalizedHeight {
        &self.height
    }

    /// Polls once and updates the shared height. Returns the parsed block.
    ///
    /// This is the testable core of the watcher: tests can call it directly
    /// against a mock server rather than running the full `tokio::spawn` loop.
    pub async fn poll_once(&self, request_id: u64) -> Result<ParsedBlock, ChainError> {
        let request = RpcRequest::get_finalized_block(request_id);
        let response = self
            .http
            .post(&self.config.rpc_url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ChainError::Unavailable(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            return Err(ChainError::Unavailable(format!(
                "Base RPC returned HTTP {status}"
            )));
        }

        let rpc_response: RpcResponse = response
            .json()
            .await
            .map_err(|e| ChainError::Unavailable(format!("could not parse RPC response: {e}")))?;

        let parsed = parse_block_response(&rpc_response);

        match &parsed {
            ParsedBlock::Ok { number, hash } => {
                let current = self.height.get();
                if *number > current {
                    self.height.set(*number);
                    info!(
                        block = number,
                        hash = %hash,
                        prev = current,
                        "base: new finalized block"
                    );
                } else {
                    debug!(
                        block = number,
                        current = current,
                        "base: finalized height unchanged"
                    );
                }
            }
            ParsedBlock::Null => {
                warn!("base: RPC returned null for finalized block — node catching up?");
            }
            ParsedBlock::Invalid(reason) => {
                warn!(%reason, "base: invalid block response");
            }
        }

        Ok(parsed)
    }

    /// Runs the polling loop forever, updating the shared height on every tick.
    ///
    /// Returns only if `shutdown` resolves (e.g. a `ctrl_c` future) or if
    /// wiring up the interval fails. Errors from individual polls are logged
    /// and retried; they do not stop the loop.
    pub async fn run(self, shutdown: impl std::future::Future<Output = ()>) {
        let mut ticker = tokio::time::interval(self.config.poll_interval);
        let mut request_id: u64 = 1;
        tokio::pin!(shutdown);

        info!(
            rpc = %self.config.rpc_url,
            interval_ms = self.config.poll_interval.as_millis(),
            "base: block watcher started"
        );

        loop {
            tokio::select! {
                _ = &mut shutdown => {
                    info!("base: block watcher stopping");
                    return;
                }
                _ = ticker.tick() => {}
            }

            if let Err(error) = self.poll_once(request_id).await {
                warn!(%error, "base: poll failed; will retry");
            }
            // Saturating add so a very long-running process never wraps to 0.
            request_id = request_id.saturating_add(1);
        }
    }

    /// Spawns the polling loop as a Tokio background task.
    ///
    /// The returned handle can be awaited or dropped; dropping it does not stop
    /// the loop (use a shutdown channel for that).
    pub fn spawn(
        self,
        shutdown: impl std::future::Future<Output = ()> + Send + 'static,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(self.run(shutdown))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    // ── parse_hex_u64 ────────────────────────────────────────────────────────

    #[test]
    fn parses_hex_block_numbers() {
        assert_eq!(parse_hex_u64("0x0"), Some(0));
        assert_eq!(parse_hex_u64("0x1"), Some(1));
        assert_eq!(parse_hex_u64("0x1a2b3c"), Some(0x1a2b3c));
        assert_eq!(parse_hex_u64("0xffffffffffffffff"), Some(u64::MAX));
    }

    #[test]
    fn uppercase_0x_prefix_is_accepted() {
        assert_eq!(parse_hex_u64("0Xff"), Some(255));
    }

    #[test]
    fn missing_0x_prefix_returns_none() {
        assert_eq!(parse_hex_u64("1a2b"), None);
        assert_eq!(parse_hex_u64("123"), None);
    }

    #[test]
    fn empty_hex_after_prefix_returns_none() {
        assert_eq!(parse_hex_u64("0x"), None);
    }

    #[test]
    fn non_hex_digits_return_none() {
        assert_eq!(parse_hex_u64("0xzzzz"), None);
        assert_eq!(parse_hex_u64("0x1g2h"), None);
    }

    #[test]
    fn overflow_returns_none() {
        // 2^64 in hex is one digit too many to fit in u64
        assert_eq!(parse_hex_u64("0x10000000000000000"), None);
    }

    // ── parse_block_response ─────────────────────────────────────────────────

    fn ok_response(number: &str, hash: &str) -> RpcResponse {
        RpcResponse {
            id: 1,
            result: Some(serde_json::json!({
                "number": number,
                "hash": hash,
                "parentHash": "0xdeadbeef",
                "timestamp": "0x66f5a2c0"
            })),
            error: None,
        }
    }

    fn null_response() -> RpcResponse {
        RpcResponse {
            id: 1,
            result: Some(serde_json::Value::Null),
            error: None,
        }
    }

    fn error_response(code: i64, message: &str) -> RpcResponse {
        RpcResponse {
            id: 1,
            result: None,
            error: Some(RpcError {
                code,
                message: message.to_owned(),
            }),
        }
    }

    #[test]
    fn valid_block_response_parses_to_ok() {
        let resp = ok_response("0x1a2b3c", "0xabcdef");
        assert_eq!(
            parse_block_response(&resp),
            ParsedBlock::Ok {
                number: 0x1a2b3c,
                hash: "0xabcdef".to_owned(),
            }
        );
    }

    #[test]
    fn null_result_parses_to_null() {
        assert_eq!(parse_block_response(&null_response()), ParsedBlock::Null);
    }

    #[test]
    fn rpc_error_parses_to_invalid() {
        let resp = error_response(-32601, "method not found");
        assert!(matches!(
            parse_block_response(&resp),
            ParsedBlock::Invalid(_)
        ));
    }

    #[test]
    fn missing_result_field_is_invalid() {
        let resp = RpcResponse {
            id: 1,
            result: None,
            error: None,
        };
        assert!(matches!(
            parse_block_response(&resp),
            ParsedBlock::Invalid(_)
        ));
    }

    #[test]
    fn malformed_block_number_is_invalid() {
        let resp = ok_response("not-a-hex-number", "0xabc");
        assert!(matches!(
            parse_block_response(&resp),
            ParsedBlock::Invalid(_)
        ));
    }

    #[test]
    fn block_with_zero_number_is_valid() {
        let resp = ok_response("0x0", "0xgenesis");
        assert_eq!(
            parse_block_response(&resp),
            ParsedBlock::Ok {
                number: 0,
                hash: "0xgenesis".to_owned(),
            }
        );
    }

    #[test]
    fn large_block_number_parses_correctly() {
        // Block 14_000_000 = 0xD59F80
        let resp = ok_response("0xd59f80", "0xhash");
        assert_eq!(
            parse_block_response(&resp),
            ParsedBlock::Ok {
                number: 14_000_000,
                hash: "0xhash".to_owned(),
            }
        );
    }

    // ── FinalizedHeight ──────────────────────────────────────────────────────

    #[test]
    fn initial_height_is_no_block() {
        let h = FinalizedHeight::new();
        assert_eq!(h.get(), NO_BLOCK);
    }

    #[test]
    fn set_and_get_round_trip() {
        let h = FinalizedHeight::new();
        h.set(12_345_678);
        assert_eq!(h.get(), 12_345_678);
    }

    #[test]
    fn clone_shares_the_same_value() {
        let h = FinalizedHeight::new();
        let h2 = h.clone();
        h.set(999);
        assert_eq!(h2.get(), 999, "clone must observe writes from the original");
        h2.set(1000);
        assert_eq!(h.get(), 1000, "original must observe writes from the clone");
    }

    // ── polling loop behaviour (unit-level, no network) ──────────────────────

    /// Verifies that `poll_once` advances the shared height when a higher block
    /// arrives. Uses a wiremock server to avoid any real network calls.
    #[tokio::test]
    async fn poll_once_advances_height_on_new_block() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "number": "0x100",
                    "hash": "0xaabbcc",
                    "parentHash": "0x001122",
                    "timestamp": "0x66f5a2c0"
                }
            })))
            .mount(&server)
            .await;

        let config = WatcherConfig::new(server.uri());
        let (watcher, height) = BlockWatcher::new(config).unwrap();

        assert_eq!(height.get(), NO_BLOCK);
        let result = watcher.poll_once(1).await.unwrap();
        assert_eq!(
            result,
            ParsedBlock::Ok {
                number: 0x100,
                hash: "0xaabbcc".to_owned(),
            }
        );
        assert_eq!(height.get(), 0x100);
    }

    /// The height must never go backwards: if the node returns an older finalized
    /// block (e.g. after a brief reorg or delayed indexing), the stored value
    /// must not decrease.
    #[tokio::test]
    async fn poll_once_does_not_decrease_height() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;

        // First call returns block 500, second returns 499 (delayed block)
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 1,
                "result": {
                    "number": "0x1f4",   // 500
                    "hash": "0xfirst",
                    "parentHash": "0xprev",
                    "timestamp": "0x1"
                }
            })))
            .up_to_n_times(1)
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 2,
                "result": {
                    "number": "0x1f3",   // 499 — older
                    "hash": "0xsecond",
                    "parentHash": "0xprev",
                    "timestamp": "0x1"
                }
            })))
            .mount(&server)
            .await;

        let config = WatcherConfig::new(server.uri());
        let (watcher, height) = BlockWatcher::new(config).unwrap();

        watcher.poll_once(1).await.unwrap();
        assert_eq!(height.get(), 500);

        watcher.poll_once(2).await.unwrap();
        // Height must still be 500, not 499
        assert_eq!(
            height.get(),
            500,
            "height must not decrease on delayed block"
        );
    }

    /// When the node returns `null` (block production delayed), the stored
    /// height must remain unchanged and no error must propagate.
    #[tokio::test]
    async fn null_response_leaves_height_unchanged() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 1,
                "result": null
            })))
            .mount(&server)
            .await;

        let config = WatcherConfig::new(server.uri());
        let (watcher, height) = BlockWatcher::new(config).unwrap();

        let result = watcher.poll_once(1).await.unwrap();
        assert_eq!(result, ParsedBlock::Null);
        assert_eq!(
            height.get(),
            NO_BLOCK,
            "null response must not change the stored height"
        );
    }

    /// An HTTP 500 from the RPC endpoint must surface as `ChainError::Unavailable`,
    /// not a panic or a silent empty result.
    #[tokio::test]
    async fn http_error_surfaces_as_unavailable() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let config = WatcherConfig::new(server.uri());
        let (watcher, _height) = BlockWatcher::new(config).unwrap();

        let result = watcher.poll_once(1).await;
        assert!(
            matches!(result, Err(ChainError::Unavailable(_))),
            "HTTP 500 must yield ChainError::Unavailable, got: {result:?}"
        );
    }

    /// Verifies sequential poll ordering: three consecutive blocks must be
    /// tracked in order and height must advance monotonically.
    #[tokio::test]
    async fn sequential_blocks_tracked_in_order() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;

        for (number_hex, number_dec, req_id) in
            [("0x64", 100u64, 1u64), ("0x65", 101, 2), ("0x66", 102, 3)]
        {
            Mock::given(method("POST"))
                .and(path("/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "number": number_hex,
                        "hash": format!("0xhash{number_dec}"),
                        "parentHash": "0xparent",
                        "timestamp": "0x1"
                    }
                })))
                .up_to_n_times(1)
                .mount(&server)
                .await;
        }

        let config = WatcherConfig::new(server.uri());
        let (watcher, height) = BlockWatcher::new(config).unwrap();

        for id in 1..=3u64 {
            watcher.poll_once(id).await.unwrap();
        }

        assert_eq!(height.get(), 102, "should have tracked up to block 102");
    }

    /// Simulates delayed block production: the same block number is returned
    /// several times (no new finalized block) before a new one arrives.
    #[tokio::test]
    async fn repeated_same_block_number_is_handled_gracefully() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;

        // First poll: a valid block
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 1,
                "result": {
                    "number": "0x3e8", // 1000
                    "hash": "0xstable",
                    "parentHash": "0xprev",
                    "timestamp": "0x1"
                }
            })))
            .up_to_n_times(1)
            .mount(&server)
            .await;

        // Polls 2-4: same block (delayed production)
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 2,
                "result": {
                    "number": "0x3e8", // still 1000
                    "hash": "0xstable",
                    "parentHash": "0xprev",
                    "timestamp": "0x1"
                }
            })))
            .up_to_n_times(3)
            .mount(&server)
            .await;

        // Poll 5: block advances
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 5,
                "result": {
                    "number": "0x3e9", // 1001
                    "hash": "0xnew",
                    "parentHash": "0xstable",
                    "timestamp": "0x2"
                }
            })))
            .mount(&server)
            .await;

        let config = WatcherConfig::new(server.uri());
        let (watcher, height) = BlockWatcher::new(config).unwrap();

        for id in 1..=5u64 {
            watcher.poll_once(id).await.unwrap();
        }

        assert_eq!(
            height.get(),
            1001,
            "height must advance once a new block arrives after a delay"
        );
    }

    /// When a JSON-RPC error is returned (e.g. method not supported by a
    /// non-Base node), the height must stay unchanged and no panic occurs.
    #[tokio::test]
    async fn rpc_error_leaves_height_unchanged() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 1,
                "error": { "code": -32601, "message": "method not found" }
            })))
            .mount(&server)
            .await;

        let config = WatcherConfig::new(server.uri());
        let (watcher, height) = BlockWatcher::new(config).unwrap();

        // poll_once succeeds (HTTP 200) but returns ParsedBlock::Invalid
        let result = watcher.poll_once(1).await.unwrap();
        assert!(matches!(result, ParsedBlock::Invalid(_)));
        assert_eq!(
            height.get(),
            NO_BLOCK,
            "RPC-level error must not change the stored height"
        );
    }
}
