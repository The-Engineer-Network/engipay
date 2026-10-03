//! Bitcoin confirmation gating.
//!
//! Bitcoin has a ~10 minute block interval and non-trivial orphan/reorg
//! probability, so a deposit is only credited once it has at least
//! [`REQUIRED_CONFIRMATIONS`] confirmations. A transaction included in the
//! current tip has exactly one confirmation; each subsequent block adds one
//! more.

/// Number of confirmations required before a Bitcoin deposit is credited.
pub const REQUIRED_CONFIRMATIONS: u64 = 2;

/// Alias for [`REQUIRED_CONFIRMATIONS`], used in public API exports.
pub const MIN_BITCOIN_CONFIRMATIONS: u64 = REQUIRED_CONFIRMATIONS;

/// Whether a Bitcoin transaction is confirmed enough to be credited.
///
/// `tx_height` is the block height the transaction was included in and
/// `current_height` is the current chain tip. Confirmations are counted
/// inclusively: a transaction in the tip block has one confirmation.
///
/// Returns `false` when `tx_height` is ahead of `current_height` (e.g. a
/// transaction seen in the mempool or a stale tip), since it cannot yet have
/// any confirmations.
pub fn is_bitcoin_confirmed(tx_height: u64, current_height: u64) -> bool {
    if tx_height > current_height {
        return false;
    }
    current_height - tx_height + 1 >= REQUIRED_CONFIRMATIONS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_confirmation_is_pending() {
        // Transaction sits in the current tip: exactly one confirmation.
        assert!(!is_bitcoin_confirmed(100, 100));
    }

    #[test]
    fn two_confirmations_are_creditable() {
        // One block mined on top of the inclusion block: two confirmations.
        assert!(is_bitcoin_confirmed(100, 101));
    }

    #[test]
    fn more_confirmations_are_creditable() {
        assert!(is_bitcoin_confirmed(100, 110));
    }

    #[test]
    fn unconfirmed_transaction_is_pending() {
        // tx_height ahead of the tip cannot have any confirmations yet.
        assert!(!is_bitcoin_confirmed(101, 100));
    }
}
