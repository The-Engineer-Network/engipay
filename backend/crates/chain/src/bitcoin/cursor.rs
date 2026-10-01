//! Persistence for the last scanned Bitcoin block height.
//!
//! The watcher stores its progress in the `chain_cursors` table under the
//! `bitcoin` chain so that it can resume from the stored height after a
//! process restart.

use sqlx::PgPool;

/// The chain identifier used for Bitcoin cursor rows in `chain_cursors`.
pub const BITCOIN_CHAIN: &str = "bitcoin";

/// Alias for [`BITCOIN_CHAIN`], used in public API exports.
pub const BITCOIN_CHAIN_ID: &str = BITCOIN_CHAIN;

/// Errors that can occur while reading or writing the Bitcoin cursor.
#[derive(Debug, thiserror::Error)]
pub enum CursorError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// Public alias for [`CursorError`] used in re-exports.
pub type BitcoinCursorError = CursorError;

/// A handle for reading and writing the Bitcoin block cursor in the database.
///
/// Wraps the cursor persistence functions ([`get_last_scanned_height`] and
/// [`set_last_scanned_height`]) behind a struct so callers receive a single
/// value rather than free functions.
#[derive(Debug, Clone)]
pub struct BitcoinCursor {
    pool: PgPool,
}

impl BitcoinCursor {
    /// Creates a new [`BitcoinCursor`] bound to `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Reads the last scanned block height from the database.
    ///
    /// Returns `Ok(None)` when no cursor has been written yet.
    pub async fn get(&self) -> Result<Option<i64>, BitcoinCursorError> {
        get_last_scanned_height(&self.pool).await
    }

    /// Persists the latest scanned block height to the database.
    pub async fn set(&self, height: i64) -> Result<(), BitcoinCursorError> {
        set_last_scanned_height(&self.pool, height).await
    }
}

/// Reads the last scanned Bitcoin block height from `chain_cursors`.
///
/// Returns `Ok(None)` when no cursor has been persisted yet, allowing the
/// watcher to fall back to its configured start height.
pub async fn get_last_scanned_height(pool: &PgPool) -> Result<Option<i64>, CursorError> {
    let height: Option<i64> = sqlx::query_scalar(
        "SELECT last_scanned_height FROM chain_cursors WHERE chain = $1",
    )
    .bind(BITCOIN_CHAIN)
    .fetch_optional(pool)
    .await?;

    Ok(height)
}

/// Persists the latest scanned Bitcoin block height in `chain_cursors`.
///
/// Uses an upsert so the cursor is created on first write and updated on
/// subsequent scans. Block heights are non-negative integers.
pub async fn set_last_scanned_height(pool: &PgPool, height: i64) -> Result<(), CursorError> {
    if height < 0 {
        return Err(CursorError::Database(sqlx::Error::Protocol(
            "bitcoin block height must be non-negative".to_string(),
        )));
    }

    sqlx::query(
        "INSERT INTO chain_cursors (chain, last_scanned_height) VALUES ($1, $2) \
         ON CONFLICT (chain) DO UPDATE SET last_scanned_height = EXCLUDED.last_scanned_height",
    )
    .bind(BITCOIN_CHAIN)
    .bind(height)
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bitcoin_chain_identifier_is_stable() {
        assert_eq!(BITCOIN_CHAIN, "bitcoin");
    }

    #[test]
    fn negative_height_is_rejected() {
        // Validation happens before any database access, so a pool is not
        // required to exercise the guard.
        let rt = tokio::runtime::Runtime::new().expect("runtime");
        let pool = sqlx::PgPool::connect_lazy("postgres://localhost/unused").expect("lazy pool");
        let result = rt.block_on(set_last_scanned_height(&pool, -1));
        assert!(result.is_err());
    }
}
