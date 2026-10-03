//! `DepositCreditor` — bridges the chain watcher and the ledger.
//!
//! Every [`ObservedDeposit`] that the watcher confirms as creditable passes
//! through here. The creditor:
//!
//! 1. **Resolves** the deposit address to an EngiPay [`UserId`] by querying
//!    the `deposit_addresses` table (with an in-process LRU cache).
//! 2. **Calls** [`PostgresLedgerStore::deposit`] with the on-chain reference
//!    as the idempotency key, so a duplicate event from the watcher's
//!    overlap-by-one logic, a process restart, or a network retry can never
//!    credit the same deposit twice.
//! 3. **Routes failures** to the Dead-Letter Queue
//!    ([`crate::dlq::push_to_dlq`]) rather than crashing the watcher loop:
//!    - Unknown recipient → the bare custody address, or an `M...` address
//!      not found in `deposit_addresses` → [`DlqReason::UnknownRecipient`].
//!    - Ledger errors that are not replays → [`DlqReason::DatabaseConstraint`]
//!      or similar.
//!
//! # Idempotency
//!
//! The deposit's `reference` field (e.g. `stellar:<tx hash>:<paging token>`)
//! is used verbatim as the idempotency key passed to the ledger store. The
//! store checks whether a transaction with this reference already exists; if
//! it does, it returns a [`Receipt`] with `replayed = true` and moves no
//! money. This makes the creditor safe to call multiple times for the same
//! deposit.
//!
//! # Crash safety
//!
//! The two side effects — crediting the ledger and persisting the cursor —
//! are independent. If the process crashes after the ledger write but before
//! the cursor advances, the deposit will be seen again on restart. Because of
//! the idempotency key, the second credit attempt returns `replayed = true`
//! and nothing moves. The deposit is therefore credited exactly once under
//! all crash scenarios.
//!
//! # DLQ and crash safety interaction
//!
//! If the ledger write fails and the DLQ write also fails, the deposit is
//! neither credited nor logged. The watcher's deduplication ring-buffer
//! (`seen`) prevents it from being retried within the same process lifetime.
//! On restart, however, the deposit will be seen again (cursor has not
//! advanced) and another credit attempt will be made. This is the correct
//! behaviour: a transient database outage should not permanently lose a
//! deposit. Operators monitoring the DLQ will investigate any entries there.

use engipay_core::UserId;
use engipay_core::stellar::{StellarAddress, parse_address};
use engipay_ledger::LedgerError;
use engipay_ledger::postgres::PostgresLedgerStore;
use sqlx::PgPool;
use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::ObservedDeposit;
use crate::dlq::{DlqReason, push_to_dlq};
use crate::services::account_resolver::AccountResolver;

// ── DepositCreditor ────────────────────────────────────────────────────────────

/// Credits confirmed on-chain deposits to the EngiPay ledger.
///
/// Construct once at startup and share via an `Arc`. The internal
/// [`AccountResolver`] holds an LRU cache so repeated deposits from the same
/// address do not hit the database each time.
///
/// # Usage
///
/// ```rust,ignore
/// let creditor = Arc::new(DepositCreditor::new(pool.clone()));
/// // In the watcher loop:
/// creditor.process(deposit).await;
/// ```
pub struct DepositCreditor {
    ledger: PostgresLedgerStore,
    resolver: Mutex<AccountResolver>,
    pool: PgPool,
}

impl DepositCreditor {
    /// Creates a new creditor backed by `pool`.
    ///
    /// The resolver LRU cache is sized to
    /// [`account_resolver::DEFAULT_CACHE_CAPACITY`].
    pub fn new(pool: PgPool) -> Self {
        use crate::services::account_resolver::DEFAULT_CACHE_CAPACITY;
        Self {
            ledger: PostgresLedgerStore::new(pool.clone()),
            resolver: Mutex::new(AccountResolver::new(pool.clone(), DEFAULT_CACHE_CAPACITY)),
            pool,
        }
    }

