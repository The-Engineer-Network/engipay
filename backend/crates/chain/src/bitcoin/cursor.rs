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
///
/// `chain_cursors.cursor` is text because Stellar stores a paging token there;
/// Bitcoin stores the block height as a decimal string in the same column.
pub async fn get_last_scanned_height(pool: &PgPool) -> Result<Option<i64>, CursorError> {
    let cursor: Option<String> =
        sqlx::query_scalar("SELECT cursor FROM chain_cursors WHERE chain = $1")
            .bind(BITCOIN_CHAIN)
            .fetch_optional(pool)
            .await?;

    cursor.map(|text| parse_height(&text)).transpose()
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
        "INSERT INTO chain_cursors (chain, cursor, updated_at) VALUES ($1, $2, now())          ON CONFLICT (chain) DO UPDATE          SET cursor = EXCLUDED.cursor, updated_at = EXCLUDED.updated_at",
    )
    .bind(BITCOIN_CHAIN)
    .bind(height.to_string())
    .execute(pool)
    .await?;

    Ok(())
}

/// A stored cursor that is not a block height means the row was written by
/// something else. Refuse it: guessing a height would skip or replay deposits.
fn parse_height(text: &str) -> Result<i64, CursorError> {
    text.parse::<i64>()
        .ok()
        .filter(|height| *height >= 0)
        .ok_or_else(|| {
            CursorError::Database(sqlx::Error::Protocol(format!(
                "stored bitcoin cursor {text:?} is not a block height"
            )))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bitcoin_chain_identifier_is_stable() {
        assert_eq!(BITCOIN_CHAIN, "bitcoin");
    }

    #[test]
    fn stored_heights_round_trip_through_text() {
        assert_eq!(parse_height("0").ok(), Some(0));
        assert_eq!(parse_height(&840_000_i64.to_string()).ok(), Some(840_000));
    }

    #[test]
    fn a_cursor_that_is_not_a_height_is_refused() {
        assert!(parse_height("-1").is_err());
        assert!(parse_height("12.5").is_err());
        // A Stellar paging token written under the wrong chain key.
        assert!(parse_height("stellar:123").is_err());
    }

    #[tokio::test]
    async fn negative_height_is_rejected() {
        // Validation happens before any database access, so the pool is never
        // connected. A lazy pool still has to be created inside the runtime.
        let pool = sqlx::PgPool::connect_lazy("postgres://localhost/unused").expect("lazy pool");
        let result = set_last_scanned_height(&pool, -1).await;
        assert!(result.is_err());
    }
}
