//! Bitcoin Replace-By-Fee (RBF) handling for stalled mempool transactions (BIP-125).
//!
//! Outgoing Bitcoin transactions can become stalled in the mempool during network
//! fee spikes. To prevent funds from being permanently stuck:
//! 1. All outgoing transaction inputs must explicitly opt into BIP-125 RBF by setting
//!    their sequence number to [`BIP125_RBF_SEQUENCE`] (`< 0xfffffffe`).
//! 2. Transactions unconfirmed in the mempool for longer than [`RBF_STALLED_THRESHOLD_SECONDS`]
//!    (60 minutes) are flagged as stalled.
//! 3. A replacement transaction must satisfy BIP-125 fee rules: paying a higher fee rate
//!    (sat/vB) and paying an absolute fee sufficient to cover bandwidth and previous transactions.

use super::fee::{calculate_bitcoin_fee, BitcoinFeeError};
use serde::{Deserialize, Serialize};

/// Maximum sequence number that signals BIP-125 opt-in RBF.
/// Any sequence strictly less than `0xffff_fffe` signals RBF opt-in.
pub const BIP125_MAX_RBF_SEQUENCE: u32 = 0xffff_fffd;

/// Standard sequence number used by EngiPay to signal opt-in RBF.
pub const BIP125_RBF_SEQUENCE: u32 = 0xffff_fffd;

/// Sequence number indicating finality / non-RBF.
pub const BIP125_FINAL_SEQUENCE: u32 = 0xffff_ffff;

/// Duration after which an unconfirmed mempool transaction is eligible for RBF fee bump (60 minutes).
pub const RBF_STALLED_THRESHOLD_SECONDS: u64 = 60 * 60;

/// Default minimum fee bump percentage (e.g. 25% increase).
pub const MIN_FEE_BUMP_PERCENT: u64 = 25;

/// Errors occurring during RBF evaluation or replacement transaction preparation.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RbfError {
    #[error("transaction does not signal BIP-125 opt-in RBF (sequence 0x{sequence:08x})")]
    NotRbfOptIn { sequence: u32 },

    #[error("transaction is not stalled: elapsed {elapsed_secs}s < threshold {threshold_secs}s")]
    NotStalled {
        elapsed_secs: u64,
        threshold_secs: u64,
    },

    #[error("new fee rate ({new_sat_per_vb} sat/vB) must exceed original ({orig_sat_per_vb} sat/vB)")]
    InsufficientFeeRate {
        new_sat_per_vb: u64,
        orig_sat_per_vb: u64,
    },

    #[error("replacement absolute fee ({new_fee_sats} sats) must exceed original ({orig_fee_sats} sats) plus bandwidth increment ({min_incremental} sats)")]
    InsufficientAbsoluteFee {
        new_fee_sats: u64,
        orig_fee_sats: u64,
        min_incremental: u64,
    },

    #[error("arithmetic overflow during fee calculation")]
    Overflow,

    #[error("fee calculation error: {0}")]
    Fee(#[from] BitcoinFeeError),
}

/// Checks whether an input's `nSequence` number signals BIP-125 opt-in RBF.
///
/// Under BIP-125 rule 1, any transaction with at least one input having
/// `nSequence < 0xfffffffe` is treated as replaceable.
pub const fn is_bip125_rbf_opt_in(sequence: u32) -> bool {
    sequence < 0xffff_fffe
}

/// Checks whether a broadcast transaction has stalled in the mempool beyond 60 minutes.
pub fn is_transaction_stalled(broadcast_time_secs: u64, current_time_secs: u64) -> bool {
    if current_time_secs <= broadcast_time_secs {
        return false;
    }
    current_time_secs - broadcast_time_secs >= RBF_STALLED_THRESHOLD_SECONDS
}

/// Plan and calculation for an RBF replacement transaction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RbfReplacementPlan {
    pub original_txid: String,
    pub original_fee_sats: u64,
    pub original_fee_rate_sat_per_vb: u64,
    pub new_fee_sats: u64,
    pub new_fee_rate_sat_per_vb: u64,
    pub replacement_sequence: u32,
}

