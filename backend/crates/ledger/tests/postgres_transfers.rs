//! Integration tests for internal transfers between user accounts.
//!
//! A transfer moves spendable money from one user's `available` bucket to
//! another user's `available` bucket instantly, with no network fee.  It
//! touches exactly two accounts and both must update symmetrically — a debit
//! of *n* on the sender is always paired with a credit of *n* on the
//! recipient for the same asset.
//!
//! # Test structure
//!
//! **DB-backed tests** (`#[sqlx::test]`) seed funds via raw SQL, execute a
//! transfer via raw SQL, then read balances back from the `account_balances`
//! view.  They confirm:
//!
//! * The sender's balance decreases by exactly the transferred amount.
//! * The recipient's balance increases by exactly the transferred amount.
//! * Failure cases leave both balances completely unchanged.
//! * The global zero-sum invariant (`verify_global_ledger_integrity`) holds
//!   after every operation.
//!
//! **In-memory tests** (`#[test]`) use the `Ledger` struct directly and cover
//! the full error-path matrix, idempotency, cross-asset isolation, and
//! multi-hop chains without requiring a live database.
//!
//! # "Non-existent recipient" at the DB level
//! The `ledger_postings.user_id` column is a foreign key to `users.id`.
//! Attempting to credit a user UUID that has never been inserted into `users`
//! will produce a FK violation and roll the whole transaction back, leaving
//! the sender's balance unchanged.  This is tested in
//! [`transfer_to_nonexistent_recipient_rejected_by_fk_constraint`].

#![allow(clippy::unwrap_used)]
#![allow(clippy::arithmetic_side_effects)]

use engipay_ledger::reconciliation::verify_global_ledger_integrity;
use sqlx::PgPool;
use uuid::Uuid;

// ── Shared seeding helpers ───────────────────────────────────────────────────
//
// These mirror the helpers in postgres_deposits.rs; they are duplicated here
// so each integration test file is self-contained and can be read without
// cross-referencing another file.

/// Seeds one deposit directly into Postgres inside a single DB transaction.
///
/// Inserts the `users` row (idempotent), the `ledger_transactions` row, and
/// the two `ledger_postings` rows (system debit + user credit).  The deferred
/// balance trigger is satisfied because both postings land before COMMIT.
async fn seed_deposit(
    pool: &PgPool,
    user_id: Uuid,
    asset_symbol: &str,
    amount_minor: i64,
    reference: &str,
) {
    assert!(amount_minor > 0, "seed_deposit: amount must be positive");

    let tx_id = Uuid::new_v4();
    let request_json = format!(
        r#"{{"Deposit":{{"user":"{user_id}","asset":"{asset_symbol}","amount":{amount_minor}}}}}"#
    );

    let mut dbtx = pool.begin().await.unwrap();

    sqlx::query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(user_id)
        .execute(&mut *dbtx)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO ledger_transactions (id, kind, reference, request) \
         VALUES ($1, 'deposit', $2, $3)",
    )
    .bind(tx_id)
    .bind(reference)
    .bind(&request_json)
    .execute(&mut *dbtx)
    .await
    .unwrap();

    // System debit (ExternalInflow).
    sqlx::query(
        "INSERT INTO ledger_postings \
             (transaction_id, owner_kind, system_account, asset, bucket, amount) \
         VALUES ($1, 'system', 'external_inflow', $2, 'available', ($3::bigint * -1)::numeric)",
    )
    .bind(tx_id)
    .bind(asset_symbol)
    .bind(amount_minor)
    .execute(&mut *dbtx)
    .await
    .unwrap();

    // User credit.
    sqlx::query(
        "INSERT INTO ledger_postings \
             (transaction_id, owner_kind, user_id, asset, bucket, amount) \
         VALUES ($1, 'user', $2, $3, 'available', $4::numeric)",
    )
    .bind(tx_id)
    .bind(user_id)
    .bind(asset_symbol)
    .bind(amount_minor)
    .execute(&mut *dbtx)
    .await
    .unwrap();

    dbtx.commit().await.unwrap();
}

