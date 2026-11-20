//! Settling the ledger once a Stellar withdrawal's fate is known.
//!
//! The withdrawal's hold (principal + fee) was taken when it was requested.
//! When the finality poller reports the outcome, this module closes it:
//!
//! * **Confirmed** — [`settle_hold`](engipay_ledger::postgres::PostgresLedgerStore::settle_hold):
//!   debit the user's `held` bucket, credit `ExternalOutflow` with the
//!   principal and `Fees` with the fee, then mark the withdrawal `completed`.
//! * **Failed on-chain or rejected** — release the hold back to the user's
//!   `available` bucket and mark the withdrawal `failed`.
//! * **Unknown** (timeout, Horizon unreachable) — touch nothing in the ledger
//!   and flag the withdrawal for manual review. The money stays held: it may
//!   still have left.
//!
//! # Crash safety
//!
//! Each step moves the withdrawal's status *before* touching the ledger, so the
//! status guard refuses, for example, to release the hold of a withdrawal that
//! has already been confirmed. Ledger operations are idempotent by hold
//! reference, and moving to the current status is a replay, so if the process
//! dies half way the same call can simply be run again.

use std::future::Future;

use engipay_core::Money;
use engipay_ledger::postgres::PostgresLedgerStore;
use engipay_ledger::{LedgerError, Receipt};
use tracing::{info, warn};
use uuid::Uuid;

use super::broadcast::{FinalityError, FinalityOutcome};
use crate::withdrawals::{StatusUpdate, WithdrawalError, WithdrawalStatus, WithdrawalStore};

/// The two ledger operations that close a withdrawal's hold.
pub trait HoldLedger: Send + Sync {
    fn settle_hold(
        &self,
        hold_reference: &str,
        fee: Option<Money>,
    ) -> impl Future<Output = Result<Receipt, LedgerError>> + Send;

    fn release_hold(
        &self,
        hold_reference: &str,
    ) -> impl Future<Output = Result<Receipt, LedgerError>> + Send;
}

impl HoldLedger for PostgresLedgerStore {
    async fn settle_hold(
        &self,
        hold_reference: &str,
        fee: Option<Money>,
    ) -> Result<Receipt, LedgerError> {
        PostgresLedgerStore::settle_hold(self, hold_reference, fee).await
    }

    async fn release_hold(&self, hold_reference: &str) -> Result<Receipt, LedgerError> {
        PostgresLedgerStore::release_hold(self, hold_reference).await
    }
}

/// How a withdrawal was closed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Settlement {
    /// The hold was settled and the withdrawal is `completed`.
    Completed { receipt: Receipt, ledger: u64 },
    /// The hold was released and the withdrawal is `failed`.
    Released { receipt: Receipt },
    /// The outcome is unknown; the hold stays and the withdrawal is
    /// `pending_manual_review`.
    ManualReview,
}