impl RbfReplacementPlan {
    /// Constructs and validates a BIP-125 replacement fee plan.
    ///
    /// Verifies:
    /// 1. Original input sequence opts into RBF.
    /// 2. Transaction has been in mempool >= 60 minutes.
    /// 3. New fee rate strictly exceeds original fee rate.
    /// 4. Total replacement fee satisfies BIP-125 rule 3 (pays for its own bandwidth + previous fee).
    pub fn build(
        original_txid: impl Into<String>,
        input_sequence: u32,
        broadcast_time_secs: u64,
        current_time_secs: u64,
        original_vbytes: u64,
        original_fee_rate_sat_per_vb: u64,
        target_new_fee_rate_sat_per_vb: u64,
    ) -> Result<Self, RbfError> {
        // 1. Verify RBF opt-in
        if !is_bip125_rbf_opt_in(input_sequence) {
            return Err(RbfError::NotRbfOptIn {
                sequence: input_sequence,
            });
        }

        // 2. Verify stalled threshold (60 minutes)
        if !is_transaction_stalled(broadcast_time_secs, current_time_secs) {
            let elapsed_secs = current_time_secs.saturating_sub(broadcast_time_secs);
            return Err(RbfError::NotStalled {
                elapsed_secs,
                threshold_secs: RBF_STALLED_THRESHOLD_SECONDS,
            });
        }

        // 3. Verify new fee rate > original fee rate
        if target_new_fee_rate_sat_per_vb <= original_fee_rate_sat_per_vb {
            return Err(RbfError::InsufficientFeeRate {
                new_sat_per_vb: target_new_fee_rate_sat_per_vb,
                orig_sat_per_vb: original_fee_rate_sat_per_vb,
            });
        }

        let original_fee_sats =
            calculate_bitcoin_fee(original_vbytes, original_fee_rate_sat_per_vb)?;
        let new_fee_sats =
            calculate_bitcoin_fee(original_vbytes, target_new_fee_rate_sat_per_vb)?;

        // Minimum incremental fee required by BIP-125 rule 3 (at least 1 sat/vB of replacement size)
        let min_incremental = original_vbytes;
        let min_required_fee = original_fee_sats
            .checked_add(min_incremental)
            .ok_or(RbfError::Overflow)?;

        if new_fee_sats < min_required_fee {
            return Err(RbfError::InsufficientAbsoluteFee {
                new_fee_sats,
                orig_fee_sats: original_fee_sats,
                min_incremental,
            });
        }

        Ok(Self {
            original_txid: original_txid.into(),
            original_fee_sats,
            original_fee_rate_sat_per_vb,
            new_fee_sats,
            new_fee_rate_sat_per_vb: target_new_fee_rate_sat_per_vb,
            replacement_sequence: BIP125_RBF_SEQUENCE,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_bip125_opt_in_sequences() {
        // Sequences strictly less than 0xfffffffe opt in to BIP-125
        assert!(is_bip125_rbf_opt_in(0));
        assert!(is_bip125_rbf_opt_in(100));
        assert!(is_bip125_rbf_opt_in(0xffff_fffd)); // BIP125_RBF_SEQUENCE

        // 0xfffffffe and 0xffffffff do NOT opt in to BIP-125
        assert!(!is_bip125_rbf_opt_in(0xffff_fffe));
        assert!(!is_bip125_rbf_opt_in(0xffff_ffff)); // BIP125_FINAL_SEQUENCE
    }

    #[test]
    fn identifies_stalled_transactions() {
        let broadcast_time = 1_000_000;

        // 59 minutes elapsed (3,540s) -> not stalled
        assert!(!is_transaction_stalled(broadcast_time, broadcast_time + 3540));

        // Exactly 60 minutes elapsed (3,600s) -> stalled
        assert!(is_transaction_stalled(broadcast_time, broadcast_time + 3600));

        // 2 hours elapsed -> stalled
        assert!(is_transaction_stalled(broadcast_time, broadcast_time + 7200));

        // Clock skew / past timestamp -> not stalled
        assert!(!is_transaction_stalled(broadcast_time, broadcast_time - 100));
    }

    #[test]
    fn constructs_valid_rbf_replacement_plan() {
        let broadcast_time = 1_000_000;
        let current_time = broadcast_time + 3600; // 60 minutes
        let vbytes = 140;
        let orig_rate = 10;
        let new_rate = 15;

        let plan = RbfReplacementPlan::build(
            "orig_txid_001",
            BIP125_RBF_SEQUENCE,
            broadcast_time,
            current_time,
            vbytes,
            orig_rate,
            new_rate,
        )
        .expect("valid RBF plan");

        assert_eq!(plan.original_txid, "orig_txid_001");
        assert_eq!(plan.original_fee_sats, 1400); // 140 * 10
        assert_eq!(plan.new_fee_sats, 2100); // 140 * 15
        assert_eq!(plan.replacement_sequence, BIP125_RBF_SEQUENCE);
    }

    #[test]
    fn rejects_rbf_when_not_opted_in() {
        let err = RbfReplacementPlan::build(
            "orig_txid_002",
            BIP125_FINAL_SEQUENCE,
            1_000_000,
            1_004_000,
            140,
            10,
            15,
        )
        .expect_err("should reject non-RBF");

        assert_eq!(
            err,
            RbfError::NotRbfOptIn {
                sequence: BIP125_FINAL_SEQUENCE
            }
        );
    }

    #[test]
    fn rejects_rbf_when_not_stalled_yet() {
        let broadcast_time = 1_000_000;
        let current_time = broadcast_time + 1800; // only 30 minutes

        let err = RbfReplacementPlan::build(
            "orig_txid_003",
            BIP125_RBF_SEQUENCE,
            broadcast_time,
            current_time,
            140,
            10,
            15,
        )
        .expect_err("should reject not stalled");

        assert_eq!(
            err,
            RbfError::NotStalled {
                elapsed_secs: 1800,
                threshold_secs: 3600
            }
        );
    }

    #[test]
    fn rejects_insufficient_fee_rate_bump() {
        let broadcast_time = 1_000_000;
        let current_time = broadcast_time + 3600;

        let err = RbfReplacementPlan::build(
            "orig_txid_004",
            BIP125_RBF_SEQUENCE,
            broadcast_time,
            current_time,
            140,
            20,
            20, // same fee rate
        )
        .expect_err("should reject same fee rate");

        assert_eq!(
            err,
            RbfError::InsufficientFeeRate {
                new_sat_per_vb: 20,
                orig_sat_per_vb: 20
            }
        );
    }
}