/// Seeds one transfer directly into Postgres inside a single DB transaction.
///
/// Inserts the `ledger_transactions` row and the two `ledger_postings` rows
/// (sender debit + recipient credit).  Both `from_id` and `to_id` must
/// already exist in `users`.
///
/// Returns `Ok(())` on success, or propagates the underlying `sqlx::Error`
/// on failure (e.g. FK violation when `to_id` is not in `users`, or the
/// deferred negative-balance trigger firing at COMMIT).
async fn seed_transfer(
    pool: &PgPool,
    from_id: Uuid,
    to_id: Uuid,
    asset_symbol: &str,
    amount_minor: i64,
    reference: &str,
) -> Result<(), sqlx::Error> {
    assert!(amount_minor > 0, "seed_transfer: amount must be positive");

    let tx_id = Uuid::new_v4();
    let request_json = format!(
        r#"{{"Transfer":{{"from":"{from_id}","to":"{to_id}","asset":"{asset_symbol}","amount":{amount_minor}}}}}"#
    );

    let mut dbtx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO ledger_transactions (id, kind, reference, request) \
         VALUES ($1, 'transfer', $2, $3)",
    )
    .bind(tx_id)
    .bind(reference)
    .bind(&request_json)
    .execute(&mut *dbtx)
    .await?;

    // Sender debit.
    sqlx::query(
        "INSERT INTO ledger_postings \
             (transaction_id, owner_kind, user_id, asset, bucket, amount) \
         VALUES ($1, 'user', $2, $3, 'available', ($4::bigint * -1)::numeric)",
    )
    .bind(tx_id)
    .bind(from_id)
    .bind(asset_symbol)
    .bind(amount_minor)
    .execute(&mut *dbtx)
    .await?;

    // Recipient credit.
    sqlx::query(
        "INSERT INTO ledger_postings \
             (transaction_id, owner_kind, user_id, asset, bucket, amount) \
         VALUES ($1, 'user', $2, $3, 'available', $4::numeric)",
    )
    .bind(tx_id)
    .bind(to_id)
    .bind(asset_symbol)
    .bind(amount_minor)
    .execute(&mut *dbtx)
    .await?;

    dbtx.commit().await
}

/// Reads one user's `available` balance for `asset_symbol` from the
/// `account_balances` view.  Returns `0` when no posting exists.
async fn read_user_balance(pool: &PgPool, user_id: Uuid, asset_symbol: &str) -> i64 {
    let row: Option<(Option<i64>,)> = sqlx::query_as(
        "SELECT amount::bigint \
         FROM account_balances \
         WHERE owner_kind = 'user' \
           AND user_id     = $1 \
           AND asset       = $2 \
           AND bucket      = 'available'",
    )
    .bind(user_id)
    .bind(asset_symbol)
    .fetch_optional(pool)
    .await
    .unwrap();

    row.and_then(|(v,)| v).unwrap_or(0)
}

// ── DB-backed transfer tests ─────────────────────────────────────────────────

/// A successful USDC transfer debits the sender and credits the recipient by
/// exactly the transferred amount.
#[sqlx::test(migrations = "../../migrations")]
async fn successful_transfer_updates_both_balances_symmetrically(pool: PgPool) {
    let alice = Uuid::new_v4();
    let bob = Uuid::new_v4();

    // Fund Alice; register Bob so FK constraints are satisfied.
    seed_deposit(&pool, alice, "USDC", 1_000, "dep:alice:usdc").await;
    seed_deposit(&pool, bob, "USDC", 500, "dep:bob:usdc").await;

    seed_transfer(&pool, alice, bob, "USDC", 300, "tx:alice-bob:1")
        .await
        .expect("transfer must succeed");

    assert_eq!(
        read_user_balance(&pool, alice, "USDC").await,
        700,
        "sender balance must decrease by the transferred amount"
    );
    assert_eq!(
        read_user_balance(&pool, bob, "USDC").await,
        800,
        "recipient balance must increase by the transferred amount"
    );
}

