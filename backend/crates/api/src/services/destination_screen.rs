//! Destination screening for withdrawals.
//!
//! A [`DestinationScreen`] is consulted before any hold is placed. If it
//! returns [`Blocked`], the withdrawal is refused and no funds are locked.
//!
//! # Production data source
//!
//! The static list here is a placeholder. In production the set of blocked
//! addresses would be populated from one or more of:
//!
//! * **Chainalysis / Elliptic** — industry-standard on-chain risk APIs that
//!   flag sanctioned wallets and mixer outputs in real time.
//! * **OFAC SDN list** — the US Treasury sanctions list; many jurisdictions
//!   require this as a minimum.
//! * **Internal incidents** — addresses flagged by EngiPay's own fraud team
//!   following a dispute or theft report.
//!
//! The integration point is this trait: swap [`StaticBlockList`] for a
//! struct that calls the chosen API and the rest of the withdrawal flow stays
//! unchanged.

use std::collections::HashSet;

/// The outcome of a destination screen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScreenResult {
    /// The address passed all checks; the withdrawal may proceed.
    Allowed,
    /// The address is on a block list; the withdrawal must be refused.
    Blocked {
        /// A short reason returned to the caller so it can surface a useful
        /// message without leaking operational details.
        reason: String,
    },
}

impl ScreenResult {
    /// Returns `true` when the destination is blocked.
    pub fn is_blocked(&self) -> bool {
        matches!(self, ScreenResult::Blocked { .. })
    }
}

/// A service that decides whether a withdrawal destination may receive funds.
pub trait DestinationScreen: Send + Sync {
    /// Screen `destination`.  The string is the raw user-supplied address and
    /// may be in any normalisation (uppercase EVM, lowercase, with or without
    /// `0x`).  Implementations must normalise before comparing.
    fn screen(&self, destination: &str) -> ScreenResult;
}

/// A [`DestinationScreen`] backed by an in-memory set of blocked addresses.
///
/// Address comparison is **case-insensitive** so EVM checksum capitalisation
/// (`0xAbCd…` vs `0xabcd…`) does not allow a blocked address through.
pub struct StaticBlockList {
    /// Blocked addresses stored as lowercase.
    blocked: HashSet<String>,
}

impl StaticBlockList {
    /// Builds a block list from a slice of addresses.
    /// Addresses are normalised to lowercase on insertion.
    pub fn new(blocked: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            blocked: blocked
                .into_iter()
                .map(|a| a.into().trim().to_ascii_lowercase())
                .collect(),
        }
    }

    /// An empty block list that allows every address.
    pub fn empty() -> Self {
        Self::new(std::iter::empty::<String>())
    }
}

impl DestinationScreen for StaticBlockList {
    fn screen(&self, destination: &str) -> ScreenResult {
        let normalised = destination.trim().to_ascii_lowercase();
        if self.blocked.contains(&normalised) {
            ScreenResult::Blocked {
                reason: "destination address is not permitted".to_string(),
            }
        } else {
            ScreenResult::Allowed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── StaticBlockList ───────────────────────────────────────────────────────

    #[test]
    fn listed_address_is_blocked() {
        let screen = StaticBlockList::new(["0xdeadbeef00000000000000000000000000000001"]);
        assert_eq!(
            screen.screen("0xdeadbeef00000000000000000000000000000001"),
            ScreenResult::Blocked {
                reason: "destination address is not permitted".to_string()
            }
        );
    }

    #[test]
    fn unlisted_address_is_allowed() {
        let screen = StaticBlockList::new(["0xdeadbeef00000000000000000000000000000001"]);
        assert_eq!(
            screen.screen("0xffffffff00000000000000000000000000000002"),
            ScreenResult::Allowed
        );
    }

    // EVM addresses may arrive in EIP-55 mixed-case checksum form. The screen
    // must block them regardless of capitalisation.
    #[test]
    fn evm_address_blocked_regardless_of_case() {
        let lower = "0xdeadbeef00000000000000000000000000000001";
        let mixed = "0xDeAdBeEf00000000000000000000000000000001";
        let upper = "0xDEADBEEF00000000000000000000000000000001";

        let screen = StaticBlockList::new([lower]);
        assert_eq!(
            screen.screen(mixed),
            ScreenResult::Blocked {
                reason: "destination address is not permitted".to_string()
            }
        );
        assert_eq!(
            screen.screen(upper),
            ScreenResult::Blocked {
                reason: "destination address is not permitted".to_string()
            }
        );
        assert_eq!(
            screen.screen(lower),
            ScreenResult::Blocked {
                reason: "destination address is not permitted".to_string()
            }
        );
    }

    #[test]
    fn empty_list_allows_everything() {
        let screen = StaticBlockList::empty();
        assert_eq!(
            screen.screen("0xdeadbeef00000000000000000000000000000001"),
            ScreenResult::Allowed
        );
    }

    #[test]
    fn stellar_address_can_be_blocked() {
        let addr = "GBLOCKED1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        let screen = StaticBlockList::new([addr]);
        assert_eq!(
            screen.screen(addr),
            ScreenResult::Blocked {
                reason: "destination address is not permitted".to_string()
            }
        );
    }

    #[test]
    fn addresses_are_trimmed_on_insert_and_lookup() {
        let screen = StaticBlockList::new(["  0xdeadbeef00000000000000000000000000000001  "]);
        assert_eq!(
            screen.screen("  0xdeadbeef00000000000000000000000000000001  "),
            ScreenResult::Blocked {
                reason: "destination address is not permitted".to_string()
            }
        );
    }

    // ── ScreenResult ─────────────────────────────────────────────────────────

    #[test]
    fn blocked_is_blocked() {
        assert!(ScreenResult::Blocked {
            reason: "test".to_string()
        }
        .is_blocked());
    }

    #[test]
    fn allowed_is_not_blocked() {
        assert!(!ScreenResult::Allowed.is_blocked());
    }
}
