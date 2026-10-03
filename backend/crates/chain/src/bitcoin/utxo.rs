//! Unspent Transaction Output (UTXO) detection for user Bitcoin addresses.
//!
//! Given confirmed Bitcoin transactions, this module inspects every output
//! (`vout`) and matches its `scriptPubKey` against the script pubkeys derived
//! from user deposit addresses. Matched outputs are surfaced as [`DetectedUtxo`]
//! values carrying the integer satoshi amount, the transaction hash (`txid`)
//! and the output index (`vout`).
//!
//! Money is represented exclusively with integer satoshi amounts; no floating
//! point arithmetic is used anywhere in this module.
//!
//! # Satoshi → Ledger minor unit conversion
//!
//! Bitcoin uses 8 decimal places: 1 BTC = 100 000 000 satoshis.  The EngiPay
//! ledger stores `Asset::Btc` at 8 decimal places (`Asset::Btc.decimals() == 8`),
//! so the network precision and the ledger precision are identical.  A satoshi
//! amount maps **1-to-1** to a ledger minor unit:
//!
//! ```text
//! ledger minor units = value_sats   (no scaling required)
//! ```
//!
//! Use [`sats_to_money`] to perform the conversion in a way that is explicit,
//! type-safe, and tested.

use std::collections::HashMap;

use engipay_core::{Asset, Money};

/// A Bitcoin transaction hash (32 bytes, big-endian display order).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Txid(pub [u8; 32]);

impl Txid {
    /// Constructs a [`Txid`] from a 32-byte array.
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// Returns the raw 32-byte representation.
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// A Bitcoin script pubkey (the locking script of an output).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ScriptPubKey(pub Vec<u8>);

impl ScriptPubKey {
    /// Constructs a [`ScriptPubKey`] from raw script bytes.
    pub fn new(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }

    /// Returns the raw script bytes.
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

/// A single transaction output as observed on chain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TxOutput {
    /// Integer satoshi amount locked by this output.
    pub value_sats: u64,
    /// The locking script of this output.
    pub script_pubkey: ScriptPubKey,
}

/// A confirmed Bitcoin transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfirmedTransaction {
    /// Transaction hash.
    pub txid: Txid,
    /// Outputs produced by this transaction, in `vout` order.
    pub outputs: Vec<TxOutput>,
}

/// A UTXO detected for a user deposit address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectedUtxo {
    /// Transaction hash that produced the output.
    pub txid: Txid,
    /// Output index within the transaction.
    pub vout: u32,
    /// Integer satoshi amount of the output.
    pub value_sats: u64,
    /// The user deposit address that owns the matched script pubkey.
    pub address: String,
}

/// Errors produced while watching transactions for user UTXOs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UtxoWatchError {
    /// A deposit address was registered with an empty script pubkey.
    EmptyScriptPubKey { address: String },
    /// A transaction output carried a zero satoshi amount.
    ZeroValueOutput { txid: Txid, vout: u32 },
}

impl std::fmt::Display for UtxoWatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UtxoWatchError::EmptyScriptPubKey { address } => {
                write!(f, "deposit address {address} has an empty script pubkey")
            }
            UtxoWatchError::ZeroValueOutput { txid, vout } => {
                write!(f, "output {vout} of transaction {txid:?} has zero value")
            }
        }
    }
}

impl std::error::Error for UtxoWatchError {}

/// Converts an integer satoshi amount to a ledger [`Money`] value.
///
/// Bitcoin has 8 decimal places on-chain (`Asset::Btc.network_decimals(Chain::Bitcoin) == 8`)
/// and the EngiPay ledger also stores `Asset::Btc` at 8 decimal places
/// (`Asset::Btc.decimals() == 8`). The network precision and the ledger
/// precision are therefore identical, so satoshis map **1-to-1** to ledger
/// minor units with no scaling.
///
/// # Example
///
/// ```ignore
/// let money = sats_to_money(100_000_000); // 1 BTC
/// assert_eq!(money.minor, 100_000_000);
/// assert_eq!(money.asset, Asset::Btc);
/// ```
///
/// # Panics
///
/// Never panics: `i128` can represent every `u64` value without overflow.
pub fn sats_to_money(value_sats: u64) -> Money {
    // Cast is lossless: u64::MAX < i128::MAX.
    Money::from_minor(Asset::Btc, value_sats as i128)
}

