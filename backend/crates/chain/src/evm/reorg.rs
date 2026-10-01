//! Chain reorganisation detection for Base.
//!
//! Blocks that are not finalized yet can be replaced: the sequencer, or an L1
//! reorg underneath it, swaps the tip for a different chain. A deposit seen in
//! a replaced block may not exist on the new one, so the watcher has to notice
//! and look again from where the chains agree.
//!
//! [`ReorgDetector`] remembers the hashes of the last [`WINDOW`] blocks. Each
//! new block must name the remembered hash of the block before it as its
//! `parent_hash`. When it does not, the chain has changed under us:
//! [`ReorgDetector::find_fork_point`] walks back through the remembered blocks,
//! asking the node for the canonical hash at each height, until the two agree.
//! That height is the fork point; the cursor rewinds to just after it and the
//! detector forgets everything above it.
//!
//! Everything is pure except the hash lookup, which is passed in, so a reorg
//! can be simulated in tests without a node.

use std::collections::VecDeque;
use std::future::Future;

/// How many recent blocks are remembered. A reorg deeper than this cannot be
/// resolved here and is reported as [`ForkPoint::BeyondWindow`].
pub const WINDOW: usize = 20;

/// A block as far as reorg detection cares: its height and hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockRef {
    pub number: u64,
    /// `0x`-prefixed hex, lowercased so comparisons ignore case.
    pub hash: String,
}

impl BlockRef {
    pub fn new(number: u64, hash: &str) -> Self {
        Self {
            number,
            hash: normalize(hash),
        }
    }
}

/// What a newly observed block means for the chain we have been following.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Observation {
    /// The first block, or the next block on the chain we know. Recorded.
    Extends,
    /// A block we have already recorded, with the same hash. Nothing to do.
    AlreadySeen,
    /// The block skips heights we have not seen. Nothing was recorded: fetch
    /// and observe the blocks from `next` first, in order.
    Gap { next: u64 },
    /// The block does not build on the chain we recorded: its parent, or the
    /// block at its own height, differs. Resolve with
    /// [`ReorgDetector::find_fork_point`] before going on.
    Reorg { at: u64 },
}

/// Where two chains agree, once a reorg has been resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForkPoint {
    /// The chains agree up to and including `number`. Every block above it
    /// was forgotten; resume scanning at `number + 1`.
    At { number: u64 },
    /// None of the remembered blocks is still canonical: the reorg is deeper
    /// than the window. Everything was forgotten; resume no later than
    /// `oldest_forgotten`, and alert, since this should never happen on Base.
    BeyondWindow { oldest_forgotten: u64 },
}

impl ForkPoint {
    /// The first block height to scan again.
    pub fn resume_from(&self) -> u64 {
        match self {
            ForkPoint::At { number } => number.saturating_add(1),
            ForkPoint::BeyondWindow { oldest_forgotten } => *oldest_forgotten,
        }
    }
}

/// Remembers the last [`WINDOW`] blocks and checks each new one against them.
#[derive(Debug, Default, Clone)]
pub struct ReorgDetector {
    /// Oldest first, consecutive heights, at most [`WINDOW`] entries.
    recent: VecDeque<BlockRef>,
}

impl ReorgDetector {
    pub fn new() -> Self {
        Self::default()
    }

    /// The newest block recorded, if any.
    pub fn tip(&self) -> Option<&BlockRef> {
        self.recent.back()
    }

    /// The recorded hash at `number`, if it is still in the window.
    pub fn hash_at(&self, number: u64) -> Option<&str> {
        let oldest = self.recent.front()?.number;
        let index = usize::try_from(number.checked_sub(oldest)?).ok()?;
        self.recent.get(index).map(|block| block.hash.as_str())
    }

    /// Checks a new block against the recorded chain, recording it when it
    /// extends that chain.
    pub fn observe(&mut self, number: u64, hash: &str, parent_hash: &str) -> Observation {
        let hash = normalize(hash);
        let Some(tip) = self.recent.back() else {
            self.record(BlockRef { number, hash });
            return Observation::Extends;
        };
        let tip_number = tip.number;

        if number <= tip_number {
            return match self.hash_at(number) {
                Some(recorded) if recorded == hash => Observation::AlreadySeen,
                // Older than the window: nothing to compare it with.
                None => Observation::AlreadySeen,
                Some(_) => Observation::Reorg { at: number },
            };
        }

        let next = tip_number.saturating_add(1);
        if number > next {
            return Observation::Gap { next };
        }
        if normalize(parent_hash) != tip.hash {
            return Observation::Reorg { at: number };
        }
        self.record(BlockRef { number, hash });
        Observation::Extends
    }

