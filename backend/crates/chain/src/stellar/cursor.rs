//! Persistent cursor storage for the Stellar deposit watcher.
//!
//! When the chain service restarts it must resume watching Stellar payments
//! from the exact Horizon paging token it had reached, not from the current
//! ledger tip. Without this, deposits that arrived while the service was
//! offline are silently skipped.
//!
//! # Schema
//! One row per chain in `chain_cursors (chain TEXT PK, cursor TEXT, updated_at
//! TIMESTAMPTZ)`. The cursor value is the Horizon TOID string produced by
//! [`crate::stellar::horizon::cursor_for_ledger`] and the paging tokens
//! returned in payment records.
//!
//! # Atomicity
//! [`CursorStore::save`] uses `INSERT … ON CONFLICT … DO UPDATE` (upsert), so
//! the first write creates the row and subsequent writes update it. Both
//! operations execute within a single statement and are atomic.

use sqlx::PgPool;

/// Identifies which chain's cursor is being stored.
pub const STELLAR_CHAIN_KEY: &str = "stellar";

/// Error type for cursor operations.
#[derive(Debug, thiserror::Error)]
pub enum CursorError {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
    #[error("cursor value {cursor:?} is not a valid TOID")]
    InvalidFormat { cursor: String },
}

/// Converts a Horizon paging token (TOID) to the ledger sequence number it belongs to.
///
/// Stellar TOIDs store the ledger number in the top 32 bits. This function
/// extracts and validates it, returning an error for unparsable or invalid cursors
/// rather than silently falling back to ledger 0 (which would replay the entire chain).
///
/// # Errors
///
/// - Returns [`CursorError::InvalidFormat`] when `cursor` cannot be parsed as an `i64`
/// - Returns [`CursorError::InvalidFormat`] when the extracted ledger number is negative
///
/// # Examples
///
/// ```ignore
/// // Valid cursor: ledger 100, TOID = 100 << 32 = 429496729600
/// assert_eq!(cursor_to_ledger("429496729600")?, 100);
///
/// // Garbage input: refuse to start
/// assert!(cursor_to_ledger("not-a-number").is_err());
/// assert!(cursor_to_ledger("").is_err());
/// ```
pub fn cursor_to_ledger(cursor: &str) -> Result<u64, CursorError> {
    let toid = cursor
        .parse::<i64>()
        .map_err(|_| CursorError::InvalidFormat {
            cursor: cursor.to_owned(),
        })?;

    // Extract ledger from the top 32 bits. Negative TOIDs are structurally
    // invalid (Horizon never produces them), so refuse them explicitly.
    let ledger = toid >> 32;
    u64::try_from(ledger).map_err(|_| CursorError::InvalidFormat {
        cursor: cursor.to_owned(),
    })
}

/// Reads and writes the Stellar watcher's resume cursor from/to Postgres.
#[derive(Clone)]
pub struct CursorStore {
    pool: PgPool,
}

