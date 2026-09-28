//! Integration tests for deposit precision across all supported assets.
//!
//! Each asset has a different decimal precision:
//!
//! | Asset | Ledger decimals | Smallest unit     | Example min deposit     |
//! |-------|----------------|-------------------|-------------------------|
//! | ETH   | 18             | 1 wei             | `1` minor unit          |
//! | USDC  | 7              | 0.0000001 USDC    | `1` minor unit          |
//! | BTC   | 8              | 1 satoshi         | `1` minor unit          |
//! | XLM   | 7              | 0.0000001 XLM     | `1` minor unit (in-mem) |
//!
//! Amounts are stored as `NUMERIC(78,0)` in Postgres — a 78-digit exact
//! integer — so there is no rounding at any precision.  These tests verify
//! that the full round-trip (insert → read back via reconciliation queries)
//! preserves exact integer values.
//!
//! # XLM note
//! The current `ledger_postings` schema constrains `asset` to
//! `('ETH', 'USDC', 'BTC')`, so XLM cannot yet be stored in the database.
//! XLM precision is covered by the in-memory tests at the bottom of this
//! file, which exercise the same arithmetic path without a DB round-trip.
//!
//! # How the DB tests work
//! Each `#[sqlx::test]` receives a freshly-migrated `PgPool`.  We seed a
//! deposit directly via raw SQL (no `PostgresLedgerStore` exists yet) using
//! the same double-entry structure the application will eventually write:
//!
//! * One `users` row.
//! * One `ledger_transactions` row (`kind = 'deposit'`).
//! * Two `ledger_postings` rows inside a single transaction so the deferred
//!   balance trigger passes at COMMIT:
//!     - `owner_kind = 'system'`, `system_account = 'external_inflow'`, `amount = -n`
//!     - `owner_kind = 'user'`, `amount = +n`

// The workspace lint `unwrap_used = "warn"` is suppressed here: integration
// test helpers use `.unwrap()` intentionally so that a DB error produces an
// immediate panic with a clear message rather than a silent wrong result.
#![allow(clippy::unwrap_used)]
// Literal arithmetic in assert arguments is intentional and bounded.
#![allow(clippy::arithmetic_side_effects)]

use engipay_core::Asset;
use engipay_ledger::reconciliation::{
    calculate_total_user_liabilities, verify_global_ledger_integrity,
};
use sqlx::PgPool;
use uuid::Uuid;

// ── Seeding helpers ──────────────────────────────────────────────────────────

