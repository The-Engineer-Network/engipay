//! Sequential deposit creditor.
//!
//! Deposits emitted by [`ChainClient::stream_events`] can arrive at this
//! module in any order if the calling code dispatches events concurrently, or
//! if the underlying poll returns ledger events out of sequence during
//! catch-up.  To preserve ledger correctness — money must always be posted in
//! the order the network settled it — this module imposes a total ledger-height
//! ordering before any credit is applied.
//!
//! # Design
//!
//! ```text
//!   stream_events()   ──►  SequentialCreditor::push()
//!                               │
//!                               ▼
//!                         pending: BinaryHeap<PendingEvent>
//!                               │
//!                     (sorted ascending by height)
//!                               │
//!                               ▼
//!                    drain_ready() → credit in order
//! ```
//!
//! The creditor keeps a **min-heap** of [`LedgerEvent`]s ordered by `height`.
//! When [`SequentialCreditor::drain_ready`] is called it yields all events
//! whose height is at most `next_expected` (the next height the consumer is
//! waiting for), advancing `next_expected` after each one so the sequence is
//! always gapless.
//!
//! A bounded channel (capacity [`QUEUE_CAPACITY`]) provides back-pressure: if
//! the heap grows too large the caller should pause ingestion.
//!
//! # Invariants
//!
//! * Events at the same height are yielded together in a deterministic order
//!   (by the natural ordering of the heap).
//! * The `next_expected` cursor only advances forward; it never decreases.
//! * Duplicate heights are allowed (a single ledger may produce multiple events
//!   from different poll pages) and are all yielded.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use crate::LedgerEvent;

/// Maximum number of out-of-order events the creditor will hold in memory
/// before signalling back-pressure to the caller.
pub const QUEUE_CAPACITY: usize = 1_024;

// ── Ordering wrapper ──────────────────────────────────────────────────────────

/// Wraps a [`LedgerEvent`] so that a [`BinaryHeap`] (a max-heap by default)
/// behaves as a **min-heap** keyed on `height`.
///
/// `Reverse<u64>` gives us the min ordering; we store the full event alongside
/// so the heap entry is self-contained.
#[derive(Debug, Eq, PartialEq)]
struct PendingEvent {
    /// Negated height so `BinaryHeap` pops the *smallest* height first.
    key: Reverse<u64>,
    event: LedgerEvent,
}

impl PartialOrd for PendingEvent {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PendingEvent {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Primary: height ascending. Secondary: reference string of the first
        // deposit (if any) for a fully deterministic order within a height.
        self.key.cmp(&other.key).then_with(|| {
            let self_ref = self
                .event
                .deposits
                .first()
                .map(|d| d.reference.as_str())
                .unwrap_or("");
            let other_ref = other
                .event
                .deposits
                .first()
                .map(|d| d.reference.as_str())
                .unwrap_or("");
            self_ref.cmp(other_ref)
        })
    }
}

// ── SequentialCreditor ────────────────────────────────────────────────────────

/// Enforces chronological ledger order for incoming deposit events.
///
/// Call [`push`](Self::push) whenever a new [`LedgerEvent`] arrives.
/// Call [`drain_ready`](Self::drain_ready) to iterate over every event that
/// is now in order and ready to be credited.
///
/// The creditor is entirely in-memory and has no I/O of its own.  Persistence
/// of the high-water-mark is the caller's responsibility (e.g. the Stellar
/// cursor in `CursorStore`).
pub struct SequentialCreditor {
    /// Min-heap of events not yet emitted.
    pending: BinaryHeap<PendingEvent>,
    /// The next ledger height the consumer is waiting for.
    next_expected: u64,
}

impl SequentialCreditor {
    /// Creates a new creditor.
    ///
    /// `start_height` is the ledger height the consumer has already processed
    /// up to (inclusive).  The first event emitted will have height
    /// `start_height + 1` or higher.
    pub fn new(start_height: u64) -> Self {
        Self {
            pending: BinaryHeap::new(),
            next_expected: start_height.saturating_add(1),
        }
    }