/// A transfer of the sender's exact balance reduces the sender to zero and
/// credits the full amount to the recipient.
#[sqlx::test(migrations = "../../migrations")]
async fn transfer_of_exact_balance_clears_sender_to_zero(pool: PgPool) {
    let alice = Uuid::new_v4();
    let bob = Uuid::new_v4();

    seed_deposit(&pool, alice, "USDC", 250, "dep:alice:exact").await;
    seed_deposit(&pool, bob, "USDC", 1, "dep:bob:exact").await; // register Bob

    // Transfer Alice's entire balance.
    seed_transfer(&pool, alice, bob, "USDC", 250, "tx:exact")
        .await
        .expect("transfer of exact balance must succeed");

    assert_eq!(
        read_user_balance(&pool, alice, "USDC").await,
        0,
        "sender must reach zero after transferring their entire balance"
    );
    assert_eq!(read_user_balance(&pool, bob, "USDC").await, 251);
}

/// A partial transfer leaves the correct remainder in the sender and the
/// correct incremented balance in the recipient.
#[sqlx::test(migrations = "../../migrations")]
async fn partial_transfer_leaves_correct_remainder_in_sender(pool: PgPool) {
    let alice = Uuid::new_v4();
    let bob = Uuid::new_v4();

    seed_deposit(&pool, alice, "ETH", 1_000_000_000_000_000_000, "dep:alice:eth").await;
    seed_deposit(&pool, bob, "ETH", 1, "dep:bob:eth").await;

    // Transfer 1 wei — the smallest possible ETH unit.
    seed_transfer(&pool, alice, bob, "ETH", 1, "tx:eth:1wei")
        .await
        .expect("single-wei transfer must succeed");

    // Alice: 10^18 - 1
    assert_eq!(
        read_user_balance(&pool, alice, "ETH").await,
        999_999_999_999_999_999,
        "sender must have exactly one wei less"
    );
    // Bob: 1 + 1 = 2
    assert_eq!(
        read_user_balance(&pool, bob, "ETH").await,
        2,
        "recipient must have exactly one wei more"
    );
}

/// A transfer where the sender has insufficient funds is rejected by the
/// database's deferred negative-balance trigger.
///
/// The DB trigger (`ledger_postings_balanced`) fires at COMMIT and checks that
/// no user's running balance goes negative.  A transfer that would overdraw
/// the sender is therefore rolled back, leaving both balances unchanged.
#[sqlx::test(migrations = "../../migrations")]
async fn transfer_with_insufficient_funds_is_rejected_and_leaves_balances_unchanged(
    pool: PgPool,
) {
    let alice = Uuid::new_v4();
    let bob = Uuid::new_v4();

    seed_deposit(&pool, alice, "USDC", 100, "dep:alice:insuff").await;
    seed_deposit(&pool, bob, "USDC", 50, "dep:bob:insuff").await;

    let before_alice = read_user_balance(&pool, alice, "USDC").await;
    let before_bob = read_user_balance(&pool, bob, "USDC").await;

    // Attempt to transfer more than Alice has.
    let result = seed_transfer(&pool, alice, bob, "USDC", 101, "tx:overdraft").await;
    assert!(
        result.is_err(),
        "overdraft transfer must be rejected by the DB constraint"
    );

    // Both balances must be completely unchanged.
    assert_eq!(
        read_user_balance(&pool, alice, "USDC").await,
        before_alice,
        "sender balance must not change after a failed transfer"
    );
    assert_eq!(
        read_user_balance(&pool, bob, "USDC").await,
        before_bob,
        "recipient balance must not change after a failed transfer"
    );
}

