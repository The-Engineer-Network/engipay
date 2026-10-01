//! Integration tests: Stellar deposit ingestion from Horizon.
//!
//! These tests drive [`StellarClient::deposits_since`] against a
//! [`wiremock::MockServer`] that replays pre-recorded Horizon JSON.  Every
//! assertion targets the public surface of the crate
//! (`engipay_chain::{ChainClient, ObservedDeposit}`) so they remain valid
//! regardless of internal refactors.
//!
//! Scenario coverage
//! -----------------
//! 1. **Native XLM to an `M...` address** – the canonical happy path.
//! 2. **USDC from Circle to an `M...` address** – correct issuer accepted.
//! 3. **USDC from an unknown issuer** – must not be credited.
//! 4. **Failed transaction** – must not be credited.
//! 5. **Outgoing payment** – must not be credited.
//! 6. **Non-payment operation (`create_account`)** – must not be credited.
//! 7. **Multiple deposits in one batch** – all credited, amounts correct.
//! 8. **Deposit to bare custody (`G...`)** – address falls back to custody.
//! 9. **Multi-operation transaction** – one cached tx fetch, all ops credited.
//! 10. **Horizon unavailable (503)** – surfaces as `ChainError::Unavailable`.
//! 11. **`is_creditable` gate** – Stellar needs exactly 1 confirmation.

#![allow(clippy::unwrap_used)]

use engipay_chain::stellar::{StellarClient, StellarConfig, StellarNetwork};
use engipay_chain::{ChainClient, ChainError, is_creditable};
use engipay_core::stellar::muxed_deposit_address;
use engipay_core::{Asset, Chain, Money};
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Derives a deterministic `G...` address from a single seed byte so tests
/// never depend on hard-coded addresses copied from somewhere else.
fn account(seed: u8) -> String {
    stellar_strkey::ed25519::PublicKey([seed; 32])
        .to_string()
        .as_str()
        .to_owned()
}

/// The custody account used across all tests.
fn custody() -> String {
    account(1)
}

/// A muxed deposit address belonging to user id 42 on the custody account.
fn user_muxed(id: u64) -> String {
    muxed_deposit_address(&custody(), id).unwrap()
}

/// Builds a [`StellarClient`] pointed at the provided mock server.
async fn client(server: &MockServer) -> StellarClient {
    let config =
        StellarConfig::new(StellarNetwork::Testnet, Some(server.uri()), &custody()).unwrap();
    StellarClient::new(config).unwrap()
}

/// Mounts the standard `GET /` (root) handler returning `latest_ledger`.
async fn mount_root(server: &MockServer, latest_ledger: u64) {
    Mock::given(method("GET"))
        .and(path("/"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({ "history_latest_ledger": latest_ledger })),
        )
        .mount(server)
        .await;
}

