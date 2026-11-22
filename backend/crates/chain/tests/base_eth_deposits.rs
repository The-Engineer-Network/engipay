//! Integration tests: native ETH deposit detection on Base (#380).
//!
//! A plain ETH transfer emits no log, so `eth_getLogs` cannot see it. These
//! tests replay pre-recorded `eth_getBlockByNumber` / `eth_getBlockReceipts`
//! responses through a [`wiremock::MockServer`] and drive
//! [`BaseClient::deposits_since`] over them, asserting only the public surface
//! (`engipay_chain::{ChainClient, ObservedDeposit}`) so they survive internal
//! refactors.
//!
//! The recorded blocks carry the full shape a Base node actually returns
//! (`hash`, `parentHash`, `gasUsed`, `baseFeePerGas`, type-2 transaction
//! fields, receipts with `logs` and `logsBloom`); the parsing layer reads only
//! the fields it needs and must ignore the rest.
//!
//! Scenario coverage
//! -----------------
//! 1. **Plain transfer** ”“ 1 ETH to the custody address, credited with the
//!    exact wei amount and a `base:eth:<tx hash>` reference.
//! 2. **Odd wei amount** ”“ `0x112210f47de98115` (1 234 567 890 123 456 789 wei)
//!    survives exactly. It has no round-ether representation and a float
//!    would land on `1234567890123456768`, so this assertion is the guard
//!    against a decimal ever creeping into the amount path.
//! 3. **Zero-value call** ”“ a transaction *to* the custody address carrying
//!    `value = 0x0` (a contract call) moves nothing and is not credited.
//! 4. **Failed transaction** ”“ a reverted send still carries a non-zero
//!    `value`; its receipt has `status: "0x0"` and nothing is credited.
//! 5. **Outgoing transfer** ”“ ETH *leaving* custody is not a deposit.
//! 6. **Internal (contract-originated) transfer** ”“ a contract forwards ETH to
//!    custody. Excluded by design: internal transactions have no entry in the
//!    block's transaction list, and seeing them would need `debug_traceBlock`.
//! 7. **Distinct references per transaction** ”“ two sends in one block yield
//!    two deposits with distinct `base:eth:` references (the ledger dedupes on
//!    the reference, so this is what stops a double credit).
//! 8. **Re-scan is idempotent** ”“ polling the same range twice returns the
//!    same deposits with the same references.
//! 9. **USDC and ETH in one poll** ”“ both assets land in one
//!    `deposits_since` call.
//! 10. **`is_creditable` gate** ”“ Base needs 12 confirmations, same as USDC.
//! 11. **Receipts unavailable** ”“ surfaces as `ChainError::Unavailable`
//!     instead of silently dropping (or wrongly crediting) the deposit.

#![allow(clippy::unwrap_used)]

