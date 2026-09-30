//! EVM (Base) chain support.
//!
//! Currently provides a block header polling loop ([`watcher`]) that tracks
//! the latest finalized block on Base. Deposit watching and transaction signing
//! will follow once the finalized-height plumbing is in place.

pub mod watcher;