/// Seeds one deposit directly into Postgres, bypassing the application layer.
///
/// Inserts the `users` row, the `ledger_transactions` row, and both
/// `ledger_postings` rows inside a single transaction so the deferred
/// balance trigger is satisfied at COMMIT.
///
/// `amount_minor` must be positive — it is the credit to the user's available
/// balance.  The matching system debit (`-amount_minor` on `external_inflow`)
/// is written automatically.
async fn seed_deposit(
    pool: &PgPool,
    user_id: Uuid,
    asset_symbol: &str,
    amount_minor: i64,
    reference: &str,
) {
    assert!(amount_minor > 0, "seed_deposit requires a positive amount");

    let tx_id = Uuid::new_v4();
    // A compact JSON fingerprint.  The DB only needs any non-empty string; the
    // format matches what the in-memory Ledger would eventually persist.
    let request_json = format!(
        r#"{{"Deposit":{{"user":"{user_id}","asset":"{asset_symbol}","amount":{amount_minor}}}}}"#
    );

    let mut dbtx = pool.begin().await.unwrap();

    // 1. Upsert the user (multiple deposits to the same user are safe to retry).
    sqlx::query(
        "INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .execute(&mut *dbtx)
    .await
    .unwrap();

    // 2. The ledger transaction row.
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

    // 3a. System debit: ExternalInflow goes negative as money enters.
    //     We cast the i64 to NUMERIC in SQL; production code that needs
    //     uint256-scale values would supply a NUMERIC literal directly.
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

    // 3b. User credit: available bucket.
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

/// Reads the user's `available` balance for `asset_symbol` from the
/// `account_balances` view, returning the raw `NUMERIC(78,0)` cast to `i64`.
///
/// Returns `0` when no posting exists for this (user, asset, bucket) tuple,
/// mirroring the Ledger's in-memory behaviour of defaulting absent keys to 0.
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

// ── DB-backed precision tests ────────────────────────────────────────────────

/// Deposits the smallest possible ETH unit (1 wei) and verifies it is stored
/// and read back without any rounding.
///
/// ETH uses 18 decimal places: 1 wei = 0.000000000000000001 ETH.
/// A `FLOAT8` column would lose this immediately; `NUMERIC(78,0)` keeps it.
#[sqlx::test(migrations = "../../migrations")]
async fn eth_minimum_unit_one_wei_stored_exactly(pool: PgPool) {
    let user_id = Uuid::new_v4();
    seed_deposit(&pool, user_id, "ETH", 1, "eth:min:1wei").await;

    let balance = read_user_balance(&pool, user_id, "ETH").await;
    assert_eq!(balance, 1, "1 wei must be stored as the integer 1, not rounded");
}

/// Deposits 1 ETH (= 10^18 wei) and verifies the full round-trip.
///
/// 10^18 fits in `i64` (`i64::MAX ≈ 9.2 × 10^18`), but multi-ETH amounts
/// would need the full NUMERIC range; this test confirms the base case.
#[sqlx::test(migrations = "../../migrations")]
async fn eth_one_full_unit_equals_one_quintillion_wei(pool: PgPool) {
    let user_id = Uuid::new_v4();
    let one_eth_in_wei: i64 = 1_000_000_000_000_000_000;
    seed_deposit(&pool, user_id, "ETH", one_eth_in_wei, "eth:1eth").await;

    let balance = read_user_balance(&pool, user_id, "ETH").await;
    assert_eq!(
        balance, one_eth_in_wei,
        "1 ETH expressed in wei must survive the DB round-trip exactly"
    );
}

/// Deposits 0.5 ETH (= 5 × 10^17 wei).
#[sqlx::test(migrations = "../../migrations")]
async fn eth_half_unit_stored_exactly(pool: PgPool) {
    let user_id = Uuid::new_v4();
    let half_eth: i64 = 500_000_000_000_000_000;
    seed_deposit(&pool, user_id, "ETH", half_eth, "eth:0.5eth").await;

    let balance = read_user_balance(&pool, user_id, "ETH").await;
    assert_eq!(balance, half_eth);
}

/// Deposits the smallest possible USDC unit (1 = 0.0000001 USDC at 7 decimals)
/// and verifies no rounding occurs.
///
/// USDC uses 7 ledger decimals (finest across Base-6 and Stellar-7).
#[sqlx::test(migrations = "../../migrations")]
async fn usdc_minimum_unit_one_tenth_microusdc_stored_exactly(pool: PgPool) {
    let user_id = Uuid::new_v4();
    seed_deposit(&pool, user_id, "USDC", 1, "usdc:min:1unit").await;

    let balance = read_user_balance(&pool, user_id, "USDC").await;
    assert_eq!(balance, 1, "smallest USDC unit must be stored as the integer 1");
}

/// Deposits exactly 1.0 USDC (= 10_000_000 minor units at 7 decimals).
#[sqlx::test(migrations = "../../migrations")]
async fn usdc_one_full_unit_equals_ten_million_minor_units(pool: PgPool) {
    let user_id = Uuid::new_v4();
    let one_usdc: i64 = 10_000_000;
    seed_deposit(&pool, user_id, "USDC", one_usdc, "usdc:1usdc").await;

    let balance = read_user_balance(&pool, user_id, "USDC").await;
    assert_eq!(balance, one_usdc);
}

/// A Base-USDC deposit uses 6 decimal places; the ledger stores at 7.
///
/// 1.000001 USDC on Base = 1_000_001 Base units.  At ledger precision the
/// same amount is 10_000_010 minor units (the 7th decimal is implicitly 0).
/// No rounding occurs because no precision is lost — only a trailing zero is
/// added.
#[sqlx::test(migrations = "../../migrations")]
async fn usdc_base_six_decimal_amount_stored_at_ledger_seven_decimal_precision(pool: PgPool) {
    let user_id = Uuid::new_v4();
    // 1.000001 USDC on Base = 10_000_010 ledger minor units
    let amount: i64 = 10_000_010;
    seed_deposit(&pool, user_id, "USDC", amount, "usdc:base-6dp").await;

    let balance = read_user_balance(&pool, user_id, "USDC").await;
    assert_eq!(balance, amount);
}

/// Deposits the smallest possible BTC unit (1 satoshi = 0.00000001 BTC).
///
/// BTC uses 8 decimal places.  This also checks that a BTC deposit does not
/// contaminate the USDC balance for the same user.
#[sqlx::test(migrations = "../../migrations")]
async fn btc_minimum_unit_one_satoshi_stored_exactly(pool: PgPool) {
    let user_id = Uuid::new_v4();
    seed_deposit(&pool, user_id, "BTC", 1, "btc:min:1sat").await;

    // BTC and USDC are independent: no USDC row should exist.
    let usdc_balance = read_user_balance(&pool, user_id, "USDC").await;
    assert_eq!(usdc_balance, 0, "BTC deposit must not affect USDC balance");

    let btc_balance = read_user_balance(&pool, user_id, "BTC").await;
    assert_eq!(btc_balance, 1, "1 satoshi must be stored as the integer 1");
}

/// Deposits 1.0 BTC (= 100_000_000 satoshis).
#[sqlx::test(migrations = "../../migrations")]
async fn btc_one_full_unit_equals_one_hundred_million_satoshis(pool: PgPool) {
    let user_id = Uuid::new_v4();
    let one_btc: i64 = 100_000_000;
    seed_deposit(&pool, user_id, "BTC", one_btc, "btc:1btc").await;

    let balance = read_user_balance(&pool, user_id, "BTC").await;
    assert_eq!(balance, one_btc);
}

/// Deposits the BTC supply cap (21 million BTC expressed in satoshis).
///
/// 21_000_000 × 10^8 = 2_100_000_000_000_000 satoshis — well within `i64`,
/// and a realistic upper bound for a custody ledger.
#[sqlx::test(migrations = "../../migrations")]
async fn btc_supply_cap_in_satoshis_stored_exactly(pool: PgPool) {
    let user_id = Uuid::new_v4();
    let supply_cap_sats: i64 = 2_100_000_000_000_000;
    seed_deposit(&pool, user_id, "BTC", supply_cap_sats, "btc:supply-cap").await;

    let balance = read_user_balance(&pool, user_id, "BTC").await;
    assert_eq!(balance, supply_cap_sats);
}

/// Sequential deposits to the same user accumulate exactly.
///
/// Verifies that the `account_balances` view (`SUM` over `ledger_postings`)
/// aggregates without loss when multiple small-unit amounts are combined.
#[sqlx::test(migrations = "../../migrations")]
async fn multiple_deposits_accumulate_exactly(pool: PgPool) {
    let user_id = Uuid::new_v4();
    seed_deposit(&pool, user_id, "USDC", 1, "usdc:acc:1").await;
    seed_deposit(&pool, user_id, "USDC", 3, "usdc:acc:2").await;
    seed_deposit(&pool, user_id, "USDC", 999_999, "usdc:acc:3").await;

    let balance = read_user_balance(&pool, user_id, "USDC").await;
    // 1 + 3 + 999_999 = 1_000_003
    assert_eq!(balance, 1_000_003);
}

/// Deposits to different users are strictly isolated from each other.
#[sqlx::test(migrations = "../../migrations")]
async fn deposits_to_different_users_are_isolated(pool: PgPool) {
    let alice = Uuid::new_v4();
    let bob = Uuid::new_v4();

    seed_deposit(&pool, alice, "ETH", 1_000_000_000_000_000_000, "eth:alice").await;
    seed_deposit(&pool, bob, "ETH", 7, "eth:bob").await;

    assert_eq!(
        read_user_balance(&pool, alice, "ETH").await,
        1_000_000_000_000_000_000,
    );
    assert_eq!(
        read_user_balance(&pool, bob, "ETH").await,
        7,
        "Bob's 7 wei must not be affected by Alice's deposit"
    );
}

/// After seeding deposits, `verify_global_ledger_integrity` must confirm
/// that every asset's postings sum to zero (the double-entry invariant holds).
#[sqlx::test(migrations = "../../migrations")]
async fn seeded_deposits_satisfy_global_integrity(pool: PgPool) {
    let user_id = Uuid::new_v4();

    seed_deposit(&pool, user_id, "ETH", 1, "eth:integrity:1").await;
    seed_deposit(&pool, user_id, "USDC", 10_000_000, "usdc:integrity:1").await;
    seed_deposit(&pool, user_id, "BTC", 100_000_000, "btc:integrity:1").await;

    verify_global_ledger_integrity(&pool)
        .await
        .expect("seeded deposits must satisfy the global zero-sum invariant");
}

/// `calculate_total_user_liabilities` must return the exact deposited amounts
/// and confirm they equal the negation of system balances.
#[sqlx::test(migrations = "../../migrations")]
async fn liabilities_equal_deposited_amounts(pool: PgPool) {
    let user_id = Uuid::new_v4();
    let usdc_amount: i64 = 12_345_678; // 1.2345678 USDC at 7 decimals
    let btc_amount: i64 = 777; // 777 satoshis

    seed_deposit(&pool, user_id, "USDC", usdc_amount, "usdc:liab:1").await;
    seed_deposit(&pool, user_id, "BTC", btc_amount, "btc:liab:1").await;

    let liabilities = calculate_total_user_liabilities(&pool)
        .await
        .expect("liability calculation must succeed");

    assert_eq!(
        liabilities.get(&Asset::Usdc).copied().unwrap_or(0),
        i128::from(usdc_amount),
        "USDC liability must equal the exact deposited minor-unit amount"
    );
    assert_eq!(
        liabilities.get(&Asset::Btc).copied().unwrap_or(0),
        i128::from(btc_amount),
        "BTC liability must equal the exact deposited minor-unit amount"
    );
}

/// Sub-unit USDC amounts (< 1 full token) must not round to zero.
///
/// A `FLOAT8` column would collapse 0.0000001 USDC (= 1 minor unit) to 0.
/// `NUMERIC(78,0)` preserves it exactly.
#[sqlx::test(migrations = "../../migrations")]
async fn sub_unit_usdc_deposit_does_not_round_to_zero(pool: PgPool) {
    let user_id = Uuid::new_v4();
    seed_deposit(&pool, user_id, "USDC", 1, "usdc:sub:1").await;

    let balance = read_user_balance(&pool, user_id, "USDC").await;
    assert_ne!(balance, 0, "sub-unit USDC must not round to zero");
    assert_eq!(balance, 1);
}

/// 1 satoshi (0.00000001 BTC) must survive the DB round-trip without rounding.
#[sqlx::test(migrations = "../../migrations")]
async fn sub_unit_btc_deposit_does_not_round_to_zero(pool: PgPool) {
    let user_id = Uuid::new_v4();
    seed_deposit(&pool, user_id, "BTC", 1, "btc:sub:1").await;

    let balance = read_user_balance(&pool, user_id, "BTC").await;
    assert_ne!(balance, 0, "1 satoshi must not round to zero");
    assert_eq!(balance, 1);
}

/// 1 wei (10^-18 ETH) must not be lost to rounding.
///
/// `FLOAT8` has ~15 significant decimal digits, so 1 wei relative to
/// 1 ETH (10^-18 relative magnitude) falls below that threshold and would be
/// lost.  `NUMERIC(78,0)` stores it as the plain integer `1`.
#[sqlx::test(migrations = "../../migrations")]
async fn sub_unit_eth_deposit_does_not_round_to_zero(pool: PgPool) {
    let user_id = Uuid::new_v4();
    seed_deposit(&pool, user_id, "ETH", 1, "eth:sub:1").await;

    let balance = read_user_balance(&pool, user_id, "ETH").await;
    assert_ne!(balance, 0, "1 wei must not round to zero");
    assert_eq!(balance, 1);
}

/// Deposits for different assets to the same user are strictly independent.
///
/// No cross-asset contamination may occur in the `account_balances` view.
#[sqlx::test(migrations = "../../migrations")]
async fn asset_balances_are_independent(pool: PgPool) {
    let user_id = Uuid::new_v4();

    seed_deposit(&pool, user_id, "ETH", 5, "eth:iso:1").await;
    seed_deposit(&pool, user_id, "USDC", 7, "usdc:iso:1").await;
    seed_deposit(&pool, user_id, "BTC", 3, "btc:iso:1").await;

    assert_eq!(read_user_balance(&pool, user_id, "ETH").await, 5);
    assert_eq!(read_user_balance(&pool, user_id, "USDC").await, 7);
    assert_eq!(read_user_balance(&pool, user_id, "BTC").await, 3);
}

// ── In-memory precision tests ────────────────────────────────────────────────
//
// XLM cannot be stored in the database yet (the ledger_postings CHECK
// constraint allows only 'ETH', 'USDC', 'BTC').  These tests exercise XLM
// and the full set of all four assets via the in-memory `Ledger`, which
// applies the same exact-integer arithmetic as the eventual Postgres-backed
// store will.  They complement rather than replace the DB tests above.

mod in_memory_precision {
    use engipay_core::{Asset, Money, UserId};
    use engipay_ledger::{Balance, Ledger, LedgerError, SystemAccount};

    fn deposit_one_unit(asset: Asset) -> (Ledger, UserId) {
        let user = UserId::new();
        let mut ledger = Ledger::new();
        ledger
            .deposit(user, Money::from_minor(asset, 1), "min:1")
            .unwrap();
        (ledger, user)
    }

    // ── Minimum-unit deposits ────────────────────────────────────────────

    #[test]
    fn one_wei_credited_as_integer_1() {
        let (ledger, user) = deposit_one_unit(Asset::Eth);
        assert_eq!(
            ledger.balance(user, Asset::Eth),
            Balance {
                asset: Asset::Eth,
                available: 1,
                held: 0,
            },
            "1 wei must credit available balance as the integer 1"
        );
        assert_eq!(
            ledger.system_balance(SystemAccount::ExternalInflow, Asset::Eth),
            -1,
            "ExternalInflow must be debited by exactly 1"
        );
        ledger.verify().unwrap();
    }

    #[test]
    fn one_usdc_minor_unit_credited_exactly() {
        // 1 minor unit = 0.0000001 USDC (7 decimal places)
        let (ledger, user) = deposit_one_unit(Asset::Usdc);
        assert_eq!(ledger.balance(user, Asset::Usdc).available, 1);
        assert_eq!(
            ledger.system_balance(SystemAccount::ExternalInflow, Asset::Usdc),
            -1
        );
        ledger.verify().unwrap();
    }

    #[test]
    fn one_satoshi_credited_exactly() {
        // 1 satoshi = 0.00000001 BTC (8 decimal places)
        let (ledger, user) = deposit_one_unit(Asset::Btc);
        assert_eq!(ledger.balance(user, Asset::Btc).available, 1);
        assert_eq!(
            ledger.system_balance(SystemAccount::ExternalInflow, Asset::Btc),
            -1
        );
        ledger.verify().unwrap();
    }

    #[test]
    fn one_xlm_minor_unit_credited_exactly() {
        // 1 minor unit = 0.0000001 XLM (7 decimal places, same as USDC on Stellar)
        let (ledger, user) = deposit_one_unit(Asset::Xlm);
        assert_eq!(ledger.balance(user, Asset::Xlm).available, 1);
        assert_eq!(
            ledger.system_balance(SystemAccount::ExternalInflow, Asset::Xlm),
            -1
        );
        ledger.verify().unwrap();
    }

    // ── Full-unit deposits ───────────────────────────────────────────────

    #[test]
    fn one_eth_equals_one_quintillion_wei() {
        // 1 ETH = 10^18 wei
        let one_eth = Money::from_minor(Asset::Eth, 1_000_000_000_000_000_000_i128);
        let user = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(user, one_eth, "eth:1eth").unwrap();
        assert_eq!(
            ledger.balance(user, Asset::Eth).available,
            1_000_000_000_000_000_000_i128
        );
        ledger.verify().unwrap();
    }

    #[test]
    fn one_usdc_equals_ten_million_minor_units() {
        // 1 USDC = 10^7 minor units
        let one_usdc = Money::from_minor(Asset::Usdc, 10_000_000);
        let user = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(user, one_usdc, "usdc:1usdc").unwrap();
        assert_eq!(ledger.balance(user, Asset::Usdc).available, 10_000_000);
        ledger.verify().unwrap();
    }

    #[test]
    fn one_btc_equals_one_hundred_million_satoshis() {
        // 1 BTC = 10^8 satoshis
        let one_btc = Money::from_minor(Asset::Btc, 100_000_000);
        let user = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(user, one_btc, "btc:1btc").unwrap();
        assert_eq!(ledger.balance(user, Asset::Btc).available, 100_000_000);
        ledger.verify().unwrap();
    }

    #[test]
    fn one_xlm_equals_ten_million_minor_units() {
        // 1 XLM = 10^7 minor units
        let one_xlm = Money::from_minor(Asset::Xlm, 10_000_000);
        let user = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(user, one_xlm, "xlm:1xlm").unwrap();
        assert_eq!(ledger.balance(user, Asset::Xlm).available, 10_000_000);
        ledger.verify().unwrap();
    }

    // ── Money::parse precision ───────────────────────────────────────────
    //
    // The human-amount parser must produce the correct minor-unit integer for
    // each asset's minimum representable amount.

    #[test]
    fn parse_minimum_eth_amount() {
        // "0.000000000000000001" ETH = 1 wei
        let m = Money::parse(Asset::Eth, "0.000000000000000001").unwrap();
        assert_eq!(m.minor, 1, "smallest ETH human amount must parse to 1 wei");
    }

    #[test]
    fn parse_minimum_usdc_amount() {
        // "0.0000001" USDC = 1 minor unit at 7 decimal places
        let m = Money::parse(Asset::Usdc, "0.0000001").unwrap();
        assert_eq!(m.minor, 1);
    }

    #[test]
    fn parse_minimum_btc_amount() {
        // "0.00000001" BTC = 1 satoshi
        let m = Money::parse(Asset::Btc, "0.00000001").unwrap();
        assert_eq!(m.minor, 1, "smallest BTC human amount must parse to 1 satoshi");
    }

    #[test]
    fn parse_minimum_xlm_amount() {
        // "0.0000001" XLM = 1 minor unit at 7 decimal places
        let m = Money::parse(Asset::Xlm, "0.0000001").unwrap();
        assert_eq!(m.minor, 1);
    }

    // ── Over-precision rejection ─────────────────────────────────────────
    //
    // Inputs with more decimal places than the asset supports must be
    // rejected rather than silently rounded.

    #[test]
    fn parse_rejects_too_many_decimal_places_for_eth() {
        // ETH supports 18 decimals; 19 places must be refused.
        let result = Money::parse(Asset::Eth, "0.0000000000000000001");
        assert!(
            result.is_err(),
            "ETH with 19 decimal places must be rejected, not silently rounded"
        );
    }

    #[test]
    fn parse_rejects_too_many_decimal_places_for_usdc() {
        // USDC supports 7 decimals; 8 places must be refused.
        let result = Money::parse(Asset::Usdc, "0.00000001");
        assert!(
            result.is_err(),
            "USDC with 8 decimal places must be rejected, not silently rounded"
        );
    }

    #[test]
    fn parse_rejects_too_many_decimal_places_for_btc() {
        // BTC supports 8 decimals; 9 places must be refused.
        let result = Money::parse(Asset::Btc, "0.000000001");
        assert!(
            result.is_err(),
            "BTC with 9 decimal places must be rejected, not silently rounded"
        );
    }

    #[test]
    fn parse_rejects_too_many_decimal_places_for_xlm() {
        // XLM supports 7 decimals; 8 places must be refused.
        let result = Money::parse(Asset::Xlm, "0.00000001");
        assert!(
            result.is_err(),
            "XLM with 8 decimal places must be rejected, not silently rounded"
        );
    }

    // ── NonPositiveAmount guard ──────────────────────────────────────────
    //
    // Depositing zero or a negative amount must return
    // `LedgerError::NonPositiveAmount` for every supported asset.

    #[test]
    fn deposit_zero_eth_returns_non_positive_amount() {
        let mut ledger = Ledger::new();
        let user = UserId::new();
        assert_eq!(
            ledger.deposit(user, Money::from_minor(Asset::Eth, 0), "eth:zero"),
            Err(LedgerError::NonPositiveAmount),
        );
    }

    #[test]
    fn deposit_negative_eth_returns_non_positive_amount() {
        let mut ledger = Ledger::new();
        let user = UserId::new();
        assert_eq!(
            ledger.deposit(user, Money::from_minor(Asset::Eth, -1), "eth:neg"),
            Err(LedgerError::NonPositiveAmount),
        );
    }

    #[test]
    fn deposit_zero_usdc_returns_non_positive_amount() {
        let mut ledger = Ledger::new();
        let user = UserId::new();
        assert_eq!(
            ledger.deposit(user, Money::from_minor(Asset::Usdc, 0), "usdc:zero"),
            Err(LedgerError::NonPositiveAmount),
        );
    }

    #[test]
    fn deposit_negative_usdc_returns_non_positive_amount() {
        let mut ledger = Ledger::new();
        let user = UserId::new();
        assert_eq!(
            ledger.deposit(user, Money::from_minor(Asset::Usdc, -1), "usdc:neg"),
            Err(LedgerError::NonPositiveAmount),
        );
    }

    #[test]
    fn deposit_zero_btc_returns_non_positive_amount() {
        let mut ledger = Ledger::new();
        let user = UserId::new();
        assert_eq!(
            ledger.deposit(user, Money::from_minor(Asset::Btc, 0), "btc:zero"),
            Err(LedgerError::NonPositiveAmount),
        );
    }

    #[test]
    fn deposit_negative_btc_returns_non_positive_amount() {
        let mut ledger = Ledger::new();
        let user = UserId::new();
        assert_eq!(
            ledger.deposit(user, Money::from_minor(Asset::Btc, -1), "btc:neg"),
            Err(LedgerError::NonPositiveAmount),
        );
    }

    #[test]
    fn deposit_zero_xlm_returns_non_positive_amount() {
        let mut ledger = Ledger::new();
        let user = UserId::new();
        assert_eq!(
            ledger.deposit(user, Money::from_minor(Asset::Xlm, 0), "xlm:zero"),
            Err(LedgerError::NonPositiveAmount),
        );
    }

    #[test]
    fn deposit_negative_xlm_returns_non_positive_amount() {
        let mut ledger = Ledger::new();
        let user = UserId::new();
        assert_eq!(
            ledger.deposit(user, Money::from_minor(Asset::Xlm, -1), "xlm:neg"),
            Err(LedgerError::NonPositiveAmount),
        );
    }

    // ── Cross-asset isolation ────────────────────────────────────────────

    /// All four assets carry independent balances; depositing 1 unit of each
    /// must not affect any other asset's balance.
    #[test]
    fn all_four_assets_balance_independently() {
        let user = UserId::new();
        let mut ledger = Ledger::new();

        ledger
            .deposit(user, Money::from_minor(Asset::Eth, 1), "eth:iso")
            .unwrap();
        ledger
            .deposit(user, Money::from_minor(Asset::Usdc, 1), "usdc:iso")
            .unwrap();
        ledger
            .deposit(user, Money::from_minor(Asset::Btc, 1), "btc:iso")
            .unwrap();
        ledger
            .deposit(user, Money::from_minor(Asset::Xlm, 1), "xlm:iso")
            .unwrap();

        for asset in Asset::ALL {
            assert_eq!(
                ledger.balance(user, asset).available,
                1,
                "after depositing 1 minor unit of {asset}, available balance must be 1"
            );
            assert_eq!(
                ledger.system_balance(SystemAccount::ExternalInflow, asset),
                -1,
                "ExternalInflow for {asset} must be -1 after one 1-unit deposit"
            );
        }

        ledger.verify().unwrap();
    }
}