/// Mounts the payments page for `custody()` with a single-page `records` list.
async fn mount_payments(server: &MockServer, from_ledger: u64, records: serde_json::Value) {
    let cursor = (from_ledger as i64) << 32;
    Mock::given(method("GET"))
        .and(path(format!("/accounts/{}/payments", custody())))
        .and(query_param("cursor", cursor.to_string()))
        .and(query_param("join", "transactions"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({ "_embedded": { "records": records } })),
        )
        .mount(server)
        .await;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Native XLM to a muxed address
// ─────────────────────────────────────────────────────────────────────────────

/// The most important happy path: a successful XLM payment into a muxed
/// custody address must produce a single `ObservedDeposit` with the correct
/// `Money`, `address`, `reference`, and `confirmations`.
#[tokio::test]
async fn xlm_payment_to_muxed_address_produces_deposit() {
    let server = MockServer::start().await;
    let muxed = user_muxed(42);
    let tx_hash = "aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233";

    mount_root(&server, 110).await;
    mount_payments(
        &server,
        100,
        serde_json::json!([{
            "paging_token": "429496729601",
            "type": "payment",
            "transaction_hash": tx_hash,
            "transaction_successful": true,
            "to": custody(),
            "to_muxed": muxed,
            "asset_type": "native",
            "amount": "12.5000000",
            "transaction": { "ledger": 105, "successful": true }
        }]),
    )
    .await;

    let deposits = client(&server).await.deposits_since(100).await.unwrap();

    assert_eq!(deposits.len(), 1, "exactly one deposit expected");
    let dep = &deposits[0];

    // 12.5 XLM = 125_000_000 stroops
    assert_eq!(
        dep.money,
        Money::from_minor(Asset::Xlm, 125_000_000),
        "money must be 12.5 XLM in stroops"
    );
    assert_eq!(dep.address, muxed, "address must be the M... address");
    assert!(
        dep.reference.starts_with("stellar:"),
        "reference must have stellar: prefix"
    );
    assert!(
        dep.reference.contains(tx_hash),
        "reference must contain the tx hash"
    );
    assert!(
        dep.reference.contains("429496729601"),
        "reference must contain the paging token"
    );
    // latest=110, ledger=105 → confirmations = 110 - 105 + 1 = 6
    assert_eq!(dep.confirmations, 6, "confirmations = latest - ledger + 1");
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. USDC from Circle
// ─────────────────────────────────────────────────────────────────────────────

/// A USDC payment from Circle's real testnet issuer must be credited.
#[tokio::test]
async fn usdc_from_circle_issuer_is_credited() {
    let server = MockServer::start().await;
    let muxed = user_muxed(7);

    mount_root(&server, 200).await;
    mount_payments(
        &server,
        190,
        serde_json::json!([{
            "paging_token": "815497224193",
            "type": "payment",
            "transaction_hash": "deadbeef11223344deadbeef11223344deadbeef11223344deadbeef11223344",
            "transaction_successful": true,
            "to": custody(),
            "to_muxed": muxed,
            "asset_type": "credit_alphanum4",
            "asset_code": "USDC",
            "asset_issuer": StellarNetwork::Testnet.usdc_issuer(),
            "amount": "50.0000000",
            "transaction": { "ledger": 195, "successful": true }
        }]),
    )
    .await;

    let deposits = client(&server).await.deposits_since(190).await.unwrap();

    assert_eq!(deposits.len(), 1);
    // 50 USDC = 500_000_000 units (7 decimal places)
    assert_eq!(
        deposits[0].money,
        Money::from_minor(Asset::Usdc, 500_000_000)
    );
    assert_eq!(deposits[0].address, muxed);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. USDC from an unknown issuer must not be credited
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn usdc_from_unknown_issuer_is_not_credited() {
    let server = MockServer::start().await;

    mount_root(&server, 200).await;
    mount_payments(
        &server,
        190,
        serde_json::json!([{
            "paging_token": "815497224194",
            "type": "payment",
            "transaction_hash": "cafecafe11223344cafecafe11223344cafecafe11223344cafecafe11223344",
            "transaction_successful": true,
            "to": custody(),
            "to_muxed": user_muxed(9),
            "asset_type": "credit_alphanum4",
            "asset_code": "USDC",
            // A random account pretending to be USDC
            "asset_issuer": account(99),
            "amount": "100.0000000",
            "transaction": { "ledger": 195, "successful": true }
        }]),
    )
    .await;

    let deposits = client(&server).await.deposits_since(190).await.unwrap();
    assert!(deposits.is_empty(), "fake USDC must never be credited");
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Failed transaction must not be credited
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn failed_transaction_is_not_credited() {
    let server = MockServer::start().await;

    mount_root(&server, 300).await;
    mount_payments(
        &server,
        290,
        serde_json::json!([{
            "paging_token": "1246006468609",
            "type": "payment",
            "transaction_hash": "f00df00d11223344f00df00d11223344f00df00d11223344f00df00d11223344",
            "transaction_successful": false,
            "to": custody(),
            "to_muxed": user_muxed(3),
            "asset_type": "native",
            "amount": "5.0000000",
            "transaction": { "ledger": 295, "successful": false }
        }]),
    )
    .await;

    let deposits = client(&server).await.deposits_since(290).await.unwrap();
    assert!(
        deposits.is_empty(),
        "failed transactions must not be credited"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Outgoing payment must not be credited
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn outgoing_payment_is_not_credited() {
    let server = MockServer::start().await;

    mount_root(&server, 300).await;
    // `to` is someone else's account, not custody
    mount_payments(
        &server,
        290,
        serde_json::json!([{
            "paging_token": "1246006468610",
            "type": "payment",
            "transaction_hash": "beefdead11223344beefdead11223344beefdead11223344beefdead11223344",
            "transaction_successful": true,
            "from": custody(),
            "to": account(77),
            "asset_type": "native",
            "amount": "1.0000000",
            "transaction": { "ledger": 295, "successful": true }
        }]),
    )
    .await;

    let deposits = client(&server).await.deposits_since(290).await.unwrap();
    assert!(deposits.is_empty(), "outgoing payment must not be credited");
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Non-payment operation (create_account) must not be credited
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn create_account_operation_is_not_credited() {
    let server = MockServer::start().await;

    mount_root(&server, 300).await;
    mount_payments(
        &server,
        290,
        serde_json::json!([{
            "paging_token": "1246006468611",
            "type": "create_account",
            "transaction_hash": "1234567811223344123456781122334412345678112233441234567811223344",
            "transaction_successful": true,
            "to": custody(),
            "asset_type": "native",
            "amount": "1.0000000",
            "transaction": { "ledger": 295, "successful": true }
        }]),
    )
    .await;

    let deposits = client(&server).await.deposits_since(290).await.unwrap();
    assert!(
        deposits.is_empty(),
        "create_account must not be treated as a deposit"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Multiple deposits in one response batch
// ─────────────────────────────────────────────────────────────────────────────

/// When the page contains a mix of valid and invalid records, only the
/// creditable ones surface, with all amounts and addresses correct.
#[tokio::test]
async fn mixed_batch_credits_only_valid_deposits() {
    let server = MockServer::start().await;
    let user_a = user_muxed(100);
    let user_b = user_muxed(200);

    mount_root(&server, 500).await;
    mount_payments(
        &server,
        490,
        serde_json::json!([
            // ✓ XLM to user A
            {
                "paging_token": "2103074217985",
                "type": "payment",
                "transaction_hash": "aaaa000011223344aaaa000011223344aaaa000011223344aaaa000011223344",
                "transaction_successful": true,
                "to": custody(),
                "to_muxed": user_a,
                "asset_type": "native",
                "amount": "3.0000000",
                "transaction": { "ledger": 492, "successful": true }
            },
            // ✓ USDC from Circle to user B
            {
                "paging_token": "2103074217986",
                "type": "payment",
                "transaction_hash": "bbbb000011223344bbbb000011223344bbbb000011223344bbbb000011223344",
                "transaction_successful": true,
                "to": custody(),
                "to_muxed": user_b,
                "asset_type": "credit_alphanum4",
                "asset_code": "USDC",
                "asset_issuer": StellarNetwork::Testnet.usdc_issuer(),
                "amount": "20.0000000",
                "transaction": { "ledger": 495, "successful": true }
            },
            // ✗ Fake USDC
            {
                "paging_token": "2103074217987",
                "type": "payment",
                "transaction_hash": "cccc000011223344cccc000011223344cccc000011223344cccc000011223344",
                "transaction_successful": true,
                "to": custody(),
                "to_muxed": user_muxed(300),
                "asset_type": "credit_alphanum4",
                "asset_code": "USDC",
                "asset_issuer": account(55),
                "amount": "999.0000000",
                "transaction": { "ledger": 495, "successful": true }
            },
            // ✗ Failed
            {
                "paging_token": "2103074217988",
                "type": "payment",
                "transaction_hash": "dddd000011223344dddd000011223344dddd000011223344dddd000011223344",
                "transaction_successful": false,
                "to": custody(),
                "to_muxed": user_muxed(400),
                "asset_type": "native",
                "amount": "1.0000000",
                "transaction": { "ledger": 495, "successful": false }
            }
        ]),
    )
    .await;

    let deposits = client(&server).await.deposits_since(490).await.unwrap();

    assert_eq!(deposits.len(), 2, "only valid deposits must be returned");

    let xlm = deposits
        .iter()
        .find(|d| d.money.asset == Asset::Xlm)
        .expect("XLM deposit must be present");
    assert_eq!(xlm.money, Money::from_minor(Asset::Xlm, 30_000_000));
    assert_eq!(xlm.address, user_a);

    let usdc = deposits
        .iter()
        .find(|d| d.money.asset == Asset::Usdc)
        .expect("USDC deposit must be present");
    assert_eq!(usdc.money, Money::from_minor(Asset::Usdc, 200_000_000));
    assert_eq!(usdc.address, user_b);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Payment to bare custody (no muxed destination)
// ─────────────────────────────────────────────────────────────────────────────

/// When a sender pays the bare `G...` address (no mux), the deposit address
/// should fall back to the custody account itself — a human must review it.
#[tokio::test]
async fn payment_to_bare_custody_uses_custody_as_address() {
    let server = MockServer::start().await;

    mount_root(&server, 400).await;
    mount_payments(
        &server,
        390,
        serde_json::json!([{
            "paging_token": "1676458663937",
            "type": "payment",
            "transaction_hash": "eeee000011223344eeee000011223344eeee000011223344eeee000011223344",
            "transaction_successful": true,
            "to": custody(),
            // No "to_muxed" field at all
            "asset_type": "native",
            "amount": "1.0000000",
            "transaction": { "ledger": 392, "successful": true }
        }]),
    )
    .await;

    let deposits = client(&server).await.deposits_since(390).await.unwrap();

    assert_eq!(deposits.len(), 1);
    assert_eq!(
        deposits[0].address,
        custody(),
        "bare custody payment must use the G... address"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Multi-operation transaction exercises the transaction detail cache
// ─────────────────────────────────────────────────────────────────────────────

/// When one transaction contains several payment operations, Horizon returns
/// one `PaymentRecord` per operation, all sharing the same `transaction_hash`.
/// If those records have no inlined `transaction` field, `StellarClient` must
/// call `GET /transactions/{hash}` exactly once (wiremock `.expect(1)`) and
/// cache the result for the remaining operations.
#[tokio::test]
async fn multi_operation_tx_fetches_transaction_details_once() {
    let server = MockServer::start().await;
    let tx_hash = "multimulti11223344multimulti11223344multimulti11223344multimulti1122";
    let user_a = user_muxed(10);
    let user_b = user_muxed(20);
    let user_c = user_muxed(30);

    mount_root(&server, 600).await;

    // Three payment ops sharing the same tx_hash; no inlined `transaction`
    // field so the client must call the transaction endpoint.
    Mock::given(method("GET"))
        .and(path(format!("/accounts/{}/payments", custody())))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "_embedded": { "records": [
                {
                    "paging_token": "2577496878081",
                    "type": "payment",
                    "transaction_hash": tx_hash,
                    "transaction_successful": true,
                    "to": custody(),
                    "to_muxed": user_a,
                    "asset_type": "native",
                    "amount": "1.0000000"
                    // no "transaction" key — forces fetch_transaction
                },
                {
                    "paging_token": "2577496878082",
                    "type": "payment",
                    "transaction_hash": tx_hash,
                    "transaction_successful": true,
                    "to": custody(),
                    "to_muxed": user_b,
                    "asset_type": "native",
                    "amount": "2.0000000"
                },
                {
                    "paging_token": "2577496878083",
                    "type": "payment",
                    "transaction_hash": tx_hash,
                    "transaction_successful": true,
                    "to": custody(),
                    "to_muxed": user_c,
                    "asset_type": "native",
                    "amount": "3.0000000"
                }
            ]}
        })))
        .mount(&server)
        .await;

    // Transaction detail endpoint — must be called exactly once.
    Mock::given(method("GET"))
        .and(path(format!("/transactions/{tx_hash}")))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({ "ledger": 598, "successful": true })),
        )
        .expect(1) // cache hit for ops 2 and 3
        .mount(&server)
        .await;

    let deposits = client(&server).await.deposits_since(595).await.unwrap();

    assert_eq!(deposits.len(), 3, "all three operations must be credited");

    // latest=600, ledger=598 → confirmations = 3
    for dep in &deposits {
        assert_eq!(dep.confirmations, 3);
    }

    // Total: 1 + 2 + 3 = 6 XLM = 60_000_000 stroops
    let total: i128 = deposits
        .iter()
        .map(|d| {
            d.money
                .to_network_units(Chain::Stellar)
                .expect("XLM to_network_units must not fail")
        })
        .sum();
    assert_eq!(total, 60_000_000_i128, "1 + 2 + 3 XLM = 60_000_000 stroops");

    // Each deposit has a distinct reference (distinct paging_token).
    let references: std::collections::HashSet<_> =
        deposits.iter().map(|d| d.reference.as_str()).collect();
    assert_eq!(
        references.len(),
        3,
        "each operation must have a unique reference"
    );
    // All references include the shared tx hash.
    for dep in &deposits {
        assert!(
            dep.reference.contains(tx_hash),
            "reference must contain the transaction hash"
        );
    }

    // Wiremock verifies `.expect(1)` when the server is dropped — if the cache
    // did not work, the GET /transactions call would happen 3 times and the
    // server would fail with an unexpected request count.
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Horizon unavailable
// ─────────────────────────────────────────────────────────────────────────────

/// When Horizon returns 503, `deposits_since` must propagate a
/// `ChainError::Unavailable`, not panic or silently return an empty list.
#[tokio::test]
async fn horizon_503_surfaces_as_unavailable() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;

    let result = client(&server).await.deposits_since(1).await;
    assert!(
        matches!(result, Err(ChainError::Unavailable(_))),
        "503 must surface as ChainError::Unavailable, got: {result:?}"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. is_creditable gate
// ─────────────────────────────────────────────────────────────────────────────

/// Stellar finalises in one ledger close. `required_confirmations()` is 1, so
/// a deposit with `confirmations >= 1` and a positive amount must be creditable.
#[tokio::test]
async fn stellar_deposit_is_creditable_after_one_confirmation() {
    let server = MockServer::start().await;
    let muxed = user_muxed(55);

    mount_root(&server, 1000).await;
    mount_payments(
        &server,
        999,
        serde_json::json!([{
            "paging_token": "4294967296001",
            "type": "payment",
            "transaction_hash": "ffff000011223344ffff000011223344ffff000011223344ffff000011223344",
            "transaction_successful": true,
            "to": custody(),
            "to_muxed": muxed,
            "asset_type": "native",
            "amount": "0.0000001",      // minimum: 1 stroop
            "transaction": { "ledger": 999, "successful": true }
        }]),
    )
    .await;

    let stellar = client(&server).await;
    let deposits = stellar.deposits_since(999).await.unwrap();

    assert_eq!(deposits.len(), 1);
    let dep = &deposits[0];

    // latest=1000, ledger=999 → confirmations = 2, which is >= 1
    assert!(dep.confirmations >= 1);
    assert!(dep.money.is_positive());
    assert!(
        is_creditable(&stellar, dep),
        "a confirmed positive Stellar deposit must be creditable"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Path-payment operations are accepted
// ─────────────────────────────────────────────────────────────────────────────

/// `path_payment_strict_receive` and `path_payment_strict_send` are also
/// payment operations — they move funds into the custody account and must be
/// credited just like a plain `payment`.
#[tokio::test]
async fn path_payment_strict_receive_is_credited() {
    let server = MockServer::start().await;
    let muxed = user_muxed(11);

    mount_root(&server, 700).await;
    mount_payments(
        &server,
        690,
        serde_json::json!([{
            "paging_token": "2990303104001",
            "type": "path_payment_strict_receive",
            "transaction_hash": "1111111111223344111111111122334411111111112233441111111111223344",
            "transaction_successful": true,
            "to": custody(),
            "to_muxed": muxed,
            "asset_type": "native",
            "amount": "7.5000000",
            "transaction": { "ledger": 693, "successful": true }
        }]),
    )
    .await;

    let deposits = client(&server).await.deposits_since(690).await.unwrap();

    assert_eq!(deposits.len(), 1);
    assert_eq!(deposits[0].money, Money::from_minor(Asset::Xlm, 75_000_000));
    assert_eq!(deposits[0].address, muxed);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. Reference format is deterministic and unique
// ─────────────────────────────────────────────────────────────────────────────

/// The reference `stellar:{tx_hash}:{paging_token}` is what prevents a deposit
/// from being credited twice. Two operations in different transactions must
/// have entirely different references.
#[tokio::test]
async fn deposit_references_are_unique_across_transactions() {
    let server = MockServer::start().await;

    mount_root(&server, 800).await;
    mount_payments(
        &server,
        790,
        serde_json::json!([
            {
                "paging_token": "3401491062785",
                "type": "payment",
                "transaction_hash": "tx000000001122334400000000112233440000000011223344000000001122334",
                "transaction_successful": true,
                "to": custody(),
                "to_muxed": user_muxed(1),
                "asset_type": "native",
                "amount": "1.0000000",
                "transaction": { "ledger": 792, "successful": true }
            },
            {
                "paging_token": "3401491062786",
                "type": "payment",
                "transaction_hash": "tx111111111122334411111111112233441111111111223344111111111122334",
                "transaction_successful": true,
                "to": custody(),
                "to_muxed": user_muxed(2),
                "asset_type": "native",
                "amount": "2.0000000",
                "transaction": { "ledger": 795, "successful": true }
            }
        ]),
    )
    .await;

    let deposits = client(&server).await.deposits_since(790).await.unwrap();
    assert_eq!(deposits.len(), 2);

    assert_ne!(
        deposits[0].reference, deposits[1].reference,
        "deposits from different transactions must have distinct references"
    );

    // Both references must follow the `stellar:{hash}:{paging_token}` pattern.
    for dep in &deposits {
        let parts: Vec<&str> = dep.reference.splitn(3, ':').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "stellar");
        assert!(!parts[1].is_empty(), "tx hash must not be empty");
        assert!(!parts[2].is_empty(), "paging token must not be empty");
    }
}
