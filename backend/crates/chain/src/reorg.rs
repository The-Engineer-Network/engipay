//! Chain-reorganisation tracking for the deposit watcher.
//!
//! A block the watcher has processed can be replaced by a competing branch.
//! Without a check, a deposit observed in a replaced block could be credited
//! from a chain that no longer exists. [`ReorgTracker`] keeps the hashes of
//! the most recent blocks; when a polled block does not link to the recorded
//! chain by parent hash, the watcher rewinds to the common ancestor and
//! re-scans. Deposits are only emitted once they have at least
//! [`ChainClient::required_confirmations`](crate::ChainClient::required_confirmations)
//! confirmations, so the reorg window the tracker must cover is bounded by the
//! confirmation depth.
//!
//! The tracker itself is pure — no network, no clock — so every branch of the
//! decision tree is unit-testable. When a mismatch is found, the watcher walks
//! back through the recorded hashes with [`ReorgTracker::find_common_ancestor`],
//! supplying the node's canonical hashes through a plain callback.

use std::collections::{HashSet, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::{ChainClient, ChainError, ObservedDeposit, is_creditable};

/// Maximum deposit references held in the deduplication ring-buffer.
const SEEN_CAPACITY: usize = 10_000;

/// Identity of a block, as needed to detect reorgs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockRecord {
    /// Block height (or ledger sequence) on the chain.
    pub height: u64,
    /// The block's own hash.
    pub hash: String,
    /// The hash of the parent block. A child whose `parent_hash` does not
    /// match the recorded hash for its parent's height proves a reorg.
    pub parent_hash: String,
}

/// How many recent block hashes the tracker keeps by default.
///
/// Sized to comfortably cover Base's 12-confirmation credit depth (see
/// [`crate::ChainClient::required_confirmations`]) while staying tiny in
/// memory.
pub const DEFAULT_HISTORY: usize = 64;

/// What observing a new block did to the tracker's view of the chain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Observation {
    /// The block extends the known chain (or seeded an empty tracker).
    Extended,
    /// The tracker already holds exactly this block; nothing changed.
    Known,
    /// The block does not link to the recorded chain: it replaces recorded
    /// blocks at and above `suspect_from`. The common ancestor is strictly
    /// below that height; re-scan from there.
    Reorg { suspect_from: u64 },
    /// The block jumps over heights the tracker never recorded, so its parent
    /// cannot be checked. The block is recorded, but no reorg verdict exists.
    Unverifiable,
}

/// Bounded record of the most recent canonical block hashes.
///
/// The recorded heights are contiguous except across [`Observation::Unverifiable`]
/// gaps; the newest entry is the presumed canonical tip.
#[derive(Debug)]
pub struct ReorgTracker {
    /// `(height, hash)` pairs, ascending by height, bounded by `capacity`.
    recent: VecDeque<(u64, String)>,
    capacity: usize,
}

impl ReorgTracker {
    /// Creates a tracker that remembers at most `capacity` block hashes.
    /// A capacity of zero is raised to one: the tracker must always be able
    /// to compare against at least the current tip.
    pub fn new(capacity: usize) -> Self {
        Self {
            recent: VecDeque::with_capacity(capacity.max(1)),
            capacity: capacity.max(1),
        }
    }

    /// The height of the newest recorded block, if any.
    pub fn tip(&self) -> Option<u64> {
        self.recent.back().map(|(height, _)| *height)
    }

    /// The height of the oldest recorded block, if any.
    pub fn oldest(&self) -> Option<u64> {
        self.recent.front().map(|(height, _)| *height)
    }

    /// The recorded hash for `height`, if the tracker still holds it.
    pub fn recorded_hash(&self, height: u64) -> Option<&str> {
        self.recent
            .iter()
            .find(|(h, _)| *h == height)
            .map(|(_, hash)| hash.as_str())
    }

