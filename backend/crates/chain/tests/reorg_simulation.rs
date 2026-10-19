//! Issue #381: a simulated chain reorganisation must make the watcher rewind
//! to the common ancestor, and nothing may ever be credited twice.
//!
//! [`FakeChain`] is an in-memory Base chain whose blocks carry deposits. The
//! test drives [`ReorgSafeWatcher`] poll by poll (no timers, no network),
//! swaps a branch out from under it mid-run, and pushes every emitted deposit
//! into the real in-memory [`engipay_ledger::Ledger`] to prove the reference
//! idempotency the production path relies on.
#![allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]

use std::sync::{Arc, Mutex};

use engipay_chain::reorg::{BlockRecord, ReorgSafeWatcher};
use engipay_chain::{ChainClient, ChainError, ObservedDeposit};
use engipay_core::{Asset, Chain, Money, UserId};
use engipay_ledger::Ledger;

/// First block of the simulated chain; heights are arbitrary.
const GENESIS: u64 = 100;

/// One block of the fake chain: a header plus the deposits mined into it.
#[derive(Clone)]
struct FakeBlock {
    record: BlockRecord,
    deposits: Vec<(String, i128)>,
}

#[derive(Default)]
struct ChainState {
    /// Contiguous ascending blocks; the last entry is the canonical tip.
    blocks: Vec<FakeBlock>,
}

/// An in-memory Base chain: 12 required confirmations from
/// [`ChainClient::required_confirmations`], real block headers through
/// [`ChainClient::block_record`], and a `reorg` that replaces a suffix of the
/// chain with a rival branch.
#[derive(Default)]
struct FakeChain {
    state: Mutex<ChainState>,
}

impl FakeChain {
    /// Builds `count` canonical blocks above the current tip, linking each new
    /// header to its parent by hash.
    fn mine(&self, count: u64) {
        let mut state = self.state.lock().expect("state lock");
        for _ in 0..count {
            let height = state
                .blocks
                .last()
                .map_or(GENESIS, |block| block.record.height + 1);
            state.blocks.push(FakeBlock {
                record: BlockRecord {
                    height,
                    hash: format!("hash-{height}"),
                    parent_hash: format!("hash-{}", height - 1),
                },
                deposits: Vec::new(),
            });
        }
    }

    /// Mines a deposit into the block at `height`.
    fn deposit(&self, height: u64, reference: &str, units: i128) {
        let mut state = self.state.lock().expect("state lock");
        let block = state
            .blocks
            .iter_mut()
            .find(|block| block.record.height == height)
            .unwrap_or_else(|| panic!("no block at height {height}"));
        block.deposits.push((reference.to_owned(), units));
    }

    /// Replaces every block at or above `from_height` with `count` rival
    /// blocks (`rival-<height>` hashes) and returns. Deposits that lived only
    /// on the replaced branch are gone; the caller re-mines any transaction
    /// that survived with the same transaction hash — and therefore the same
    /// reference.
    fn reorg(&self, from_height: u64, count: u64) {
        let mut state = self.state.lock().expect("state lock");
        let parent = state
            .blocks
            .iter()
            .find(|block| block.record.height + 1 == from_height)
            .map(|block| block.record.hash.clone())
            .expect("block below the fork point");
        state
            .blocks
            .retain(|block| block.record.height < from_height);
        for offset in 0..count {
            let height = from_height + offset;
            state.blocks.push(FakeBlock {
                record: BlockRecord {
                    height,
                    hash: format!("rival-{height}"),
                    parent_hash: if offset == 0 {
                        parent.clone()
                    } else {
                        format!("rival-{}", height - 1)
                    },
                },
                deposits: Vec::new(),
            });
        }
    }

    fn tip(&self) -> u64 {
        self.state
            .lock()
            .expect("state lock")
            .blocks
            .last()
            .expect("chain is never empty")
            .record
            .height
    }
}

impl ChainClient for FakeChain {
    fn chain(&self) -> Chain {
        Chain::Base
    }

    async fn latest_height(&self) -> Result<u64, ChainError> {
        Ok(self.tip())
    }

    async fn block_record(&self, height: u64) -> Result<Option<BlockRecord>, ChainError> {
        Ok(self
            .state
            .lock()
            .expect("state lock")
            .blocks
            .iter()
            .find(|block| block.record.height == height)
            .map(|block| block.record.clone()))
    }