/// Watches confirmed transactions for outputs paying registered user addresses.
///
/// The watcher is built from the `deposit_addresses` registry, mapping each
/// user address to its script pubkey. Script pubkeys must be non-empty; an
/// empty script pubkey is rejected at construction time so that no unvalidated
/// input can silently match unrelated outputs.
#[derive(Debug, Clone, Default)]
pub struct UtxoWatcher {
    scripts: HashMap<ScriptPubKey, String>,
}

impl UtxoWatcher {
    /// Creates an empty watcher with no registered deposit addresses.
    pub fn new() -> Self {
        Self {
            scripts: HashMap::new(),
        }
    }

    /// Registers a user deposit address and its script pubkey.
    ///
    /// Returns [`UtxoWatchError::EmptyScriptPubKey`] when the script pubkey is
    /// empty, preserving the strict validation rule that no unvalidated input
    /// is accepted.
    pub fn register_address(
        &mut self,
        address: impl Into<String>,
        script_pubkey: ScriptPubKey,
    ) -> Result<(), UtxoWatchError> {
        let address = address.into();
        if script_pubkey.as_bytes().is_empty() {
            return Err(UtxoWatchError::EmptyScriptPubKey { address });
        }
        self.scripts.insert(script_pubkey, address);
        Ok(())
    }

    /// Returns the number of registered deposit addresses.
    pub fn len(&self) -> usize {
        self.scripts.len()
    }

    /// Returns `true` when no deposit addresses are registered.
    pub fn is_empty(&self) -> bool {
        self.scripts.is_empty()
    }

    /// Inspects a confirmed transaction and returns every output paying a
    /// registered user address.
    ///
    /// Each matched output yields a [`DetectedUtxo`] with the integer satoshi
    /// amount, the transaction hash and the output index. Outputs with a zero
    /// satoshi amount are rejected as invalid.
    pub fn inspect_transaction(
        &self,
        tx: &ConfirmedTransaction,
    ) -> Result<Vec<DetectedUtxo>, UtxoWatchError> {
        let mut detected = Vec::new();
        for (index, output) in tx.outputs.iter().enumerate() {
            let Some(address) = self.scripts.get(&output.script_pubkey) else {
                continue;
            };
            let vout = u32::try_from(index).map_err(|_| UtxoWatchError::ZeroValueOutput {
                txid: tx.txid,
                vout: u32::MAX,
            })?;
            if output.value_sats == 0 {
                return Err(UtxoWatchError::ZeroValueOutput {
                    txid: tx.txid,
                    vout,
                });
            }
            detected.push(DetectedUtxo {
                txid: tx.txid,
                vout,
                value_sats: output.value_sats,
                address: address.clone(),
            });
        }
        Ok(detected)
    }

