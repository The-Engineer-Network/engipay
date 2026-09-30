//! Bitcoin withdrawal hold settlement upon confirmation finality.
//!
//! When an outgoing Bitcoin withdrawal transaction is confirmed on-chain with at least
//! [`REQUIRED_CONFIRMATIONS`] (2 confirmations), the temporary ledger hold must be settled.
//!
//! Settlement performs a double-entry ledger transition:
//! - Debits the user's `Held` balance for `Asset::Btc` by the withdrawal satoshis.
//! - Credits `SystemAccount::ExternalOutflow` by the same satoshi amount.
//! - Updates withdrawal status to `Completed`.
//!
//! Strict type safety is preserved: money amounts use exact satoshi integers and
//! ledger minor units; no floating point arithmetic is used.

use super::confirmations::{is_bitcoin_confirmed, REQUIRED_CONFIRMATIONS};
use engipay_core::{Asset, Money, MoneyError, UserId};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Status lifecycle for an on-chain Bitcoin withdrawal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WithdrawalStatus {
    /// Withdrawal requested and hold placed on user's available funds.
    PendingBroadcast,
    /// Transaction broadcast to Bitcoin mempool; awaiting block confirmations.
    Broadcasted,
    /// Transaction reached at least [`REQUIRED_CONFIRMATIONS`]; ledger hold settled.
    Completed,
    /// Withdrawal failed or broadcast rejected; hold released back to user's available funds.
    Failed,
}

/// Represents an in-flight or completed Bitcoin withdrawal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BitcoinWithdrawal {
    /// Unique withdrawal identifier.
    pub id: Uuid,
    /// User requesting the withdrawal.
    pub user_id: UserId,
    /// Destination Bitcoin address.
    pub destination_address: String,
    /// Withdrawal amount in integer satoshis.
    pub amount_sats: u64,
    /// Mining fee in integer satoshis.
    pub fee_sats: u64,
    /// Ledger hold idempotency reference.
    pub hold_reference: String,
    /// Bitcoin transaction hash (`txid`), once broadcast.
    pub txid: Option<String>,
    /// Inclusion block height on the Bitcoin blockchain.
    pub block_height: Option<u64>,
    /// Current lifecycle status.
    pub status: WithdrawalStatus,
}

/// Errors occurring during Bitcoin withdrawal settlement.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BitcoinSettlementError {
    #[error("insufficient confirmations: transaction has {current} confirmations, but {required} are required")]
    InsufficientConfirmations { current: u64, required: u64 },

    #[error("withdrawal {id} has invalid status {status:?} for settlement (expected Broadcasted)")]
    InvalidWithdrawalStatus { id: Uuid, status: WithdrawalStatus },

    #[error("withdrawal {id} missing transaction hash (txid)")]
    MissingTxid { id: Uuid },

    #[error("withdrawal {id} missing inclusion block height")]
    MissingBlockHeight { id: Uuid },

    #[error("withdrawal amount must be greater than zero")]
    ZeroAmount,

    #[error("arithmetic overflow calculating total withdrawal satoshis")]
    Overflow,

    #[error("core money conversion error: {0}")]
    Money(#[from] MoneyError),
}

/// Double-entry settlement transaction plan to be committed to the ledger.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SettlementPostings {
    /// The unique reference string for idempotency in the ledger.
    pub settlement_reference: String,
    /// User whose held balance is debited.
    pub user_id: UserId,
    /// Asset type (always `Asset::Btc`).
    pub asset: Asset,
    /// Satoshis debited from user's `Held` bucket (positive magnitude, applied as debit).
    pub satoshis: u64,
    /// The resulting `Money` value for `Asset::Btc`.
    pub money: Money,
}

impl BitcoinWithdrawal {
    /// Verifies whether the withdrawal has reached the required confirmation threshold.
    pub fn is_settleable(&self, current_tip_height: u64) -> Result<bool, BitcoinSettlementError> {
        let block_height = self.block_height.ok_or(BitcoinSettlementError::MissingBlockHeight {
            id: self.id,
        })?;

        if !is_bitcoin_confirmed(block_height, current_tip_height) {
            let current = if current_tip_height >= block_height {
                current_tip_height - block_height + 1
            } else {
                0
            };
            return Err(BitcoinSettlementError::InsufficientConfirmations {
                current,
                required: REQUIRED_CONFIRMATIONS,
            });
        }

        Ok(true)
    }

