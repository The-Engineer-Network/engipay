//! The shared deposit-watching loop.
//!
//! `engipay-chain watch` (the default subcommand of the binary) starts one of
//! these loops per configured network - Stellar today, Base alongside it as of
//! #382. Each loop polls its [`ChainClient`] for the latest height, scans from
//! the last height it processed, credits deposits through the
//! [`DepositCreditor`], and persists its position in `chain_cursors` so a
//! restart resumes where it left off instead of skipping everything that
//! arrived while the process was down.
//!
//! # Cursor encoding
//! `chain_cursors.cursor` is a plain string so each chain stores the value its
//! own source of truth produces: Stellar a Horizon TOID, Base a block number.
//! [`CursorFormat`] owns that difference, which keeps the loop itself
//! chain-agnostic.
//!
//! # Overlap, not gaps
//! The loop deliberately re-scans the last processed height on every poll
//! (polls overlap by one height) and drops repeats through the in-memory
//! `seen` ring. Overlapping is safe - duplicates are cheap - while a gap would
//! silently lose a deposit.

use std::collections::{HashSet, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::deposit_creditor::DepositCreditor;
use crate::stellar::cursor::{cursor_to_ledger, CursorError, CursorStore};
use crate::stellar::horizon::cursor_for_ledger;
use crate::{is_creditable, ChainClient};

/// References remembered per loop to drop deposits seen by two overlapping polls.
const SEEN_CAPACITY: usize = 10_000;

/// How a chain's height is written to and read back from `chain_cursors`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorFormat {
    /// A Stellar Horizon paging token (TOID); [`cursor_to_ledger`] recovers the
    /// ledger sequence it belongs to.
    HorizonToid,
    /// A plain block number in decimal, as Base's JSON-RPC reports heights.
    BlockNumber,
}

impl CursorFormat {
    /// Renders a processed height as the value to persist. A TOID that cannot
    /// be built (a ledger too large for `i64`) falls back to the decimal
    /// height, exactly as the Stellar-only loop did before this was shared.
    pub fn encode(self, height: u64) -> String {
        match self {
            CursorFormat::HorizonToid => cursor_for_ledger(height)
                .map(|toid| toid.to_string())
                .unwrap_or_else(|| height.to_string()),
            CursorFormat::BlockNumber => height.to_string(),
        }
    }

    /// Recovers the last processed height from a stored cursor.
    ///
    /// # Errors
    /// Returns [`CursorError::InvalidFormat`] for unparsable values, so callers
    /// can refuse to start rather than silently replaying the whole chain.
    pub fn decode(self, cursor: &str) -> Result<u64, CursorError> {
        match self {
            CursorFormat::HorizonToid => cursor_to_ledger(cursor),
            CursorFormat::BlockNumber => {
                cursor
                    .parse::<u64>()
                    .map_err(|_| CursorError::InvalidFormat {
                        cursor: cursor.to_owned(),
                    })
            }
        }
    }
}

/// Resolves the height a watch loop must resume from, given whatever cursor
/// `chain_cursors` held for that chain. `Ok(None)` means "no cursor yet: start
/// from the current tip".
///
/// # Errors
/// Returns an error when the stored cursor cannot be decoded, so a corrupt row
/// fails loudly instead of replaying the chain from genesis (which would
/// duplicate credits).
fn resume_from_saved(saved: Option<String>, format: CursorFormat) -> anyhow::Result<Option<u64>> {
    let Some(saved) = saved else {
        return Ok(None);
    };
    format.decode(&saved).map(Some).with_context(|| {
        format!("stored cursor {saved:?} is invalid; fix or delete the chain_cursors row")
    })
}

/// Everything one network's watch loop needs besides its client.
#[derive(Debug, Clone)]
pub struct ChainWatch {
    /// `chain_cursors.chain` key: `"stellar"`, `"base"`, ...
    pub chain_key: &'static str,
    /// Network name for logs, e.g. `testnet`.
    pub network: String,
    /// The custody account(s) or address(es) being watched, for logs.
    pub custody: Vec<String>,
    /// Seconds between polls.
    pub poll: Duration,
    /// Explicit start height from the environment (`STELLAR_START_LEDGER`,
    /// `BASE_START_BLOCK`); wins over the stored cursor. Useful for backfills.
    pub start_override: Option<u64>,
    /// How this chain's heights are persisted in `chain_cursors`.
    pub format: CursorFormat,
}