    /// Inspects a batch of confirmed transactions, concatenating the detected
    /// UTXOs in transaction order.
    pub fn inspect_confirmed(
        &self,
        transactions: &[ConfirmedTransaction],
    ) -> Result<Vec<DetectedUtxo>, UtxoWatchError> {
        let mut detected = Vec::new();
        for tx in transactions {
            detected.extend(self.inspect_transaction(tx)?);
        }
        Ok(detected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engipay_core::Chain;

    fn txid(byte: u8) -> Txid {
        Txid::from_bytes([byte; 32])
    }

    fn p2wpkh(marker: u8) -> ScriptPubKey {
        // 0x00 0x14 <20-byte program> — a minimal P2WPKH-shaped script.
        let mut script = vec![0x00, 0x14];
        script.extend_from_slice(&[marker; 20]);
        ScriptPubKey::new(script)
    }

    fn watcher_with(address: &str, script: ScriptPubKey) -> UtxoWatcher {
        let mut watcher = UtxoWatcher::new();
        watcher
            .register_address(address, script)
            .expect("valid script pubkey");
        watcher
    }

    // ── Satoshi → ledger minor unit conversion ────────────────────────────────

    /// The core invariant for issue #168: Bitcoin uses 8 decimal places both
    /// on-chain and in the EngiPay ledger, so satoshis map 1-to-1 to ledger
    /// minor units with no scaling factor.
    #[test]
    fn satoshis_map_one_to_one_to_ledger_minor_units() {
        // 1 BTC = 100_000_000 satoshis = 100_000_000 minor units in the ledger.
        let money = sats_to_money(100_000_000);
        assert_eq!(money.minor, 100_000_000, "1 BTC must be 100_000_000 minor units");
        assert_eq!(money.asset, Asset::Btc);
    }

    #[test]
    fn one_satoshi_maps_to_one_minor_unit() {
        let money = sats_to_money(1);
        assert_eq!(money.minor, 1);
        assert_eq!(money.asset, Asset::Btc);
    }

    #[test]
    fn zero_satoshis_map_to_zero_minor_units() {
        let money = sats_to_money(0);
        assert_eq!(money.minor, 0);
        assert!(money.is_zero());
        assert!(!money.is_positive());
    }

    #[test]
    fn dust_limit_546_satoshis_maps_correctly() {
        // 546 satoshis is the standard P2WPKH dust limit.
        let money = sats_to_money(546);
        assert_eq!(money.minor, 546);
        assert!(money.is_positive());
    }

    #[test]
    fn large_satoshi_amount_does_not_overflow() {
        // 21 million BTC = 2_100_000_000_000_000 satoshis — the total supply.
        let total_supply_sats: u64 = 21_000_000 * 100_000_000;
        let money = sats_to_money(total_supply_sats);
        assert_eq!(money.minor, total_supply_sats as i128);
    }

    #[test]
    fn u64_max_satoshis_does_not_overflow_i128() {
        // u64::MAX fits inside i128 without wrapping.
        let money = sats_to_money(u64::MAX);
        assert_eq!(money.minor, u64::MAX as i128);
        assert!(money.is_positive());
    }

    #[test]
    fn btc_has_8_decimal_places_on_bitcoin_network() {
        // Verifies that the 1:1 mapping assumption holds: both the ledger and
        // the Bitcoin network use exactly 8 decimal places.
        assert_eq!(Asset::Btc.decimals(), 8,
            "Asset::Btc ledger decimals must be 8");
        assert_eq!(
            Asset::Btc.network_decimals(Chain::Bitcoin),
            Some(8),
            "Bitcoin network decimals must be 8"
        );
    }

    #[test]
    fn ledger_decimals_equal_network_decimals_so_no_scaling_is_needed() {
        let ledger = Asset::Btc.decimals();
        let network = Asset::Btc.network_decimals(Chain::Bitcoin).unwrap();
        assert_eq!(
            ledger, network,
            "ledger and network decimals must match for 1:1 satoshi mapping"
        );
    }

    #[test]
    fn sats_to_money_asset_is_always_btc() {
        for sats in [0u64, 1, 546, 100_000_000, u64::MAX] {
            assert_eq!(
                sats_to_money(sats).asset,
                Asset::Btc,
                "sats_to_money({sats}) must always produce Asset::Btc"
            );
        }
    }

    #[test]
    fn sats_to_money_minor_equals_sats_for_all_representative_values() {
        let cases: &[(u64, &str)] = &[
            (1,                   "1 satoshi (smallest unit)"),
            (546,                 "dust limit"),
            (10_000,              "typical small payment"),
            (1_000_000,           "0.01 BTC"),
            (50_000_000,          "0.5 BTC"),
            (100_000_000,         "1 BTC"),
            (1_000_000_000,       "10 BTC"),
            (2_100_000_000_000_000, "21 million BTC (total supply)"),
        ];
        for &(sats, label) in cases {
            let money = sats_to_money(sats);
            assert_eq!(
                money.minor, sats as i128,
                "sats_to_money mismatch for {label}: expected {sats}, got {}",
                money.minor
            );
        }
    }

    #[test]
    fn detected_utxo_value_sats_converts_to_money_correctly() {
        // End-to-end: detect a UTXO then convert its satoshi amount to Money.
        let user_script = p2wpkh(0xAA);
        let watcher = watcher_with("bc1quser", user_script.clone());

        let tx = ConfirmedTransaction {
            txid: txid(0x01),
            outputs: vec![TxOutput {
                value_sats: 50_000_000, // 0.5 BTC
                script_pubkey: user_script,
            }],
        };

        let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
        assert_eq!(detected.len(), 1);

        let utxo = &detected[0];
        let money = sats_to_money(utxo.value_sats);

        assert_eq!(money.asset, Asset::Btc);
        assert_eq!(money.minor, 50_000_000);
        assert!(money.is_positive());
    }

    // ── Existing UTXO detection tests ─────────────────────────────────────────

    #[test]
    fn detects_output_matching_user_script_pubkey() {
        let user_script = p2wpkh(0xAA);
        let watcher = watcher_with("bc1quser", user_script.clone());

        let tx = ConfirmedTransaction {
            txid: txid(0x01),
            outputs: vec![
                TxOutput {
                    value_sats: 1_000,
                    script_pubkey: p2wpkh(0xBB),
                },
                TxOutput {
                    value_sats: 42_000,
                    script_pubkey: user_script,
                },
            ],
        };

        let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
        assert_eq!(detected.len(), 1);
        assert_eq!(
            detected[0],
            DetectedUtxo {
                txid: txid(0x01),
                vout: 1,
                value_sats: 42_000,
                address: "bc1quser".to_string(),
            }
        );
    }

    #[test]
    fn ignores_outputs_with_non_matching_script_pubkeys() {
        let watcher = watcher_with("bc1quser", p2wpkh(0xAA));

        let tx = ConfirmedTransaction {
            txid: txid(0x02),
            outputs: vec![
                TxOutput {
                    value_sats: 5_000,
                    script_pubkey: p2wpkh(0xBB),
                },
                TxOutput {
                    value_sats: 7_000,
                    script_pubkey: p2wpkh(0xCC),
                },
            ],
        };

        let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
        assert!(detected.is_empty());
    }

    #[test]
    fn detects_multiple_outputs_and_preserves_vout_index() {
        let first = p2wpkh(0x01);
        let second = p2wpkh(0x02);
        let mut watcher = UtxoWatcher::new();
        watcher
            .register_address("bc1qfirst", first.clone())
            .expect("valid script");
        watcher
            .register_address("bc1qsecond", second.clone())
            .expect("valid script");

        let tx = ConfirmedTransaction {
            txid: txid(0x03),
            outputs: vec![
                TxOutput {
                    value_sats: 100,
                    script_pubkey: first,
                },
                TxOutput {
                    value_sats: 200,
                    script_pubkey: p2wpkh(0x09),
                },
                TxOutput {
                    value_sats: 300,
                    script_pubkey: second,
                },
            ],
        };

        let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
        assert_eq!(detected.len(), 2);
        assert_eq!(detected[0].vout, 0);
        assert_eq!(detected[0].value_sats, 100);
        assert_eq!(detected[0].address, "bc1qfirst");
        assert_eq!(detected[1].vout, 2);
        assert_eq!(detected[1].value_sats, 300);
        assert_eq!(detected[1].address, "bc1qsecond");
    }

    #[test]
    fn rejects_empty_script_pubkey_on_registration() {
        let mut watcher = UtxoWatcher::new();
        let err = watcher
            .register_address("bc1quser", ScriptPubKey::new(Vec::new()))
            .expect_err("empty script must be rejected");
        assert_eq!(
            err,
            UtxoWatchError::EmptyScriptPubKey {
                address: "bc1quser".to_string(),
            }
        );
        assert!(watcher.is_empty());
    }

    #[test]
    fn rejects_zero_value_output_for_user_address() {
        let user_script = p2wpkh(0xAA);
        let watcher = watcher_with("bc1quser", user_script.clone());

        let tx = ConfirmedTransaction {
            txid: txid(0x04),
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
                txid: txid(0x04),
                vout: 0,
            }
        );
    }

    #[test]
    fn inspect_confirmed_aggregates_across_transactions() {
        let user_script = p2wpkh(0xAA);
        let watcher = watcher_with("bc1quser", user_script.clone());

        let transactions = vec![
            ConfirmedTransaction {
                txid: txid(0x05),
                outputs: vec![TxOutput {
                    value_sats: 1_500,
                    script_pubkey: user_script.clone(),
                }],
            },
            ConfirmedTransaction {
                txid: txid(0x06),
                outputs: vec![TxOutput {
                    value_sats: 2_500,
                    script_pubkey: user_script,
                }],
            },
        ];

        let detected = watcher
            .inspect_confirmed(&transactions)
            .expect("inspection ok");
        assert_eq!(detected.len(), 2);
        assert_eq!(detected[0].txid, txid(0x05));
        assert_eq!(detected[0].value_sats, 1_500);
        assert_eq!(detected[1].txid, txid(0x06));
        assert_eq!(detected[1].value_sats, 2_500);
    }
}
        let user_script = p2wpkh(0xAA);
        let watcher = watcher_with("bc1quser", user_script.clone());