    async fn deposits_since(&self, height: u64) -> Result<Vec<ObservedDeposit>, ChainError> {
        let state = self.state.lock().expect("state lock");
        let tip = state
            .blocks
            .last()
            .expect("chain is never empty")
            .record
            .height;
        let mut deposits = Vec::new();
        for block in &state.blocks {
            if block.record.height < height {
                continue;
            }
            let confirmations =
                u32::try_from(tip - block.record.height + 1).expect("confirmation count fits u32");
            for (reference, units) in &block.deposits {
                deposits.push(ObservedDeposit {
                    money: Money::from_network_units(Asset::Usdc, Chain::Base, *units)
                        .expect("valid amount"),
                    address: "0xc0ffee".to_owned(),
                    reference: reference.clone(),
                    confirmations,
                });
            }
        }
        Ok(deposits)
    }
}

/// Feeds emitted deposits into the ledger exactly like the production
/// creditor does, returning whether each one was credited or replayed.
fn credit_all(ledger: &mut Ledger, user: UserId, emitted: &[ObservedDeposit]) -> Vec<bool> {
    emitted
        .iter()
        .map(|deposit| {
            ledger
                .deposit(user, deposit.money, &deposit.reference)
                .expect("ledger accepts the deposit")
                .replayed
        })
        .collect()
}

/// The scenario from the issue's "Done when": the watcher rewinds to the
/// common ancestor on a simulated reorg and never credits anything twice.
#[tokio::test]
async fn watcher_rewinds_and_credits_nothing_twice() {
    let chain = Arc::new(FakeChain::default());
    chain.mine(16); // branch A: blocks 100..=115
    chain.deposit(101, "base:0xaaa:0", 15); // 16 confirmations at tip 115
    chain.deposit(110, "base:0xdead:0", 9); // orphaned later, never returns
    chain.deposit(114, "base:0xbbb:0", 5); // re-mined on the rival branch

    let mut watcher = ReorgSafeWatcher::new(chain.clone(), GENESIS);
    let user = UserId::new();
    let mut ledger = Ledger::new();
    let mut credited_refs: Vec<String> = Vec::new();

    // Poll 1: only the old, deep deposit is creditable. The recent one at
    // block 114 has 2 confirmations and must wait for the 12-confirmation
    // gate (`ChainClient::required_confirmations` for Base).
    let report = watcher.poll_once().await.expect("poll succeeds");
    assert_eq!(report.tip, 115);
    assert_eq!(report.rewound_to, None);
    let emitted = report.emitted;
    let emitted_refs: Vec<_> = emitted.iter().map(|d| d.reference.as_str()).collect();
    assert_eq!(emitted_refs, ["base:0xaaa:0"], "only the mature deposit");
    assert!(
        watcher.cursor() < 115,
        "cursor stays below the tip so young deposits are re-scanned"
    );
    credit_all(&mut ledger, user, &emitted);
    credited_refs.extend(emitted.into_iter().map(|d| d.reference));

    // The reorganisation: blocks 105..=115 are replaced by a rival branch
    // 105..=116. The orphaned deposit dies with them; the surviving
    // transaction is re-mined at the rival block 110 under the same
    // reference, and a brand-new deposit appears at 116.
    chain.reorg(105, 12);
    chain.deposit(110, "base:0xbbb:0", 5);
    chain.deposit(116, "base:0xccc:0", 7);

    // Poll 2: the parent-hash mismatch proves the reorg. The watcher rewinds
    // to the common ancestor (104) and re-scans the rival branch from there.
    let report = watcher.poll_once().await.expect("poll succeeds");
    assert_eq!(
        report.rewound_to,
        Some(104),
        "rewound to the common ancestor"
    );
    assert_eq!(
        watcher.cursor(),
        104,
        "the deposit scan restarts at the ancestor"
    );
    assert!(
        report.emitted.is_empty(),
        "the re-mined deposit still has only 7 confirmations"
    );

    // Mine 5 more rival blocks: the re-mined deposit reaches 12 confirmations
    // at rival tip 121, the new one has 6.
    chain.mine(5);
    let report = watcher.poll_once().await.expect("poll succeeds");
    assert_eq!(report.tip, 121);
    let emitted = report.emitted;
    let emitted_refs: Vec<_> = emitted.iter().map(|d| d.reference.as_str()).collect();
    assert_eq!(
        emitted_refs,
        ["base:0xbbb:0"],
        "re-mined deposit matures once"
    );
    credit_all(&mut ledger, user, &emitted);
    credited_refs.extend(emitted.into_iter().map(|d| d.reference));

    // Poll 4 with no new blocks: overlap-by-one must not re-emit it.
    let report = watcher.poll_once().await.expect("poll succeeds");
    assert!(report.emitted.is_empty(), "seen set drops the overlap");

    // Mine 6 more: the brand-new deposit reaches 12 confirmations at 127.
    chain.mine(6);
    let report = watcher.poll_once().await.expect("poll succeeds");
    assert_eq!(report.tip, 127);
    let emitted = report.emitted;
    let emitted_refs: Vec<_> = emitted.iter().map(|d| d.reference.as_str()).collect();
    assert_eq!(emitted_refs, ["base:0xccc:0"], "new-branch deposit matures");
    credit_all(&mut ledger, user, &emitted);
    credited_refs.extend(emitted.into_iter().map(|d| d.reference));

    // The deposit that only ever lived on the orphaned branch was never
    // emitted and therefore never credited.
    assert!(
        !credited_refs.iter().any(|r| r == "base:0xdead:0"),
        "orphaned deposit must never be credited"
    );

    // Nothing was credited twice: every reference went in exactly once and
    // the balance is the sum of exactly those deposits.
    assert_eq!(credited_refs.len(), 3, "three deposits credited, once each");
    let balance = ledger.balance(user, Asset::Usdc);
    assert_eq!(
        balance.available,
        (15 + 5 + 7) * 10,
        "minor units (USDC x10)"
    );
    assert_eq!(balance.held, 0);
}