/// A transfer where the sender has zero balance is rejected.
#[sqlx::test(migrations = "../../migrations")]
async fn transfer_from_unfunded_sender_is_rejected(pool: PgPool) {
    let alice = Uuid::new_v4();
    let bob = Uuid::new_v4();

    // Register both users but only fund Bob.
    seed_deposit(&pool, alice, "USDC", 1, "dep:alice:zero-fund").await;
    seed_deposit(&pool, bob, "USDC", 100, "dep:bob:zero-fund").await;

    // Alice sends back her 1 unit, leaving her at zero.
    seed_transfer(&pool, alice, bob, "USDC", 1, "tx:drain-alice")
        .await
        .expect("initial drain must succeed");
    assert_eq!(read_user_balance(&pool, alice, "USDC").await, 0);

    let before_bob = read_user_balance(&pool, bob, "USDC").await;

    // Now Alice has nothing; this transfer must fail.
    let result = seed_transfer(&pool, alice, bob, "USDC", 1, "tx:zero-sender").await;
    assert!(
        result.is_err(),
        "transfer from zero-balance sender must be rejected"
    );

    assert_eq!(
        read_user_balance(&pool, alice, "USDC").await,
        0,
        "zero-balance sender must remain at zero after failed transfer"
    );
    assert_eq!(
        read_user_balance(&pool, bob, "USDC").await,
        before_bob,
        "recipient balance must not change after a failed transfer"
    );
}

/// A transfer to a non-existent recipient is rejected by the foreign-key
/// constraint on `ledger_postings.user_id`.
///
/// `ledger_postings.user_id` references `users.id`.  Inserting a posting for
/// a UUID that does not appear in `users` produces a FK violation and rolls
/// the entire transaction back, leaving the sender's balance intact.
#[sqlx::test(migrations = "../../migrations")]
async fn transfer_to_nonexistent_recipient_rejected_by_fk_constraint(pool: PgPool) {
    let alice = Uuid::new_v4();
    // Carol is never inserted into `users`.
    let carol = Uuid::new_v4();

    seed_deposit(&pool, alice, "USDC", 500, "dep:alice:fk").await;
    let before_alice = read_user_balance(&pool, alice, "USDC").await;

    let result = seed_transfer(&pool, alice, carol, "USDC", 100, "tx:to-ghost").await;
    assert!(
        result.is_err(),
        "transfer to a non-existent user must fail with a FK violation"
    );

    // Alice's balance must be completely unchanged.
    assert_eq!(
        read_user_balance(&pool, alice, "USDC").await,
        before_alice,
        "sender balance must not change when the recipient does not exist"
    );
    // Carol has no balance row at all.
    assert_eq!(
        read_user_balance(&pool, carol, "USDC").await,
        0,
        "non-existent recipient must have no balance after a failed transfer"
    );
}

/// A BTC transfer preserves USDC balances and vice-versa — transfers are
/// strictly asset-scoped.
#[sqlx::test(migrations = "../../migrations")]
async fn transfer_does_not_affect_other_asset_balances(pool: PgPool) {
    let alice = Uuid::new_v4();
    let bob = Uuid::new_v4();

    seed_deposit(&pool, alice, "BTC", 100_000_000, "dep:alice:btc").await;
    seed_deposit(&pool, alice, "USDC", 5_000, "dep:alice:usdc").await;
    seed_deposit(&pool, bob, "BTC", 1, "dep:bob:btc").await;

    seed_transfer(&pool, alice, bob, "BTC", 50_000_000, "tx:btc:half")
        .await
        .expect("BTC transfer must succeed");

    // BTC balances updated correctly.
    assert_eq!(read_user_balance(&pool, alice, "BTC").await, 50_000_000);
    assert_eq!(read_user_balance(&pool, bob, "BTC").await, 50_000_001);

    // USDC balance on Alice must be completely unaffected.
    assert_eq!(
        read_user_balance(&pool, alice, "USDC").await,
        5_000,
        "USDC balance must not be altered by a BTC transfer"
    );
}