        let tx = ConfirmedTransaction {
            txid: txid(0x01),
            outputs: vec![
                TxOutput {
                    value_sats: 1_000,
                    script_pubkey: p2wpkh(0xBB),
                },
                TxOutput {
                    value_sats: 42_000,
                    script_pubkey: user_script,
                },
            ],
        };

        let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
        assert_eq!(detected.len(), 1);
        assert_eq!(
            detected[0],
            DetectedUtxo {
                txid: txid(0x01),
                vout: 1,
                value_sats: 42_000,
                address: "bc1quser".to_string(),
            }
        );
    }

    #[test]
    fn ignores_outputs_with_non_matching_script_pubkeys() {
        let watcher = watcher_with("bc1quser", p2wpkh(0xAA));

        let tx = ConfirmedTransaction {
            txid: txid(0x02),
            outputs: vec![
                TxOutput {
                    value_sats: 5_000,
                    script_pubkey: p2wpkh(0xBB),
                },
                TxOutput {
                    value_sats: 7_000,
                    script_pubkey: p2wpkh(0xCC),
                },
            ],
        };

        let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
        assert!(detected.is_empty());
    }

    #[test]
    fn detects_multiple_outputs_and_preserves_vout_index() {
        let first = p2wpkh(0x01);
        let second = p2wpkh(0x02);
        let mut watcher = UtxoWatcher::new();
        watcher
            .register_address("bc1qfirst", first.clone())
            .expect("valid script");
        watcher
            .register_address("bc1qsecond", second.clone())
            .expect("valid script");

        let tx = ConfirmedTransaction {
            txid: txid(0x03),
            outputs: vec![
                TxOutput {
                    value_sats: 100,
                    script_pubkey: first,
                },
                TxOutput {
                    value_sats: 200,
                    script_pubkey: p2wpkh(0x09),
                },
                TxOutput {
                    value_sats: 300,
                    script_pubkey: second,
                },
            ],
        };

        let detected = watcher.inspect_transaction(&tx).expect("inspection ok");
        assert_eq!(detected.len(), 2);
        assert_eq!(detected[0].vout, 0);
        assert_eq!(detected[0].value_sats, 100);
        assert_eq!(detected[0].address, "bc1qfirst");
        assert_eq!(detected[1].vout, 2);
        assert_eq!(detected[1].value_sats, 300);
        assert_eq!(detected[1].address, "bc1qsecond");
    }

    #[test]
    fn rejects_empty_script_pubkey_on_registration() {
        let mut watcher = UtxoWatcher::new();
        let err = watcher
            .register_address("bc1quser", ScriptPubKey::new(Vec::new()))
            .expect_err("empty script must be rejected");
        assert_eq!(
            err,
            UtxoWatchError::EmptyScriptPubKey {
                address: "bc1quser".to_string(),
            }
        );
        assert!(watcher.is_empty());
    }

    #[test]
    fn rejects_zero_value_output_for_user_address() {
        let user_script = p2wpkh(0xAA);
        let watcher = watcher_with("bc1quser", user_script.clone());

        let tx = ConfirmedTransaction {
            txid: txid(0x04),
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
                txid: txid(0x04),
                vout: 0,
            }
        );
    }

    #[test]
    fn inspect_confirmed_aggregates_across_transactions() {
        let user_script = p2wpkh(0xAA);
        let watcher = watcher_with("bc1quser", user_script.clone());

        let transactions = vec![
            ConfirmedTransaction {
                txid: txid(0x05),
                outputs: vec![TxOutput {
                    value_sats: 1_500,
                    script_pubkey: user_script.clone(),
                }],
            },
            ConfirmedTransaction {
                txid: txid(0x06),
                outputs: vec![TxOutput {
                    value_sats: 2_500,
                    script_pubkey: user_script,
                }],
            },
        ];

        let detected = watcher
            .inspect_confirmed(&transactions)
            .expect("inspection ok");
        assert_eq!(detected.len(), 2);
        assert_eq!(detected[0].txid, txid(0x05));
        assert_eq!(detected[0].value_sats, 1_500);
        assert_eq!(detected[1].txid, txid(0x06));
        assert_eq!(detected[1].value_sats, 2_500);
    }
}
