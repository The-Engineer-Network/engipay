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

use std::collections::HashMap;

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

impl std::fmt::Display for Txid {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for byte in &self.0 {
            write!(f, "{:02x}", byte)?;
        }
        Ok(())
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

impl DetectedUtxo {
    /// Returns the deterministic idempotency reference string for Bitcoin deposits.
    ///
    /// Formatted as `btc:<tx_hash>:<vout>` (e.g. `btc:7f8e...:0`), which uniquely
    /// identifies the exact unspent transaction output credited.
    pub fn idempotency_reference(&self) -> String {
        format!("btc:{}:{}", self.txid, self.vout)
    }

    /// Converts the integer satoshi amount to ledger minor units for [`engipay_core::Asset::Btc`].
    ///
    /// Bitcoin amounts are denominated in satoshis (1 BTC = 100,000,000 sats).
    /// Since the ledger stores BTC at 8 decimals, satoshi amounts map 1:1 to minor units
    /// of [`engipay_core::Asset::Btc`].
    pub fn to_minor_units(&self) -> i128 {
        sats_to_minor_units(self.value_sats)
    }

    /// Converts the detected UTXO satoshi amount into a typed [`engipay_core::Money`] value.
    pub fn to_money(&self) -> engipay_core::Money {
        sats_to_money(self.value_sats)
    }
}

/// Converts a Bitcoin satoshi amount to ledger minor units for [`engipay_core::Asset::Btc`].
///
/// Satoshis map 1:1 to minor units of [`engipay_core::Asset::Btc`] because both Bitcoin
/// on-chain and the EngiPay ledger represent BTC at 8 decimal places (1 BTC = 100,000,000 units).
pub fn sats_to_minor_units(sats: u64) -> i128 {
    i128::from(sats)
}

/// Converts a Bitcoin satoshi amount directly into typed [`engipay_core::Money`] of [`engipay_core::Asset::Btc`].
pub fn sats_to_money(sats: u64) -> engipay_core::Money {
    engipay_core::Money::from_minor(engipay_core::Asset::Btc, sats_to_minor_units(sats))
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

    #[test]
    fn format_deterministic_idempotency_reference() {
        let mut tx_bytes = [0u8; 32];
        tx_bytes[0] = 0x7f;
        tx_bytes[1] = 0x8e;
        tx_bytes[31] = 0x01;
        let utxo = DetectedUtxo {
            txid: Txid::from_bytes(tx_bytes),
            vout: 0,
            value_sats: 50_000,
            address: "bc1qtest".to_string(),
        };
        let expected_ref = format!("btc:{}:0", utxo.txid);
        assert_eq!(utxo.idempotency_reference(), expected_ref);
        assert!(utxo.idempotency_reference().starts_with("btc:7f8e"));
        assert!(utxo.idempotency_reference().ends_with(":0"));
    }

    #[test]
    fn txid_display_formats_lowercase_hex() {
        let mut bytes = [0u8; 32];
        bytes[0] = 0xab;
        bytes[1] = 0xcd;
        bytes[2] = 0xef;
        let id = Txid::from_bytes(bytes);
        let s = id.to_string();
        assert_eq!(s.len(), 64);
        assert!(s.starts_with("abcdef"));
    }

    #[test]
    fn satoshis_map_one_to_one_to_ledger_minor_units() {
        // 1 satoshi = 1 minor unit
        assert_eq!(sats_to_minor_units(1), 1);
        // 1 BTC = 100,000,000 satoshis = 100,000,000 minor units
        let one_btc_sats = 100_000_000_u64;
        assert_eq!(sats_to_minor_units(one_btc_sats), 100_000_000_i128);

        let money = sats_to_money(one_btc_sats);
        assert_eq!(money.asset, engipay_core::Asset::Btc);
        assert_eq!(money.minor, 100_000_000);
        assert_eq!(money.asset.decimals(), 8);

        // Maximum Bitcoin supply: 21,000,000 BTC
        let max_supply_sats = 21_000_000 * 100_000_000_u64;
        assert_eq!(sats_to_minor_units(max_supply_sats), max_supply_sats as i128);
    }

    #[test]
    fn detected_utxo_converts_to_minor_units_and_money() {
        let utxo = DetectedUtxo {
            txid: txid(0x01),
            vout: 3,
            value_sats: 123_456_789,
            address: "bc1quser".to_string(),
        };
        assert_eq!(utxo.to_minor_units(), 123_456_789_i128);
        let m = utxo.to_money();
        assert_eq!(m.asset, engipay_core::Asset::Btc);
        assert_eq!(m.minor, 123_456_789);
    }
}