    /// Folds `record` into the tracker and reports how it relates to the
    /// recorded chain.
    pub fn observe(&mut self, record: BlockRecord) -> Observation {
        let observation = match (self.tip(), self.recorded_hash(record.height)) {
            // Empty tracker: seed it with the first block we ever see.
            (None, _) => Observation::Extended,
            // A block at a height we already hold: same hash means no change,
            // a different hash means that height was replaced (a reorg).
            (Some(_), Some(known)) if known == record.hash => Observation::Known,
            (Some(_), Some(_)) => Observation::Reorg {
                suspect_from: record.height,
            },
            // The normal case: the next block in the chain, parent-verified.
            (Some(tip), None) if record.height == tip.saturating_add(1) => {
                let parent_matches = self
                    .recorded_hash(tip)
                    .is_some_and(|tip_hash| tip_hash == record.parent_hash);
                if parent_matches {
                    Observation::Extended
                } else {
                    Observation::Reorg { suspect_from: tip }
                }
            }
            // A jump forward (or a block below the recorded window whose hash
            // we no longer hold): the parent link cannot be verified.
            (Some(_), None) => Observation::Unverifiable,
        };

        self.record(record.height, record.hash);
        observation
    }

    /// Walks back from `from` (inclusive, clamped to the recorded tip)
    /// looking for the highest recorded height whose hash still matches the
    /// canonical chain reported by `canonical_hash`.
    ///
    /// That height is the common ancestor: everything above it was replaced
    /// and must be re-scanned. Returns `None` when no recorded block below
    /// `from` is on the canonical chain (a reorg deeper than the tracker's
    /// window); callers should then rewind at least to the oldest recorded
    /// height and keep re-scanning.
    pub fn find_common_ancestor(
        &self,
        from: u64,
        mut canonical_hash: impl FnMut(u64) -> Option<String>,
    ) -> Option<u64> {
        self.recent
            .iter()
            .rev()
            .map_while(|(height, _)| (*height <= from).then_some(*height))
            .find(|height| {
                let Some(recorded) = self.recorded_hash(*height) else {
                    return false;
                };
                canonical_hash(*height).is_some_and(|canonical| canonical == recorded)
            })
    }

    /// Drops every recorded block above `height`.
    pub fn rewind_to(&mut self, height: u64) {
        while self.tip().is_some_and(|tip| tip > height) {
            self.recent.pop_back();
        }
    }