/// After a transfer `verify_global_ledger_integrity` must still report that
/// every asset's postings sum to zero.
///
/// A transfer is a pure rearrangement: it debits one user and credits another
/// by the same amount, leaving the global sum unchanged at zero.
#[sqlx::test(migrations = "../../migrations")]
async fn transfer_preserves_global_ledger_integrity(pool: PgPool) {
    let alice = Uuid::new_v4();
    let bob = Uuid::new_v4();

    seed_deposit(&pool, alice, "USDC", 1_000, "dep:alice:int").await;
    seed_deposit(&pool, bob, "USDC", 1, "dep:bob:int").await;

    seed_transfer(&pool, alice, bob, "USDC", 400, "tx:integrity")
        .await
        .expect("transfer must succeed");

    verify_global_ledger_integrity(&pool)
        .await
        .expect("global zero-sum must hold after a transfer");
}

/// Multiple sequential transfers accumulate correctly at each step.
#[sqlx::test(migrations = "../../migrations")]
async fn sequential_transfers_accumulate_correctly(pool: PgPool) {
    let alice = Uuid::new_v4();
    let bob = Uuid::new_v4();
    let carol = Uuid::new_v4();

    seed_deposit(&pool, alice, "USDC", 1_000, "dep:seq:alice").await;
    seed_deposit(&pool, bob, "USDC", 1, "dep:seq:bob").await;
    seed_deposit(&pool, carol, "USDC", 1, "dep:seq:carol").await;

    // Alice → Bob: 300
    seed_transfer(&pool, alice, bob, "USDC", 300, "tx:seq:1")
        .await
        .expect("first transfer must succeed");

    // Alice → Carol: 200
    seed_transfer(&pool, alice, carol, "USDC", 200, "tx:seq:2")
        .await
        .expect("second transfer must succeed");

    // Bob → Carol: 100 (Bob pays Carol out of the money Alice sent)
    seed_transfer(&pool, bob, carol, "USDC", 100, "tx:seq:3")
        .await
        .expect("third transfer must succeed");

    // Alice: 1000 - 300 - 200 = 500
    assert_eq!(read_user_balance(&pool, alice, "USDC").await, 500);
    // Bob:   1 + 300 - 100 = 201
    assert_eq!(read_user_balance(&pool, bob, "USDC").await, 201);
    // Carol: 1 + 200 + 100 = 301
    assert_eq!(read_user_balance(&pool, carol, "USDC").await, 301);

    verify_global_ledger_integrity(&pool)
        .await
        .expect("global zero-sum must hold after sequential transfers");
}

// ── In-memory transfer tests ─────────────────────────────────────────────────
//
// These use the in-memory `Ledger` directly and cover the full error-path
// matrix, idempotency, cross-asset isolation, and multi-hop chains.  They run
// without a live database and are therefore fast and always available in CI
// even when no Postgres instance is configured.

mod in_memory_transfers {
    use engipay_core::{Asset, Money, UserId};
    use engipay_ledger::{Balance, Ledger, LedgerError, SystemAccount};

    // ── Helper ───────────────────────────────────────────────────────────

    /// Returns a `Ledger` with `user` pre-funded with `amount` USDC.
    fn funded_ledger(user: UserId, amount: i128) -> Ledger {
        let mut ledger = Ledger::new();
        ledger
            .deposit(user, Money::from_minor(Asset::Usdc, amount), "seed")
            .unwrap();
        ledger
    }

    fn usdc(minor: i128) -> Money {
        Money::from_minor(Asset::Usdc, minor)
    }

    // ── Successful transfer paths ────────────────────────────────────────

    /// A transfer credits the recipient and debits the sender by exactly the
    /// same amount.
    #[test]
    fn successful_transfer_is_symmetric() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = funded_ledger(alice, 1_000);

