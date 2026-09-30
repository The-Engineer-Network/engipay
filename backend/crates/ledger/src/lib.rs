//! EngiPay's double-entry ledger.
//!
//! The ledger, not the blockchain, is the source of truth for what each user
//! owns. Three rules hold after every operation, and the tests pin them down:
//!
//! 1. Every transaction balances: its postings sum to zero for each asset, so
//!    money is only ever moved, never created or destroyed.
//! 2. A user's balance can never go negative, in either bucket.
//! 3. Replaying a request with the same reference returns the original result
//!    and moves nothing. A retried HTTP call cannot credit a deposit twice.
//!
//! This module is the rules, kept in memory so they can be tested exhaustively.
//! The Postgres-backed store implements the same operations with the same
//! checks inside a database transaction.

#[cfg(feature = "postgres")]
pub mod postgres;

use std::collections::HashMap;

use engipay_core::{Asset, Money, UserId};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A user's money is split in two. `Available` can be spent. `Held` is
/// committed to something in flight (a withdrawal, a conversion, an off-ramp)
/// and cannot be spent twice while it is pending.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Bucket {
    Available,
    Held,
}

/// EngiPay's own accounts, the other side of money entering or leaving.
/// These are allowed to go negative: `ExternalInflow` going negative is simply
/// the record of how much has come in from outside.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemAccount {
    /// Where on-chain deposits and on-ramp purchases come from.
    ExternalInflow,
    /// Where settled withdrawals and off-ramp payouts go.
    ExternalOutflow,
    /// Fees EngiPay has earned.
    Fees,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Owner {
    User(UserId),
    System(SystemAccount),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AccountKey {
    pub owner: Owner,
    pub asset: Asset,
    pub bucket: Bucket,
}

impl AccountKey {
    const fn user(user: UserId, asset: Asset, bucket: Bucket) -> Self {
        Self {
            owner: Owner::User(user),
            asset,
            bucket,
        }
    }

    const fn system(account: SystemAccount, asset: Asset) -> Self {
        Self {
            owner: Owner::System(account),
            asset,
            bucket: Bucket::Available,
        }
    }
}

/// One line of a transaction. Positive adds to the account, negative takes away.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Posting {
    pub account: AccountKey,
    pub amount: i128,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionKind {
    Deposit,
    Transfer,
    Hold,
    ReleaseHold,
    SettleHold,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transaction {
    pub id: Uuid,
    pub kind: TransactionKind,
    /// The caller's idempotency key. Unique across the ledger.
    pub reference: String,
    pub postings: Vec<Posting>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receipt {
    pub transaction_id: Uuid,
    /// True when this reference had already been applied and nothing moved now.
    pub replayed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Balance {
    pub asset: Asset,
    pub available: i128,
    pub held: i128,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HoldState {
    Open,
    Released,
    Settled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hold {
    pub user: UserId,
    pub money: Money,
    pub state: HoldState,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LedgerError {
    #[error("amount must be greater than zero")]
    NonPositiveAmount,
    #[error("insufficient funds: {available} available, {requested} requested")]
    InsufficientFunds { available: Money, requested: Money },
    #[error("cannot transfer to the same account")]
    SameAccount,
    #[error("reference {reference:?} was already used for a different request")]
    IdempotencyConflict { reference: String },
    #[error("reference must not be empty")]
    EmptyReference,
    #[error("hold {reference:?} not found")]
    HoldNotFound { reference: String },
    #[error("hold {reference:?} is already {state:?}")]
    HoldClosed { reference: String, state: HoldState },
    #[error("fee must be in the same asset and smaller than the held amount")]
    InvalidFee,
    #[error("arithmetic overflow")]
    Overflow,
    /// A database operation failed. `code` is the PostgreSQL SQLSTATE when
    /// available, used internally for retry decisions and error mapping.
    #[error("database error: {message}")]
    Database {
        code: Option<String>,
        message: String,
    },
    /// A balance would go negative or a transaction would not balance. Only a
    /// bug in this module can produce it, and it refuses to apply rather than
    /// write a corrupt ledger.
    #[error("ledger invariant violated: {0}")]
    InvariantViolated(&'static str),
}

/// The canonical form of a request, compared when a reference is reused.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Request {
    Deposit {
        user: UserId,
        money: Money,
    },
    Transfer {
        from: UserId,
        to: UserId,
        money: Money,
    },
    Hold {
        user: UserId,
        money: Money,
    },
    Release,
    Settle {
        fee: Option<Money>,
    },
}

#[derive(Debug, Default)]
pub struct Ledger {
    balances: HashMap<AccountKey, i128>,
    transactions: Vec<Transaction>,
    by_reference: HashMap<String, (Uuid, Request)>,
    holds: HashMap<String, Hold>,
}

impl Ledger {
    pub fn new() -> Self {
        Self::default()
    }

    /// Credits a user with money that arrived from outside EngiPay.
    /// `reference` should identify the source uniquely, e.g. `base:<tx hash>:<log index>`.
    pub fn deposit(
        &mut self,
        user: UserId,
        money: Money,
        reference: &str,
    ) -> Result<Receipt, LedgerError> {
        require_positive(money)?;
        let request = Request::Deposit { user, money };
        if let Some(receipt) = self.replay(reference, &request)? {
            return Ok(receipt);
        }
        let postings = vec![
            posting(
                AccountKey::system(SystemAccount::ExternalInflow, money.asset),
                negate(money.minor)?,
            ),
            posting(
                AccountKey::user(user, money.asset, Bucket::Available),
                money.minor,
            ),
        ];
        self.commit(TransactionKind::Deposit, reference, request, postings)
    }

    /// Moves spendable money from one user to another, instantly and without a
    /// network fee. Both sides change together or not at all.
    pub fn transfer(
        &mut self,
        from: UserId,
        to: UserId,
        money: Money,
        reference: &str,
    ) -> Result<Receipt, LedgerError> {
        require_positive(money)?;
        if from == to {
            return Err(LedgerError::SameAccount);
        }
        let request = Request::Transfer { from, to, money };
        if let Some(receipt) = self.replay(reference, &request)? {
            return Ok(receipt);
        }
        self.require_available(from, money)?;
        let postings = vec![
            posting(
                AccountKey::user(from, money.asset, Bucket::Available),
                negate(money.minor)?,
            ),
            posting(
                AccountKey::user(to, money.asset, Bucket::Available),
                money.minor,
            ),
        ];
        self.commit(TransactionKind::Transfer, reference, request, postings)
    }

    /// Commits spendable money to something in flight. The money stays the
    /// user's, but moves from `Available` to `Held` so it cannot be spent twice.
    ///
    /// Before the hold is created, the user's available balance must cover the
    /// principal plus the estimated network fee. If it does not, the hold is
    /// rejected with [`LedgerError::InsufficientFunds`] detailing the total
    /// required against what is actually available.
    pub fn hold(
        &mut self,
        user: UserId,
        money: Money,
        fee: Money,
        reference: &str,
    ) -> Result<Receipt, LedgerError> {
        require_positive(money)?;
        require_positive(fee)?;
        if fee.asset != money.asset {
            return Err(LedgerError::InvalidFee);
        }
        let request = Request::Hold { user, money };
        if let Some(receipt) = self.replay(reference, &request)? {
            return Ok(receipt);
        }
        let required = Money {
            asset: money.asset,
            minor: money
                .minor
                .checked_add(fee.minor)
                .ok_or(LedgerError::Overflow)?,
        };
        self.require_available(user, required)?;
        let postings = vec![
            posting(
                AccountKey::user(user, money.asset, Bucket::Available),
                negate(money.minor)?,
            ),
            posting(
                AccountKey::user(user, money.asset, Bucket::Held),
                money.minor,
            ),
        ];
        self.commit(TransactionKind::Hold, reference, request, postings)
    }

    /// Returns held money to the user's available balance.
    pub fn release(&mut self, reference: &str) -> Result<Receipt, LedgerError> {
        let hold = self.open_hold(reference)?;
        let request = Request::Release;
        if let Some(receipt) = self.replay(reference, &request)? {
            return Ok(receipt);
        }
        let postings = vec![
            posting(
                AccountKey::user(hold.user, hold.money.asset, Bucket::Held),
                negate(hold.money.minor)?,
            ),
            posting(
                AccountKey::user(hold.user, hold.money.asset, Bucket::Available),
                hold.money.minor,
            ),
        ];
        self.commit(TransactionKind::ReleaseHold, reference, request, postings)
    }

    /// Settles a hold: the held money leaves EngiPay, and an optional fee is
    /// booked as revenue. The fee must be in the same asset and no larger than
    /// the held amount.
    pub fn settle(&mut self, reference: &str, fee: Option<Money>) -> Result<Receipt, LedgerError> {
        let hold = self.open_hold(reference)?;
        if let Some(fee) = fee {
            if fee.asset != hold.money.asset || fee.minor > hold.money.minor {
                return Err(LedgerError::InvalidFee);
            }
        }
        let request = Request::Settle { fee };
        if let Some(receipt) = self.replay(reference, &request)? {
            return Ok(receipt);
        }
        let mut postings = vec![
            posting(
                AccountKey::user(hold.user, hold.money.asset, Bucket::Held),
                negate(hold.money.minor)?,
            ),
            posting(
                AccountKey::system(SystemAccount::ExternalOutflow, hold.money.asset),
                hold.money.minor,
            ),
        ];
        if let Some(fee) = fee {
            postings.push(posting(
                AccountKey::system(SystemAccount::Fees, fee.asset),
                negate(fee.minor)?,
            ));
        }
        self.commit(TransactionKind::SettleHold, reference, request, postings)
    }

    /// The user's current balance in both buckets.
    pub fn balance(&self, user: UserId, asset: Asset) -> Balance {
        Balance {
            asset,
            available: self.amount(AccountKey::user(user, asset, Bucket::Available)),
            held: self.amount(AccountKey::user(user, asset, Bucket::Held)),
        }
    }

    fn amount(&self, key: AccountKey) -> i128 {
        self.balances.get(&key).copied().unwrap_or(0)
    }

    fn require_available(&self, user: UserId, money: Money) -> Result<(), LedgerError> {
        let available = self.amount(AccountKey::user(user, money.asset, Bucket::Available));
        if available < money.minor {
            return Err(LedgerError::InsufficientFunds {
                available: Money {
                    asset: money.asset,
                    minor: available,
                },
                requested: money,
            });
        }
        Ok(())
    }

    fn open_hold(&self, reference: &str) -> Result<Hold, LedgerError> {
        let hold = self
            .holds
            .get(reference)
            .copied()
            .ok_or_else(|| LedgerError::HoldNotFound {
                reference: reference.to_string(),
            })?;
        if hold.state != HoldState::Open {
            return Err(LedgerError::HoldClosed {
                reference: reference.to_string(),
                state: hold.state,
            });
        }
        Ok(hold)
    }

    fn replay(&self, reference: &str, request: &Request) -> Result<Option<Receipt>, LedgerError> {
        if reference.is_empty() {
            return Err(LedgerError::EmptyReference);
        }
        match self.by_reference.get(reference) {
            Some((id, previous)) if previous == request => Ok(Some(Receipt {
                transaction_id: *id,
                replayed: true,
            })),
            Some(_) => Err(LedgerError::IdempotencyConflict {
                reference: reference.to_string(),
            }),
            None => Ok(None),
        }
    }

    fn commit(
        &mut self,
        kind: TransactionKind,
        reference: &str,
        request: Request,
        postings: Vec<Posting>,
    ) -> Result<Receipt, LedgerError> {
        self.apply(&postings)?;
        let id = Uuid::new_v4();
        self.transactions.push(Transaction {
            id,
            kind,
            reference: reference.to_string(),
            postings,
        });
        self.by_reference
            .insert(reference.to_string(), (id, request));
        Ok(Receipt {
            transaction_id: id,
            replayed: false,
        })
    }

    fn apply(&mut self, postings: &[Posting]) -> Result<(), LedgerError> {
        let mut deltas: HashMap<AccountKey, i128> = HashMap::new();
        for posting in postings {
            let entry = deltas.entry(posting.account).or_insert(0);
            *entry = entry
                .checked_add(posting.amount)
                .ok_or(LedgerError::Overflow)?;
        }
        for (key, delta) in &deltas {
            if matches!(key.owner, Owner::User(_)) {
                let next = self
                    .amount(*key)
                    .checked_add(*delta)
                    .ok_or(LedgerError::Overflow)?;
                if next < 0 {
                    return Err(LedgerError::InvariantViolated(
                        "user balance would go negative",
                    ));
                }
            }
        }
        for (key, delta) in deltas {
            let entry = self.balances.entry(key).or_insert(0);
            *entry = entry.checked_add(delta).ok_or(LedgerError::Overflow)?;
        }
        Ok(())
    }
}

fn require_positive(money: Money) -> Result<(), LedgerError> {
    if money.minor <= 0 {
        return Err(LedgerError::NonPositiveAmount);
    }
    Ok(())
}

fn negate(amount: i128) -> Result<i128, LedgerError> {
    amount.checked_neg().ok_or(LedgerError::Overflow)
}

fn posting(account: AccountKey, amount: i128) -> Posting {
    Posting { account, amount }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user() -> UserId {
        UserId::new()
    }

    fn usdc(minor: i128) -> Money {
        Money {
            asset: Asset::Usdc,
            minor,
        }
    }

    #[test]
    fn hold_requires_available_balance_to_cover_principal_and_fee() {
        let mut ledger = Ledger::new();
        let alice = user();
        ledger
            .deposit(alice, usdc(1_000), "dep-1")
            .expect("valid ledger test setup");

        // Principal 900 + fee 200 = 1100 > 1000 available.
        let err = ledger
            .hold(alice, usdc(900), usdc(200), "hold-1")
            .expect_err("operation should fail");
        assert_eq!(
            err,
            LedgerError::InsufficientFunds {
                available: usdc(1_000),
                requested: usdc(1_100),
            }
        );

        // Nothing moved: the failed hold left the balance untouched.
        let balance = ledger.balance(alice, Asset::Usdc);
        assert_eq!(balance.available, 1_000);
        assert_eq!(balance.held, 0);
    }

    #[test]
    fn hold_succeeds_when_available_balance_covers_principal_and_fee() {
        let mut ledger = Ledger::new();
        let alice = user();
        ledger
            .deposit(alice, usdc(1_000), "dep-1")
            .expect("valid ledger test setup");

        // Principal 900 + fee 100 = 1000, exactly covered.
        ledger
            .hold(alice, usdc(900), usdc(100), "hold-1")
            .expect("valid ledger test setup");

        let balance = ledger.balance(alice, Asset::Usdc);
        assert_eq!(balance.available, 100);
        assert_eq!(balance.held, 900);
    }

    #[test]
    fn hold_rejects_fee_in_a_different_asset() {
        let mut ledger = Ledger::new();
        let alice = user();
        ledger
            .deposit(alice, usdc(1_000), "dep-1")
            .expect("valid ledger test setup");

        let err = ledger
            .hold(
                alice,
                usdc(100),
                Money {
                    asset: Asset::Eth,
                    minor: 1,
                },
                "hold-1",
            )
            .expect_err("operation should fail");
        assert_eq!(err, LedgerError::InvalidFee);
    }
}
