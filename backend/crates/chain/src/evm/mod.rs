//! EVM (Base) chain support.
//!
//! Provides the Base JSON-RPC client ([`client`]), the USDC and native-ETH
//! deposit parsing it is built on ([`erc20`], [`eth`]), and a finalized-height
//! polling loop ([`watcher`]) the client can attach to. [`BaseClient`]
//! implements [`crate::ChainClient`], so `engipay-chain watch` polls it
//! alongside Stellar (see [`crate::watch`]).

pub mod client;
pub mod confirmations;
pub mod erc20;
pub mod eth;
pub mod watcher;

pub use client::BaseClient;
pub use erc20::BaseNetwork;

/// `chain_cursors.chain` value under which the Base watcher stores its cursor.
pub const BASE_CHAIN_KEY: &str = "base";

/// Why a transfer or event was not turned into a deposit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Skipped {
    /// Outgoing, zero-value, or not a transfer at all.
    NotIncoming,
    /// Transaction reverted.
    Failed,
    /// A token contract that is not the canonical USDC on this network.
    /// Security-sensitive: unauthorized tokens must be logged for audit.
    UnauthorizedContract(String),
    /// Structurally invalid or unparseable data.
    Malformed(&'static str),
}

impl Skipped {
    /// Whether this rejection requires security audit logging.
    pub fn is_security_sensitive(&self) -> bool {
        matches!(self, Skipped::UnauthorizedContract(_))
    }
}

/// Normalizes an Ethereum address to lowercase without the `0x` prefix removed.
///
/// Returns `None` for addresses that are not 42-character `0x`-prefixed hex.
/// Checksum validation is not performed (all valid checksums become lowercase).
pub fn normalize_address(address: &str) -> Option<String> {
    let stripped = address
        .strip_prefix("0x")
        .or_else(|| address.strip_prefix("0X"))?;
    if stripped.len() != 40 || !stripped.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("0x{}", stripped.to_ascii_lowercase()))
}

/// Parses a `0x`-prefixed hex quantity (Ethereum JSON-RPC format) into an `i128`.
///
/// Returns `None` for non-hex input or values that overflow `i128`.
pub fn parse_quantity(s: &str) -> Option<i128> {
    let hex = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X"))?;
    if hex.is_empty() {
        return Some(0);
    }
    // u128 first, then try to fit into i128.
    let value = u128::from_str_radix(hex, 16).ok()?;
    i128::try_from(value).ok()
}

/// Parses a `0x`-prefixed hex string into a `u64`.
///
/// Returns `None` for non-hex input or overflow.
pub fn parse_u64(s: &str) -> Option<u64> {
    let hex = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X"))?;
    if hex.is_empty() {
        return Some(0);
    }
    u64::from_str_radix(hex, 16).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_address_lowercases_checksummed_addresses() {
        assert_eq!(
            normalize_address("0xAbC0000000000000000000000000000000000001"),
            Some("0xabc0000000000000000000000000000000000001".to_owned())
        );
    }

    #[test]
    fn normalize_address_accepts_already_lowercase() {
        assert_eq!(
            normalize_address("0xabc0000000000000000000000000000000000001"),
            Some("0xabc0000000000000000000000000000000000001".to_owned())
        );
    }

    #[test]
    fn normalize_address_rejects_wrong_length() {
        assert_eq!(normalize_address("0x123"), None);
        assert_eq!(normalize_address("0xabcdef"), None);
        assert_eq!(
            normalize_address("0xabc000000000000000000000000000000000000011"),
            None
        );
    }

    #[test]
    fn normalize_address_rejects_non_hex() {
        assert_eq!(
            normalize_address("0xZZZ0000000000000000000000000000000000001"),
            None
        );
    }

    #[test]
    fn normalize_address_rejects_missing_prefix() {
        assert_eq!(
            normalize_address("abc0000000000000000000000000000000000001"),
            None
        );
    }

    #[test]
    fn parse_quantity_hex_values() {
        assert_eq!(parse_quantity("0x0"), Some(0));
        assert_eq!(parse_quantity("0x1"), Some(1));
        assert_eq!(parse_quantity("0xff"), Some(255));
        assert_eq!(
            parse_quantity("0xde0b6b3a7640000"),
            Some(1_000_000_000_000_000_000)
        );
    }

    #[test]
    fn parse_quantity_empty_hex_is_zero() {
        assert_eq!(parse_quantity("0x"), Some(0));
    }

    #[test]
    fn parse_quantity_rejects_non_hex() {
        assert_eq!(parse_quantity("1000"), None);
        assert_eq!(parse_quantity("0xGG"), None);
    }

    #[test]
    fn parse_quantity_max_i128() {
        let max_hex = format!("0x{:x}", i128::MAX);
        assert_eq!(parse_quantity(&max_hex), Some(i128::MAX));
    }

    #[test]
    fn parse_u64_parses_block_numbers() {
        assert_eq!(parse_u64("0x0"), Some(0));
        assert_eq!(parse_u64("0x64"), Some(100));
        assert_eq!(parse_u64("0x1a2b3c"), Some(0x1a2b3c));
    }

    #[test]
    fn parse_u64_rejects_overflow() {
        // 2^64 in hex
        assert_eq!(parse_u64("0x10000000000000000"), None);
    }
}