        ledger.transfer(alice, bob, usdc(300), "pay-1").unwrap();

        assert_eq!(
            ledger.balance(alice, Asset::Usdc),
            Balance {
                asset: Asset::Usdc,
                available: 700,
                held: 0,
            },
            "sender must be debited by exactly the transferred amount"
        );
        assert_eq!(
            ledger.balance(bob, Asset::Usdc),
            Balance {
                asset: Asset::Usdc,
                available: 300,
                held: 0,
            },
            "recipient must be credited by exactly the transferred amount"
        );
        ledger.verify().unwrap();
    }

    /// Transferring the sender's exact balance reduces them to zero.
    #[test]
    fn transfer_of_exact_balance_reduces_sender_to_zero() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = funded_ledger(alice, 500);

        ledger.transfer(alice, bob, usdc(500), "pay-exact").unwrap();

        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 0);
        assert_eq!(ledger.balance(bob, Asset::Usdc).available, 500);
        ledger.verify().unwrap();
    }

    /// A partial transfer leaves the correct remainder.
    #[test]
    fn partial_transfer_leaves_correct_remainder() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = funded_ledger(alice, 1_000);

        ledger.transfer(alice, bob, usdc(1), "pay-1wei").unwrap();

        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 999);
        assert_eq!(ledger.balance(bob, Asset::Usdc).available, 1);
        ledger.verify().unwrap();
    }

    // ── Error paths — no balance alteration ─────────────────────────────

    /// A transfer that would overdraw the sender is refused.  Neither balance
    /// must change.
    #[test]
    fn insufficient_funds_leaves_both_balances_unchanged() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = funded_ledger(alice, 100);
        // Give Bob some balance so we can assert it didn't change either.
        ledger.deposit(bob, usdc(50), "seed-bob").unwrap();

        let result = ledger.transfer(alice, bob, usdc(101), "pay-overdraft");

        assert!(
            matches!(result, Err(LedgerError::InsufficientFunds { .. })),
            "overdraft must return InsufficientFunds"
        );
        assert_eq!(
            ledger.balance(alice, Asset::Usdc).available,
            100,
            "sender balance must not change after a failed transfer"
        );
        assert_eq!(
            ledger.balance(bob, Asset::Usdc).available,
            50,
            "recipient balance must not change after a failed transfer"
        );
        ledger.verify().unwrap();
    }

    /// Transferring from a zero-balance account is refused.
    #[test]
    fn transfer_from_zero_balance_returns_insufficient_funds() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = Ledger::new();
        // Alice has no funds; Bob is pre-funded so we can assert nothing moved.
        ledger.deposit(bob, usdc(100), "seed-bob").unwrap();

        let result = ledger.transfer(alice, bob, usdc(1), "pay-zero");

        assert_eq!(result, Err(LedgerError::InsufficientFunds {
            available: Money::from_minor(Asset::Usdc, 0),
            requested: usdc(1),
        }));
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 0);
        assert_eq!(ledger.balance(bob, Asset::Usdc).available, 100);
    }

    /// Attempting to transfer to the same account returns `SameAccount`.
    /// The balance must not change.
    #[test]
    fn transfer_to_same_account_returns_same_account_error() {
        let alice = UserId::new();
        let mut ledger = funded_ledger(alice, 200);

        let result = ledger.transfer(alice, alice, usdc(50), "pay-self");

        assert_eq!(result, Err(LedgerError::SameAccount));
        assert_eq!(
            ledger.balance(alice, Asset::Usdc).available,
            200,
            "self-transfer must not alter the balance"
        );
        ledger.verify().unwrap();
    }

    /// A zero-amount transfer returns `NonPositiveAmount`.
    #[test]
    fn transfer_of_zero_amount_returns_non_positive_amount() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = funded_ledger(alice, 100);

        assert_eq!(
            ledger.transfer(alice, bob, usdc(0), "pay-zero-amt"),
            Err(LedgerError::NonPositiveAmount),
        );
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 100);
        assert_eq!(ledger.balance(bob, Asset::Usdc).available, 0);
    }

    /// A negative-amount transfer returns `NonPositiveAmount`.
    #[test]
    fn transfer_of_negative_amount_returns_non_positive_amount() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = funded_ledger(alice, 100);

        assert_eq!(
            ledger.transfer(alice, bob, usdc(-1), "pay-neg"),
            Err(LedgerError::NonPositiveAmount),
        );
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 100);
    }

    /// An empty reference string returns `EmptyReference`.
    #[test]
    fn transfer_with_empty_reference_returns_empty_reference_error() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = funded_ledger(alice, 100);

        assert_eq!(
            ledger.transfer(alice, bob, usdc(10), ""),
            Err(LedgerError::EmptyReference),
        );
        // Balance unchanged.
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 100);
        assert_eq!(ledger.balance(bob, Asset::Usdc).available, 0);
    }

    /// A whitespace-only reference string also returns `EmptyReference`.
    #[test]
    fn transfer_with_whitespace_reference_returns_empty_reference_error() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = funded_ledger(alice, 100);

        assert_eq!(
            ledger.transfer(alice, bob, usdc(10), "   "),
            Err(LedgerError::EmptyReference),
        );
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 100);
    }

    // ── Idempotency ──────────────────────────────────────────────────────

    /// Replaying a transfer with the same reference and same request returns
    /// `replayed = true` and moves no money a second time.
    #[test]
    fn replaying_a_transfer_is_idempotent() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = funded_ledger(alice, 500);

        let first = ledger.transfer(alice, bob, usdc(100), "pay-idm").unwrap();
        let second = ledger.transfer(alice, bob, usdc(100), "pay-idm").unwrap();

        assert!(!first.replayed, "first call must not be a replay");
        assert!(second.replayed, "second call with same reference must be a replay");
        assert_eq!(
            first.transaction_id, second.transaction_id,
            "replayed call must return the original transaction id"
        );

        // Only one transfer took place.
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 400);
        assert_eq!(ledger.balance(bob, Asset::Usdc).available, 100);
        assert_eq!(ledger.transactions().len(), 2); // deposit + 1 transfer
        ledger.verify().unwrap();
    }

    /// Reusing a reference for a different request returns
    /// `IdempotencyConflict` and moves no money.
    #[test]
    fn conflicting_reference_returns_idempotency_conflict() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let carol = UserId::new();
        let mut ledger = funded_ledger(alice, 500);
        ledger.deposit(bob, usdc(100), "seed-bob").unwrap();

        ledger.transfer(alice, bob, usdc(100), "ref-1").unwrap();

        // Same reference, different recipient.
        let result = ledger.transfer(alice, carol, usdc(100), "ref-1");
        assert_eq!(
            result,
            Err(LedgerError::IdempotencyConflict {
                reference: "ref-1".into()
            }),
        );

        // Balances reflect only the original transfer.
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 400);
        assert_eq!(ledger.balance(bob, Asset::Usdc).available, 200);
        assert_eq!(ledger.balance(carol, Asset::Usdc).available, 0);
    }

    // ── Cross-asset isolation ────────────────────────────────────────────

    /// A USDC transfer must not alter either user's BTC or ETH balances.
    #[test]
    fn transfer_does_not_affect_other_asset_balances() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = Ledger::new();

        // Fund Alice with multiple assets.
        ledger
            .deposit(alice, usdc(1_000), "dep:usdc")
            .unwrap();
        ledger
            .deposit(alice, Money::from_minor(Asset::Btc, 200_000_000), "dep:btc")
            .unwrap();
        ledger
            .deposit(alice, Money::from_minor(Asset::Eth, 2_000_000_000_000_000_000), "dep:eth")
            .unwrap();

        ledger.transfer(alice, bob, usdc(400), "pay-usdc").unwrap();

        // USDC updated.
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 600);
        assert_eq!(ledger.balance(bob, Asset::Usdc).available, 400);

        // BTC and ETH on Alice must be untouched.
        assert_eq!(
            ledger.balance(alice, Asset::Btc).available,
            200_000_000,
            "BTC balance must not be affected by a USDC transfer"
        );
        assert_eq!(
            ledger.balance(alice, Asset::Eth).available,
            2_000_000_000_000_000_000,
            "ETH balance must not be affected by a USDC transfer"
        );
        // Bob has no BTC or ETH.
        assert_eq!(ledger.balance(bob, Asset::Btc).available, 0);
        assert_eq!(ledger.balance(bob, Asset::Eth).available, 0);

        ledger.verify().unwrap();
    }

    // ── Multi-hop chain ──────────────────────────────────────────────────

    /// Money flowing A → B → C leaves each intermediate balance correct and
    /// the global sum at zero throughout.
    #[test]
    fn multi_hop_chain_preserves_total_supply() {
        let (alice, bob, carol) = (UserId::new(), UserId::new(), UserId::new());
        let mut ledger = funded_ledger(alice, 1_000);

        ledger.transfer(alice, bob, usdc(600), "pay-ab").unwrap();
        ledger.verify().unwrap();

        ledger.transfer(bob, carol, usdc(400), "pay-bc").unwrap();
        ledger.verify().unwrap();

        // Alice: 1000 - 600 = 400
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 400);
        // Bob:   600 - 400 = 200
        assert_eq!(ledger.balance(bob, Asset::Usdc).available, 200);
        // Carol: 400
        assert_eq!(ledger.balance(carol, Asset::Usdc).available, 400);

        // Total across all user accounts must equal the original deposit.
        let total: i128 = [alice, bob, carol]
            .iter()
            .map(|u| ledger.balance(*u, Asset::Usdc).available)
            .sum();
        assert_eq!(total, 1_000, "total supply must be conserved across all hops");

        // The only money source is ExternalInflow — it must equal the negative
        // of the total user supply.
        assert_eq!(
            ledger.system_balance(SystemAccount::ExternalInflow, Asset::Usdc),
            -1_000,
        );
        ledger.verify().unwrap();
    }

    /// A full round-trip: Alice funds herself, transfers to Bob, Bob transfers
    /// back, and the system returns to the original state.
    #[test]
    fn round_trip_transfer_restores_original_balances() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = funded_ledger(alice, 800);

        ledger.transfer(alice, bob, usdc(800), "pay-ab").unwrap();
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 0);
        assert_eq!(ledger.balance(bob, Asset::Usdc).available, 800);

        ledger.transfer(bob, alice, usdc(800), "pay-ba").unwrap();
        assert_eq!(ledger.balance(alice, Asset::Usdc).available, 800);
        assert_eq!(ledger.balance(bob, Asset::Usdc).available, 0);

        ledger.verify().unwrap();
    }

    /// The `verify()` invariant check passes after every combination of valid
    /// transfers, confirming no double-entry rules are violated.
    #[test]
    fn verify_passes_after_many_transfers() {
        let users: Vec<UserId> = (0..4).map(|_| UserId::new()).collect();
        let mut ledger = Ledger::new();

        // Seed each user.
        for (i, &u) in users.iter().enumerate() {
            ledger
                .deposit(u, usdc(1_000), &format!("seed-{i}"))
                .unwrap();
        }

        // Round-robin transfers.
        let pairs = [(0, 1), (1, 2), (2, 3), (3, 0), (0, 2), (1, 3)];
        for (step, (from_idx, to_idx)) in pairs.iter().enumerate() {
            ledger
                .transfer(
                    users[*from_idx],
                    users[*to_idx],
                    usdc(100),
                    &format!("rr-{step}"),
                )
                .unwrap();
            ledger.verify().unwrap();
        }
    }
}