    /// Records `(height, hash)`, evicting the oldest entry when full.
    ///
    /// A height at or below the current tip replaces the recorded tail
    /// (used after a reorg rewind); a height above the tip appends.
    fn record(&mut self, height: u64, hash: String) {
        if self.tip().is_some_and(|tip| height <= tip) {
            self.rewind_to(height.saturating_sub(1));
        }
        self.recent.push_back((height, hash));
        while self.recent.len() > self.capacity {
            self.recent.pop_front();
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ReorgSafeWatcher — deposit watching with parent-hash verification
// ─────────────────────────────────────────────────────────────────────────────

/// How many block headers one poll fetches while walking the chain forward.
/// A larger gap than this is taken on trust (the tip header is recorded as
/// [`Observation::Unverifiable`]): deposits are still gated behind
/// `required_confirmations`, so an unverifiable extension cannot credit
/// anything on its own.
const MAX_HEADERS_PER_POLL: usize = 32;

/// Outcome of one [`ReorgSafeWatcher::poll_once`].
#[derive(Debug, Default)]
pub struct PollReport {
    /// Deposits that passed the confirmation gate and were not seen before.
    pub emitted: Vec<ObservedDeposit>,
    /// When a reorg was detected: the common ancestor the watcher rewound to.
    /// Deposits above this height are re-scanned on the following polls.
    pub rewound_to: Option<u64>,
    /// The chain tip observed during this poll.
    pub tip: u64,
}

/// A deposit watcher that verifies block linkage before trusting a tip.
///
/// Each poll:
/// 1. Reads the chain tip and walks the block headers from the recorded tip
///    (or the node's tip when they diverge) upwards, feeding every header to
///    a [`ReorgTracker`].
/// 2. On a parent-hash mismatch, rewinds to the common ancestor — walking
///    back through the recorded hashes against the node's current canonical
///    chain — and re-scans from there.
/// 3. Fetches deposits from the (possibly rewound) cursor and emits only
///    those that are creditable, i.e. at or beyond
///    [`ChainClient::required_confirmations`] (12 for Base) with a positive
///    amount.
/// 4. Never emits the same reference twice within the process: the `seen`
///    ring-buffer short-circuits repeats, and the ledger's reference
///    idempotency is the durable backstop across restarts.
///
/// Chains that cannot report block headers (the default
/// [`ChainClient::block_record`] returns `Ok(None)`) skip steps 1–2 and rely
/// on confirmation depth alone; Stellar, whose ledgers are final once closed,
/// is such a chain.
pub struct ReorgSafeWatcher<C: ChainClient> {
    client: Arc<C>,
    tracker: ReorgTracker,
    /// First height that still needs scanning (deposits below
    /// `tip - required_confirmations + 1` are final and already handled).
    next_height: u64,
    seen: HashSet<String>,
    seen_order: VecDeque<String>,
}

impl<C: ChainClient> ReorgSafeWatcher<C> {
    /// Creates a watcher starting at `start_height`.
    pub fn new(client: Arc<C>, start_height: u64) -> Self {
        Self {
            client,
            tracker: ReorgTracker::new(DEFAULT_HISTORY),
            next_height: start_height,
            seen: HashSet::new(),
            seen_order: VecDeque::new(),
        }
    }

    /// The height the next deposit scan starts from.
    pub fn cursor(&self) -> u64 {
        self.next_height
    }

    /// The common ancestor of the last reorg detection, if any poll detected
    /// one. Exposed for observability and tests.
    pub fn recorded_tip(&self) -> Option<u64> {
        self.tracker.tip()
    }

    /// Runs one poll: verifies block linkage, rewinds on a reorg, and returns
    /// the deposits that became creditable. Errors from the chain surface
    /// unchanged; the cursor does not move on error.
    pub async fn poll_once(&mut self) -> Result<PollReport, ChainError> {
        let mut report = PollReport {
            tip: self.client.latest_height().await?,
            ..PollReport::default()
        };

        report.rewound_to = self.sync_headers(report.tip).await?;

        let deposits = self.client.deposits_since(self.next_height).await?;
        let required = self.client.required_confirmations();

        for deposit in deposits {
            // The confirmation gate: `is_creditable` only admits deposits at
            // or beyond `required_confirmations` (12 on Base) with a positive
            // amount, and the `seen` set drops overlap-by-one repeats.
            if !is_creditable(self.client.as_ref(), &deposit)
                || self.seen.contains(&deposit.reference)
            {
                continue;
            }
            self.remember(deposit.reference.clone());
            report.emitted.push(deposit);
        }

        // Advance the cursor no further than both (a) the last height whose
        // deposits are all final — younger blocks are re-scanned on the next
        // poll so their deposits get another chance at reaching the
        // confirmation depth — and (b) the highest linkage-verified height,
        // so the watcher never skips a range whose parent links it has not
        // checked. On chains without block headers (b) is the tip itself and
        // the confirmation depth alone decides.
        let verified_upto = self.tracker.tip().unwrap_or(report.tip);
        let final_upto = verified_upto.min(
            report
                .tip
                .saturating_sub(u64::from(required.saturating_sub(1))),
        );
        if final_upto > self.next_height {
            self.next_height = final_upto;
        }

        Ok(report)
    }

    /// Watches the chain until `cancel` is cancelled, forwarding each newly
    /// creditable deposit to `on_deposit`. Errors are logged and retried on
    /// the next tick; they never stop the loop.
    pub async fn run<F, Fut>(
        &mut self,
        poll_interval: Duration,
        cancel: CancellationToken,
        mut on_deposit: F,
    ) where
        F: FnMut(ObservedDeposit) -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        let mut ticker = tokio::time::interval(poll_interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                biased;
                () = cancel.cancelled() => {
                    info!("reorg-safe watcher cancelled; stopping");
                    return;
                }
                _ = ticker.tick() => {}
            }

            match self.poll_once().await {
                Ok(report) => {
                    if let Some(ancestor) = report.rewound_to {
                        warn!(
                            ancestor,
                            tip = report.tip,
                            "reorg detected; rewound to common ancestor"
                        );
                    }
                    for deposit in report.emitted {
                        on_deposit(deposit).await;
                    }
                }
                Err(error) => warn!(%error, "poll failed; retrying on next tick"),
            }
        }
    }

    /// Walks the canonical headers into the tracker and rewinds on a reorg.
    /// Returns the common ancestor when a rewind happened.
    async fn sync_headers(&mut self, tip: u64) -> Result<Option<u64>, ChainError> {
        let Some(recorded_tip) = self.tracker.tip() else {
            // First contact: record enough history that a reorg of the
            // confirmation window can be measured from the very next poll.
            self.backfill(tip).await;
            return Ok(None);
        };

        // Re-check the recorded tip itself: after a reorg its hash no longer
        // matches the node, and that mismatch is the signal. A node tip below
        // ours (the chain shortened under us) is checked the same way.
        let start = recorded_tip.min(tip);

        // Bound the walk; a larger gap is picked up over the following polls.
        let end = start
            .saturating_add(u64::try_from(MAX_HEADERS_PER_POLL).unwrap_or(u64::MAX))
            .min(tip);

        for height in start..=end {
            match self.client.block_record(height).await? {
                Some(record) => {
                    if let Observation::Reorg { suspect_from } = self.tracker.observe(record) {
                        return Ok(Some(self.rewind(suspect_from, height).await));
                    }
                }
                // The height no longer exists on the node while we recorded
                // it: the chain shortened under us, which is a reorg too.
                None if self.tracker.recorded_hash(height).is_some() => {
                    return Ok(Some(self.rewind(height, height).await));
                }
                // The chain reports no headers at all: fall back to relying
                // on confirmation depth alone.
                None => break,
            }
        }

        Ok(None)
    }

    /// Records up to [`DEFAULT_HISTORY`] canonical headers below `tip` so a
    /// reorg within the recorded window is measurable from the first poll.
    /// A chain that reports no headers leaves the tracker empty and the
    /// watcher then relies on confirmation depth alone. Backfill failures are
    /// logged, not fatal: deposits are still gated behind confirmations.
    async fn backfill(&mut self, tip: u64) {
        let mut collected = Vec::with_capacity(DEFAULT_HISTORY);
        let mut height = tip;
        loop {
            match self.client.block_record(height).await {
                Ok(Some(record)) => collected.push(record),
                Ok(None) => break,
                Err(error) => {
                    warn!(%error, height, "header backfill failed; continuing without it");
                    break;
                }
            }
            if height == 0 || collected.len() >= DEFAULT_HISTORY {
                break;
            }
            height = height.saturating_sub(1);
        }
        // Reverse to ascending height so linkage checks see a contiguous chain.
        collected.reverse();
        for record in collected {
            self.tracker.observe(record);
        }
    }

    /// Rewinds the tracker and the deposit cursor to the common ancestor at
    /// or below `suspect_from`, falling back to the oldest recorded block
    /// when the reorg is deeper than the recorded window. Returns the height
    /// the deposit scan restarts from.
    async fn rewind(&mut self, suspect_from: u64, fallback: u64) -> u64 {
        let target = match self.rewind_to_common_ancestor(suspect_from).await {
            Some(ancestor) => ancestor,
            None => {
                // Deeper than the recorded window: fall back to the oldest
                // block we still know and rescan from there.
                let oldest = self.tracker.oldest().unwrap_or(fallback);
                warn!(
                    target = oldest,
                    "reorg deeper than the recorded window; rescanning from oldest recorded block"
                );
                oldest
            }
        };
        self.tracker.rewind_to(target);
        if target < self.next_height {
            self.next_height = target;
        }
        target
    }

    /// Walks back from `suspect_from` asking the node for each block until a
    /// recorded hash still matches the canonical chain: the common ancestor.
    /// Returns `None` when the reorg is deeper than the tracker's window.
    async fn rewind_to_common_ancestor(&self, suspect_from: u64) -> Option<u64> {
        let mut height = suspect_from;
        while height > 0 {
            height = height.saturating_sub(1);
            let Some(recorded) = self.tracker.recorded_hash(height) else {
                // Below the recorded window: unverifiable.
                return None;
            };
            match self.client.block_record(height).await {
                Ok(Some(canonical)) if canonical.hash == recorded => return Some(height),
                // A hash that differs means the fork is even lower; a height
                // the node no longer has (shorter chain) means the same.
                Ok(Some(_)) | Ok(None) => continue,
                Err(error) => {
                    warn!(%error, height, "ancestor search failed; rescanning recorded window");
                    return None;
                }
            }
        }
        Some(0)
    }

    /// Inserts a reference into the bounded `seen` ring-buffer.
    fn remember(&mut self, reference: String) {
        self.seen.insert(reference.clone());
        self.seen_order.push_back(reference);
        while self.seen_order.len() > SEEN_CAPACITY {
            if let Some(oldest) = self.seen_order.pop_front() {
                self.seen.remove(&oldest);
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use super::*;

    /// Builds a record with placeholder parent hashes: `hash(n)` links to
    /// `hash(n-1)` unless the caller overrides the linkage.
    fn block(height: u64) -> BlockRecord {
        BlockRecord {
            height,
            hash: format!("hash-{height}"),
            parent_hash: format!("hash-{}", height.saturating_sub(1)),
        }
    }

    fn linked_from(blocks: &[BlockRecord], record: BlockRecord) -> BlockRecord {
        let parent_hash = blocks
            .iter()
            .find(|b| b.height + 1 == record.height)
            .map(|b| b.hash.clone())
            .unwrap_or(record.parent_hash);
        BlockRecord {
            parent_hash,
            ..record
        }
    }

    #[test]
    fn empty_tracker_seeds_on_first_block() {
        let mut tracker = ReorgTracker::new(DEFAULT_HISTORY);
        assert_eq!(tracker.observe(block(100)), Observation::Extended);
        assert_eq!(tracker.tip(), Some(100));
    }

    #[test]
    fn contiguous_blocks_extend() {
        let mut tracker = ReorgTracker::new(DEFAULT_HISTORY);
        let mut chain = vec![block(100)];
        tracker.observe(chain[0].clone());
        for height in 101..=105 {
            let next = linked_from(&chain, block(height));
            assert_eq!(tracker.observe(next.clone()), Observation::Extended);
            chain.push(next);
        }
        assert_eq!(tracker.tip(), Some(105));
    }

    #[test]
    fn same_block_twice_is_known() {
        let mut tracker = ReorgTracker::new(DEFAULT_HISTORY);
        tracker.observe(block(100));
        assert_eq!(tracker.observe(block(100)), Observation::Known);
        assert_eq!(tracker.tip(), Some(100));
    }

    #[test]
    fn parent_hash_mismatch_is_a_reorg() {
        let mut tracker = ReorgTracker::new(DEFAULT_HISTORY);
        for height in 100..=104 {
            tracker.observe(block(height));
        }
        // Block 105 arrives, but its parent is not our recorded 104.
        let orphaned_child = BlockRecord {
            height: 105,
            hash: "rival-105".to_owned(),
            parent_hash: "rival-104".to_owned(),
        };
        assert_eq!(
            tracker.observe(orphaned_child),
            Observation::Reorg { suspect_from: 104 }
        );
    }

    #[test]
    fn different_hash_at_same_height_is_a_reorg() {
        let mut tracker = ReorgTracker::new(DEFAULT_HISTORY);
        for height in 100..=103 {
            tracker.observe(block(height));
        }
        let replacement = BlockRecord {
            height: 103,
            hash: "rival-103".to_owned(),
            parent_hash: "hash-102".to_owned(),
        };
        assert_eq!(
            tracker.observe(replacement),
            Observation::Reorg { suspect_from: 103 }
        );
    }

    #[test]
    fn jump_forward_is_unverifiable() {
        let mut tracker = ReorgTracker::new(DEFAULT_HISTORY);
        tracker.observe(block(100));
        // Missing 101..=109: no parent link to check.
        assert_eq!(tracker.observe(block(110)), Observation::Unverifiable);
        assert_eq!(tracker.tip(), Some(110));
    }

    #[test]
    fn capacity_bounds_memory_and_oldest_hash() {
        let mut tracker = ReorgTracker::new(3);
        for height in 100..=104 {
            tracker.observe(block(height));
        }
        assert_eq!(tracker.tip(), Some(104));
        assert_eq!(tracker.recorded_hash(100), None, "evicted from the ring");
        assert_eq!(tracker.recorded_hash(102), Some("hash-102"));
    }

    #[test]
    fn zero_capacity_still_tracks_the_tip() {
        let mut tracker = ReorgTracker::new(0);
        tracker.observe(block(1));
        tracker.observe(block(2));
        assert_eq!(tracker.tip(), Some(2));
        assert_eq!(tracker.recorded_hash(1), None);
    }

    #[test]
    fn common_ancestor_is_the_newest_matching_block() {
        let mut tracker = ReorgTracker::new(DEFAULT_HISTORY);
        for height in 100..=105 {
            tracker.observe(block(height));
        }
        // The node reports a competing chain: 104 and 105 were replaced.
        let canonical = |height: u64| match height {
            h if h <= 103 => Some(format!("hash-{h}")),
            104 => Some("rival-104".to_owned()),
            _ => Some("rival-105".to_owned()),
        };
        assert_eq!(tracker.find_common_ancestor(105, canonical), Some(103));
    }

    #[test]
    fn common_ancestor_none_when_reorg_is_deeper_than_the_window() {
        let mut tracker = ReorgTracker::new(DEFAULT_HISTORY);
        for height in 100..=105 {
            tracker.observe(block(height));
        }
        let canonical = |_height: u64| Some("rival".to_owned());
        assert_eq!(tracker.find_common_ancestor(105, canonical), None);
    }

    #[test]
    fn common_ancestor_clamps_to_recorded_tip() {
        let mut tracker = ReorgTracker::new(DEFAULT_HISTORY);
        for height in 100..=105 {
            tracker.observe(block(height));
        }
        // Asking from above the tip still inspects the recorded window.
        let canonical = |height: u64| Some(format!("hash-{height}"));
        assert_eq!(tracker.find_common_ancestor(1_000, canonical), Some(105));
    }

    #[test]
    fn rewind_to_drops_replaced_blocks() {
        let mut tracker = ReorgTracker::new(DEFAULT_HISTORY);
        for height in 100..=105 {
            tracker.observe(block(height));
        }
        tracker.rewind_to(102);
        assert_eq!(tracker.tip(), Some(102));
        assert_eq!(tracker.recorded_hash(105), None);
        // The new branch can now be recorded from 103 upwards.
        assert_eq!(tracker.observe(block(103)), Observation::Extended);
    }

    #[test]
    fn recording_a_replacement_truncates_the_tail() {
        let mut tracker = ReorgTracker::new(DEFAULT_HISTORY);
        for height in 100..=105 {
            tracker.observe(block(height));
        }
        let replacement = BlockRecord {
            height: 104,
            hash: "rival-104".to_owned(),
            parent_hash: "hash-103".to_owned(),
        };
        tracker.observe(replacement.clone());
        assert_eq!(tracker.tip(), Some(104));
        assert_eq!(tracker.recorded_hash(105), None, "old tail dropped");
        assert_eq!(tracker.recorded_hash(104), Some("rival-104"));
    }
}
