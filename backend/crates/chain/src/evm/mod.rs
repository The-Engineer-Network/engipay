//! Base (EVM) deposit detection.
//!
//! Everything here is pure: JSON-RPC responses in, deposits out. The RPC
//! client that fetches blocks and logs is a separate concern.

pub mod confirmations;
pub mod erc20;
pub mod eth;

/// Why a transaction or log was not turned into a deposit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Skipped {
    /// Not addressed to one of our deposit addresses, or carries no value.
    NotIncoming,
    /// Reverted on-chain: no value actually moved.
    Failed,
    /// A `Transfer` from a contract other than the canonical USDC, e.g. a fake
    /// token. Security-sensitive: someone may be probing for a false credit.
    UnauthorizedContract(String),
    Malformed(&'static str),
}

impl Skipped {
    pub fn is_security_sensitive(&self) -> bool {
        matches!(self, Skipped::UnauthorizedContract(_))
    }
}

/// Validates a `0x`-prefixed 20-byte address and lowercases it, so addresses
/// compare equal regardless of EIP-55 checksum casing.
pub fn normalize_address(input: &str) -> Option<String> {
    let hex = input.strip_prefix("0x")?;
    (hex.len() == 40 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
        .then(|| format!("0x{}", hex.to_ascii_lowercase()))
}

/// Parses a JSON-RPC hex quantity (e.g. `"0x1bc16d674ec80000"`). `None` if it
/// is malformed or does not fit the ledger's `i128`.
pub(crate) fn parse_quantity(input: &str) -> Option<i128> {
    let hex = input.strip_prefix("0x")?;
    if hex.is_empty() {
        return None;
    }
    let value = u128::from_str_radix(hex, 16).ok()?;
    i128::try_from(value).ok()
}

pub(crate) fn parse_u64(input: &str) -> Option<u64> {
    parse_quantity(input).and_then(|v| u64::try_from(v).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_are_validated_and_lowercased() {
        assert_eq!(
            normalize_address("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").as_deref(),
            Some("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")
        );
        assert_eq!(
            normalize_address("833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
            None
        );
        assert_eq!(normalize_address("0x1234"), None);
        assert_eq!(
            normalize_address("0xzz3589fcd6edb6e08f4c7c32d4f71b54bda02913"),
            None
        );
    }

    #[test]
    fn quantities_parse_or_refuse() {
        assert_eq!(parse_quantity("0x0"), Some(0));
        assert_eq!(
            parse_quantity("0x1bc16d674ec80000"),
            Some(2_000_000_000_000_000_000)
        );
        assert_eq!(parse_quantity("0x"), None);
        assert_eq!(parse_quantity("12"), None);
        // Above i128::MAX: refused rather than wrapped.
        assert_eq!(parse_quantity(&format!("0x{}", "f".repeat(32))), None);
    }
}
