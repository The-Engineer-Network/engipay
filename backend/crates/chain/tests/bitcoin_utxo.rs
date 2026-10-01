//! Integration tests: Bitcoin UTXO detection and confirmation counting.
//!
//! These tests drive the public surface of the Bitcoin UTXO detection pipeline
//! (`engipay_chain::bitcoin::*`) without any external network calls.  Every
//! assertion targets the exported types so they remain valid regardless of
//! internal refactors.
//!
//! Scenario coverage
//! -----------------
//!
//! **UTXO detection (`UtxoWatcher`)**
//! 1. User-bound output produces a valid `DetectedUtxo` with correct satoshi amount.
//! 2. Zero-satoshi outputs are rejected with `UtxoWatchError::ZeroValueOutput`.
//! 3. OP_RETURN outputs (non-matching script pubkey) are silently ignored.
//! 4. Change outputs sent to non-user (third-party) addresses are ignored.
//! 5. Multiple user outputs in one transaction are all detected.
//! 6. Multiple user addresses registered; each matched independently.
//! 7. Empty script pubkey registration is rejected.
//! 8. Batch inspection across multiple transactions aggregates correctly.
//! 9. `DetectedUtxo` carries correct `vout` index (not always 0).
//! 10. Transaction with only non-user outputs yields an empty result.
//!
//! **Confirmation counting (`is_bitcoin_confirmed`)**
//! 11. Transaction in the tip block (1 confirmation) is not yet creditable.
//! 12. Transaction with exactly `REQUIRED_CONFIRMATIONS` is creditable.
//! 13. Transaction with more than required is creditable.
//! 14. Transaction ahead of the current tip (mempool) is not creditable.
//! 15. Overflow-safe: very large block heights compare correctly.
//!
//! **`ObservedDeposit` construction from `DetectedUtxo`**
//! 16. Satoshi amount converts to `Money::from_minor(Asset::Btc, sats)` exactly.
//! 17. Zero-satoshi UTXO is never creditable via `is_creditable`.
//! 18. Positive UTXO with enough confirmations is creditable.
//! 19. Positive UTXO with too few confirmations is not creditable.
//! 20. `BITCOIN_CHAIN` constant matches expected identifier string.
//! 21. `REQUIRED_CONFIRMATIONS` constant matches expected value.

#![allow(clippy::unwrap_used)]

use engipay_chain::bitcoin::{
    ConfirmedTransaction, ScriptPubKey, TxOutput, Txid, UtxoWatchError, UtxoWatcher,
    is_bitcoin_confirmed, MIN_BITCOIN_CONFIRMATIONS, BITCOIN_CHAIN_ID,
};
use engipay_chain::bitcoin::confirmations::REQUIRED_CONFIRMATIONS;
use engipay_chain::bitcoin::cursor::BITCOIN_CHAIN;
use engipay_chain::{ChainClient, ObservedDeposit, is_creditable};
use engipay_core::{Asset, Chain, Money};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Builds a deterministic `Txid` from a single seed byte so tests never depend
/// on hard-coded byte arrays copied from somewhere else.
fn txid(seed: u8) -> Txid {
    Txid::from_bytes([seed; 32])
}

/// A minimal P2WPKH-shaped script pubkey: `OP_0 OP_PUSH20 <20 bytes>`.
/// Using a `marker` byte makes each script unique without real key material.
fn p2wpkh(marker: u8) -> ScriptPubKey {
    let mut script = vec![0x00, 0x14];
    script.extend_from_slice(&[marker; 20]);
    ScriptPubKey::new(script)
}

/// A P2TR (Taproot) output script: `OP_1 OP_PUSH32 <32 bytes>`.
fn p2tr(marker: u8) -> ScriptPubKey {
    let mut script = vec![0x51, 0x20];
    script.extend_from_slice(&[marker; 32]);
    ScriptPubKey::new(script)
}

/// An OP_RETURN script (unspendable data carrier). These are never user outputs.
fn op_return(data: &[u8]) -> ScriptPubKey {
    let mut script = vec![0x6a, data.len() as u8];
    script.extend_from_slice(data);
    ScriptPubKey::new(script)
}

