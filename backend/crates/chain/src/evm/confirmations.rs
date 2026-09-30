//! Reorg protection: Base deposits wait for 12 confirmations.

pub const REQUIRED: u64 = 12;

/// Confirmations of a deposit included in `deposit_block`, counting that
/// block itself. Zero if the node reports a head behind the deposit (e.g. a
/// lagging or reorged RPC), never an underflow.
pub fn confirmations(deposit_block: u64, current_block: u64) -> u64 {
    current_block
        .checked_sub(deposit_block)
        .map_or(0, |behind| behind.saturating_add(1))
}

pub fn is_confirmed(deposit_block: u64, current_block: u64) -> bool {
    confirmations(deposit_block, current_block) >= REQUIRED
}

/// For [`crate::ObservedDeposit::confirmations`].
pub(crate) fn confirmations_u32(deposit_block: u64, current_block: u64) -> u32 {
    u32::try_from(confirmations(deposit_block, current_block)).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_creditable_at_11_blocks() {
        assert_eq!(confirmations(100, 110), 11);
        assert!(!is_confirmed(100, 110));
    }

    #[test]
    fn creditable_at_12_blocks() {
        assert_eq!(confirmations(100, 111), 12);
        assert!(is_confirmed(100, 111));
        assert!(is_confirmed(100, 500));
    }

    #[test]
    fn inclusion_block_counts_as_one() {
        assert_eq!(confirmations(100, 100), 1);
    }

    #[test]
    fn head_behind_deposit_is_unconfirmed() {
        assert_eq!(confirmations(100, 99), 0);
        assert!(!is_confirmed(100, 0));
    }

    #[test]
    fn extremes_do_not_overflow() {
        assert_eq!(confirmations(0, u64::MAX), u64::MAX);
        assert_eq!(confirmations_u32(0, u64::MAX), u32::MAX);
    }
}
