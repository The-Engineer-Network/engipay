//! Bitcoin chain integration.
//!
//! This module hosts the Bitcoin watcher and the persistence layer used to
//! track the last scanned block height so the watcher can resume after a
//! process restart.

pub mod confirmations;
pub mod cursor;
pub mod rbf;
pub mod utxo;

pub use confirmations::{is_bitcoin_confirmed, MIN_BITCOIN_CONFIRMATIONS};
pub use cursor::{BitcoinCursor, BitcoinCursorError, BITCOIN_CHAIN_ID};
pub use utxo::{
    ConfirmedTransaction, DetectedUtxo, ScriptPubKey, TxOutput, Txid, UtxoWatchError, UtxoWatcher,
};

pub use rbf::{
    is_bip125_rbf_opt_in, is_transaction_stalled, RbfError, RbfReplacementPlan,
    BIP125_RBF_SEQUENCE, RBF_STALLED_THRESHOLD_SECONDS,
};
