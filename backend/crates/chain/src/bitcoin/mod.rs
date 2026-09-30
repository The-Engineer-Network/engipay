//! Bitcoin chain integration.
//!
//! This module hosts the Bitcoin watcher and the persistence layer used to
//! track the last scanned block height so the watcher can resume after a
//! process restart.

pub mod cursor;
pub mod utxo;

pub use cursor::{BitcoinCursor, BitcoinCursorError, BITCOIN_CHAIN_ID};
pub use utxo::{
    ConfirmedTransaction, DetectedUtxo, ScriptPubKey, TxOutput, Txid, UtxoWatchError, UtxoWatcher,
};