#[derive(Debug, thiserror::Error)]
pub enum SettlementError {
    /// The finality report is for a different transaction than the one this
    /// withdrawal broadcast. Nothing is settled on someone else's transaction.
    #[error("withdrawal {id} broadcast {recorded:?}, but the report is for {reported}")]
    HashMismatch {
        id: Uuid,
        recorded: Option<String>,
        reported: String,
    },
    #[error(transparent)]
    Ledger(#[from] LedgerError),
    #[error(transparent)]
    Store(#[from] WithdrawalError),
}

/// Applies a finality poll result to the withdrawal and its hold.
pub async fn apply_finality<W: WithdrawalStore, L: HoldLedger>(
    store: &W,
    ledger: &L,
    withdrawal_id: Uuid,
    outcome: Result<FinalityOutcome, FinalityError>,
) -> Result<Settlement, SettlementError> {
    match outcome {
        Ok(FinalityOutcome::Confirmed { hash, ledger: seq }) => {
            settle_confirmed(store, ledger, withdrawal_id, &hash, seq).await
        }
        Ok(FinalityOutcome::Failed { hash, ledger: seq }) => {
            require_recorded_hash(store, withdrawal_id, &hash).await?;
            warn!(%withdrawal_id, %hash, ledger = seq, "withdrawal failed on-chain; releasing hold");
            fail_withdrawal(store, ledger, withdrawal_id, None).await
        }
        Err(error) => {
            warn!(%withdrawal_id, %error, "withdrawal outcome unknown; flagging for manual review");
            store
                .transition(
                    withdrawal_id,
                    WithdrawalStatus::PendingManualReview,
                    StatusUpdate::default(),
                )
                .await?;
            Ok(Settlement::ManualReview)
        }
    }
}

/// Settles the hold of a withdrawal whose transaction `hash` landed in
/// `ledger_seq`, then marks it `completed`.
pub async fn settle_confirmed<W: WithdrawalStore, L: HoldLedger>(
    store: &W,
    ledger: &L,
    withdrawal_id: Uuid,
    hash: &str,
    ledger_seq: u64,
) -> Result<Settlement, SettlementError> {
    let withdrawal = require_recorded_hash(store, withdrawal_id, hash).await?;

    // Already completed: re-running only replays the settlement receipt.
    if withdrawal.status != WithdrawalStatus::Completed {
        store
            .transition(
                withdrawal_id,
                WithdrawalStatus::Confirmed,
                StatusUpdate {
                    tx_hash: None,
                    confirmed_ledger: Some(ledger_seq),
                },
            )
            .await?;
    }

    let fee = (withdrawal.fee.minor > 0).then_some(withdrawal.fee);
    let receipt = ledger.settle_hold(&withdrawal.hold_reference, fee).await?;

    store
        .transition(
            withdrawal_id,
            WithdrawalStatus::Completed,
            StatusUpdate::default(),
        )
        .await?;

    info!(
        %withdrawal_id,
        %hash,
        ledger = ledger_seq,
        principal = %withdrawal.amount,
        fee = %withdrawal.fee,
        replayed = receipt.replayed,
        "withdrawal settled"
    );
    Ok(Settlement::Completed {
        receipt,
        ledger: ledger_seq,
    })
}

/// Marks a withdrawal `failed` and returns its held money to the user.
///
/// Refused (by the status machine) for a withdrawal that is already
/// confirmed or completed, so money that left can never be handed back.
pub async fn fail_withdrawal<W: WithdrawalStore, L: HoldLedger>(
    store: &W,
    ledger: &L,
    withdrawal_id: Uuid,
    tx_hash: Option<String>,
) -> Result<Settlement, SettlementError> {
    let withdrawal = store.get(withdrawal_id).await?;
    store
        .transition(
            withdrawal_id,
            WithdrawalStatus::Failed,
            StatusUpdate {
                tx_hash,
                confirmed_ledger: None,
            },
        )
        .await?;
    let receipt = ledger.release_hold(&withdrawal.hold_reference).await?;
    Ok(Settlement::Released { receipt })
}

async fn require_recorded_hash<W: WithdrawalStore>(
    store: &W,
    withdrawal_id: Uuid,
    reported: &str,
) -> Result<crate::withdrawals::Withdrawal, SettlementError> {
    let withdrawal = store.get(withdrawal_id).await?;
    if withdrawal.tx_hash.as_deref() != Some(reported) {
        return Err(SettlementError::HashMismatch {
            id: withdrawal_id,
            recorded: withdrawal.tx_hash,
            reported: reported.to_owned(),
        });
    }
    Ok(withdrawal)
}

#[cfg(test)]
pub(crate) mod fake {
    //! The in-memory [`Ledger`](engipay_ledger::Ledger) as a [`HoldLedger`].

    use std::sync::Mutex;

    use engipay_core::{Asset, UserId};
    use engipay_ledger::{Balance, HoldState, Ledger, SystemAccount};

    use super::*;

    #[derive(Debug, Default)]
    pub struct MemoryLedger(pub Mutex<Ledger>);

    impl MemoryLedger {
        /// Holds principal + fee under `reference`, as the withdrawal request
        /// does. The in-memory hold also needs a positive network-fee buffer
        /// available, so one extra unit is deposited and stays available.
        pub fn with_hold(user: UserId, principal: Money, fee: Money, reference: &str) -> Self {
            let asset = principal.asset;
            let locked = Money::from_minor(
                asset,
                principal
                    .minor
                    .checked_add(fee.minor)
                    .expect("small test amounts"),
            );
            let mut ledger = Ledger::new();
            ledger
                .deposit(
                    user,
                    Money::from_minor(asset, locked.minor.checked_add(1).expect("small")),
                    "funding",
                )
                .expect("deposit");
            ledger
                .hold(user, locked, Money::from_minor(asset, 1), reference)
                .expect("hold");
            Self(Mutex::new(ledger))
        }

        pub fn balance(&self, user: UserId, asset: Asset) -> Balance {
            self.0.lock().expect("ledger lock").balance(user, asset)
        }

        pub fn system(&self, account: SystemAccount, asset: Asset) -> i128 {
            self.0
                .lock()
                .expect("ledger lock")
                .system_balance(account, asset)
        }

        pub fn hold_state(&self, reference: &str) -> Option<HoldState> {
            self.0.lock().expect("ledger lock").hold_state(reference)
        }
    }

    impl HoldLedger for MemoryLedger {
        async fn settle_hold(
            &self,
            hold_reference: &str,
            fee: Option<Money>,
        ) -> Result<Receipt, LedgerError> {
            self.0
                .lock()
                .expect("ledger lock")
                .settle(hold_reference, fee)
        }

        async fn release_hold(&self, hold_reference: &str) -> Result<Receipt, LedgerError> {
            self.0.lock().expect("ledger lock").release(hold_reference)
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use std::time::Duration;

    use engipay_core::Asset;
    use engipay_ledger::{HoldState, SystemAccount};

    use super::fake::MemoryLedger;
    use super::*;
    use crate::withdrawals::fake::{FakeWithdrawalStore, pending};
    use crate::withdrawals::{Withdrawal, WithdrawalStatus::*};

    const HASH: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

    /// A withdrawal of 9 USDC with a 0.5 USDC fee, already broadcast.
    fn broadcast() -> (Withdrawal, FakeWithdrawalStore, MemoryLedger) {
        let mut withdrawal = pending(Asset::Usdc, 9_000_000, 500_000);
        withdrawal.status = BroadcastAccepted;
        withdrawal.tx_hash = Some(HASH.to_owned());
        let ledger = MemoryLedger::with_hold(
            withdrawal.user,
            withdrawal.amount,
            withdrawal.fee,
            &withdrawal.hold_reference,
        );
        (
            withdrawal.clone(),
            FakeWithdrawalStore::with(withdrawal),
            ledger,
        )
    }

    fn confirmed(ledger: u64) -> Result<FinalityOutcome, FinalityError> {
        Ok(FinalityOutcome::Confirmed {
            hash: HASH.to_owned(),
            ledger,
        })
    }

    #[tokio::test]
    async fn a_confirmed_withdrawal_settles_principal_and_fee() {
        let (withdrawal, store, ledger) = broadcast();
        assert_eq!(ledger.balance(withdrawal.user, Asset::Usdc).held, 9_500_000);

        let settlement = apply_finality(&store, &ledger, withdrawal.id, confirmed(4_242))
            .await
            .unwrap();
        assert!(matches!(
            settlement,
            Settlement::Completed { ledger: 4_242, .. }
        ));

        let balance = ledger.balance(withdrawal.user, Asset::Usdc);
        assert_eq!(balance.held, 0, "the held bucket is debited");
        assert_eq!(
            balance.available, 1,
            "only the unheld unit stays with the user"
        );
        assert_eq!(
            ledger.system(SystemAccount::ExternalOutflow, Asset::Usdc),
            9_000_000,
            "the principal leaves EngiPay"
        );
        assert_eq!(
            ledger.system(SystemAccount::Fees, Asset::Usdc),
            500_000,
            "the fee is revenue"
        );
        assert_eq!(
            ledger.hold_state(&withdrawal.hold_reference),
            Some(HoldState::Settled)
        );

        let after = store.snapshot(withdrawal.id);
        assert_eq!(after.status, Completed);
        assert_eq!(after.confirmed_ledger, Some(4_242));
    }

    #[tokio::test]
    async fn a_fee_free_withdrawal_sends_the_whole_hold_out() {
        let mut withdrawal = pending(Asset::Xlm, 30_000_000, 0);
        withdrawal.status = BroadcastAccepted;
        withdrawal.tx_hash = Some(HASH.to_owned());
        let ledger = MemoryLedger::with_hold(
            withdrawal.user,
            withdrawal.amount,
            withdrawal.fee,
            &withdrawal.hold_reference,
        );
        let store = FakeWithdrawalStore::with(withdrawal.clone());

        apply_finality(&store, &ledger, withdrawal.id, confirmed(1))
            .await
            .unwrap();

        assert_eq!(
            ledger.system(SystemAccount::ExternalOutflow, Asset::Xlm),
            30_000_000
        );
        assert_eq!(ledger.system(SystemAccount::Fees, Asset::Xlm), 0);
        assert_eq!(store.snapshot(withdrawal.id).status, Completed);
    }

    #[tokio::test]
    async fn settling_twice_moves_money_once() {
        let (withdrawal, store, ledger) = broadcast();

        let first = apply_finality(&store, &ledger, withdrawal.id, confirmed(10))
            .await
            .unwrap();
        let second = apply_finality(&store, &ledger, withdrawal.id, confirmed(10))
            .await
            .unwrap();

        let (Settlement::Completed { receipt: a, .. }, Settlement::Completed { receipt: b, .. }) =
            (first, second)
        else {
            panic!("both runs complete");
        };
        assert_eq!(a.transaction_id, b.transaction_id);
        assert!(b.replayed);
        assert_eq!(
            ledger.system(SystemAccount::ExternalOutflow, Asset::Usdc),
            9_000_000
        );
    }

    #[tokio::test]
    async fn a_crash_after_settling_is_finished_by_running_again() {
        let (withdrawal, store, ledger) = broadcast();
        // The process settled the hold but died before marking it completed.
        store
            .transition(
                withdrawal.id,
                Confirmed,
                StatusUpdate {
                    tx_hash: None,
                    confirmed_ledger: Some(10),
                },
            )
            .await
            .unwrap();
        ledger
            .settle_hold(&withdrawal.hold_reference, Some(withdrawal.fee))
            .await
            .unwrap();

        let settlement = apply_finality(&store, &ledger, withdrawal.id, confirmed(10))
            .await
            .unwrap();
        assert!(matches!(settlement, Settlement::Completed { receipt, .. } if receipt.replayed));
        assert_eq!(store.snapshot(withdrawal.id).status, Completed);
        assert_eq!(ledger.system(SystemAccount::Fees, Asset::Usdc), 500_000);
    }

    #[tokio::test]
    async fn a_report_for_another_transaction_settles_nothing() {
        let (withdrawal, store, ledger) = broadcast();
        let other = Ok(FinalityOutcome::Confirmed {
            hash: "ff".repeat(32),
            ledger: 10,
        });

        let err = apply_finality(&store, &ledger, withdrawal.id, other)
            .await
            .unwrap_err();
        assert!(matches!(err, SettlementError::HashMismatch { .. }));
        assert_eq!(ledger.balance(withdrawal.user, Asset::Usdc).held, 9_500_000);
        assert_eq!(store.snapshot(withdrawal.id).status, BroadcastAccepted);
    }

    #[tokio::test]
    async fn a_failed_transaction_releases_the_hold() {
        let (withdrawal, store, ledger) = broadcast();
        let failed = Ok(FinalityOutcome::Failed {
            hash: HASH.to_owned(),
            ledger: 10,
        });

        let settlement = apply_finality(&store, &ledger, withdrawal.id, failed)
            .await
            .unwrap();
        assert!(matches!(settlement, Settlement::Released { .. }));

        let balance = ledger.balance(withdrawal.user, Asset::Usdc);
        assert_eq!(balance.held, 0);
        assert_eq!(balance.available, 9_500_001);
        assert_eq!(
            ledger.system(SystemAccount::ExternalOutflow, Asset::Usdc),
            0
        );
        assert_eq!(store.snapshot(withdrawal.id).status, Failed);
    }

    #[tokio::test]
    async fn an_unknown_outcome_keeps_the_money_held() {
        let (withdrawal, store, ledger) = broadcast();
        let timeout = Err(FinalityError::Timeout {
            hash: HASH.to_owned(),
            timeout: Duration::from_secs(120),
        });

        let settlement = apply_finality(&store, &ledger, withdrawal.id, timeout)
            .await
            .unwrap();
        assert_eq!(settlement, Settlement::ManualReview);
        assert_eq!(ledger.balance(withdrawal.user, Asset::Usdc).held, 9_500_000);
        assert_eq!(store.snapshot(withdrawal.id).status, PendingManualReview);

        // A later poll that sees it confirmed still settles it.
        apply_finality(&store, &ledger, withdrawal.id, confirmed(12))
            .await
            .unwrap();
        assert_eq!(store.snapshot(withdrawal.id).status, Completed);
        assert_eq!(ledger.balance(withdrawal.user, Asset::Usdc).held, 0);
    }

    #[tokio::test]
    async fn a_completed_withdrawal_can_never_be_released() {
        let (withdrawal, store, ledger) = broadcast();
        apply_finality(&store, &ledger, withdrawal.id, confirmed(10))
            .await
            .unwrap();

        let err = fail_withdrawal(&store, &ledger, withdrawal.id, None)
            .await
            .unwrap_err();
        assert!(matches!(
            err,
            SettlementError::Store(WithdrawalError::InvalidTransition {
                from: Completed,
                ..
            })
        ));
        assert_eq!(ledger.balance(withdrawal.user, Asset::Usdc).available, 1);
        assert_eq!(store.snapshot(withdrawal.id).status, Completed);
    }
}