impl CursorStore {
    /// Creates a store backed by `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Loads the last saved cursor for `chain`.
    ///
    /// Returns `Ok(Some(cursor))` when a previous run saved one, or
    /// `Ok(None)` when the watcher is starting from scratch.
    pub async fn load(&self, chain: &str) -> Result<Option<String>, CursorError> {
        let row: Option<String> =
            sqlx::query_scalar("SELECT cursor FROM chain_cursors WHERE chain = $1")
                .bind(chain)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row)
    }

    /// Atomically persists `cursor` for `chain`.
    ///
    /// Uses an upsert so the first call creates the row and subsequent calls
    /// update it. The `updated_at` column is refreshed on every write.
    pub async fn save(&self, chain: &str, cursor: &str) -> Result<(), CursorError> {
        sqlx::query(
            r#"
            INSERT INTO chain_cursors (chain, cursor, updated_at)
            VALUES ($1, $2, now())
            ON CONFLICT (chain) DO UPDATE
                SET cursor     = EXCLUDED.cursor,
                    updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(chain)
        .bind(cursor)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    //! Unit tests for cursor persistence and recovery.
    //!
    //! These tests do not require a live database; they verify the interface
    //! contract and the in-memory behaviour of a `FakeCursorStore` that mirrors
    //! the `CursorStore` semantics.

    use std::collections::HashMap;

    /// An in-memory stand-in that mirrors `CursorStore`'s interface so we can
    /// test persistence logic without a running Postgres instance.
    struct FakeCursorStore {
        cursors: HashMap<String, String>,
    }

    impl FakeCursorStore {
        fn new() -> Self {
            Self {
                cursors: HashMap::new(),
            }
        }

        fn load(&self, chain: &str) -> Option<String> {
            self.cursors.get(chain).cloned()
        }

        fn save(&mut self, chain: &str, cursor: &str) {
            self.cursors.insert(chain.to_owned(), cursor.to_owned());
        }
    }

    #[test]
    fn load_returns_none_before_any_save() {
        let store = FakeCursorStore::new();
        assert_eq!(store.load("stellar"), None);
    }

    #[test]
    fn save_then_load_returns_the_same_cursor() {
        let mut store = FakeCursorStore::new();
        store.save("stellar", "429496729600");
        assert_eq!(store.load("stellar"), Some("429496729600".to_owned()));
    }

    #[test]
    fn save_overwrites_previous_cursor() {
        let mut store = FakeCursorStore::new();
        store.save("stellar", "100");
        store.save("stellar", "200");
        assert_eq!(store.load("stellar"), Some("200".to_owned()));
    }

    #[test]
    fn cursors_for_different_chains_are_independent() {
        let mut store = FakeCursorStore::new();
        store.save("stellar", "stellar-cursor");
        store.save("base", "base-cursor");

        assert_eq!(store.load("stellar"), Some("stellar-cursor".to_owned()));
        assert_eq!(store.load("base"), Some("base-cursor".to_owned()));
    }

    #[test]
    fn load_unknown_chain_returns_none() {
        let mut store = FakeCursorStore::new();
        store.save("stellar", "100");
        // "base" was never saved.
        assert_eq!(store.load("base"), None);
    }

    #[test]
    fn simulated_restart_resumes_from_saved_cursor() {
        // Process 1: runs, saves cursor after processing.
        let mut process1 = FakeCursorStore::new();
        process1.save("stellar", "858993459200"); // ledger 200 TOID

        // Process 2: starts fresh, loads cursor from "persistent" storage.
        let saved = process1.load("stellar").unwrap();
        let mut process2 = FakeCursorStore::new();
        process2.save("stellar", &saved);

        assert_eq!(
            process2.load("stellar"),
            Some("858993459200".to_owned()),
            "restarted process must resume from where the previous one stopped"
        );
    }

    #[test]
    fn cursor_value_round_trips_through_toid_arithmetic() {
        // TOIDs: ledger in top 32 bits. cursor_for_ledger(100) = 100 << 32.
        let ledger: i64 = 100;
        let toid = ledger.checked_mul(1 << 32).unwrap();
        let cursor_str = toid.to_string();

        let mut store = FakeCursorStore::new();
        store.save("stellar", &cursor_str);

        let loaded = store.load("stellar").unwrap();
        let recovered: i64 = loaded.parse().unwrap();
        assert_eq!(recovered, toid);
        assert_eq!(recovered >> 32, ledger);
    }

    // ── cursor_to_ledger ─────────────────────────────────────────────────────

    use super::cursor_to_ledger;

    #[test]
    fn valid_cursor_extracts_ledger_number() {
        // Ledger 100: 100 << 32 = 429496729600
        assert_eq!(cursor_to_ledger("429496729600").unwrap(), 100);
        // Ledger 1: 1 << 32 = 4294967296
        assert_eq!(cursor_to_ledger("4294967296").unwrap(), 1);
        // Ledger 0: 0 << 32 = 0
        assert_eq!(cursor_to_ledger("0").unwrap(), 0);
    }

    #[test]
    fn unparsable_cursor_returns_error() {
        assert!(cursor_to_ledger("not-a-number").is_err());
        assert!(cursor_to_ledger("").is_err());
        assert!(cursor_to_ledger("abc123").is_err());
        assert!(cursor_to_ledger("12.34").is_err());
    }

    #[test]
    fn garbage_cursor_refuses_to_start() {
        // The key behavior: garbage must error, not silently fall back to 0.
        let result = cursor_to_ledger("corrupt_data_from_db");
        assert!(result.is_err(), "garbage cursor must be refused");
    }

    #[test]
    fn negative_toid_is_invalid() {
        // Negative TOIDs are structurally impossible in Horizon.
        assert!(cursor_to_ledger("-1").is_err());
        assert!(cursor_to_ledger("-429496729600").is_err());
    }

    #[test]
    fn empty_cursor_is_invalid() {
        // An empty string is not a valid TOID.
        assert!(cursor_to_ledger("").is_err());
    }

    #[test]
    fn cursor_with_decimal_point_is_invalid() {
        // TOIDs are integers, not floats.
        assert!(cursor_to_ledger("123.456").is_err());
    }

    #[test]
    fn large_ledger_number_is_valid() {
        // Ledger 14,000,000: 14_000_000 << 32 = 60_129_542_144_000_000
        assert_eq!(cursor_to_ledger("60129542144000000").unwrap(), 14_000_000);
    }

    #[test]
    fn cursor_to_ledger_error_message_names_bad_value() {
        // Operators need to see what the bad cursor was to diagnose it.
        let err = cursor_to_ledger("bad_cursor").unwrap_err();
        let message = err.to_string();
        assert!(
            message.contains("bad_cursor"),
            "error message should quote the bad cursor value: {message}"
        );
    }
}