/// Polls `client` until `shutdown` is cancelled: one loop per configured
/// network, spawned from `watch()` in the binary.
///
/// Startup errors (unreadable cursor, unreachable endpoint) are returned so the
/// caller can fail fast instead of running the service while watching nothing.
/// Errors during the loop are logged and retried on the next poll: a flaky RPC
/// endpoint must not take the whole service down.
pub async fn watch_chain<C>(
    client: Arc<C>,
    cfg: ChainWatch,
    cursor_store: Option<CursorStore>,
    creditor: Option<Arc<DepositCreditor>>,
    leader_lock: Option<crate::leader::LeaderLock>,
    shutdown: CancellationToken,
) -> anyhow::Result<()>
where
    C: ChainClient + 'static,
{
    // Determine the starting height:
    // 1. Explicit override from the environment (backfills).
    // 2. Persisted cursor from the database (normal restart path).
    // 3. Current tip (first-ever run with no database).
    let mut next_height: u64 = match cfg.start_override {
        Some(height) => height,
        None => {
            let saved = match cursor_store.as_ref() {
                Some(store) => store.load(cfg.chain_key).await?,
                None => None,
            };
            match resume_from_saved(saved, cfg.format)? {
                Some(height) => height,
                None => client.latest_height().await?,
            }
        }
    };

    info!(
        chain = cfg.chain_key,
        network = %cfg.network,
        custody = ?cfg.custody,
        from_height = next_height,
        db_cursor = cursor_store.is_some(),
        creditor_enabled = creditor.is_some(),
        poll_secs = cfg.poll.as_secs(),
        "watching deposits"
    );

    let mut seen: HashSet<String> = HashSet::new();
    let mut seen_order: VecDeque<String> = VecDeque::new();
    let mut ticker = tokio::time::interval(cfg.poll);

    loop {
        tokio::select! {
            _ = shutdown.cancelled() => {
                if let Some(lock) = leader_lock {
                    lock.unlock().await;
                }
                return Ok(());
            }
            _ = ticker.tick() => {}
        }

        // Read the tip first, then everything from the last tip onwards. Polls
        // overlap by one height on purpose; `seen` drops the repeats.
        let tip = match client.latest_height().await {
            Ok(tip) => tip,
            Err(error) => {
                warn!(chain = cfg.chain_key, %error, "could not read the chain tip; retrying");
                continue;
            }
        };
        let deposits = match client.deposits_since(next_height).await {
            Ok(deposits) => deposits,
            Err(error) => {
                warn!(chain = cfg.chain_key, %error, "could not read deposits; retrying");
                continue;
            }
        };

        for deposit in deposits {
            if !is_creditable(&*client, &deposit) || seen.contains(&deposit.reference) {
                continue;
            }

            // Deduplicate before calling the creditor so the in-memory `seen`
            // ring short-circuits the overlap-by-one without a database round-trip.
            seen.insert(deposit.reference.clone());
            seen_order.push_back(deposit.reference.clone());
            while seen_order.len() > SEEN_CAPACITY {
                if let Some(oldest) = seen_order.pop_front() {
                    seen.remove(&oldest);
                }
            }

            match &creditor {
                Some(c) => {
                    // Credit the deposit. The creditor handles DLQ routing for
                    // unresolvable addresses and ledger errors; it never panics
                    // or returns an error that would crash this loop.
                    c.process(deposit).await;
                }
                None => {
                    // No database: log what would have been credited.
                    info!(
                        chain     = cfg.chain_key,
                        amount    = %deposit.money,
                        reference = %deposit.reference,
                        address   = %deposit.address,
                        "deposit creditable (no database configured - not credited)"
                    );
                }
            }
        }

        // Advance cursor. Persist it atomically so a restart resumes here.
        next_height = tip;
        if let Some(store) = &cursor_store {
            let cursor_value = cfg.format.encode(tip);
            if let Err(error) = store.save(cfg.chain_key, &cursor_value).await {
                warn!(chain = cfg.chain_key, %error, "could not persist cursor; will retry next poll");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_number_cursors_round_trip() {
        assert_eq!(CursorFormat::BlockNumber.encode(12_345), "12345");
        assert_eq!(
            CursorFormat::BlockNumber.decode("12345").expect("decodes"),
            12_345
        );
    }

    #[test]
    fn block_number_cursors_refuse_garbage() {
        assert!(CursorFormat::BlockNumber.decode("not-a-block").is_err());
        assert!(CursorFormat::BlockNumber.decode("-1").is_err());
        assert!(CursorFormat::BlockNumber.decode("").is_err());
    }

    #[test]
    fn toid_cursors_round_trip() {
        // A TOID stores the ledger in its top 32 bits.
        let cursor = CursorFormat::HorizonToid.encode(7);
        assert_eq!(cursor, "30064771072");
        assert_eq!(
            CursorFormat::HorizonToid.decode(&cursor).expect("decodes"),
            7
        );
    }

    #[test]
    fn resume_starts_at_the_tip_without_a_cursor() {
        assert_eq!(
            resume_from_saved(None, CursorFormat::BlockNumber).expect("resolves"),
            None
        );
    }

    #[test]
    fn resume_returns_the_stored_cursor() {
        assert_eq!(
            resume_from_saved(Some("42".to_owned()), CursorFormat::BlockNumber).expect("resolves"),
            Some(42)
        );
    }

    #[test]
    fn resume_refuses_a_corrupt_cursor_instead_of_replaying_the_chain() {
        let error = resume_from_saved(Some("garbage".to_owned()), CursorFormat::BlockNumber)
            .expect_err("must refuse to start");
        assert!(
            error
                .to_string()
                .contains("fix or delete the chain_cursors row"),
            "unexpected message: {error}"
        );
    }

    // A restarted process builds a fresh CursorStore over the same database, so
    // this is exactly the restart path: what one process saved, the next reads.
    async fn test_pool() -> Option<sqlx::PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        sqlx::PgPool::connect(&url).await.ok()
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn postgres_base_cursor_survives_a_restart() {
        let pool = test_pool().await.expect("DATABASE_URL is set");
        // A unique chain key keeps this row away from the real "base"/"stellar" cursors.
        let chain = format!("base-restart-test-{}", uuid::Uuid::new_v4());

        CursorStore::new(pool.clone())
            .save(&chain, "12345")
            .await
            .expect("the first process saves its cursor");

        let saved = CursorStore::new(pool.clone())
            .load(&chain)
            .await
            .expect("the restarted process reads it back");
        assert_eq!(saved.as_deref(), Some("12345"));
        assert_eq!(
            resume_from_saved(saved, CursorFormat::BlockNumber).expect("resolves"),
            Some(12_345),
            "the restarted process resumes from the saved block"
        );

        sqlx::query("DELETE FROM chain_cursors WHERE chain = $1")
            .bind(&chain)
            .execute(&pool)
            .await
            .expect("cleanup");
    }
}
