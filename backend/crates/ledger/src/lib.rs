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

    /// Reserves money for something in flight, so it cannot be spent twice.
    /// The reference names the hold for the later release or settle.
    pub fn hold(
        &mut self,
        user: UserId,
        money: Money,
        reference: &str,
    ) -> Result<Receipt, LedgerError> {
        require_positive(money)?;
        let request = Request::Hold { user, money };
        if let Some(receipt) = self.replay(reference, &request)? {
            return Ok(receipt);
        }
        self.require_available(user, money)?;
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
        let receipt = self.commit(TransactionKind::Hold, reference, request, postings)?;
        self.holds.insert(
            reference.to_owned(),
            Hold {
                user,
                money,
                state: HoldState::Open,
            },
        );
        Ok(receipt)
    }

    /// Returns held money to the user, for a withdrawal that failed or was cancelled.
    pub fn release(&mut self, hold_reference: &str) -> Result<Receipt, LedgerError> {
        let reference = format!("{hold_reference}:release");
        if let Some(receipt) = self.replay(&reference, &Request::Release)? {
            return Ok(receipt);
        }
        let hold = self.open_hold(hold_reference)?;
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
        let receipt = self.commit(
            TransactionKind::ReleaseHold,
            &reference,
            Request::Release,
            postings,
        )?;
        self.close_hold(hold_reference, HoldState::Released);
        Ok(receipt)
    }

    /// Completes a hold: the money leaves EngiPay, minus an optional fee that
    /// EngiPay keeps. Used when a withdrawal is broadcast or a payout completes.
    pub fn settle(
        &mut self,
        hold_reference: &str,
        fee: Option<Money>,
    ) -> Result<Receipt, LedgerError> {
        let reference = format!("{hold_reference}:settle");
        let request = Request::Settle { fee };
        if let Some(receipt) = self.replay(&reference, &request)? {
            return Ok(receipt);
        }
        let hold = self.open_hold(hold_reference)?;
        let fee_minor = match fee {
            None => 0,
            Some(fee)
                if fee.asset == hold.money.asset
                    && fee.minor >= 0
                    && fee.minor < hold.money.minor =>
            {
                fee.minor
            }
            Some(_) => return Err(LedgerError::InvalidFee),
        };
        let outflow = hold
            .money
            .minor
            .checked_sub(fee_minor)
            .ok_or(LedgerError::Overflow)?;

        let mut postings = vec![
            posting(
                AccountKey::user(hold.user, hold.money.asset, Bucket::Held),
                negate(hold.money.minor)?,
            ),
            posting(
                AccountKey::system(SystemAccount::ExternalOutflow, hold.money.asset),
                outflow,
            ),
        ];
        if fee_minor > 0 {
            postings.push(posting(
                AccountKey::system(SystemAccount::Fees, hold.money.asset),
                fee_minor,
            ));
        }
        let receipt = self.commit(TransactionKind::SettleHold, &reference, request, postings)?;
        self.close_hold(hold_reference, HoldState::Settled);
        Ok(receipt)
    }

    pub fn balance(&self, user: UserId, asset: Asset) -> Balance {
        Balance {
            asset,
            available: self.amount(AccountKey::user(user, asset, Bucket::Available)),
            held: self.amount(AccountKey::user(user, asset, Bucket::Held)),
        }
    }

    pub fn system_balance(&self, account: SystemAccount, asset: Asset) -> i128 {
        self.amount(AccountKey::system(account, asset))
    }

    pub fn hold_state(&self, reference: &str) -> Option<HoldState> {
        self.holds.get(reference).map(|hold| hold.state)
    }

    pub fn transactions(&self) -> &[Transaction] {
        &self.transactions
    }

    /// Re-derives every balance from the transaction history and checks all
    /// three rules. Cheap enough to run in tests after every step, and the same
    /// check the reconciliation job runs against the database.
    pub fn verify(&self) -> Result<(), LedgerError> {
        let mut derived: HashMap<AccountKey, i128> = HashMap::new();
        for transaction in &self.transactions {
            check_balanced(&transaction.postings)?;
            for p in &transaction.postings {
                let entry = derived.entry(p.account).or_insert(0);
                *entry = entry.checked_add(p.amount).ok_or(LedgerError::Overflow)?;
            }
        }
        for (key, amount) in &derived {
            if self.amount(*key) != *amount {
                return Err(LedgerError::InvariantViolated(
                    "stored balance differs from history",
                ));
            }
            if matches!(key.owner, Owner::User(_)) && *amount < 0 {
                return Err(LedgerError::InvariantViolated("user balance is negative"));
            }
        }
        Ok(())
    }

    fn amount(&self, key: AccountKey) -> i128 {
        self.balances.get(&key).copied().unwrap_or(0)
    }

    fn require_available(&self, user: UserId, money: Money) -> Result<(), LedgerError> {
        let available = self.amount(AccountKey::user(user, money.asset, Bucket::Available));
        if available < money.minor {
            return Err(LedgerError::InsufficientFunds {
                available: Money::from_minor(money.asset, available),
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
                reference: reference.to_owned(),
            })?;
        if hold.state != HoldState::Open {
            return Err(LedgerError::HoldClosed {
                reference: reference.to_owned(),
                state: hold.state,
            });
        }
        Ok(hold)
    }

    fn close_hold(&mut self, reference: &str, state: HoldState) {
        if let Some(hold) = self.holds.get_mut(reference) {
            hold.state = state;
        }
    }

    /// Returns the original receipt if this reference was already applied with
    /// the same request, and refuses if it was used for anything else.
    fn replay(&self, reference: &str, request: &Request) -> Result<Option<Receipt>, LedgerError> {
        if reference.trim().is_empty() {
            return Err(LedgerError::EmptyReference);
        }
        match self.by_reference.get(reference) {
            None => Ok(None),
            Some((id, existing)) if existing == request => Ok(Some(Receipt {
                transaction_id: *id,
                replayed: true,
            })),
            Some(_) => Err(LedgerError::IdempotencyConflict {
                reference: reference.to_owned(),
            }),
        }
    }

    /// Validates the whole transaction against a copy of the affected balances,
    /// and only then writes it. A failure leaves the ledger exactly as it was.
    fn commit(
        &mut self,
        kind: TransactionKind,
        reference: &str,
        request: Request,
        postings: Vec<Posting>,
    ) -> Result<Receipt, LedgerError> {
        check_balanced(&postings)?;

        let mut staged: HashMap<AccountKey, i128> = HashMap::new();
        for p in &postings {
            let current = staged
                .get(&p.account)
                .copied()
                .unwrap_or_else(|| self.amount(p.account));
            let next = current.checked_add(p.amount).ok_or(LedgerError::Overflow)?;
            if matches!(p.account.owner, Owner::User(_)) && next < 0 {
                return Err(LedgerError::InvariantViolated(
                    "user balance would go negative",
                ));
            }
            staged.insert(p.account, next);
        }

        let id = Uuid::new_v4();
        self.balances.extend(staged);
        self.transactions.push(Transaction {
            id,
            kind,
            reference: reference.to_owned(),
            postings,
        });
        self.by_reference
            .insert(reference.to_owned(), (id, request));
        Ok(Receipt {
            transaction_id: id,
            replayed: false,
        })
    }
}