    /// Walks back from the tip, asking `canonical_hash` for the node's current
    /// hash at each remembered height, until one matches. Forgets every block
    /// above the fork point. `canonical_hash` returns `None` when the node has
    /// no block at that height (it is behind); that height counts as replaced.
    pub async fn find_fork_point<F, Fut, E>(
        &mut self,
        mut canonical_hash: F,
    ) -> Result<ForkPoint, E>
    where
        F: FnMut(u64) -> Fut,
        Fut: Future<Output = Result<Option<String>, E>>,
    {
        let Some(oldest) = self.recent.front().map(|block| block.number) else {
            return Ok(ForkPoint::BeyondWindow {
                oldest_forgotten: 0,
            });
        };

        while let Some(block) = self.recent.back() {
            let number = block.number;
            let still_canonical = canonical_hash(number)
                .await?
                .is_some_and(|hash| normalize(&hash) == block.hash);
            if still_canonical {
                return Ok(ForkPoint::At { number });
            }
            self.recent.pop_back();
        }
        Ok(ForkPoint::BeyondWindow {
            oldest_forgotten: oldest,
        })
    }

    fn record(&mut self, block: BlockRef) {
        self.recent.push_back(block);
        while self.recent.len() > WINDOW {
            self.recent.pop_front();
        }
    }
}

/// The node's current hash at `number`, via `eth_getBlockByNumber`: the
/// lookup [`ReorgDetector::find_fork_point`] needs against a real node.
/// `Ok(None)` when the node has no block at that height yet.
pub async fn canonical_hash(
    http: &reqwest::Client,
    rpc_url: &str,
    number: u64,
) -> Result<Option<String>, crate::ChainError> {
    #[derive(serde::Deserialize)]
    struct Header {
        hash: String,
    }
    #[derive(serde::Deserialize)]
    struct Response {
        #[serde(default)]
        result: Option<Header>,
        #[serde(default)]
        error: Option<serde_json::Value>,
    }

    let unavailable = |error: reqwest::Error| crate::ChainError::Unavailable(error.to_string());
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_getBlockByNumber",
        "params": [format!("{number:#x}"), false],
    });
    let response: Response = http
        .post(rpc_url)
        .json(&body)
        .send()
        .await
        .map_err(unavailable)?
        .error_for_status()
        .map_err(unavailable)?
        .json()
        .await
        .map_err(unavailable)?;

    if let Some(error) = response.error {
        return Err(crate::ChainError::Unavailable(format!(
            "eth_getBlockByNumber failed: {error}"
        )));
    }
    Ok(response.result.map(|header| normalize(&header.hash)))
}

