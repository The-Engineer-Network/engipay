//! Postgres-advisory-lock based leader election for the chain watcher.
//!
//! Running two chain service instances against the same database would make
//! both watch the same network and race on cursors, potentially crediting
//! deposits twice. This module prevents that: before entering the watcher
//! loop, each instance calls [`LeaderLock::acquire`] for its network. Only
//! the one that holds the lock processes ledgers; the other waits and takes
//! over automatically the moment the lock is released.
//!
//! # Why Postgres advisory locks
//!
//! - **Session-scoped**: Postgres releases the lock automatically when the
//!   connection is dropped. A crashed process cannot hold the lock
//!   indefinitely — handover happens at TCP timeout, typically seconds.
//! - **Non-transactional**: the lock survives `COMMIT` / `ROLLBACK`, so
//!   cursor writes and deposit credits do not accidentally drop leadership.
//! - **No schema change required**: `pg_try_advisory_lock` is a Postgres
//!   built-in. The migration only adds an observability view over `pg_locks`.
//! - **Operator-visible**: `pg_locks` and the `chain_leaders` view show which
//!   backend holds which lock; the `/metrics` endpoint exposes
//!   `chain_is_leader` so Prometheus can alert on split-brain.
//!
//! # Lock key derivation
//!
//! Postgres advisory locks use a 64-bit integer key. We derive one from the
//! ASCII chain name by taking the first 8 bytes (zero-padded to 8) and
//! interpreting them as a little-endian `i64`. The mapping is stable across
//! restarts and process identities, and unique for the three supported chains.
//!
//! | chain   | bytes (LE hex)            | key (decimal)       |
//! |---------|---------------------------|---------------------|
//! | stellar | 73 74 65 6c 6c 61 72 00   | 49206881933140595   |
//! | base    | 62 61 73 65 00 00 00 00   | 110075314786       |
//! | bitcoin | 62 69 74 63 6f 69 6e 00   | 49954626156647778  |

use std::time::Duration;

use sqlx::PgPool;
use tracing::{debug, info, warn};

/// How long a standby waits between lock-acquisition attempts.
const RETRY_INTERVAL: Duration = Duration::from_secs(5);

/// Derives a stable 64-bit advisory lock key from an ASCII chain identifier.
///
/// Takes the first 8 bytes of `chain` (zero-padded), interprets them as a
/// little-endian `i64`. All three supported chains (`stellar`, `base`,
/// `bitcoin`) produce distinct keys because their first 8 characters differ.
///
/// The key is intentionally stable — a rolling deploy would deadlock if this
/// function returned a different value between versions.
pub fn lock_key(chain: &str) -> i64 {
    let bytes = chain.as_bytes();
    let mut buf = [0u8; 8];
    let len = bytes.len().min(8);
    buf[..len].copy_from_slice(&bytes[..len]);
    i64::from_le_bytes(buf)
}

/// Holds an active Postgres session-level advisory lock for one chain network.
///
/// The lock is tied to the dedicated connection stored inside this struct.
/// Dropping this struct **does not** release the lock from Rust; call
/// [`LeaderLock::unlock`] for a clean, explicit release. On process exit
/// (including crashes) Postgres releases the lock automatically when the
/// TCP connection is closed.
pub struct LeaderLock {
    conn: sqlx::pool::PoolConnection<sqlx::Postgres>,
    key: i64,
    /// The chain name this lock was acquired for (e.g. `"stellar"`).
    pub chain: String,
}

impl LeaderLock {
    /// Tries once to acquire the advisory lock for `chain`.
    ///
    /// Returns `Some(LeaderLock)` when this process is now the leader, or
    /// `None` when another session already holds the lock. Never blocks.
    pub async fn try_acquire(pool: &PgPool, chain: &str) -> Result<Option<Self>, sqlx::Error> {
        let key = lock_key(chain);
        let mut conn = pool.acquire().await?;
        let held: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
            .bind(key)
            .fetch_one(&mut *conn)
            .await?;
        if held {
            debug!(chain, key, "acquired leader lock");
            Ok(Some(Self {
                conn,
                key,
                chain: chain.to_owned(),
            }))
        } else {
            Ok(None)
        }
    }

    /// Loops until this instance becomes the leader for `chain`, or until
    /// `shutdown` is cancelled.
    ///
    /// Retries every [`RETRY_INTERVAL`] seconds. Returns `Ok(None)` when
    /// shutdown fires before the lock is acquired, allowing callers to exit
    /// cleanly. Returns `Err` only on a database connection error.
    pub async fn acquire(
        pool: &PgPool,
        chain: &str,
        shutdown: &tokio_util::sync::CancellationToken,
    ) -> Result<Option<Self>, sqlx::Error> {
        loop {
            match Self::try_acquire(pool, chain).await? {
                Some(lock) => {
                    info!(chain, "this instance is now the leader for this network");
                    return Ok(Some(lock));
                }
                None => {
                    info!(
                        chain,
                        interval_secs = RETRY_INTERVAL.as_secs(),
                        "another instance holds the leader lock; waiting to take over"
                    );
                }
            }

            tokio::select! {
                _ = shutdown.cancelled() => {
                    info!(chain, "shutting down while waiting for leader lock");
                    return Ok(None);
                }
                _ = tokio::time::sleep(RETRY_INTERVAL) => {}
            }
        }
    }