/// Builds a `UtxoWatcher` with a single registered address.
fn watcher_with(address: &str, script: ScriptPubKey) -> UtxoWatcher {
    let mut watcher = UtxoWatcher::new();
    watcher
        .register_address(address, script)
        .expect("valid script pubkey");
    watcher
}

/// A fake `ChainClient` for Bitcoin — lets us call `is_creditable` and
/// `required_confirmations` without any network access.
struct FakeBitcoinClient;

impl ChainClient for FakeBitcoinClient {
    fn chain(&self) -> Chain {
        Chain::Bitcoin
    }

    async fn latest_height(&self) -> Result<u64, engipay_chain::ChainError> {
        Ok(0)
    }

    async fn deposits_since(
        &self,
        _height: u64,
    ) -> Result<Vec<ObservedDeposit>, engipay_chain::ChainError> {
        Ok(Vec::new())
    }

    async fn stream_events(
        &self,
        from_height: u64,
        poll_interval: std::time::Duration,
    ) -> Result<engipay_chain::EventStream, engipay_chain::ChainError> {
        use std::sync::Arc;
        Ok(engipay_chain::polling_stream(
            Arc::new(FakeBitcoinClient),
            from_height,
            poll_interval,
        ))
    }
}

/// Constructs an `ObservedDeposit` for Bitcoin with `value_sats` satoshis and
/// the given confirmation count. The reference is a placeholder that uniquely
/// identifies the deposit.
fn btc_deposit(value_sats: u64, confirmations: u32) -> ObservedDeposit {
    ObservedDeposit {
        money: Money::from_minor(Asset::Btc, value_sats as i128),
        address: "bc1qtest".to_owned(),
        reference: format!("bitcoin:{}:{}", "0".repeat(64), 0),
        confirmations,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. User-bound output → DetectedUtxo
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn user_bound_output_is_detected_with_correct_satoshi_amount() {
    let user_script = p2wpkh(0xAA);
    let watcher = watcher_with("bc1qalice", user_script.clone());

    let tx = ConfirmedTransaction {
        txid: txid(0x01),
        outputs: vec![TxOutput {
            value_sats: 100_000,
            script_pubkey: user_script,
        }],
    };

    let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
    assert_eq!(detected.len(), 1);
    assert_eq!(detected[0].txid, txid(0x01));
    assert_eq!(detected[0].vout, 0);
    assert_eq!(detected[0].value_sats, 100_000);
    assert_eq!(detected[0].address, "bc1qalice");
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Zero-satoshi outputs are rejected
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn zero_satoshi_output_for_user_address_is_rejected() {
    let user_script = p2wpkh(0xAA);
    let watcher = watcher_with("bc1qalice", user_script.clone());

    let tx = ConfirmedTransaction {
        txid: txid(0x02),
        outputs: vec![TxOutput {
            value_sats: 0,
            script_pubkey: user_script,
        }],
    };

    let err = watcher
        .inspect_transaction(&tx)
        .expect_err("zero value must be rejected");
    assert_eq!(
        err,
        UtxoWatchError::ZeroValueOutput {
            txid: txid(0x02),
            vout: 0,
        },
        "error must carry the txid and vout of the offending output"
    );
}

#[test]
fn zero_satoshi_output_to_non_user_address_does_not_produce_an_error() {
    // Zero-value outputs to unregistered scripts are simply ignored; no error.
    let watcher = watcher_with("bc1qalice", p2wpkh(0xAA));

    let tx = ConfirmedTransaction {
        txid: txid(0x03),
        outputs: vec![TxOutput {
            value_sats: 0,
            script_pubkey: p2wpkh(0xFF), // not registered
        }],
    };

    let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
    assert!(
        detected.is_empty(),
        "zero-value non-user output must be ignored, not errored"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. OP_RETURN outputs are ignored
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn op_return_output_is_ignored() {
    let user_script = p2wpkh(0xAA);
    let watcher = watcher_with("bc1qalice", user_script.clone());

    let tx = ConfirmedTransaction {
        txid: txid(0x04),
        outputs: vec![
            // OP_RETURN data carrier — unspendable, never a user output.
            TxOutput {
                value_sats: 0,
                script_pubkey: op_return(b"engipay"),
            },
            // Legitimate user output.
            TxOutput {
                value_sats: 50_000,
                script_pubkey: user_script,
            },
        ],
    };

    let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
    // Only the user output should be detected; the OP_RETURN is silently skipped.
    assert_eq!(detected.len(), 1);
    assert_eq!(detected[0].vout, 1);
    assert_eq!(detected[0].value_sats, 50_000);
}

#[test]
fn transaction_with_only_op_return_outputs_yields_empty_result() {
    let watcher = watcher_with("bc1qalice", p2wpkh(0xAA));

    let tx = ConfirmedTransaction {
        txid: txid(0x05),
        outputs: vec![TxOutput {
            value_sats: 0,
            script_pubkey: op_return(b"arbitrary data"),
        }],
    };

    let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
    assert!(detected.is_empty(), "OP_RETURN-only tx must yield no UTXOs");
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Change outputs to non-user addresses are ignored
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn change_output_to_third_party_address_is_ignored() {
    let user_script = p2wpkh(0xAA);
    let change_script = p2wpkh(0xBB); // sender's change address — not registered
    let watcher = watcher_with("bc1qalice", user_script.clone());

    let tx = ConfirmedTransaction {
        txid: txid(0x06),
        outputs: vec![
            // The actual payment to the user.
            TxOutput {
                value_sats: 200_000,
                script_pubkey: user_script,
            },
            // Change back to the sender — must not be credited.
            TxOutput {
                value_sats: 800_000,
                script_pubkey: change_script,
            },
        ],
    };

    let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
    assert_eq!(detected.len(), 1, "only the user output must be detected");
    assert_eq!(detected[0].value_sats, 200_000);
    assert_eq!(detected[0].vout, 0);
}

#[test]
fn transaction_with_only_change_outputs_yields_no_utxos() {
    let watcher = watcher_with("bc1qalice", p2wpkh(0xAA));

    let tx = ConfirmedTransaction {
        txid: txid(0x07),
        outputs: vec![
            TxOutput {
                value_sats: 500_000,
                script_pubkey: p2wpkh(0xBB), // sender change
            },
            TxOutput {
                value_sats: 300_000,
                script_pubkey: p2wpkh(0xCC), // some other third-party
            },
        ],
    };

    let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
    assert!(
        detected.is_empty(),
        "change-only transaction must yield no user UTXOs"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Multiple user outputs in one transaction
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn multiple_user_outputs_in_one_transaction_all_detected() {
    let user_script = p2wpkh(0xAA);
    let watcher = watcher_with("bc1qalice", user_script.clone());

    let tx = ConfirmedTransaction {
        txid: txid(0x08),
        outputs: vec![
            TxOutput {
                value_sats: 10_000,
                script_pubkey: user_script.clone(),
            },
            TxOutput {
                value_sats: 20_000,
                script_pubkey: p2wpkh(0xFF), // unregistered
            },
            TxOutput {
                value_sats: 30_000,
                script_pubkey: user_script.clone(),
            },
        ],
    };

    let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
    assert_eq!(detected.len(), 2);
    assert_eq!(detected[0].vout, 0);
    assert_eq!(detected[0].value_sats, 10_000);
    assert_eq!(detected[1].vout, 2);
    assert_eq!(detected[1].value_sats, 30_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Multiple user addresses registered — each matched independently
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn multiple_registered_addresses_each_matched_independently() {
    let alice_script = p2wpkh(0x01);
    let bob_script = p2wpkh(0x02);
    let mut watcher = UtxoWatcher::new();
    watcher
        .register_address("bc1qalice", alice_script.clone())
        .expect("valid");
    watcher
        .register_address("bc1qbob", bob_script.clone())
        .expect("valid");

    assert_eq!(watcher.len(), 2);

    let tx = ConfirmedTransaction {
        txid: txid(0x09),
        outputs: vec![
            TxOutput {
                value_sats: 11_000,
                script_pubkey: alice_script,
            },
            TxOutput {
                value_sats: 22_000,
                script_pubkey: bob_script,
            },
            TxOutput {
                value_sats: 99_000,
                script_pubkey: p2wpkh(0xFF), // unregistered change
            },
        ],
    };

    let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
    assert_eq!(detected.len(), 2);

    // vout 0 → alice
    assert_eq!(detected[0].vout, 0);
    assert_eq!(detected[0].value_sats, 11_000);
    assert_eq!(detected[0].address, "bc1qalice");

    // vout 1 → bob
    assert_eq!(detected[1].vout, 1);
    assert_eq!(detected[1].value_sats, 22_000);
    assert_eq!(detected[1].address, "bc1qbob");
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Empty script pubkey registration is rejected
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn registering_empty_script_pubkey_is_rejected() {
    let mut watcher = UtxoWatcher::new();
    let err = watcher
        .register_address("bc1qalice", ScriptPubKey::new(Vec::new()))
        .expect_err("empty script must be rejected");

    assert_eq!(
        err,
        UtxoWatchError::EmptyScriptPubKey {
            address: "bc1qalice".to_owned(),
        }
    );
    // The watcher must remain empty — no partial state.
    assert!(watcher.is_empty());
}

#[test]
fn watcher_with_no_registered_addresses_never_detects_anything() {
    let watcher = UtxoWatcher::new();
    assert!(watcher.is_empty());

    let tx = ConfirmedTransaction {
        txid: txid(0x0A),
        outputs: vec![TxOutput {
            value_sats: 1_000_000,
            script_pubkey: p2wpkh(0xAA),
        }],
    };

    let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
    assert!(detected.is_empty());
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Batch inspection aggregates across multiple transactions
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn batch_inspection_aggregates_detected_utxos_in_transaction_order() {
    let user_script = p2wpkh(0xAA);
    let watcher = watcher_with("bc1qalice", user_script.clone());

    let transactions = vec![
        ConfirmedTransaction {
            txid: txid(0x10),
            outputs: vec![TxOutput {
                value_sats: 1_000,
                script_pubkey: user_script.clone(),
            }],
        },
        ConfirmedTransaction {
            txid: txid(0x11),
            outputs: vec![
                TxOutput {
                    value_sats: 2_000,
                    script_pubkey: p2wpkh(0xFF), // not user
                },
            ],
        },
        ConfirmedTransaction {
            txid: txid(0x12),
            outputs: vec![TxOutput {
                value_sats: 3_000,
                script_pubkey: user_script,
            }],
        },
    ];

    let detected = watcher
        .inspect_confirmed(&transactions)
        .expect("batch inspection ok");

    assert_eq!(detected.len(), 2, "only two transactions pay the user");
    assert_eq!(detected[0].txid, txid(0x10));
    assert_eq!(detected[0].value_sats, 1_000);
    assert_eq!(detected[1].txid, txid(0x12));
    assert_eq!(detected[1].value_sats, 3_000);
}

#[test]
fn batch_inspection_of_empty_transaction_list_returns_empty_vec() {
    let watcher = watcher_with("bc1qalice", p2wpkh(0xAA));
    let detected = watcher
        .inspect_confirmed(&[])
        .expect("empty batch ok");
    assert!(detected.is_empty());
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. `vout` index is preserved correctly
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn vout_index_corresponds_to_position_in_outputs_vec() {
    let first = p2wpkh(0x01);
    let second = p2wpkh(0x02);
    let third = p2wpkh(0x03);
    let mut watcher = UtxoWatcher::new();
    watcher.register_address("bc1qfirst", first.clone()).unwrap();
    watcher.register_address("bc1qthird", third.clone()).unwrap();

    let tx = ConfirmedTransaction {
        txid: txid(0x20),
        outputs: vec![
            TxOutput { value_sats: 1_000, script_pubkey: first },   // vout 0
            TxOutput { value_sats: 2_000, script_pubkey: second },  // vout 1 — unregistered
            TxOutput { value_sats: 3_000, script_pubkey: third },   // vout 2
        ],
    };

    let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
    assert_eq!(detected.len(), 2);
    assert_eq!(detected[0].vout, 0, "first user output must be vout 0");
    assert_eq!(detected[1].vout, 2, "third output must be vout 2");
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Transaction with only non-user outputs
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn transaction_with_only_non_user_outputs_yields_empty_result() {
    let watcher = watcher_with("bc1qalice", p2wpkh(0xAA));

    let tx = ConfirmedTransaction {
        txid: txid(0x30),
        outputs: vec![
            TxOutput { value_sats: 100_000, script_pubkey: p2wpkh(0xBB) },
            TxOutput { value_sats: 200_000, script_pubkey: p2wpkh(0xCC) },
            TxOutput { value_sats: 0,       script_pubkey: op_return(b"memo") },
        ],
    };

    let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
    assert!(detected.is_empty());
}

// ─────────────────────────────────────────────────────────────────────────────
// 11–15. Confirmation counting
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn transaction_in_tip_block_has_one_confirmation_and_is_not_creditable() {
    // A transaction included in the current tip has exactly 1 confirmation.
    // With REQUIRED_CONFIRMATIONS = 2 it must not yet be credited.
    assert!(
        !is_bitcoin_confirmed(100, 100),
        "1 confirmation (tip) must not be creditable"
    );
}

#[test]
fn transaction_with_exactly_required_confirmations_is_creditable() {
    // One block mined on top of the inclusion block = 2 confirmations.
    assert!(
        is_bitcoin_confirmed(100, 100 + REQUIRED_CONFIRMATIONS - 1),
        "exactly {REQUIRED_CONFIRMATIONS} confirmations must be creditable"
    );
}

#[test]
fn transaction_with_more_than_required_confirmations_is_creditable() {
    assert!(is_bitcoin_confirmed(100, 200));
    assert!(is_bitcoin_confirmed(0, 999));
}

#[test]
fn transaction_ahead_of_current_tip_is_not_creditable() {
    // tx_height > current_height: this can happen with a stale chain tip.
    assert!(!is_bitcoin_confirmed(101, 100));
    assert!(!is_bitcoin_confirmed(1_000_000, 999_999));
}

#[test]
fn confirmation_counting_handles_large_block_heights_without_overflow() {
    // Near u64::MAX to ensure no arithmetic overflow.
    let high = u64::MAX / 2;
    assert!(!is_bitcoin_confirmed(high, high));               // 1 confirmation
    assert!(is_bitcoin_confirmed(high, high + 1));            // 2 confirmations
    assert!(!is_bitcoin_confirmed(high + 1, high));           // tip behind tx
}

// ─────────────────────────────────────────────────────────────────────────────
// 16. Satoshi → Money conversion
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn satoshi_amount_converts_to_btc_money_exactly() {
    // 1 BTC = 100_000_000 satoshis. Money::from_minor stores raw satoshi count.
    let one_btc = Money::from_minor(Asset::Btc, 100_000_000);
    assert_eq!(one_btc.asset, Asset::Btc);
    assert_eq!(one_btc.minor, 100_000_000);

    let dust = Money::from_minor(Asset::Btc, 546); // typical dust limit
    assert_eq!(dust.minor, 546);
    assert!(dust.is_positive());
}

#[test]
fn zero_satoshi_money_is_not_positive() {
    let zero = Money::from_minor(Asset::Btc, 0);
    assert!(!zero.is_positive());
    assert!(zero.is_zero());
}

// ─────────────────────────────────────────────────────────────────────────────
// 17–19. is_creditable gate
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn zero_satoshi_deposit_is_never_creditable() {
    let deposit = btc_deposit(0, 100);
    assert!(
        !is_creditable(&FakeBitcoinClient, &deposit),
        "zero-value deposit must never be creditable regardless of confirmations"
    );
}

#[test]
fn positive_deposit_with_sufficient_confirmations_is_creditable() {
    let deposit = btc_deposit(10_000, 2); // exactly REQUIRED_CONFIRMATIONS
    assert!(
        is_creditable(&FakeBitcoinClient, &deposit),
        "deposit with {} confirmations (required: 2) must be creditable",
        deposit.confirmations
    );
}

#[test]
fn positive_deposit_with_one_confirmation_is_not_creditable() {
    let deposit = btc_deposit(10_000, 1);
    assert!(
        !is_creditable(&FakeBitcoinClient, &deposit),
        "deposit with only 1 confirmation must not be creditable"
    );
}

#[test]
fn positive_deposit_with_many_confirmations_is_creditable() {
    let deposit = btc_deposit(100_000_000, 100);
    assert!(is_creditable(&FakeBitcoinClient, &deposit));
}

#[test]
fn bitcoin_client_requires_two_confirmations() {
    assert_eq!(
        FakeBitcoinClient.required_confirmations(),
        2,
        "Bitcoin chain must require exactly 2 confirmations"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 20–21. Constants
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn bitcoin_chain_constant_is_stable() {
    // Direct constant from cursor module.
    assert_eq!(BITCOIN_CHAIN, "bitcoin");
    // Re-exported via bitcoin mod.rs as BITCOIN_CHAIN_ID.
    assert_eq!(BITCOIN_CHAIN_ID, "bitcoin");
    assert_eq!(BITCOIN_CHAIN, BITCOIN_CHAIN_ID);
}

#[test]
fn required_confirmations_constant_matches_expected_value() {
    // Direct constant from confirmations module.
    assert_eq!(
        REQUIRED_CONFIRMATIONS, 2,
        "Bitcoin deposits require 2 confirmations before crediting"
    );
    // Re-exported via bitcoin mod.rs as MIN_BITCOIN_CONFIRMATIONS.
    assert_eq!(MIN_BITCOIN_CONFIRMATIONS, 2);
    assert_eq!(REQUIRED_CONFIRMATIONS, MIN_BITCOIN_CONFIRMATIONS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: Taproot (P2TR) outputs are detected like any other script type
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn taproot_output_matching_registered_script_is_detected() {
    let taproot_script = p2tr(0x55);
    let watcher = watcher_with("bc1ptaproot", taproot_script.clone());

    let tx = ConfirmedTransaction {
        txid: txid(0x40),
        outputs: vec![TxOutput {
            value_sats: 500_000,
            script_pubkey: taproot_script,
        }],
    };

    let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
    assert_eq!(detected.len(), 1);
    assert_eq!(detected[0].value_sats, 500_000);
    assert_eq!(detected[0].address, "bc1ptaproot");
}

#[test]
fn taproot_output_not_registered_is_ignored() {
    let watcher = watcher_with("bc1qalice", p2wpkh(0xAA));

    let tx = ConfirmedTransaction {
        txid: txid(0x41),
        outputs: vec![TxOutput {
            value_sats: 1_000_000,
            script_pubkey: p2tr(0x99), // unregistered Taproot output
        }],
    };

    let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
    assert!(detected.is_empty());
}

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: ScriptPubKey and Txid API surface
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn txid_round_trips_through_bytes() {
    let bytes = [0xde; 32];
    let txid_val = Txid::from_bytes(bytes);
    assert_eq!(txid_val.as_bytes(), &bytes);
}

#[test]
fn script_pubkey_round_trips_through_bytes() {
    let raw: Vec<u8> = vec![0x00, 0x14, 0xAB, 0xCD];
    let script = ScriptPubKey::new(raw.clone());
    assert_eq!(script.as_bytes(), raw.as_slice());
}

#[test]
fn two_different_script_pubkeys_are_not_equal() {
    assert_ne!(p2wpkh(0x01), p2wpkh(0x02));
}

#[test]
fn same_script_pubkey_bytes_are_equal() {
    assert_eq!(p2wpkh(0x05), p2wpkh(0x05));
}

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: Error messages are human-readable
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn empty_script_pubkey_error_message_mentions_address() {
    let err = UtxoWatchError::EmptyScriptPubKey {
        address: "bc1qalice".to_owned(),
    };
    let msg = err.to_string();
    assert!(
        msg.contains("bc1qalice"),
        "error message should mention the offending address: {msg}"
    );
}

#[test]
fn zero_value_output_error_message_is_descriptive() {
    let err = UtxoWatchError::ZeroValueOutput {
        txid: txid(0xAB),
        vout: 3,
    };
    let msg = err.to_string();
    assert!(
        msg.contains('3'),
        "error message should mention the vout index: {msg}"
    );
}