fn normalize(hash: &str) -> String {
    hash.trim().to_ascii_lowercase()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use std::collections::HashMap;
    use std::convert::Infallible;

    use super::*;

    /// A deterministic hash for block `number` on chain `fork`.
    fn hash(fork: char, number: u64) -> String {
        format!("0x{fork}{number:063x}")
    }

    /// A node that serves `chain` (height → hash) as canonical.
    fn node(
        chain: &HashMap<u64, String>,
    ) -> impl FnMut(u64) -> std::future::Ready<Result<Option<String>, Infallible>> + '_ {
        move |number| std::future::ready(Ok(chain.get(&number).cloned()))
    }

    /// Records blocks `from..=to` of chain `fork`, each built on the last.
    fn follow(detector: &mut ReorgDetector, fork: char, from: u64, to: u64) {
        for number in from..=to {
            let parent = if number == from && detector.tip().is_some() {
                detector.tip().unwrap().hash.clone()
            } else {
                hash(fork, number.saturating_sub(1))
            };
            assert_eq!(
                detector.observe(number, &hash(fork, number), &parent),
                Observation::Extends
            );
        }
    }

    #[test]
    fn consecutive_blocks_extend_the_chain() {
        let mut detector = ReorgDetector::new();
        follow(&mut detector, 'a', 100, 105);
        assert_eq!(detector.tip(), Some(&BlockRef::new(105, &hash('a', 105))));
        assert_eq!(detector.hash_at(102), Some(hash('a', 102).as_str()));
    }

    #[test]
    fn only_the_last_twenty_blocks_are_remembered() {
        let mut detector = ReorgDetector::new();
        follow(&mut detector, 'a', 1, 50);
        assert_eq!(detector.hash_at(30), None);
        assert_eq!(detector.hash_at(31), Some(hash('a', 31).as_str()));
        assert_eq!(detector.hash_at(50), Some(hash('a', 50).as_str()));
    }

    #[test]
    fn hashes_compare_case_insensitively() {
        let mut detector = ReorgDetector::new();
        detector.observe(1, "0xABCDEF", "0x00");
        assert_eq!(
            detector.observe(2, "0x1234", "0xabcdef"),
            Observation::Extends
        );
        assert_eq!(
            detector.observe(2, "0X1234", "0xabcdef"),
            Observation::AlreadySeen
        );
    }

    #[test]
    fn a_repeated_block_is_already_seen() {
        let mut detector = ReorgDetector::new();
        follow(&mut detector, 'a', 1, 5);
        assert_eq!(
            detector.observe(4, &hash('a', 4), &hash('a', 3)),
            Observation::AlreadySeen
        );
    }

    #[test]
    fn a_skipped_height_is_a_gap_and_is_not_recorded() {
        let mut detector = ReorgDetector::new();
        follow(&mut detector, 'a', 1, 5);
        assert_eq!(
            detector.observe(8, &hash('a', 8), &hash('a', 7)),
            Observation::Gap { next: 6 }
        );
        assert_eq!(detector.tip().unwrap().number, 5);
    }

    #[test]
    fn a_parent_hash_mismatch_is_a_reorg() {
        let mut detector = ReorgDetector::new();
        follow(&mut detector, 'a', 1, 5);
        assert_eq!(
            detector.observe(6, &hash('b', 6), &hash('b', 5)),
            Observation::Reorg { at: 6 }
        );
        // Nothing was recorded on the strength of a block that does not fit.
        assert_eq!(detector.tip().unwrap().hash, hash('a', 5));
    }

    #[test]
    fn a_different_block_at_a_seen_height_is_a_reorg() {
        let mut detector = ReorgDetector::new();
        follow(&mut detector, 'a', 1, 5);
        assert_eq!(
            detector.observe(5, &hash('b', 5), &hash('a', 4)),
            Observation::Reorg { at: 5 }
        );
    }

    #[tokio::test]
    async fn a_two_block_reorg_rewinds_to_the_fork_point() {
        // We followed chain `a` to block 110. The node now says blocks 109 and
        // 110 were replaced by chain `b`, which forks after block 108.
        let mut detector = ReorgDetector::new();
        follow(&mut detector, 'a', 100, 110);

        let mut canonical: HashMap<u64, String> = (100..=108)
            .map(|number| (number, hash('a', number)))
            .collect();
        for number in 109..=111 {
            canonical.insert(number, hash('b', number));
        }

        // Block 111 on `b` names `b`'s 110 as its parent, which is not ours.
        assert_eq!(
            detector.observe(111, &hash('b', 111), &hash('b', 110)),
            Observation::Reorg { at: 111 }
        );

        let fork = detector.find_fork_point(node(&canonical)).await.unwrap();
        assert_eq!(fork, ForkPoint::At { number: 108 });
        assert_eq!(fork.resume_from(), 109);

        // The replaced blocks are forgotten, and the new chain is followed
        // from the fork point.
        assert_eq!(detector.tip(), Some(&BlockRef::new(108, &hash('a', 108))));
        assert_eq!(detector.hash_at(109), None);
        assert_eq!(
            detector.observe(109, &hash('b', 109), &hash('a', 108)),
            Observation::Extends
        );
        assert_eq!(
            detector.observe(110, &hash('b', 110), &hash('b', 109)),
            Observation::Extends
        );
        assert_eq!(
            detector.observe(111, &hash('b', 111), &hash('b', 110)),
            Observation::Extends
        );
    }

    #[tokio::test]
    async fn a_node_that_is_behind_counts_as_replaced() {
        let mut detector = ReorgDetector::new();
        follow(&mut detector, 'a', 1, 10);
        // The node only knows blocks up to 8, matching ours.
        let canonical: HashMap<u64, String> =
            (1..=8).map(|number| (number, hash('a', number))).collect();

        let fork = detector.find_fork_point(node(&canonical)).await.unwrap();
        assert_eq!(fork, ForkPoint::At { number: 8 });
    }

    #[tokio::test]
    async fn a_reorg_deeper_than_the_window_is_reported() {
        let mut detector = ReorgDetector::new();
        follow(&mut detector, 'a', 1, 30);
        // Every remembered block (11..=30) was replaced.
        let canonical: HashMap<u64, String> =
            (1..=31).map(|number| (number, hash('b', number))).collect();

        let fork = detector.find_fork_point(node(&canonical)).await.unwrap();
        assert_eq!(
            fork,
            ForkPoint::BeyondWindow {
                oldest_forgotten: 11
            }
        );
        assert_eq!(fork.resume_from(), 11);
        assert_eq!(detector.tip(), None);
    }

    #[tokio::test]
    async fn canonical_hashes_come_from_eth_get_block_by_number() {
        use wiremock::matchers::{body_partial_json, method};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let rpc = MockServer::start().await;
        Mock::given(method("POST"))
            .and(body_partial_json(serde_json::json!({
                "method": "eth_getBlockByNumber",
                "params": ["0x6c", false],
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 1,
                "result": { "number": "0x6c", "hash": "0xABC108", "parentHash": "0xabc107" },
            })))
            .mount(&rpc)
            .await;
        Mock::given(method("POST"))
            .and(body_partial_json(
                serde_json::json!({ "params": ["0x6d", false] }),
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 1, "result": null,
            })))
            .mount(&rpc)
            .await;

        let http = reqwest::Client::new();
        assert_eq!(
            canonical_hash(&http, &rpc.uri(), 108).await.unwrap(),
            Some("0xabc108".to_owned())
        );
        assert_eq!(canonical_hash(&http, &rpc.uri(), 109).await.unwrap(), None);
    }

    #[tokio::test]
    async fn lookup_errors_are_returned_and_nothing_is_forgotten() {
        let mut detector = ReorgDetector::new();
        follow(&mut detector, 'a', 1, 5);
        let result = detector
            .find_fork_point(|_| std::future::ready(Err::<Option<String>, _>("node down")))
            .await;
        assert_eq!(result, Err("node down"));
        assert_eq!(detector.tip().unwrap().number, 5);
    }
}