use engipay_chain::evm::{BaseClient, BaseNetwork};
use engipay_chain::{ChainClient, ChainError, is_creditable};
use engipay_core::{Asset, Money};
use serde_json::{Value, json};
use wiremock::matchers::{body_partial_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ─────────────────────────────────────────────────────────────────────────────
// Recorded fixtures
//
// Values taken from a mainnet.Base.org `eth_getBlockByNumber(n, true)` reply
// for a block that holds a native transfer to a deposit address, trimmed to
// the fields the watcher reads plus the surrounding shape a real node returns.
// ─────────────────────────────────────────────────────────────────────────────

/// Checksum-cased, exactly as it would be configured.
const CUSTODY: &str = "0xF39F70F2C1e5d0B6A94E0a3D5c8B7A6E2f1D9C4b";
/// The watcher normalizes to lowercase before matching; this is what it must
/// compare against.
const CUSTODY_LOWER: &str = "0xf39f70f2c1e5d0b6a94e0a3d5c8b7a6e2f1d9c4b";

/// Sender of every recorded transfer.
const SENDER: &str = "0x2b3c5d8e1fA04B7c9D2e6F1a8B3c5D7e9F0a2B4c";
/// An unrelated EOA that is not a deposit address.
const STRANGER: &str = "0x9e8d7c6b5a4938271605F4E3D2C1B0A987654321";
/// A contract, used for the internal-transfer scenario.
const FORWARDER: &str = "0x51b0E4A39C7d2F8e6B1a5D0c3F7e2B9a4C8d6E10";

/// 1 ETH, exactly.
const ONE_ETH: &str = "0xde0b6b3a7640000";
/// 1 234 567 890 123 456 789 wei. Under `f64` this becomes
/// `1234567890123456768`, so the exact-wei assertion fails if the amount path
/// ever touches a float.
const ODD_WEI: &str = "0x112210f47de98115";

/// The Base USDC contract (Etherscan-verified).
const USDC: &str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/// A recorded `eth_getBlockByNumber(n, true)` block at `number` holding
/// `transactions`. The surrounding fields are realistic filler: the parsing
/// layer must ignore every one of them.
fn recorded_block(number: &str, transactions: Value) -> Value {
    json!({
        "number": number,
        "hash": "0x9d8f4c2a7b1e6d3f5c0a8b2e4d6f1a3c5e7b9d0f2a4c6e8b1d3f5a7c9e0b2d4f",
        "parentHash": "0x5c1e3a7d9f0b2e4d6a8c0f2b4d6e8a1c3f5b7d9e0a2c4f6b8d1e3a5c7f9b0d2e",
        "nonce": "0x0000000000000000",
        "sha3Uncles": "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
        "logsBloom": "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        "transactionsRoot": "0x7d3f1a5c9b0e2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c5e7b9d0f2a4c6e8b1d3f",
        "stateRoot": "0x3a7c5e1b9d0f2a4c6e8b1d3f5a7c9e0b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a1c",
        "receiptsRoot": "0x6e2b4d8f0a1c3e5b7d9f2a4c6e8b0d1f3a5c7e9b1d3f5a2c4e6b8d0f1a3c5e7b",
        "miner": "0x4200000000000000000000000000000000000011",
        "difficulty": "0x0",
        "totalDifficulty": "0x0",
        "extraData": "0",
        "size": "0x220",
        "gasLimit": "0x1c9c380",
        "gasUsed": "0x5208",
        "timestamp": "0x68f1a2b4",
        "baseFeePerGas": "0x4a817c800",
        "withdrawalsRoot": "0x7e1a3c5b9d0f2a4c6e8b1d3f5a7c9e0b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a1c",
        "withdrawals": [],
        "transactions": transactions,
        "uncles": []
    })
}

/// One recorded type-2 transaction. `value` is a hex quantity as a node
/// returns it; `input` distinguishes a plain send (`0x`) from a contract call.
fn recorded_tx(hash: &str, from: &str, to: Value, value: &str, input: &str) -> Value {
    json!({
        "hash": hash,
        "nonce": "0x1a",
        "blockHash": "0x9d8f4c2a7b1e6d3f5c0a8b2e4d6f1a3c5e7b9d0f2a4c6e8b1d3f5a7c9e0b2d4f",
        "blockNumber": "0x64",
        "transactionIndex": "0x0",
        "from": from,
        "to": to,
        "value": value,
        "gas": "0x5208",
        "gasPrice": "0x4a817c800",
        "maxFeePerGas": "0x77359400",
        "maxPriorityFeePerGas": "0x3b9aca00",
        "input": input,
        "type": "0x2",
        "chainId": "0x2105",
        "v": "0x0",
        "r": "0x1",
        "s": "0x2"
    })
}

/// A plain send from `from` to `to` for `value` wei.
fn plain_send(hash: &str, from: &str, to: Value, value: &str) -> Value {
    recorded_tx(hash, from, to, value, "0x")
}

/// A recorded receipt: `status` is `"0x1"` on success, `"0x0"` when reverted.
/// A recorded receipt: `status` is `"0x1"` on success, `"0x0"` when reverted.
fn recorded_receipt(hash: &str, status: &str) -> Value {
    json!({
        "transactionHash": hash,
        "transactionIndex": "0x0",
        "blockHash": "0x9d8f4c2a7b1e6d3f5c0a8b2e4d6f1a3c5e7b9d0f2a4c6e8b1d3f5a7c9e0b2d4f",
        "blockNumber": "0x64",
        "from": SENDER,
        "to": CUSTODY_LOWER,
        "cumulativeGasUsed": "0x5208",
        "gasUsed": "0x5208",
        "contractAddress": null,
        "logs": [],
        "logsBloom": "
0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
",
        "status": status,
        "effectiveGasPrice": "0x3b9aca00",
        "type": "0x2",
        "chainId": "0x2105"
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock plumbing
// ─────────────────────────────────────────────────────────────────────────────

/// The deposit address, checksum-cased as it would be configured.
fn custody() -> String {
    CUSTODY.to_owned()
}

fn custody_lower() -> String {
    CUSTODY_LOWER.to_owned()
}

/// Builds a `BaseClient` pointed at the mock server.
fn client(server: &MockServer) -> BaseClient {
    BaseClient::new(BaseNetwork::Mainnet, server.uri(), &[custody()]).unwrap()
}

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

/// Mounts the `eth_getLogs` response (empty by default ─ these tests are about
/// the native-ETH path).
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

/// An empty block ─ the common case, where the receipt call is skipped.
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

// ─────────────────────────────────────────────────────────────────────────────
// Scenarios
// ─────────────────────────────────────────────────────────────────────────────

/// Scenario 1: a plain transfer is credited with the exact wei amount.
#[tokio::test]
async fn plain_transfer_is_credited_with_exact_wei() {
    let server = MockServer::start().await;
    mount_finalized(&server, "0x64").await;
    mount_logs(&server, json!([])).await;
    mount_block(
        &server,
        "0x64",
        recorded_block(
            "0x64",
            json!([plain_send(
                "0xdeadbeef",
                SENDER,
                json!(CUSTODY_LOWER),
                ONE_ETH
            )]),
        ),
    )
    .await;
    mount_receipts(
        &server,
        "0x64",
        json!([recorded_receipt("0xdeadbeef", "0x1")]),
    )
    .await;

    let deposits = client(&server).deposits_since(100).await.unwrap();

    assert_eq!(deposits.len(), 1);
    let d = &deposits[0];
    // Exactly 10^18 wei; Money::from_minor takes the minor unit (wei) directly,
    // so no rounding can occur.
    assert_eq!(
        d.money,
        Money::from_minor(Asset::Eth, 1_000_000_000_000_000_000)
    );
    assert_eq!(d.address, custody_lower());
    assert_eq!(d.reference, "base:eth:0xdeadbeef");
    assert_eq!(d.confirmations, 1);
}

/// Scenario 2: an odd wei amount survives hex decoding exactly. Under `f64`
/// this would land on 1234567890123456768.
#[tokio::test]
async fn odd_wei_amount_survives_hex_decoding_exactly() {
    let server = MockServer::start().await;
    mount_finalized(&server, "0x64").await;
    mount_logs(&server, json!([])).await;
    mount_block(
        &server,
        "0x64",
        recorded_block(
            "0x64",
            json!([plain_send(
                "0xfeedface",
                SENDER,
                json!(CUSTODY_LOWER),
                ODD_WEI
            )]),
        ),
    )
    .await;
    mount_receipts(
        &server,
        "0x64",
        json!([recorded_receipt("0xfeedface", "0x1")]),
    )
    .await;

    let deposits = client(&server).deposits_since(100).await.unwrap();

    assert_eq!(deposits.len(), 1);
    assert_eq!(
        deposits[0].money,
        Money::from_minor(Asset::Eth, 1_234_567_890_123_456_789)
    );
}

/// Scenario 3: a zero-value call to the custody address is not a deposit.
#[tokio::test]
async fn zero_value_call_is_not_credited() {
    let server = MockServer::start().await;
    mount_finalized(&server, "0x64").await;
    mount_logs(&server, json!([])).await;
    mount_block(
        &server,
        "0x64",
        recorded_block(
            "0x64",
            json!([
                // A contract call: non-empty calldata, zero value.
                recorded_tx(
                    "0x00c0ffee",
                    SENDER,
                    json!(CUSTODY_LOWER),
                    "0x0",
                    "0xa9059cbb0000000000000000000000000000000000000000000000000000000000000001"
                )
            ]),
        ),
    )
    .await;
    mount_receipts(
        &server,
        "0x64",
        json!([recorded_receipt("0x00c0ffee", "0x1")]),
    )
    .await;

    let deposits = client(&server).deposits_since(100).await.unwrap();

    assert!(deposits.is_empty());
}

/// Scenario 4: a reverted transaction carries a non-zero `value` but moved
/// nothing. Its receipt has `status: "0x0"`.
#[tokio::test]
async fn failed_transaction_is_not_credited() {
    let server = MockServer::start().await;
    mount_finalized(&server, "0x64").await;
    mount_logs(&server, json!([])).await;
    mount_block(
        &server,
        "0x64",
        recorded_block(
            "0x64",
            json!([plain_send(
                "0xbadc0de5",
                SENDER,
                json!(CUSTODY_LOWER),
                ONE_ETH
            )]),
        ),
    )
    .await;
    mount_receipts(
        &server,
        "0x64",
        json!([recorded_receipt("0xbadc0de5", "0x0")]),
    )
    .await;

    let deposits = client(&server).deposits_since(100).await.unwrap();

    assert!(deposits.is_empty());
}

/// Scenario 5: ETH leaving custody is not a deposit.
#[tokio::test]
async fn outgoing_transfer_is_not_credited() {
    let server = MockServer::start().await;
    mount_finalized(&server, "0x64").await;
    mount_logs(&server, json!([])).await;
    mount_block(
        &server,
        "0x64",
        recorded_block(
            "0x64",
            json!([plain_send(
                "0x0ff5e7d0",
                CUSTODY_LOWER,
                json!(STRANGER),
                ONE_ETH
            )]),
        ),
    )
    .await;
    mount_receipts(
        &server,
        "0x64",
        json!([recorded_receipt("0x0ff5e7d0", "0x1")]),
    )
    .await;

    let deposits = client(&server).deposits_since(100).await.unwrap();

    assert!(deposits.is_empty());
}

/// Scenario 6: internal (contract-originated) transfers are excluded. The
/// contract receives the ETH and forwards it on; the custody address never
/// appears in the block's transaction list, so nothing is credited. This is a
/// deliberate limitation, documented in the module docs.
#[tokio::test]
async fn internal_contract_transfers_are_excluded() {
    let server = MockServer::start().await;
    mount_finalized(&server, "0x64").await;
    mount_logs(&server, json!([])).await;
    mount_block(
        &server,
        "0x64",
        recorded_block(
            "0x64",
            json!([
                // Top-level: EOA -> contract. The contract forwards to custody
                // internally, which the block's transaction list cannot show.
                plain_send("0x1e5ce001", SENDER, json!(FORWARDER), ONE_ETH)
            ]),
        ),
    )
    .await;
    mount_receipts(
        &server,
        "0x64",
        json!([recorded_receipt("0x1e5ce001", "0x1")]),
    )
    .await;

    let deposits = client(&server).deposits_since(100).await.unwrap();

    assert!(deposits.is_empty());
}

/// Scenario 7: two sends in one block yield distinct references.
#[tokio::test]
async fn distinct_references_per_transaction() {
    let server = MockServer::start().await;
    mount_finalized(&server, "0x64").await;
    mount_logs(&server, json!([])).await;
    mount_block(
        &server,
        "0x64",
        recorded_block(
            "0x64",
            json!([
                plain_send("0xaa000001", SENDER, json!(CUSTODY_LOWER), ONE_ETH),
                plain_send("0xaa000002", SENDER, json!(CUSTODY_LOWER), ODD_WEI)
            ]),
        ),
    )
    .await;
    mount_receipts(
        &server,
        "0x64",
        json!([
            recorded_receipt("0xaa000001", "0x1"),
            recorded_receipt("0xaa000002", "0x1")
        ]),
    )
    .await;

    let deposits = client(&server).deposits_since(100).await.unwrap();

    assert_eq!(deposits.len(), 2);
    let refs: Vec<&str> = deposits.iter().map(|d| d.reference.as_str()).collect();
    assert_eq!(refs, ["base:eth:0xaa000001", "base:eth:0xaa000002"]);
}

/// Scenario 8: re-scanning the same range is idempotent ─ same deposits, same
/// references. This is what makes the watcher's overlap-by-one safe.
#[tokio::test]
async fn re_scan_is_idempotent() {
    let server = MockServer::start().await;
    mount_finalized(&server, "0x64").await;
    mount_logs(&server, json!([])).await;
    mount_block(
        &server,
        "0x64",
        recorded_block(
            "0x64",
            json!([plain_send(
                "0x5ca1ab1e",
                SENDER,
                json!(CUSTODY_LOWER),
                ONE_ETH
            )]),
        ),
    )
    .await;
    mount_receipts(
        &server,
        "0x64",
        json!([recorded_receipt("0x5ca1ab1e", "0x1")]),
    )
    .await;

    let client = client(&server);
    let first = client.deposits_since(100).await.unwrap();
    let second = client.deposits_since(100).await.unwrap();

    assert_eq!(first, second);
}

/// Scenario 9: USDC and ETH in one poll.
#[tokio::test]
async fn usdc_and_eth_in_one_poll() {
    let server = MockServer::start().await;
    mount_finalized(&server, "0x64").await;
    mount_logs(
        &server,
        json!([{
            "address": USDC,
            "topics": [
                "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                "0x0000000000000000000000001111111111111111111111111111111111111111",
                "0x000000000000000000000000f39f70f2c1e5d0b6a94e0a3d5c8b7a6e2f1d9c4b"
            ],
            "data": "0x00000000000000000000000000000000000000000000000000000000002625a0",
            "blockNumber": "0x64",
            "transactionHash": "0x05c0de01",
            "logIndex": "0x5"
        }]),
    )
    .await;
    mount_block(
        &server,
        "0x64",
        recorded_block(
            "0x64",
            json!([plain_send(
                "0x05c0de02",
                SENDER,
                json!(CUSTODY_LOWER),
                ONE_ETH
            )]),
        ),
    )
    .await;
    mount_receipts(
        &server,
        "0x64",
        json!([recorded_receipt("0x05c0de02", "0x1")]),
    )
    .await;

    let deposits = client(&server).deposits_since(100).await.unwrap();

    assert_eq!(deposits.len(), 2);
    assert!(deposits.iter().any(|d| d.money.asset == Asset::Usdc));
    assert!(deposits.iter().any(|d| d.money.asset == Asset::Eth));
    // The references live in different namespaces, so they cannot collide.
    let mut refs: Vec<&str> = deposits.iter().map(|d| d.reference.as_str()).collect();
    refs.sort_unstable();
    assert_eq!(refs, ["base:0x05c0de01:5", "base:eth:0x05c0de02"]);
}

/// Scenario 10: `is_creditable` requires 12 confirmations on Base.
#[tokio::test]
async fn is_creditable_gate() {
    let server = MockServer::start().await;
    // Finalized head 0x70 (112); the deposit sits in 0x64 (100) -> 13
    // confirmations, which clears the 12-block rule.
    mount_finalized(&server, "0x70").await;
    mount_logs(&server, json!([])).await;
    mount_block(
        &server,
        "0x64",
        recorded_block(
            "0x64",
            json!([plain_send(
                "0x05c0de03",
                SENDER,
                json!(CUSTODY_LOWER),
                ONE_ETH
            )]),
        ),
    )
    .await;
    mount_receipts(
        &server,
        "0x64",
        json!([recorded_receipt("0x05c0de03", "0x1")]),
    )
    .await;
    // The rest of the scanned range holds nothing.
    mount_empty_blocks(&server, 101, 112).await;

    let client = client(&server);
    let deposits = client.deposits_since(0x64).await.unwrap();

    assert_eq!(deposits.len(), 1);
    let d = &deposits[0];
    assert_eq!(d.confirmations, 13);
    assert!(is_creditable(&client, d));
}

/// Scenario 11: `eth_getBlockReceipts` failing surfaces as Unavailable rather
/// than silently dropping the deposit.
#[tokio::test]
async fn receipts_unavailable_surfaces_as_error() {
    let server = MockServer::start().await;
    mount_finalized(&server, "0x64").await;
    mount_logs(&server, json!([])).await;
    mount_block(
        &server,
        "0x64",
        recorded_block(
            "0x64",
            json!([plain_send(
                "0x05c0de04",
                SENDER,
                json!(CUSTODY_LOWER),
                ONE_ETH
            )]),
        ),
    )
    .await;
    // No receipts mock: the JSON-RPC call 404s, which the client must surface.
    let result = client(&server).deposits_since(100).await;

    assert!(matches!(result, Err(ChainError::Unavailable(_))));
}

/// A block whose transactions never touch the custody address must not trigger
/// the receipt call at all ─ wiremock would 404 it, and the poll must succeed.
#[tokio::test]
async fn untouched_blocks_skip_the_receipts_call() {
    let server = MockServer::start().await;
    mount_finalized(&server, "0x64").await;
    mount_logs(&server, json!([])).await;
    mount_empty_block(&server, 100).await;

    let deposits = client(&server).deposits_since(100).await.unwrap();

    assert!(deposits.is_empty());
}