/// A restarted process loses the in-memory `seen` set and re-scans the
/// overlap; the ledger's reference idempotency is the durable backstop that
/// makes the replay a no-op.
#[tokio::test]
async fn replay_after_restart_is_swallowed_by_the_ledger() {
    let chain = Arc::new(FakeChain::default());
    chain.mine(20); // blocks 100..=119
    chain.deposit(105, "base:0xaaa:0", 15);
    chain.deposit(110, "base:0xbbb:0", 5);

    let user = UserId::new();
    let mut ledger = Ledger::new();

    // First process: credits each deposit once its confirmations mature.
    let mut watcher = ReorgSafeWatcher::new(chain.clone(), GENESIS);
    let mut credited = Vec::new();
    let report = watcher.poll_once().await.expect("poll succeeds");
    credited.extend(report.emitted);
    chain.mine(2); // tip 121: the deposit at block 110 now has 12
    let report = watcher.poll_once().await.expect("poll succeeds");
    credited.extend(report.emitted);
    assert_eq!(credited.len(), 2);
    for replayed in credit_all(&mut ledger, user, &credited) {
        assert!(!replayed, "first credit is not a replay");
    }

    // "Restart": a fresh watcher resumes from the persisted cursor, has no
    // `seen` set, and re-emits the deposit inside the overlap window.
    let mut restarted = ReorgSafeWatcher::new(chain.clone(), watcher.cursor());
    let mut replay = Vec::new();
    for _ in 0..2 {
        let report = restarted.poll_once().await.expect("poll succeeds");
        replay.extend(report.emitted);
    }
    assert_eq!(
        replay.len(),
        1,
        "the restart re-scans the not-yet-final overlap window"
    );
    assert_eq!(replay[0].reference, "base:0xbbb:0");

    // The ledger refuses to credit the same references again.
    for replayed in credit_all(&mut ledger, user, &replay) {
        assert!(
            replayed,
            "ledger reference idempotency stops the double credit"
        );
    }
    let balance = ledger.balance(user, Asset::Usdc);
    assert_eq!(
        balance.available,
        (15 + 5) * 10,
        "balance moved exactly once"
    );
}

/// A chain that cannot report block headers (the default `block_record`)
/// still gets the confirmation gate and exactly-once emission; it just has no
/// parent hashes to verify.
#[tokio::test]
async fn headerless_chain_still_gates_on_confirmations() {
    struct Headerless(Arc<FakeChain>);

    impl ChainClient for Headerless {
        fn chain(&self) -> Chain {
            Chain::Base
        }

        async fn latest_height(&self) -> Result<u64, ChainError> {
            self.0.latest_height().await
        }

        async fn deposits_since(&self, height: u64) -> Result<Vec<ObservedDeposit>, ChainError> {
            self.0.deposits_since(height).await
        }
    }

    let chain = Arc::new(FakeChain::default());
    chain.mine(14); // blocks 100..=113
    chain.deposit(101, "base:0xaaa:0", 15);
    chain.deposit(113, "base:0xbbb:0", 5);

    let mut watcher = ReorgSafeWatcher::new(Arc::new(Headerless(chain.clone())), GENESIS);

    let report = watcher.poll_once().await.expect("poll succeeds");
    let refs: Vec<_> = report
        .emitted
        .iter()
        .map(|d| d.reference.as_str())
        .collect();
    assert_eq!(refs, ["base:0xaaa:0"], "only the mature deposit");

    chain.mine(11); // tip 124: the second deposit now has 12 confirmations
    let report = watcher.poll_once().await.expect("poll succeeds");
    let refs: Vec<_> = report
        .emitted
        .iter()
        .map(|d| d.reference.as_str())
        .collect();
    assert_eq!(
        refs,
        ["base:0xbbb:0"],
        "matures exactly once, no reorg check"
    );
}
