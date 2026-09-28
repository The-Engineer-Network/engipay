//! Global ledger integrity verification.
//!
//! Because every ledger transaction is double-entry, every posting that debits
//! one account by *n* must be offset by one or more postings that credit other
//! accounts by exactly *n* for the same asset. The net sum across **all**
//! postings for any given asset must therefore be zero.
//!
//! Two public functions are provided:
//!
//! * [`verify_global_ledger_integrity`] — asserts the global zero-sum per asset.
//! * [`calculate_total_user_liabilities`] — returns the total amount owed to all
//!   users per asset, and verifies it equals the negation of all system-account
//!   balances.
//!
//! Both are the database-backed mirrors of the corresponding checks that
//! [`crate::Ledger::verify`] runs in memory.

use std::collections::HashMap;
use std::fmt;

use engipay_core::Asset;
use sqlx::{FromRow, PgPool};

use crate::LedgerError;

/// An asset whose postings do not sum to zero across the entire ledger.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetImbalance {
    /// The asset symbol as stored in the database (e.g. `"USDC"`, `"ETH"`).
    pub asset: String,
}

impl fmt::Display for AssetImbalance {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "asset {} does not balance to zero", self.asset)
    }
}

/// Returned when [`verify_global_ledger_integrity`] fails.
///
/// Either the database was unreachable, or one or more assets have a non-zero
/// global posting sum — meaning money was created or destroyed, which is a
/// ledger bug.
#[derive(Debug, thiserror::Error)]
pub enum InvariantError {
    /// The database query itself failed. The ledger's health cannot be
    /// determined.
    #[error("integrity check query failed: {0}")]
    Database(#[from] sqlx::Error),

    /// One or more assets have postings that do not sum to zero globally.
    #[error("global ledger invariant violated: {}", format_imbalances(imbalances))]
    Imbalanced {
        /// Each entry names one asset that failed the zero-sum check.
        imbalances: Vec<AssetImbalance>,
    },
}

fn format_imbalances(imbalances: &[AssetImbalance]) -> String {
    imbalances
        .iter()
        .map(|i| i.asset.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

/// One row from the imbalance query: an asset whose global posting sum ≠ 0.
#[derive(Debug, FromRow)]
struct ImbalancedRow {
    asset: String,
}

/// Verifies that every asset in `ledger_postings` sums to zero globally.
///
/// Runs:
/// ```sql
/// SELECT asset
/// FROM   ledger_postings
/// GROUP  BY asset
/// HAVING SUM(amount) <> 0
/// ORDER  BY asset
/// ```
/// and returns `Ok(())` if no rows are returned — i.e. every asset balances.
/// Returns [`InvariantError::Imbalanced`] listing every imbalanced asset when
/// the invariant is broken, or [`InvariantError::Database`] if the query
/// itself could not execute.
///
/// # Why this must always be zero
///
/// Every ledger transaction is double-entry: for each asset the sum of all
/// its postings within a single transaction is exactly zero (a credit of +n
/// is always paired with a debit of −n).  Because the global sum is the sum
/// of per-transaction sums, and every per-transaction sum is zero, the global
/// sum must also be zero.  Any deviation means money was either minted or
/// destroyed, which is a ledger bug.
pub async fn verify_global_ledger_integrity(pool: &PgPool) -> Result<(), InvariantError> {
    // We only need to know *which* assets are imbalanced, not by how much,
    // because any non-zero total is equally wrong.  HAVING in the database
    // avoids transferring balanced rows over the wire and keeps the result set
    // small even when the ledger holds billions of postings.
    let imbalanced = sqlx::query_as::<_, ImbalancedRow>(
        "SELECT asset \
         FROM   ledger_postings \
         GROUP  BY asset \
         HAVING SUM(amount) <> 0 \
         ORDER  BY asset",
    )
    .fetch_all(pool)
    .await?;

    if imbalanced.is_empty() {
        return Ok(());
    }

    Err(InvariantError::Imbalanced {
        imbalances: imbalanced
            .into_iter()
            .map(|row| AssetImbalance { asset: row.asset })
            .collect(),
    })
}
/// One row from the split-sum query used by [`calculate_total_user_liabilities`].
///
/// Both columns are `NUMERIC(78,0)` aggregates which sqlx cannot decode without
/// an optional bigdecimal feature.  We cast to `TEXT` in the query and parse to
/// `i128` in Rust, which is safe because the column constraint forbids values
/// that would overflow a 78-digit integer.
#[derive(Debug, FromRow)]
struct LiabilityRow {
    asset: String,
    /// Sum of all user-side postings for this asset, as a decimal string.
    /// Always non-NULL because the WHERE clause restricts to rows that have at
    /// least one posting.
    user_total_text: String,
    /// Sum of all system-side postings for this asset, as a decimal string.
    /// May be NULL if a given asset has no system postings (impossible in a
    /// sound ledger but handled defensively).
    system_total_text: Option<String>,
}

/// Calculates the total amount EngiPay owes to all users, grouped by asset.
///
/// Runs a single query that separates user and system postings in one pass:
///
/// ```sql
/// SELECT
///     asset,
///     SUM(amount) FILTER (WHERE owner_kind = 'user')   ::text AS user_total_text,
///     SUM(amount) FILTER (WHERE owner_kind = 'system') ::text AS system_total_text
/// FROM ledger_postings
/// GROUP BY asset
/// HAVING SUM(amount) FILTER (WHERE owner_kind = 'user') IS NOT NULL
/// ```
///
/// For each asset it then asserts the accounting identity:
///
/// ```text
/// user_liabilities == -(system_total)
/// ```
///
/// This holds because the global zero-sum means
/// `user_total + system_total = 0`, so `user_total = -system_total`.
///
/// # Errors
///
/// * [`LedgerError::DatabaseError`] if the query fails.
/// * [`LedgerError::InvariantViolated`] if user liabilities don't match the
///   negation of system balances (indicating a bug in the ledger logic).
/// * [`LedgerError::Overflow`] if any aggregate exceeds `i128::MAX` (this
///   would require an astronomically large ledger).
pub async fn calculate_total_user_liabilities(
    pool: &PgPool,
) -> Result<HashMap<Asset, i128>, LedgerError> {
    // A single pass over ledger_postings splits user and system sums by asset.
    // Both aggregates are cast to TEXT so sqlx does not need the bigdecimal
    // feature to decode NUMERIC(78,0).
    let rows = sqlx::query_as::<_, LiabilityRow>(
        "SELECT \
             asset, \
             SUM(amount) FILTER (WHERE owner_kind = 'user')   ::text AS user_total_text, \
             SUM(amount) FILTER (WHERE owner_kind = 'system') ::text AS system_total_text \
         FROM ledger_postings \
         GROUP BY asset \
         HAVING SUM(amount) FILTER (WHERE owner_kind = 'user') IS NOT NULL \
         ORDER BY asset",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| LedgerError::DatabaseError(e.to_string()))?;

    let mut liabilities: HashMap<Asset, i128> = HashMap::new();

    for row in rows {
        // Parse the asset symbol. Unknown symbols are skipped defensively —
        // the DB CHECK constraint should prevent them, but we don't panic on
        // data we didn't write.
        let asset: Asset = match row.asset.parse() {
            Ok(a) => a,
            Err(_) => continue,
        };

        let user_total = parse_amount(&row.user_total_text)?;

        // Verify the identity: user_total must equal the negation of the
        // system total for this asset.
        let system_total = match &row.system_total_text {
            Some(s) => parse_amount(s)?,
            // No system postings for this asset: system total is 0.
            // user_total must also be 0 for the ledger to balance.
            None => 0_i128,
        };

        let expected = system_total.checked_neg().ok_or(LedgerError::Overflow)?;
        if user_total != expected {
            return Err(LedgerError::InvariantViolated(
                "user liabilities do not equal the negation of system balances",
            ));
        }

        if user_total != 0 {
            liabilities.insert(asset, user_total);
        }
    }

    Ok(liabilities)
}

/// Parses a `NUMERIC(78,0)` value that was `::text`-cast in Postgres.
///
/// Postgres always emits these as plain decimal strings (optionally with a
/// leading `-` for negatives), never in scientific notation, so a direct
/// `i128::from_str` works.
fn parse_amount(text: &str) -> Result<i128, LedgerError> {
    text.trim()
        .parse::<i128>()
        .map_err(|_| LedgerError::Overflow)
}

/// Computes total user liabilities per asset directly from an in-memory
/// [`crate::Ledger`], using the same logic as [`calculate_total_user_liabilities`]
/// but without a database round-trip.
///
/// Used in unit tests to verify the identity without a live Postgres pool.
/// Returns a map of `asset → total minor units owed to all users`.
pub fn user_liabilities_from_ledger(ledger: &crate::Ledger) -> HashMap<Asset, i128> {
    let mut totals: HashMap<Asset, i128> = HashMap::new();
    for tx in ledger.transactions() {
        for p in &tx.postings {
            if matches!(p.account.owner, crate::Owner::User(_)) {
                let entry = totals.entry(p.account.asset).or_insert(0);
                // Saturating is fine in tests; overflow would be caught by
                // LedgerError::Overflow in the real code path.
                *entry = entry.saturating_add(p.amount);
            }
        }
    }
    // Drop zero-balance assets, matching the DB query's HAVING clause.
    totals.retain(|_, v| *v != 0);
    totals
}

/// Returns the negation of the sum of all system-account balances per asset,
/// also derived from an in-memory [`crate::Ledger`].
///
/// By the global zero-sum identity this must equal [`user_liabilities_from_ledger`]
/// for every asset.  Used in tests to verify both sides of the equation.
pub fn system_negation_from_ledger(ledger: &crate::Ledger) -> HashMap<Asset, i128> {
    let mut totals: HashMap<Asset, i128> = HashMap::new();
    for tx in ledger.transactions() {
        for p in &tx.postings {
            if matches!(p.account.owner, crate::Owner::System(_)) {
                let entry = totals.entry(p.account.asset).or_insert(0);
                *entry = entry.saturating_add(p.amount);
            }
        }
    }
    // Negate: user_liabilities = -system_total
    for v in totals.values_mut() {
        *v = v.wrapping_neg();
    }
    totals.retain(|_, v| *v != 0);
    totals
}


#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use super::*;
    use crate::Ledger;
    use engipay_core::{Asset, Money, UserId};

    // -----------------------------------------------------------------------
    // In-memory invariant tests
    //
    // These run without a real database by verifying the same mathematical
    // property — global zero-sum per asset — through the in-memory `Ledger`
    // type.  They exercise the invariant that `verify_global_ledger_integrity`
    // enforces in Postgres.
    //
    // Each test computes the same aggregate that the database query computes:
    //
    //   SELECT asset, SUM(amount) FROM ledger_postings GROUP BY asset;
    //
    // and asserts that every asset sums to zero.
    // -----------------------------------------------------------------------

    /// Computes the global sum for `asset` across all postings in `ledger`,
    /// mirroring `SELECT SUM(amount) FROM ledger_postings WHERE asset = $1`.
    fn global_sum(ledger: &Ledger, asset: Asset) -> i128 {
        ledger
            .transactions()
            .iter()
            .flat_map(|tx| tx.postings.iter())
            .filter(|p| p.account.asset == asset)
            .map(|p| p.amount)
            .sum()
    }

    /// Asserts the global zero-sum invariant for every supported asset.
    fn assert_global_integrity(ledger: &Ledger) {
        for asset in Asset::ALL {
            assert_eq!(
                global_sum(ledger, asset),
                0,
                "global sum for {asset} is non-zero — verify_global_ledger_integrity would fail"
            );
        }
    }

    fn usdc(minor: i128) -> Money {
        Money::from_minor(Asset::Usdc, minor)
    }

    fn btc(minor: i128) -> Money {
        Money::from_minor(Asset::Btc, minor)
    }

    #[test]
    fn empty_ledger_satisfies_global_integrity() {
        let ledger = Ledger::new();
        assert_global_integrity(&ledger);
    }

    #[test]
    fn deposit_satisfies_global_integrity() {
        let alice = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(alice, usdc(1_000_000), "dep-1").unwrap();

        // user credit (+1_000_000) is exactly offset by ExternalInflow debit (−1_000_000)
        assert_global_integrity(&ledger);
    }

    #[test]
    fn multiple_deposits_and_transfers_satisfy_global_integrity() {
        let (alice, bob, carol) = (UserId::new(), UserId::new(), UserId::new());
        let mut ledger = Ledger::new();

        ledger.deposit(alice, usdc(500), "dep-alice").unwrap();
        ledger.deposit(bob, usdc(300), "dep-bob").unwrap();
        ledger.deposit(carol, usdc(200), "dep-carol").unwrap();

        ledger.transfer(alice, bob, usdc(100), "tx-1").unwrap();
        ledger.transfer(bob, carol, usdc(50), "tx-2").unwrap();
        ledger.transfer(carol, alice, usdc(25), "tx-3").unwrap();

        assert_global_integrity(&ledger);
        ledger.verify().unwrap();
    }

    #[test]
    fn hold_satisfies_global_integrity() {
        let alice = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(alice, usdc(400), "dep-1").unwrap();
        ledger.hold(alice, usdc(150), "hold-1").unwrap();

        // Hold moves money between buckets of the same user; the global sum
        // across all accounts must still be zero.
        assert_global_integrity(&ledger);
        ledger.verify().unwrap();
    }

    #[test]
    fn release_satisfies_global_integrity() {
        let alice = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(alice, usdc(400), "dep-1").unwrap();
        ledger.hold(alice, usdc(150), "hold-1").unwrap();
        ledger.release("hold-1").unwrap();

        assert_global_integrity(&ledger);
        ledger.verify().unwrap();
    }

    #[test]
    fn settle_with_fee_satisfies_global_integrity() {
        let alice = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(alice, usdc(200), "dep-1").unwrap();
        ledger.hold(alice, usdc(100), "hold-1").unwrap();
        ledger.settle("hold-1", Some(usdc(5))).unwrap();

        // Held amount: −100 from user.held
        // ExternalOutflow: +95 (net payout)
        // Fees: +5
        // Total: −100 + 95 + 5 = 0  ✓
        assert_global_integrity(&ledger);
        ledger.verify().unwrap();
    }

    #[test]
    fn settle_without_fee_satisfies_global_integrity() {
        let alice = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(alice, usdc(200), "dep-1").unwrap();
        ledger.hold(alice, usdc(200), "hold-1").unwrap();
        ledger.settle("hold-1", None).unwrap();

        assert_global_integrity(&ledger);
        ledger.verify().unwrap();
    }

    #[test]
    fn multiple_assets_each_independently_satisfy_global_integrity() {
        let alice = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(alice, usdc(1_000), "dep-usdc").unwrap();
        ledger
            .deposit(alice, btc(50_000_000), "dep-btc")
            .unwrap(); // 0.5 BTC in sats

        // Each asset is independently balanced.
        assert_eq!(global_sum(&ledger, Asset::Usdc), 0);
        assert_eq!(global_sum(&ledger, Asset::Btc), 0);
        assert_eq!(global_sum(&ledger, Asset::Eth), 0);

        assert_global_integrity(&ledger);
        ledger.verify().unwrap();
    }

    #[test]
    fn invariant_error_imbalanced_display_lists_all_assets() {
        let err = InvariantError::Imbalanced {
            imbalances: vec![
                AssetImbalance {
                    asset: "BTC".to_owned(),
                },
                AssetImbalance {
                    asset: "USDC".to_owned(),
                },
            ],
        };
        let msg = err.to_string();
        assert!(
            msg.contains("BTC"),
            "error message must name the imbalanced asset BTC"
        );
        assert!(
            msg.contains("USDC"),
            "error message must name the imbalanced asset USDC"
        );
    }

    #[test]
    fn asset_imbalance_display() {
        let imbalance = AssetImbalance {
            asset: "ETH".to_owned(),
        };
        assert_eq!(imbalance.to_string(), "asset ETH does not balance to zero");
    }

    /// Property-style test: runs 400 mixed operations and asserts the global
    /// zero-sum holds after every single one.  This directly mirrors what
    /// `verify_global_ledger_integrity` would confirm in the database.
    #[test]
    fn global_integrity_holds_through_a_long_sequence() {
        let users: Vec<UserId> = (0..4).map(|_| UserId::new()).collect();
        let mut ledger = Ledger::new();
        // Simple deterministic LCG for reproducible sequences.
        let mut seed: u64 = 0x5eed_7ec0_u64;
        let mut next = move || {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (seed >> 33) as usize
        };
        let mut open_holds: Vec<String> = Vec::new();

        for step in 0..400_usize {
            let a = users[next() % users.len()];
            let b = users[next() % users.len()];
            let amount = usdc((next() % 300) as i128 + 1);
            let reference = format!("rec-{step}");

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

            // The core invariant: the global sum for USDC is zero after every
            // operation — exactly what verify_global_ledger_integrity asserts.
            assert_eq!(
                global_sum(&ledger, Asset::Usdc),
                0,
                "global USDC sum is non-zero at step {step}"
            );
        }

        ledger.verify().unwrap();
    }

    // -----------------------------------------------------------------------
    // User liability tests
    //
    // These verify `calculate_total_user_liabilities` semantics using the
    // in-memory helpers `user_liabilities_from_ledger` and
    // `system_negation_from_ledger`, exercising the same identity the async
    // DB-backed function checks.
    //
    // Identity: user_liabilities(asset) == -(ExternalInflow + ExternalOutflow + Fees)(asset)
    //
    // Because global_sum = 0 = user_total + system_total for every asset,
    // user_total = -system_total at all times.
    // -----------------------------------------------------------------------

    /// Helper: asserts user liabilities equal the negation of system balances.
    fn assert_liability_identity(ledger: &Ledger) {
        let liabilities = user_liabilities_from_ledger(ledger);
        let system_neg = system_negation_from_ledger(ledger);
        assert_eq!(
            liabilities, system_neg,
            "user liabilities do not equal the negation of system balances"
        );
    }

    #[test]
    fn empty_ledger_has_zero_liabilities() {
        let ledger = Ledger::new();
        assert!(
            user_liabilities_from_ledger(&ledger).is_empty(),
            "empty ledger should have no liabilities"
        );
        assert_liability_identity(&ledger);
    }

    #[test]
    fn single_deposit_liability_equals_deposit_amount() {
        let alice = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(alice, usdc(500), "dep-1").unwrap();

        let liabilities = user_liabilities_from_ledger(&ledger);
        assert_eq!(liabilities[&Asset::Usdc], 500, "liability must equal deposit");
        assert_liability_identity(&ledger);
    }

    #[test]
    fn transfer_does_not_change_total_liabilities() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = Ledger::new();
        ledger.deposit(alice, usdc(200), "dep-1").unwrap();

        let before = user_liabilities_from_ledger(&ledger);
        ledger.transfer(alice, bob, usdc(75), "tx-1").unwrap();
        let after = user_liabilities_from_ledger(&ledger);

        // A peer transfer moves money between users but does not change total
        // owed: the sum across all users is unchanged.
        assert_eq!(
            before, after,
            "peer transfer must not change total user liabilities"
        );
        assert_liability_identity(&ledger);
    }

    #[test]
    fn hold_does_not_change_total_liabilities() {
        let alice = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(alice, usdc(300), "dep-1").unwrap();

        let before = user_liabilities_from_ledger(&ledger);
        ledger.hold(alice, usdc(100), "hold-1").unwrap();
        let after = user_liabilities_from_ledger(&ledger);

        // Hold moves between buckets of the same user: total liability unchanged.
        assert_eq!(
            before, after,
            "hold must not change total user liabilities"
        );
        assert_liability_identity(&ledger);
    }

    #[test]
    fn release_does_not_change_total_liabilities() {
        let alice = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(alice, usdc(300), "dep-1").unwrap();
        ledger.hold(alice, usdc(100), "hold-1").unwrap();

        let before = user_liabilities_from_ledger(&ledger);
        ledger.release("hold-1").unwrap();
        let after = user_liabilities_from_ledger(&ledger);

        assert_eq!(
            before, after,
            "release must not change total user liabilities"
        );
        assert_liability_identity(&ledger);
    }

    #[test]
    fn settle_reduces_liabilities_by_the_full_hold_amount() {
        let alice = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(alice, usdc(500), "dep-1").unwrap();
        ledger.hold(alice, usdc(200), "hold-1").unwrap();
        ledger.settle("hold-1", None).unwrap();

        let liabilities = user_liabilities_from_ledger(&ledger);
        // 500 deposited, 200 settled out → 300 still owed to Alice.
        assert_eq!(liabilities[&Asset::Usdc], 300);
        assert_liability_identity(&ledger);
    }

    #[test]
    fn settle_with_fee_reduces_liabilities_correctly() {
        let alice = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(alice, usdc(500), "dep-1").unwrap();
        ledger.hold(alice, usdc(200), "hold-1").unwrap();
        // Settle 200 out; fee 10 stays with EngiPay.
        // The full 200 leaves user custody regardless of the fee split.
        ledger.settle("hold-1", Some(usdc(10))).unwrap();

        let liabilities = user_liabilities_from_ledger(&ledger);
        assert_eq!(liabilities[&Asset::Usdc], 300);
        assert_liability_identity(&ledger);
    }

    /// The canonical scenario from the issue: several deposits and withdrawals,
    /// confirming that net liabilities match system balances exactly at each step.
    #[test]
    fn deposits_and_withdrawals_liabilities_match_system_balances() {
        let (alice, bob) = (UserId::new(), UserId::new());
        let mut ledger = Ledger::new();

        // ── Step 1: two deposits ────────────────────────────────────────────
        ledger.deposit(alice, usdc(1_000), "dep-alice").unwrap();
        ledger.deposit(bob, usdc(600), "dep-bob").unwrap();

        // Total owed: 1_000 + 600 = 1_600 USDC
        // ExternalInflow balance: −1_600 (it went negative as money entered)
        {
            let liabilities = user_liabilities_from_ledger(&ledger);
            assert_eq!(liabilities[&Asset::Usdc], 1_600);
            assert_liability_identity(&ledger);
        }

        // ── Step 2: Alice withdraws 400 (hold then settle, fee 5) ──────────
        ledger.hold(alice, usdc(400), "wd-alice-1").unwrap();
        ledger.settle("wd-alice-1", Some(usdc(5))).unwrap();

        // Alice: 1_000 − 400 = 600 remaining
        // Bob:   600
        // Total owed: 1_200
        // System: ExternalInflow −1_600 | ExternalOutflow +395 | Fees +5 = −1_200 → negation = 1_200 ✓
        {
            let liabilities = user_liabilities_from_ledger(&ledger);
            assert_eq!(liabilities[&Asset::Usdc], 1_200);
            assert_liability_identity(&ledger);
            ledger.verify().unwrap();
        }

        // ── Step 3: Bob transfers 200 to Alice (liability total unchanged) ──
        ledger.transfer(bob, alice, usdc(200), "tx-1").unwrap();

        {
            let liabilities = user_liabilities_from_ledger(&ledger);
            assert_eq!(
                liabilities[&Asset::Usdc],
                1_200,
                "peer transfer must not change total liabilities"
            );
            assert_liability_identity(&ledger);
        }

        // ── Step 4: Alice withdraws 300 (hold then release — no outflow) ───
        ledger.hold(alice, usdc(300), "wd-alice-2").unwrap();
        ledger.release("wd-alice-2").unwrap();

        // Cancelled withdrawal: liabilities unchanged at 1_200
        {
            let liabilities = user_liabilities_from_ledger(&ledger);
            assert_eq!(
                liabilities[&Asset::Usdc],
                1_200,
                "released hold must not change total liabilities"
            );
            assert_liability_identity(&ledger);
        }

        // ── Step 5: Bob withdraws his remaining 400 (no fee) ───────────────
        ledger.hold(bob, usdc(400), "wd-bob-1").unwrap();
        ledger.settle("wd-bob-1", None).unwrap();

        // Bob: 600 − 200 (sent to Alice) − 400 (settled) = 0
        // Alice: 600 + 200 (received) = 800
        // Total owed: 800
        {
            let liabilities = user_liabilities_from_ledger(&ledger);
            assert_eq!(liabilities[&Asset::Usdc], 800);
            assert_liability_identity(&ledger);
            ledger.verify().unwrap();
        }

        // ── Final: verify individual balances match the aggregate ───────────
        let alice_bal = ledger.balance(alice, Asset::Usdc);
        let bob_bal = ledger.balance(bob, Asset::Usdc);
        assert_eq!(
            alice_bal.available + alice_bal.held + bob_bal.available + bob_bal.held,
            user_liabilities_from_ledger(&ledger)[&Asset::Usdc],
            "sum of individual balances must equal the aggregate user liability"
        );
    }

    #[test]
    fn multi_asset_liabilities_are_independent() {
        let alice = UserId::new();
        let mut ledger = Ledger::new();
        ledger.deposit(alice, usdc(1_000), "dep-usdc").unwrap();
        ledger.deposit(alice, btc(5_000_000), "dep-btc").unwrap();

        let liabilities = user_liabilities_from_ledger(&ledger);
        assert_eq!(liabilities[&Asset::Usdc], 1_000);
        assert_eq!(liabilities[&Asset::Btc], 5_000_000);
        assert!(!liabilities.contains_key(&Asset::Eth));

        assert_liability_identity(&ledger);
        ledger.verify().unwrap();
    }

    #[test]
    fn parse_amount_handles_positive_and_negative_strings() {
        assert_eq!(parse_amount("0").unwrap(), 0_i128);
        assert_eq!(parse_amount("42").unwrap(), 42_i128);
        assert_eq!(parse_amount("-100").unwrap(), -100_i128);
        assert_eq!(parse_amount("  99  ").unwrap(), 99_i128);
        assert!(parse_amount("not_a_number").is_err());
        assert!(parse_amount("1.5").is_err());
    }
}