    /// Returns the next ledger height this creditor is waiting for.
    ///
    /// Useful for monitoring and for deciding whether back-pressure is needed.
    pub fn next_expected(&self) -> u64 {
        self.next_expected
    }

    /// The number of events currently buffered and not yet drained.
    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }

    /// Returns `true` if adding one more event would exceed [`QUEUE_CAPACITY`].
    pub fn is_full(&self) -> bool {
        self.pending.len() >= QUEUE_CAPACITY
    }

    /// Enqueues a new [`LedgerEvent`].
    ///
    /// Events whose height is strictly less than the current `next_expected`
    /// are silently dropped — they have already been (or should have been)
    /// processed, and re-crediting them would violate the idempotency
    /// invariant.
    ///
    /// If the heap is already at capacity the event is logged and dropped
    /// rather than causing unbounded memory growth.  The caller is responsible
    /// for pausing upstream ingestion when [`is_full`](Self::is_full) returns
    /// `true`.
    pub fn push(&mut self, event: LedgerEvent) {
        if event.height < self.next_expected {
            tracing::debug!(
                height = event.height,
                next_expected = self.next_expected,
                "creditor: discarding already-seen ledger event"
            );
            return;
        }
        if self.pending.len() >= QUEUE_CAPACITY {
            tracing::warn!(
                height = event.height,
                capacity = QUEUE_CAPACITY,
                "creditor: queue is full; dropping event — upstream should pause"
            );
            return;
        }
        self.pending.push(PendingEvent {
            key: Reverse(event.height),
            event,
        });
    }

    /// Drains all buffered events that are now in order, yielding them in
    /// strictly ascending height order.
    ///
    /// An event at height `h` is *ready* when `h == self.next_expected`.
    /// After it is yielded, `next_expected` advances to `h + 1`, which may
    /// immediately unlock further events already in the heap.
    ///
    /// Returns a `Vec` rather than an iterator so the caller does not need to
    /// borrow the creditor mutably across an async boundary.
    pub fn drain_ready(&mut self) -> Vec<LedgerEvent> {
        let mut ready = Vec::new();
        loop {
            match self.pending.peek() {
                Some(top) if top.key.0 <= self.next_expected => {
                    // SAFETY: we just peeked and confirmed it exists.
                    let item = self.pending.pop().expect("peek said Some");
                    let height = item.event.height;
                    ready.push(item.event);
                    // Advance next_expected to height + 1, but only if this
                    // event was exactly at the cursor; events from the same
                    // height should all be popped before advancing.
                    if height >= self.next_expected {
                        self.next_expected = height.saturating_add(1);
                    }
                }
                _ => break,
            }
        }
        ready
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use engipay_core::{Asset, Money};

    use super::*;
    use crate::ObservedDeposit;

    fn deposit(minor: i128, reference: &str) -> ObservedDeposit {
        ObservedDeposit {
            money: Money::from_minor(Asset::Usdc, minor),
            address: "MABC".to_owned(),
            reference: reference.to_owned(),
            confirmations: 1,
        }
    }

    fn event(height: u64, deposits: Vec<ObservedDeposit>) -> LedgerEvent {
        LedgerEvent { height, deposits }
    }

    // ── happy-path ordering ───────────────────────────────────────────────────

    #[test]
    fn in_order_events_are_drained_immediately() {
        let mut c = SequentialCreditor::new(0);
        c.push(event(1, vec![deposit(100, "ref-1")]));
        c.push(event(2, vec![deposit(200, "ref-2")]));
        c.push(event(3, vec![deposit(300, "ref-3")]));

        let ready = c.drain_ready();
        assert_eq!(ready.len(), 3);
        assert_eq!(ready[0].height, 1);
        assert_eq!(ready[1].height, 2);
        assert_eq!(ready[2].height, 3);
        assert_eq!(c.next_expected(), 4);
    }

    #[test]
    fn out_of_order_event_is_held_until_gap_is_filled() {
        let mut c = SequentialCreditor::new(0);
        // Arrive out of order: 3, 1, 2.
        c.push(event(3, vec![deposit(300, "ref-3")]));
        c.push(event(1, vec![deposit(100, "ref-1")]));

        // Height 2 is still missing, so only height 1 is ready.
        let ready = c.drain_ready();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].height, 1);
        assert_eq!(c.pending_count(), 1);
        assert_eq!(c.next_expected(), 2);

        // Fill the gap.
        c.push(event(2, vec![deposit(200, "ref-2")]));
        let ready = c.drain_ready();
        assert_eq!(ready.len(), 2);
        assert_eq!(ready[0].height, 2);
        assert_eq!(ready[1].height, 3);
        assert_eq!(c.next_expected(), 4);
    }

    #[test]
    fn multiple_out_of_order_events_sorted_ascending() {
        let mut c = SequentialCreditor::new(0);
        // Push heights 5, 2, 4, 1, 3.
        c.push(event(5, vec![deposit(500, "r5")]));
        c.push(event(2, vec![deposit(200, "r2")]));
        c.push(event(4, vec![deposit(400, "r4")]));
        c.push(event(1, vec![deposit(100, "r1")]));
        c.push(event(3, vec![deposit(300, "r3")]));

        let ready = c.drain_ready();
        assert_eq!(ready.len(), 5);
        let heights: Vec<u64> = ready.iter().map(|e| e.height).collect();
        assert_eq!(heights, [1, 2, 3, 4, 5]);
    }

    // ── stale / already-seen events ───────────────────────────────────────────

    #[test]
    fn events_below_next_expected_are_discarded() {
        let mut c = SequentialCreditor::new(10);
        // Heights 8 and 9 are below the starting cursor.
        c.push(event(8, vec![deposit(80, "r8")]));
        c.push(event(9, vec![deposit(90, "r9")]));

        assert_eq!(c.pending_count(), 0, "old events must not be queued");

        // Height 11 is ready once we push 11 (next_expected is 11).
        c.push(event(11, vec![deposit(110, "r11")]));
        let ready = c.drain_ready();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].height, 11);
    }

    // ── same-height events ────────────────────────────────────────────────────

    #[test]
    fn two_events_at_same_height_are_both_emitted() {
        let mut c = SequentialCreditor::new(0);
        // Two poll pages both describe height 5 with different deposits.
        // Heights 1-4 arrive first, then two events at height 5.
        for h in 1u64..5 {
            c.push(event(h, vec![]));
        }
        c.push(event(5, vec![deposit(50, "r5-a")]));
        c.push(event(5, vec![deposit(55, "r5-b")]));

        let ready = c.drain_ready();
        // All six events drain (4 empty + 2 at height 5).
        assert_eq!(ready.len(), 6);
        // Both height-5 events are emitted.
        let height5: Vec<_> = ready.iter().filter(|e| e.height == 5).collect();
        assert_eq!(height5.len(), 2);
        // next_expected must advance past 5.
        assert_eq!(c.next_expected(), 6);
    }

    #[test]
    fn same_height_events_drain_when_already_at_that_height() {
        // Start the creditor already at height 4 (i.e. next_expected = 5).
        let mut c = SequentialCreditor::new(4);
        c.push(event(5, vec![deposit(50, "r5-a")]));
        c.push(event(5, vec![deposit(55, "r5-b")]));

        let ready = c.drain_ready();
        // Both events at height 5 should be immediately ready.
        assert_eq!(ready.len(), 2);
        assert!(ready.iter().all(|e| e.height == 5));
        assert_eq!(c.next_expected(), 6);
    }

    // ── gap with no events ────────────────────────────────────────────────────

    #[test]
    fn event_after_gap_waits_for_intervening_heights() {
        let mut c = SequentialCreditor::new(0);
        // Jump straight to height 10; heights 1–9 have not been seen.
        c.push(event(10, vec![deposit(1000, "r10")]));

        let ready = c.drain_ready();
        assert_eq!(ready.len(), 0, "height 10 must wait for 1–9");
        assert_eq!(c.pending_count(), 1);

        // Fill heights 1–9 with empty events (no deposits, but the height
        // is still a valid ledger event — e.g. a ledger with no payments).
        for h in 1u64..10 {
            c.push(event(h, vec![]));
        }
        let ready = c.drain_ready();
        // All 10 events are now ready (9 empty + 1 with deposit).
        assert_eq!(ready.len(), 10);
        assert_eq!(ready.last().unwrap().height, 10);
        assert_eq!(ready.last().unwrap().deposits[0].reference, "r10");
    }

    // ── is_full / back-pressure ───────────────────────────────────────────────

    #[test]
    fn is_full_returns_true_at_capacity() {
        let mut c = SequentialCreditor::new(0);
        // Fill the queue to capacity. Heights start at 1_000_000 so none are
        // ready (next_expected is 1) and they all stay buffered.
        for i in 0..QUEUE_CAPACITY {
            // Use a height far beyond next_expected so nothing drains.
            let h = 1_000_000u64.saturating_add(i as u64);
            c.push(event(h, vec![]));
        }
        assert!(c.is_full());
        // One more push must be silently dropped.
        let before = c.pending_count();
        c.push(event(1_000_000 + QUEUE_CAPACITY as u64 + 1, vec![]));
        assert_eq!(
            c.pending_count(),
            before,
            "over-capacity push must be dropped"
        );
    }

    // ── initial start_height ─────────────────────────────────────────────────

    #[test]
    fn creditor_starts_from_the_correct_next_expected() {
        let c = SequentialCreditor::new(99);
        assert_eq!(c.next_expected(), 100);
    }

    #[test]
    fn start_at_zero_accepts_height_one_first() {
        let mut c = SequentialCreditor::new(0);
        c.push(event(1, vec![deposit(1, "first")]));
        let ready = c.drain_ready();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].height, 1);
    }

    // ── empty state ───────────────────────────────────────────────────────────

    #[test]
    fn drain_on_empty_creditor_returns_empty_vec() {
        let mut c = SequentialCreditor::new(0);
        assert!(c.drain_ready().is_empty());
    }

    // ── deposit amounts are exact integers (no float) ─────────────────────────

    #[test]
    fn deposit_amounts_survive_ordering_without_rounding() {
        let mut c = SequentialCreditor::new(0);
        // Use amounts that would be affected by float rounding.
        c.push(event(2, vec![deposit(3, "r-b")]));
        c.push(event(1, vec![deposit(10_000_001, "r-a")]));

        let ready = c.drain_ready();
        assert_eq!(ready[0].deposits[0].money.minor, 10_000_001);
        assert_eq!(ready[1].deposits[0].money.minor, 3);
    }

    // ── ordering with multiple deposits per event ─────────────────────────────

    #[test]
    fn deposits_within_an_event_preserve_their_original_order() {
        let mut c = SequentialCreditor::new(0);
        let deposits = vec![
            deposit(100, "ref-first"),
            deposit(200, "ref-second"),
            deposit(300, "ref-third"),
        ];
        c.push(event(1, deposits.clone()));

        let ready = c.drain_ready();
        assert_eq!(ready[0].deposits.len(), 3);
        assert_eq!(ready[0].deposits[0].reference, "ref-first");
        assert_eq!(ready[0].deposits[1].reference, "ref-second");
        assert_eq!(ready[0].deposits[2].reference, "ref-third");
    }

    // ── next_expected never decreases ────────────────────────────────────────

    #[test]
    fn next_expected_never_decreases_after_draining() {
        let mut c = SequentialCreditor::new(0);
        c.push(event(3, vec![]));
        c.push(event(1, vec![]));
        c.push(event(2, vec![]));
        c.drain_ready();
        let after_drain = c.next_expected();

        // Even if we push a stale event, next_expected stays the same.
        c.push(event(1, vec![]));
        assert_eq!(c.next_expected(), after_drain);
    }
}
