//! Bitcoin chain integration.
//!
//! This module hosts the Bitcoin watcher and the persistence layer used to
//! track the last scanned block height so the watcher can resume after a
//! process restart.

pub mod confirmations;
pub mod cursor;
pub mod utxo;

pub use confirmations::{is_bitcoin_confirmed, MIN_BITCOIN_CONFIRMATIONS};
pub use cursor::{BitcoinCursor, BitcoinCursorError, BITCOIN_CHAIN_ID};
pub use utxo::{
    ConfirmedTransaction, DetectedUtxo, ScriptPubKey, TxOutput, Txid, UtxoWatchError, UtxoWatcher,
    sats_to_minor_units, sats_to_money,
};
