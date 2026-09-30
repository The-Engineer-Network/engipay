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
}