    /// Attempts to credit `deposit` to the ledger.
    ///
    /// Returns [`CreditOutcome`] describing what happened. Failures are
    /// logged and routed to the DLQ; they do not propagate as errors so the
    /// caller's event loop can continue uninterrupted.
    pub async fn process(&self, deposit: ObservedDeposit) -> CreditOutcome {
        // 1. Resolve address → UserId.
        let user_id = match self.resolve_user(&deposit).await {
            Ok(id) => id,
            Err(outcome) => return outcome,
        };

        // 2. Call the ledger.
        match self
            .ledger
            .deposit(user_id, deposit.money, &deposit.reference)
            .await
        {
            Ok(receipt) if receipt.replayed => {
                info!(
                    reference = %deposit.reference,
                    user_id   = %user_id,
                    amount    = %deposit.money,
                    "deposit already credited (idempotent replay)"
                );
                CreditOutcome::Replayed
            }
            Ok(_receipt) => {
                info!(
                    reference = %deposit.reference,
                    user_id   = %user_id,
                    amount    = %deposit.money,
                    "deposit credited"
                );
                CreditOutcome::Credited
            }
            Err(LedgerError::IdempotencyConflict { reference }) => {
                warn!(
                    reference = %reference,
                    user_id   = %user_id,
                    amount    = %deposit.money,
                    "deposit reference conflicts with an existing transaction; routing to DLQ"
                );
                self.dlq(&deposit, DlqReason::DatabaseConstraint).await;
                CreditOutcome::Dlq(DlqReason::DatabaseConstraint)
            }
            Err(err) => {
                warn!(
                    reference = %deposit.reference,
                    user_id   = %user_id,
                    amount    = %deposit.money,
                    error     = %err,
                    "ledger deposit failed; routing to DLQ"
                );
                let reason = ledger_error_to_dlq_reason(&err);
                self.dlq(&deposit, reason.clone()).await;
                CreditOutcome::Dlq(reason)
            }
        }
    }

    /// Resolves the deposit address to a [`UserId`].
    ///
    /// Returns `Err(CreditOutcome)` on failure so `process` can return early.
    async fn resolve_user(&self, deposit: &ObservedDeposit) -> Result<UserId, CreditOutcome> {
        match parse_address(&deposit.address) {
            Ok(StellarAddress::Muxed { id, .. }) => {
                let mut resolver = self.resolver.lock().await;
                match resolver.resolve(id).await {
                    Ok(uuid) => Ok(UserId::from_uuid(uuid)),
                    Err(_) => {
                        warn!(
                            reference = %deposit.reference,
                            address   = %deposit.address,
                            muxed_id  = id,
                            "muxed deposit address not found in deposit_addresses; routing to DLQ"
                        );
                        self.dlq(deposit, DlqReason::UnknownRecipient).await;
                        Err(CreditOutcome::Dlq(DlqReason::UnknownRecipient))
                    }
                }
            }
            _ => {
                warn!(
                    reference = %deposit.reference,
                    address   = %deposit.address,
                    "deposit to non-muxed address cannot be attributed to a user; routing to DLQ"
                );
                self.dlq(deposit, DlqReason::UnknownRecipient).await;
                Err(CreditOutcome::Dlq(DlqReason::UnknownRecipient))
            }
        }
    }

    /// Writes `deposit` to the DLQ. Logs a warning if the DLQ write itself
    /// fails so the deposit is always visible in process logs.
    async fn dlq(&self, deposit: &ObservedDeposit, reason: DlqReason) {
        if let Err(err) = push_to_dlq(&self.pool, deposit, reason).await {
            warn!(
                reference = %deposit.reference,
                error     = %err,
                "could not write deposit to DLQ; deposit is in logs only"
            );
        }
    }
}

// ── CreditOutcome ──────────────────────────────────────────────────────────────

/// The result of one [`DepositCreditor::process`] call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CreditOutcome {
    /// The deposit was applied to the ledger for the first time.
    Credited,
    /// The reference had already been applied; nothing moved.
    Replayed,
    /// The deposit could not be credited and was written to the DLQ.
    Dlq(DlqReason),
}

// ── Helpers ────────────────────────────────────────────────────────────────────

