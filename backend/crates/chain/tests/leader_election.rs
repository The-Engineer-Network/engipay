//! Integration tests: leader election with two simulated instances.
//!
//! These tests require `DATABASE_URL` and are marked `#[ignore]` so they only
//! run in CI when Postgres is available (or locally with `--include-ignored`).
//!
//! The tests verify the core guarantee from issue #497:
//! **only one chain service instance processes ledgers per network at a time**.
//!
//! Each test uses a UUID-keyed chain name so it is logically isolated and safe
//! to run in parallel under cargo's default multi-threaded test runner.

#![allow(clippy::unwrap_used)]

use std::time::Duration;

use engipay_chain::leader::LeaderLock;
use tokio_util::sync::CancellationToken;

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn pool() -> sqlx::PgPool {
    let url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set to run leader election tests");
    sqlx::PgPool::connect(&url)
        .await
        .expect("could not connect to DATABASE_URL")
}

/// A unique chain key per test invocation so parallel tests never interfere.
fn unique_chain() -> String {
    format!("test-leader-{}", uuid::Uuid::new_v4().simple())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Instance A acquires the lock; instance B cannot while A holds it.
/// After A releases, B takes over immediately.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn only_one_instance_holds_the_lock_at_a_time() {
    let pool = pool().await;
    let chain = unique_chain();

    // Instance A starts and wins the election.
    let lock_a = LeaderLock::try_acquire(&pool, &chain)
        .await
        .expect("db query ok")
        .expect("instance A must become leader on a fresh chain");

    // Instance B tries but must be the standby.
    let result_b = LeaderLock::try_acquire(&pool, &chain)
        .await
        .expect("db query ok");
    assert!(
        result_b.is_none(),
        "instance B must be the standby while A holds the lock"
    );

    // Instance A shuts down and releases the lock.
    lock_a.unlock().await;

    // Instance B can now become the leader.
    let lock_b = LeaderLock::try_acquire(&pool, &chain)
        .await
        .expect("db query ok")
        .expect("instance B must take over after A releases");

    lock_b.unlock().await;
}

/// The lock is re-acquirable after an explicit unlock, confirming clean
/// handover on graceful shutdown.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn lock_is_reacquirable_after_unlock() {
    let pool = pool().await;
    let chain = unique_chain();

    for round in 1..=3 {
        let lock = LeaderLock::try_acquire(&pool, &chain)
            .await
            .expect("db query ok")
            .unwrap_or_else(|| panic!("round {round}: lock must be free"));
        lock.unlock().await;
    }
}

/// `acquire()` returns `None` when the shutdown token fires before the lock
/// becomes free, allowing the standby to exit cleanly.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn acquire_returns_none_on_shutdown_before_lock_is_free() {
    let pool = pool().await;
    let chain = unique_chain();

    // Hold the lock so `acquire()` has to wait.
    let _holder = LeaderLock::try_acquire(&pool, &chain)
        .await
        .expect("db query ok")
        .expect("holder must succeed");

    let shutdown = CancellationToken::new();
    let ct = shutdown.clone();

    // Cancel after a short delay — well within the RETRY_INTERVAL (5 s).
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
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

/// Simulates an instance crash: the lock is dropped without calling `unlock`.
/// Postgres releases the session-level lock when the connection is closed,
/// so a fresh acquisition must succeed on the same pool.
///
/// Note: with a connection pool, the connection is returned to the pool rather
/// than closed immediately. This test verifies the explicit-unlock path works;
/// crash recovery in production depends on TCP keepalives and Postgres
/// `tcp_keepalives_idle`.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn explicit_unlock_allows_reacquisition() {
    let pool = pool().await;
    let chain = unique_chain();

    let lock = LeaderLock::try_acquire(&pool, &chain)
        .await
        .expect("db query ok")
        .expect("initial lock must succeed");

    // Release explicitly (simulating clean shutdown).
    lock.unlock().await;

    // A new instance can now acquire the lock.
    let new_lock = LeaderLock::try_acquire(&pool, &chain)
        .await
        .expect("db query ok")
        .expect("lock must be available after explicit unlock");

    new_lock.unlock().await;
}

/// Multiple different chains can be led simultaneously by different instances
/// without interfering with each other.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn different_chains_have_independent_locks() {
    let pool = pool().await;
    let chain_a = unique_chain();
    let chain_b = unique_chain();

    // Both can be acquired simultaneously.
    let lock_a = LeaderLock::try_acquire(&pool, &chain_a)
        .await
        .expect("db query ok")
        .expect("chain_a lock must succeed");

    let lock_b = LeaderLock::try_acquire(&pool, &chain_b)
        .await
        .expect("db query ok")
        .expect("chain_b lock must succeed independently of chain_a");

    // Releasing A does not affect B.
    lock_a.unlock().await;

    // chain_b is still locked.
    let result_b2 = LeaderLock::try_acquire(&pool, &chain_b)
        .await
        .expect("db query ok");
    assert!(
        result_b2.is_none(),
        "chain_b must still be locked after chain_a was released"
    );

    lock_b.unlock().await;
}