fn posting(account: AccountKey, amount: i128) -> Posting {
    Posting { account, amount }
}

fn negate(value: i128) -> Result<i128, LedgerError> {
    value.checked_neg().ok_or(LedgerError::Overflow)
}

fn require_positive(money: Money) -> Result<(), LedgerError> {
    if money.is_positive() {
        Ok(())
    } else {
        Err(LedgerError::NonPositiveAmount)
    }
}

fn check_balanced(postings: &[Posting]) -> Result<(), LedgerError> {
    let mut totals: HashMap<Asset, i128> = HashMap::new();
    for p in postings {
        let entry = totals.entry(p.account.asset).or_insert(0);
        *entry = entry.checked_add(p.amount).ok_or(LedgerError::Overflow)?;
    }
    if totals.values().all(|total| *total == 0) {
        Ok(())
    } else {
        Err(LedgerError::InvariantViolated(
            "transaction does not balance",
        ))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use super::*;

    fn usdc(units: i128) -> Money {
        Money::from_minor(Asset::Usdc, units)
    }

    fn funded(user: UserId, units: i128) -> Ledger {
        let mut ledger = Ledger::new();
        ledger.deposit(user, usdc(units), "seed").unwrap();
        ledger
    }

    #[test]
    fn deposit_credits_available_balance() {
        let alice = UserId::new();
        let ledger = funded(alice, 100);
        assert_eq!(
            ledger.balance(alice, Asset::Usdc),
            Balance {
                asset: Asset::Usdc,
                available: 100,
                held: 0
            }
        );
        assert_eq!(
            ledger.system_balance(SystemAccount::ExternalInflow, Asset::Usdc),
            -100
        );
        ledger.verify().unwrap();
    }

    #[test]
    fn replaying_a_deposit_does_not_credit_twice() {
        let alice = UserId::new();
        let mut ledger = Ledger::new();
        let first = ledger.deposit(alice, usdc(50), "base:0xabc:0").unwrap();
        let second = ledger.deposit(alice, usdc(50), "base:0xabc:0").unwrap();
        assert!(!first.replayed);
        assert!(second.replayed);
        assert_eq!(first.transaction_id, second.transaction_id);
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 50);
        assert_eq!(ledger.transactions().len(), 1);
    }

    #[test]
    fn reusing_a_reference_for_a_different_request_is_refused() {
        let alice = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(alice, usdc(50), "ref-1").unwrap();
        assert_eq!(
            ledger.deposit(alice, usdc(51), "ref-1"),
            Err(LedgerError::IdempotencyConflict {
                reference: "ref-1".into()
            })
        );
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 50);
    }

    #[test]
    fn transfer_moves_money_between_users() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = funded(alice, 100);
        ledger.transfer(alice, bob, usdc(30), "pay-1").unwrap();
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 70);
        assert_eq!(ledger.balance(bob, Asset::Usdc).available, 30);
        ledger.verify().unwrap();
    }

    #[test]
    fn transfer_beyond_the_balance_changes_nothing() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = funded(alice, 100);
        let result = ledger.transfer(alice, bob, usdc(101), "pay-1");
        assert!(matches!(result, Err(LedgerError::InsufficientFunds { .. })));
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 100);
        assert_eq!(ledger.balance(bob, Asset::Usdc).available, 0);
        assert_eq!(ledger.transactions().len(), 1);
    }

    #[test]
    fn rejects_zero_negative_self_and_unnamed_requests() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = funded(alice, 100);
        assert_eq!(
            ledger.transfer(alice, bob, usdc(0), "a"),
            Err(LedgerError::NonPositiveAmount)
        );
        assert_eq!(
            ledger.transfer(alice, bob, usdc(-5), "b"),
            Err(LedgerError::NonPositiveAmount)
        );
        assert_eq!(
            ledger.transfer(alice, alice, usdc(5), "c"),
            Err(LedgerError::SameAccount)
        );
        assert_eq!(
            ledger.deposit(alice, usdc(5), "  "),
            Err(LedgerError::EmptyReference)
        );
    }

    #[test]
    fn assets_never_mix() {
        let alice = UserId::new();
        let mut ledger = funded(alice, 100);
        ledger
            .deposit(alice, Money::from_minor(Asset::Btc, 7), "btc-1")
            .unwrap();
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 100);
        assert_eq!(ledger.balance(alice, Asset::Btc).available, 7);
        assert_eq!(ledger.balance(alice, Asset::Eth).available, 0);
    }

    #[test]
    fn held_money_cannot_be_spent_twice() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = funded(alice, 100);
        ledger.hold(alice, usdc(80), "wd-1").unwrap();
        assert_eq!(
            ledger.balance(alice, Asset::Usdc),
            Balance {
                asset: Asset::Usdc,
                available: 20,
                held: 80
            }
        );
        assert!(matches!(
            ledger.transfer(alice, bob, usdc(21), "pay-1"),
            Err(LedgerError::InsufficientFunds { .. })
        ));
        assert!(matches!(
            ledger.hold(alice, usdc(21), "wd-2"),
            Err(LedgerError::InsufficientFunds { .. })
        ));
        ledger.verify().unwrap();
    }

    #[test]
    fn releasing_a_hold_returns_the_money() {
        let alice = UserId::new();
        let mut ledger = funded(alice, 100);
        ledger.hold(alice, usdc(40), "wd-1").unwrap();
        ledger.release("wd-1").unwrap();
        assert_eq!(
            ledger.balance(alice, Asset::Usdc),
            Balance {
                asset: Asset::Usdc,
                available: 100,
                held: 0
            }
        );
        assert_eq!(ledger.hold_state("wd-1"), Some(HoldState::Released));
        ledger.verify().unwrap();
    }

    #[test]
    fn settling_a_hold_sends_the_money_out_and_keeps_the_fee() {
        let alice = UserId::new();
        let mut ledger = funded(alice, 100);
        ledger.hold(alice, usdc(40), "wd-1").unwrap();
        ledger.settle("wd-1", Some(usdc(2))).unwrap();
        assert_eq!(
            ledger.balance(alice, Asset::Usdc),
            Balance {
                asset: Asset::Usdc,
                available: 60,
                held: 0
            }
        );
        assert_eq!(
            ledger.system_balance(SystemAccount::ExternalOutflow, Asset::Usdc),
            38
        );
        assert_eq!(ledger.system_balance(SystemAccount::Fees, Asset::Usdc), 2);
        ledger.verify().unwrap();
    }

    #[test]
    fn a_hold_closes_exactly_once() {
        let alice = UserId::new();
        let mut ledger = funded(alice, 100);
        ledger.hold(alice, usdc(40), "wd-1").unwrap();
        ledger.settle("wd-1", None).unwrap();

        // Retrying the same settle is safe and moves nothing.
        assert!(ledger.settle("wd-1", None).unwrap().replayed);
        // Releasing a settled hold would mint money back to the user: refused.
        assert_eq!(
            ledger.release("wd-1"),
            Err(LedgerError::HoldClosed {
                reference: "wd-1".into(),
                state: HoldState::Settled
            })
        );
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 60);
        ledger.verify().unwrap();
    }

    #[test]
    fn fees_must_be_smaller_than_the_hold_and_in_its_asset() {
        let alice = UserId::new();
        let mut ledger = funded(alice, 100);
        ledger.hold(alice, usdc(40), "wd-1").unwrap();
        assert_eq!(
            ledger.settle("wd-1", Some(usdc(40))),
            Err(LedgerError::InvalidFee)
        );
        assert_eq!(
            ledger.settle("wd-1", Some(Money::from_minor(Asset::Btc, 1))),
            Err(LedgerError::InvalidFee)
        );
        assert_eq!(ledger.hold_state("wd-1"), Some(HoldState::Open));
    }

    #[test]
    fn unknown_holds_are_refused() {
        let mut ledger = Ledger::new();
        assert_eq!(
            ledger.release("nope"),
            Err(LedgerError::HoldNotFound {
                reference: "nope".into()
            })
        );
    }

    /// Hundreds of mixed operations, many deliberately invalid. After every
    /// step the ledger must still derive correctly from history, no user may be
    /// negative, and total money per asset must be conserved.
    #[test]
    fn money_is_conserved_through_a_long_random_sequence() {
        let users: Vec<UserId> = (0..5).map(|_| UserId::new()).collect();
        let mut ledger = Ledger::new();
        let mut seed: u64 = 0x5eed_1234;
        let mut next = move || {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (seed >> 33) as usize
        };
        let mut open_holds: Vec<String> = Vec::new();

        for step in 0..600 {
            let a = users[next() % users.len()];
            let b = users[next() % users.len()];
            let amount = usdc((next() % 500) as i128 - 50);
            let reference = format!("op-{step}");
            let _ = match next() % 5 {
                0 => ledger.deposit(a, amount, &reference),
                1 => ledger.transfer(a, b, amount, &reference),
                2 => ledger
                    .hold(a, amount, &reference)
                    .inspect(|_| open_holds.push(reference.clone())),
                3 if !open_holds.is_empty() => {
                    let hold = open_holds.swap_remove(next() % open_holds.len());
                    ledger.release(&hold)
                }
                _ if !open_holds.is_empty() => {
                    let hold = open_holds.swap_remove(next() % open_holds.len());
                    ledger.settle(&hold, None)
                }
                _ => ledger.deposit(a, amount, &reference),
            };

            ledger.verify().unwrap();

            let users_total: i128 = users
                .iter()
                .map(|u| {
                    let bal = ledger.balance(*u, Asset::Usdc);
                    bal.available + bal.held
                })
                .sum();
            let system_total = ledger.system_balance(SystemAccount::ExternalInflow, Asset::Usdc)
                + ledger.system_balance(SystemAccount::ExternalOutflow, Asset::Usdc)
                + ledger.system_balance(SystemAccount::Fees, Asset::Usdc);
            assert_eq!(
                users_total + system_total,
                0,
                "money created or destroyed at step {step}"
            );
        }
    }
}