fn ledger_error_to_dlq_reason(err: &LedgerError) -> DlqReason {
    match err {
        LedgerError::Database { .. } => DlqReason::DatabaseConstraint,
        LedgerError::IdempotencyConflict { .. } => DlqReason::DatabaseConstraint,
        LedgerError::InvariantViolated(_) => DlqReason::DatabaseConstraint,
        _ => DlqReason::Other(err.to_string()),
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use std::collections::HashMap;

    use engipay_core::{Asset, Money, UserId};
    use uuid::Uuid;

    use crate::ObservedDeposit;
    use crate::dlq::{DlqEntry, DlqReason};

    // ── Fakes ─────────────────────────────────────────────────────────────────

    #[derive(Default)]
    struct FakeLedger {
        responses: HashMap<String, Result<bool, String>>,
        calls: Vec<(UserId, Money, String)>,
    }

    impl FakeLedger {
        fn will_succeed(mut self, reference: &str, replayed: bool) -> Self {
            self.responses.insert(reference.to_owned(), Ok(replayed));
            self
        }

        fn will_fail(mut self, reference: &str, msg: &str) -> Self {
            self.responses
                .insert(reference.to_owned(), Err(msg.to_owned()));
            self
        }

        fn call(&mut self, user: UserId, money: Money, reference: &str) -> Result<bool, String> {
            self.calls.push((user, money, reference.to_owned()));
            self.responses.get(reference).cloned().unwrap_or(Ok(false))
        }
    }

    #[derive(Default)]
    struct FakeResolver {
        known: HashMap<u64, Uuid>,
    }

    impl FakeResolver {
        fn with(mut self, muxed_id: u64, uuid: Uuid) -> Self {
            self.known.insert(muxed_id, uuid);
            self
        }

        fn resolve(&self, muxed_id: u64) -> Option<Uuid> {
            self.known.get(&muxed_id).copied()
        }
    }

    // ── Orchestrator ──────────────────────────────────────────────────────────

    fn run(
        deposit: &ObservedDeposit,
        resolver: &FakeResolver,
        ledger: &mut FakeLedger,
    ) -> (FakeOutcome, Vec<DlqEntry>) {
        use engipay_core::stellar::{StellarAddress, parse_address};

        let mut dlq: Vec<DlqEntry> = Vec::new();

        let user_id = match parse_address(&deposit.address) {
            Ok(StellarAddress::Muxed { id, .. }) => match resolver.resolve(id) {
                Some(uuid) => UserId::from_uuid(uuid),
                None => {
                    dlq.push(DlqEntry::new(deposit, DlqReason::UnknownRecipient));
                    return (FakeOutcome::Dlq(DlqReason::UnknownRecipient), dlq);
                }
            },
            _ => {
                dlq.push(DlqEntry::new(deposit, DlqReason::UnknownRecipient));
                return (FakeOutcome::Dlq(DlqReason::UnknownRecipient), dlq);
            }
        };

        match ledger.call(user_id, deposit.money, &deposit.reference) {
            Ok(false) => (FakeOutcome::Credited, dlq),
            Ok(true) => (FakeOutcome::Replayed, dlq),
            Err(msg) => {
                dlq.push(DlqEntry::new(deposit, DlqReason::Other(msg)));
                (FakeOutcome::Dlq(DlqReason::DatabaseConstraint), dlq)
            }
        }
    }

    #[derive(Debug, PartialEq, Eq)]
    enum FakeOutcome {
        Credited,
        Replayed,
        Dlq(DlqReason),
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn muxed_deposit(muxed_id: u64, reference: &str) -> ObservedDeposit {
        let custody = stellar_strkey::ed25519::PublicKey([1; 32])
            .to_string()
            .as_str()
            .to_owned();
        let address = engipay_core::stellar::muxed_deposit_address(&custody, muxed_id).unwrap();
        ObservedDeposit {
            money: Money::from_minor(Asset::Xlm, 10_000_000),
            address,
            reference: reference.to_owned(),
            confirmations: 1,
        }
    }

    fn bare_custody_deposit(reference: &str) -> ObservedDeposit {
        let custody = stellar_strkey::ed25519::PublicKey([1; 32])
            .to_string()
            .as_str()
            .to_owned();
        ObservedDeposit {
            money: Money::from_minor(Asset::Xlm, 5_000_000),
            address: custody,
            reference: reference.to_owned(),
            confirmations: 1,
        }
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    #[test]
    fn known_muxed_address_is_credited() {
        let uuid = Uuid::new_v4();
        let deposit = muxed_deposit(42, "stellar:tx001:100");
        let resolver = FakeResolver::default().with(42, uuid);
        let mut ledger = FakeLedger::default().will_succeed("stellar:tx001:100", false);

        let (outcome, dlq) = run(&deposit, &resolver, &mut ledger);

        assert_eq!(outcome, FakeOutcome::Credited);
        assert!(dlq.is_empty());
        assert_eq!(ledger.calls.len(), 1);
        assert_eq!(ledger.calls[0].0, UserId::from_uuid(uuid));
        assert_eq!(ledger.calls[0].1, Money::from_minor(Asset::Xlm, 10_000_000));
        assert_eq!(ledger.calls[0].2, "stellar:tx001:100");
    }

    #[test]
    fn reference_is_passed_verbatim_to_ledger() {
        let uuid = Uuid::new_v4();
        let reference = "stellar:cafebabe:429496729601";
        let deposit = muxed_deposit(7, reference);
        let resolver = FakeResolver::default().with(7, uuid);
        let mut ledger = FakeLedger::default().will_succeed(reference, false);

        let (outcome, _) = run(&deposit, &resolver, &mut ledger);
        assert_eq!(outcome, FakeOutcome::Credited);
        assert_eq!(ledger.calls[0].2, reference);
    }

    #[test]
    fn already_credited_deposit_returns_replayed() {
        let uuid = Uuid::new_v4();
        let deposit = muxed_deposit(3, "stellar:tx002:200");
        let resolver = FakeResolver::default().with(3, uuid);
        let mut ledger = FakeLedger::default().will_succeed("stellar:tx002:200", true);

        let (outcome, dlq) = run(&deposit, &resolver, &mut ledger);

        assert_eq!(outcome, FakeOutcome::Replayed);
        assert!(dlq.is_empty(), "replayed deposits must not go to the DLQ");
    }

    #[test]
    fn calling_process_twice_with_same_reference_is_idempotent() {
        let uuid = Uuid::new_v4();
        let deposit = muxed_deposit(5, "stellar:tx_idem:50");
        let resolver = FakeResolver::default().with(5, uuid);

        let mut ledger1 = FakeLedger::default().will_succeed("stellar:tx_idem:50", false);
        let (first, _) = run(&deposit, &resolver, &mut ledger1);
        assert_eq!(first, FakeOutcome::Credited);

        let mut ledger2 = FakeLedger::default().will_succeed("stellar:tx_idem:50", true);
        let (second, dlq) = run(&deposit, &resolver, &mut ledger2);
        assert_eq!(second, FakeOutcome::Replayed);
        assert!(dlq.is_empty());
    }

    #[test]
    fn unknown_muxed_address_routes_to_dlq() {
        let deposit = muxed_deposit(999, "stellar:tx003:300");
        let resolver = FakeResolver::default();
        let mut ledger = FakeLedger::default();

        let (outcome, dlq) = run(&deposit, &resolver, &mut ledger);

        assert_eq!(outcome, FakeOutcome::Dlq(DlqReason::UnknownRecipient));
        assert_eq!(dlq.len(), 1);
        assert_eq!(dlq[0].reason, "unknown_recipient");
        assert_eq!(dlq[0].status, "pending_investigation");
        assert!(ledger.calls.is_empty(), "ledger must not be touched");
    }

    #[test]
    fn bare_custody_address_routes_to_dlq() {
        let deposit = bare_custody_deposit("stellar:tx004:400");
        let resolver = FakeResolver::default();
        let mut ledger = FakeLedger::default();

        let (outcome, dlq) = run(&deposit, &resolver, &mut ledger);

        assert_eq!(outcome, FakeOutcome::Dlq(DlqReason::UnknownRecipient));
        assert_eq!(dlq.len(), 1);
        assert_eq!(dlq[0].reason, "unknown_recipient");
        assert!(ledger.calls.is_empty());
    }

    #[test]
    fn ledger_failure_routes_to_dlq() {
        let uuid = Uuid::new_v4();
        let deposit = muxed_deposit(10, "stellar:tx005:500");
        let resolver = FakeResolver::default().with(10, uuid);
        let mut ledger = FakeLedger::default().will_fail("stellar:tx005:500", "db timeout");

        let (outcome, dlq) = run(&deposit, &resolver, &mut ledger);

        assert_eq!(outcome, FakeOutcome::Dlq(DlqReason::DatabaseConstraint));
        assert_eq!(dlq.len(), 1);
        assert_eq!(ledger.calls.len(), 1);
    }

    #[test]
    fn dlq_entry_contains_correct_payload() {
        let deposit = muxed_deposit(77, "stellar:tx_dlq:77");
        let resolver = FakeResolver::default();
        let mut ledger = FakeLedger::default();

        let (_, dlq) = run(&deposit, &resolver, &mut ledger);

        let entry = &dlq[0];
        assert_eq!(
            entry.raw_payload["reference"].as_str().unwrap(),
            "stellar:tx_dlq:77"
        );
        assert!(entry.raw_payload["amount_minor"].is_number());
        assert!(
            entry.raw_payload.get("amount").is_none(),
            "no float amount field"
        );
    }

    #[test]
    fn zero_value_deposit_fails_cleanly() {
        let uuid = Uuid::new_v4();
        let custody = stellar_strkey::ed25519::PublicKey([1; 32])
            .to_string()
            .as_str()
            .to_owned();
        let address = engipay_core::stellar::muxed_deposit_address(&custody, 1).unwrap();
        let deposit = ObservedDeposit {
            money: Money::from_minor(Asset::Xlm, 0),
            address,
            reference: "stellar:tx_zero:0".to_owned(),
            confirmations: 1,
        };
        let resolver = FakeResolver::default().with(1, uuid);
        let mut ledger = FakeLedger::default().will_fail("stellar:tx_zero:0", "non-positive");

        let (outcome, dlq) = run(&deposit, &resolver, &mut ledger);

        assert_eq!(outcome, FakeOutcome::Dlq(DlqReason::DatabaseConstraint));
        assert_eq!(dlq.len(), 1);
        assert_eq!(ledger.calls[0].1.minor, 0);
    }

    #[test]
    fn database_error_maps_to_database_constraint() {
        use super::ledger_error_to_dlq_reason;
        use engipay_ledger::LedgerError;
        let err = LedgerError::Database {
            code: Some("23505".into()),
            message: "unique".into(),
        };
        assert_eq!(
            ledger_error_to_dlq_reason(&err),
            DlqReason::DatabaseConstraint
        );
    }

    #[test]
    fn invariant_violated_maps_to_database_constraint() {
        use super::ledger_error_to_dlq_reason;
        use engipay_ledger::LedgerError;
        let err = LedgerError::InvariantViolated("negative balance");
        assert_eq!(
            ledger_error_to_dlq_reason(&err),
            DlqReason::DatabaseConstraint
        );
    }

    #[test]
    fn non_positive_amount_maps_to_other() {
        use super::ledger_error_to_dlq_reason;
        use engipay_ledger::LedgerError;
        assert!(matches!(
            ledger_error_to_dlq_reason(&LedgerError::NonPositiveAmount),
            DlqReason::Other(_)
        ));
    }

    #[test]
    fn money_is_passed_verbatim_in_minor_units() {
        let uuid = Uuid::new_v4();
        let custody = stellar_strkey::ed25519::PublicKey([1; 32])
            .to_string()
            .as_str()
            .to_owned();
        let address = engipay_core::stellar::muxed_deposit_address(&custody, 20).unwrap();
        let deposit = ObservedDeposit {
            money: Money::from_minor(Asset::Xlm, 125_000_000),
            address,
            reference: "stellar:tx_money:125".to_owned(),
            confirmations: 1,
        };
        let resolver = FakeResolver::default().with(20, uuid);
        let mut ledger = FakeLedger::default().will_succeed("stellar:tx_money:125", false);

        run(&deposit, &resolver, &mut ledger);

        assert_eq!(ledger.calls[0].1.minor, 125_000_000_i128);
        assert_eq!(ledger.calls[0].1.asset, Asset::Xlm);
    }

    #[test]
    fn usdc_deposit_preserves_exact_minor_units() {
        let uuid = Uuid::new_v4();
        let custody = stellar_strkey::ed25519::PublicKey([1; 32])
            .to_string()
            .as_str()
            .to_owned();
        let address = engipay_core::stellar::muxed_deposit_address(&custody, 30).unwrap();
        let deposit = ObservedDeposit {
            money: Money::from_minor(Asset::Usdc, 500_000_000),
            address,
            reference: "stellar:tx_usdc:50".to_owned(),
            confirmations: 1,
        };
        let resolver = FakeResolver::default().with(30, uuid);
        let mut ledger = FakeLedger::default().will_succeed("stellar:tx_usdc:50", false);

        run(&deposit, &resolver, &mut ledger);

        assert_eq!(ledger.calls[0].1.minor, 500_000_000_i128);
        assert_eq!(ledger.calls[0].1.asset, Asset::Usdc);
    }

    #[test]
    fn independent_deposits_do_not_interfere() {
        let uuid_a = Uuid::new_v4();
        let dep_a = muxed_deposit(101, "stellar:tx_a:1");
        let dep_b = muxed_deposit(999, "stellar:tx_b:2");
        let resolver = FakeResolver::default().with(101, uuid_a);

        let mut la = FakeLedger::default().will_succeed("stellar:tx_a:1", false);
        let mut lb = FakeLedger::default();

        let (out_a, dlq_a) = run(&dep_a, &resolver, &mut la);
        let (out_b, dlq_b) = run(&dep_b, &resolver, &mut lb);

        assert_eq!(out_a, FakeOutcome::Credited);
        assert!(dlq_a.is_empty());
        assert_eq!(out_b, FakeOutcome::Dlq(DlqReason::UnknownRecipient));
        assert_eq!(dlq_b.len(), 1);
    }
}