    /// Evaluates confirmation depth and prepares the ledger hold settlement postings.
    ///
    /// Transitions status from `Broadcasted` to `Completed`.
    /// Debits `held` satoshis, credits `SystemAccount::ExternalOutflow`.
    pub fn settle(
        &mut self,
        current_tip_height: u64,
    ) -> Result<SettlementPostings, BitcoinSettlementError> {
        if self.amount_sats == 0 {
            return Err(BitcoinSettlementError::ZeroAmount);
        }

        if self.status != WithdrawalStatus::Broadcasted {
            return Err(BitcoinSettlementError::InvalidWithdrawalStatus {
                id: self.id,
                status: self.status,
            });
        }

        if self.txid.is_none() {
            return Err(BitcoinSettlementError::MissingTxid { id: self.id });
        }

        self.is_settleable(current_tip_height)?;

        let total_sats = self
            .amount_sats
            .checked_add(self.fee_sats)
            .ok_or(BitcoinSettlementError::Overflow)?;

        let minor = i128::from(total_sats);
        let money = Money::from_minor(Asset::Btc, minor);

        // Update withdrawal state to completed
        self.status = WithdrawalStatus::Completed;

        let settlement_reference = format!("settle:{}:{}", self.hold_reference, self.id);

        Ok(SettlementPostings {
            settlement_reference,
            user_id: self.user_id,
            asset: Asset::Btc,
            satoshis: total_sats,
            money,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_withdrawal() -> BitcoinWithdrawal {
        BitcoinWithdrawal {
            id: Uuid::new_v4(),
            user_id: UserId::new(),
            destination_address: "bc1qdestination".to_string(),
            amount_sats: 100_000,
            fee_sats: 2_500,
            hold_reference: "hold-btc-withdrawal-001".to_string(),
            txid: Some("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string()),
            block_height: Some(800_000),
            status: WithdrawalStatus::Broadcasted,
        }
    }

    #[test]
    fn rejects_settlement_with_insufficient_confirmations() {
        let mut withdrawal = sample_withdrawal();
        // At block 800,000, current tip 800,000 is only 1 confirmation (< 2)
        let err = withdrawal.settle(800_000).expect_err("insufficient confirmations");
        assert_eq!(
            err,
            BitcoinSettlementError::InsufficientConfirmations {
                current: 1,
                required: 2,
            }
        );
        assert_eq!(withdrawal.status, WithdrawalStatus::Broadcasted);
    }

    #[test]
    fn settles_successfully_at_two_confirmations() {
        let mut withdrawal = sample_withdrawal();
        // Block 800,000 with tip 800,001 has exactly 2 confirmations
        let postings = withdrawal.settle(800_001).expect("settlement succeeds");

        assert_eq!(withdrawal.status, WithdrawalStatus::Completed);
        assert_eq!(postings.satoshis, 102_500);
        assert_eq!(postings.asset, Asset::Btc);
        assert_eq!(postings.money.minor, 102_500);
        assert_eq!(postings.money.asset, Asset::Btc);
        assert!(postings.settlement_reference.starts_with("settle:hold-btc-withdrawal-001:"));
    }

    #[test]
    fn settles_successfully_with_more_than_two_confirmations() {
        let mut withdrawal = sample_withdrawal();
        // Tip 800,010 -> 11 confirmations
        let postings = withdrawal.settle(800_010).expect("settlement succeeds");
        assert_eq!(withdrawal.status, WithdrawalStatus::Completed);
        assert_eq!(postings.satoshis, 102_500);
    }

    #[test]
    fn rejects_settlement_if_already_completed() {
        let mut withdrawal = sample_withdrawal();
        withdrawal.status = WithdrawalStatus::Completed;
        let err = withdrawal.settle(800_005).expect_err("must reject already completed");
        assert!(matches!(
            err,
            BitcoinSettlementError::InvalidWithdrawalStatus {
                status: WithdrawalStatus::Completed,
                ..
            }
        ));
    }

    #[test]
    fn rejects_settlement_if_txid_missing() {
        let mut withdrawal = sample_withdrawal();
        withdrawal.txid = None;
        let err = withdrawal.settle(800_005).expect_err("must reject missing txid");
        assert!(matches!(err, BitcoinSettlementError::MissingTxid { .. }));
    }

    #[test]
    fn rejects_zero_amount() {
        let mut withdrawal = sample_withdrawal();
        withdrawal.amount_sats = 0;
        let err = withdrawal.settle(800_005).expect_err("must reject zero amount");
        assert_eq!(err, BitcoinSettlementError::ZeroAmount);
    }
}