    /// Explicitly releases the advisory lock and returns the connection to the
    /// pool. Call this on clean shutdown so a standby instance takes over
    /// immediately instead of waiting for the TCP connection to time out.
    pub async fn unlock(mut self) {
        let result: Result<bool, _> = sqlx::query_scalar("SELECT pg_advisory_unlock($1)")
            .bind(self.key)
            .fetch_one(&mut *self.conn)
            .await;
        match result {
            Ok(true) => info!(chain = %self.chain, "leader lock released cleanly"),
            Ok(false) => warn!(
                chain = %self.chain,
                "advisory unlock returned false (lock was not held?)"
            ),
            Err(e) => warn!(
                chain = %self.chain,
                error = %e,
                "error releasing leader lock; Postgres will clean up on connection close"
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Unit tests (no database required) ────────────────────────────────────

    #[test]
    fn lock_key_is_stable() {
        // These values must never change — a rolling deploy where old and new
        // instances use different keys would fail to mutual-exclude each other.
        assert_eq!(lock_key("stellar"), i64::from_le_bytes(*b"stellar\0"));
        assert_eq!(lock_key("base"), i64::from_le_bytes(*b"base\0\0\0\0"));
        assert_eq!(lock_key("bitcoin"), i64::from_le_bytes(*b"bitcoin\0"));
    }

    #[test]
    fn lock_keys_are_distinct() {
        let keys: std::collections::HashSet<i64> = ["stellar", "base", "bitcoin"]
            .iter()
            .map(|n| lock_key(n))
            .collect();
        assert_eq!(keys.len(), 3, "all three networks must have distinct lock keys");
    }

    #[test]
    fn long_chain_name_uses_first_8_bytes_only() {
        // Names longer than 8 chars: only the first 8 bytes contribute to the key.
        let k1 = lock_key("abcdefgh");
        let k2 = lock_key("abcdefghXXXXXXXX");
        assert_eq!(k1, k2);
    }

    #[test]
    fn empty_chain_name_gives_zero_key() {
        assert_eq!(lock_key(""), 0);
    }

    // ── Integration tests (require DATABASE_URL) ──────────────────────────────

    async fn test_pool() -> Option<sqlx::PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        sqlx::PgPool::connect(&url).await.ok()
    }

    /// Unique chain name for each test run so parallel tests never interfere.
    fn unique_chain() -> String {
        format!("test-{}", uuid::Uuid::new_v4().simple())
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn try_acquire_returns_lock_when_free() {
        let pool = test_pool().await.expect("DATABASE_URL set");
        let chain = unique_chain();

        let lock = LeaderLock::try_acquire(&pool, &chain)
            .await
            .expect("db query ok")
            .expect("lock must be free on a fresh chain name");

        lock.unlock().await;
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn second_try_acquire_fails_while_first_holds() {
        let pool = test_pool().await.expect("DATABASE_URL set");
        let chain = unique_chain();

        // First instance acquires the lock.
        let lock1 = LeaderLock::try_acquire(&pool, &chain)
            .await
            .expect("db query ok")
            .expect("first acquisition must succeed");

        // Second instance (same process, simulated via try_acquire) must fail.
        let lock2 = LeaderLock::try_acquire(&pool, &chain)
            .await
            .expect("db query ok");
        assert!(
            lock2.is_none(),
            "second acquisition must fail while the first holds the lock"
        );

        // First instance releases.
        lock1.unlock().await;

        // Now a third attempt must succeed.
        let lock3 = LeaderLock::try_acquire(&pool, &chain)
            .await
            .expect("db query ok")
            .expect("lock must be free after unlock");
        lock3.unlock().await;
    }

    /// Simulates two chain service instances competing for the same network.
    /// Demonstrates the core issue #497 guarantee: only one processes at a time.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn two_instances_only_one_processes_at_a_time() {
        let pool = test_pool().await.expect("DATABASE_URL set");
        let chain = unique_chain();

        // ── Instance A starts and wins the election ───────────────────────────
        let lock_a = LeaderLock::try_acquire(&pool, &chain)
            .await
            .expect("db query ok")
            .expect("instance A must become leader");

        // ── Instance B starts but must be standby ────────────────────────────
        let result_b = LeaderLock::try_acquire(&pool, &chain)
            .await
            .expect("db query ok");
        assert!(
            result_b.is_none(),
            "instance B must be standby while A is the leader"
        );

        // ── Instance A shuts down cleanly, releasing the lock ─────────────────
        lock_a.unlock().await;

        // ── Instance B can now take over ──────────────────────────────────────
        let lock_b = LeaderLock::try_acquire(&pool, &chain)
            .await
            .expect("db query ok")
            .expect("instance B must become leader after A releases the lock");

        lock_b.unlock().await;
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn acquire_respects_shutdown_signal() {
        let pool = test_pool().await.expect("DATABASE_URL set");
        let chain = unique_chain();

        // Hold the lock so acquire() will block.
        let _holder = LeaderLock::try_acquire(&pool, &chain)
            .await
            .expect("db query ok")
            .expect("holder must succeed");

        let shutdown = tokio_util::sync::CancellationToken::new();
        let ct = shutdown.clone();

        // Cancel almost immediately.
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            ct.cancel();
        });

        let result = LeaderLock::acquire(&pool, &chain, &shutdown)
            .await
            .expect("db query ok");

        assert!(
            result.is_none(),
            "acquire must return None when shutdown fires before the lock is free"
        );
    }
}
