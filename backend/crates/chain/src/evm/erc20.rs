//! Base EVM deposit processing and deterministic idempotency reference formatting.
//!
//! For Base deposits, EngiPay constructs unique idempotency references to prevent double-crediting
//! and guarantee that multi-transfer transactions produce unique ledger postings per recipient:
//! - ERC-20 transfers: `base:<tx_hash>:<log_index>`
//! - Native ETH transfers: `base:eth:<tx_hash>`

use std::fmt;
use std::str::FromStr;

use engipay_core::{Asset, Chain, Money};
use serde::{Deserialize, Serialize};

use crate::ObservedDeposit;

/// Error encountered when validating or formatting Base deposit references.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BaseReferenceError {
    #[error("transaction hash cannot be empty")]
    EmptyTxHash,
    #[error("transaction hash contains invalid hex characters: {0}")]
    InvalidHex(String),
    #[error(
        "transaction hash length is invalid: expected 64 hex characters (or 66 with 0x), got {0}"
    )]
    InvalidLength(usize),
    #[error(
        "invalid reference format: expected 'base:<tx_hash>:<log_index>' or 'base:eth:<tx_hash>', got '{0}'"
    )]
    InvalidFormat(String),
    #[error("invalid log index in reference: {0}")]
    InvalidLogIndex(String),
}

/// The kind of transfer observed on Base.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BaseTransferKind {
    /// An ERC-20 token transfer event with a specific log index in the transaction receipt.
    Erc20 { log_index: u64 },
    /// A native Ether transfer (call or top-level tx).
    NativeEth,
}

/// A structured, deterministic idempotency reference for a Base deposit.
///
/// Formats:
/// - ERC-20: `base:<tx_hash>:<log_index>`
/// - Native ETH: `base:eth:<tx_hash>`
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct BaseDepositReference {
    kind: BaseTransferKind,
    tx_hash: String,
}

impl BaseDepositReference {
    /// Constructs and validates a new Base deposit reference for an ERC-20 transfer.
    pub fn erc20(tx_hash: &str, log_index: u64) -> Result<Self, BaseReferenceError> {
        let normalized_hash = normalize_tx_hash(tx_hash)?;
        Ok(Self {
            kind: BaseTransferKind::Erc20 { log_index },
            tx_hash: normalized_hash,
        })
    }

    /// Constructs and validates a new Base deposit reference for a native ETH transfer.
    pub fn native_eth(tx_hash: &str) -> Result<Self, BaseReferenceError> {
        let normalized_hash = normalize_tx_hash(tx_hash)?;
        Ok(Self {
            kind: BaseTransferKind::NativeEth,
            tx_hash: normalized_hash,
        })
    }

    /// The kind of transfer.
    pub const fn kind(&self) -> BaseTransferKind {
        self.kind
    }

    /// The normalized 0x-prefixed transaction hash.
    pub fn tx_hash(&self) -> &str {
        &self.tx_hash
    }

    /// Returns the formatted reference string.
    pub fn as_str(&self) -> String {
        match self.kind {
            BaseTransferKind::Erc20 { log_index } => {
                format!("base:{}:{}", self.tx_hash, log_index)
            }
            BaseTransferKind::NativeEth => {
                format!("base:eth:{}", self.tx_hash)
            }
        }
    }
}

impl fmt::Display for BaseDepositReference {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.kind {
            BaseTransferKind::Erc20 { log_index } => {
                write!(f, "base:{}:{}", self.tx_hash, log_index)
            }
            BaseTransferKind::NativeEth => {
                write!(f, "base:eth:{}", self.tx_hash)
            }
        }
    }
}

impl FromStr for BaseDepositReference {
    type Err = BaseReferenceError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let parts: Vec<&str> = s.split(':').collect();
        match parts.as_slice() {
            ["base", "eth", tx_hash] => Self::native_eth(tx_hash),
            ["base", tx_hash, log_index_str] => {
                let log_index = log_index_str.parse::<u64>().map_err(|_| {
                    BaseReferenceError::InvalidLogIndex((*log_index_str).to_owned())
                })?;
                Self::erc20(tx_hash, log_index)
            }
            _ => Err(BaseReferenceError::InvalidFormat(s.to_owned())),
        }
    }
}

/// Normalizes and validates an EVM transaction hash.
///
/// Ensures the hash is non-empty, contains valid hexadecimal characters,
/// is 32 bytes (64 hex characters, or 66 with a `0x` prefix), and returns
/// a canonical lowercase `0x`-prefixed string.
pub fn normalize_tx_hash(raw_hash: &str) -> Result<String, BaseReferenceError> {
    let trimmed = raw_hash.trim();
    if trimmed.is_empty() {
        return Err(BaseReferenceError::EmptyTxHash);
    }

    let hex_part = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    if hex_part.len() != 64 {
        return Err(BaseReferenceError::InvalidLength(hex_part.len()));
    }

    if !hex_part.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(BaseReferenceError::InvalidHex(trimmed.to_owned()));
    }

    Ok(format!("0x{}", hex_part.to_ascii_lowercase()))
}

/// Formats the unique idempotency reference for an ERC-20 transfer on Base.
///
/// Format: `base:<tx_hash>:<log_index>`
/// Validates and normalizes the transaction hash.
pub fn format_base_erc20_reference(
    tx_hash: &str,
    log_index: u64,
) -> Result<String, BaseReferenceError> {
    BaseDepositReference::erc20(tx_hash, log_index).map(|r| r.to_string())
}

/// Formats the unique idempotency reference for a native ETH transfer on Base.
///
/// Format: `base:eth:<tx_hash>`
/// Validates and normalizes the transaction hash.
pub fn format_base_native_eth_reference(tx_hash: &str) -> Result<String, BaseReferenceError> {
    BaseDepositReference::native_eth(tx_hash).map(|r| r.to_string())
}

/// Direct format helper for Base ERC-20 deposit reference without failing.
/// Normalizes the hash if valid or lowercases as fallback.
pub fn base_erc20_deposit_reference(tx_hash: &str, log_index: u64) -> String {
    format_base_erc20_reference(tx_hash, log_index)
        .unwrap_or_else(|_| format!("base:{}:{}", tx_hash.trim().to_ascii_lowercase(), log_index))
}

/// Direct format helper for Base native ETH deposit reference without failing.
/// Normalizes the hash if valid or lowercases as fallback.
pub fn base_native_eth_deposit_reference(tx_hash: &str) -> String {
    format_base_native_eth_reference(tx_hash)
        .unwrap_or_else(|_| format!("base:eth:{}", tx_hash.trim().to_ascii_lowercase()))
}

/// Details of an observed Base ERC-20 transfer event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaseErc20Transfer {
    pub tx_hash: String,
    pub log_index: u64,
    pub to_address: String,
    pub token_address: String,
    pub raw_amount: u128,
    pub confirmations: u32,
}

/// Details of an observed Base native ETH transfer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaseEthTransfer {
    pub tx_hash: String,
    pub to_address: String,
    pub wei_amount: u128,
    pub confirmations: u32,
}

/// Errors during deposit conversion.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BaseDepositError {
    #[error("reference error: {0}")]
    Reference(#[from] BaseReferenceError),
    #[error("amount conversion out of range")]
    AmountOutOfRange,
    #[error("unsupported asset for Base EVM: {0}")]
    UnsupportedAsset(Asset),
}

/// Converts an observed Base ERC-20 transfer into an [`ObservedDeposit`].
///
/// Uses integer-only arithmetic to convert raw token units to EngiPay money,
/// preserving strict type safety without floating point operations.
pub fn deposit_from_erc20(
    transfer: &BaseErc20Transfer,
    asset: Asset,
) -> Result<ObservedDeposit, BaseDepositError> {
    if !asset.is_on(Chain::Base) {
        return Err(BaseDepositError::UnsupportedAsset(asset));
    }

    let minor =
        i128::try_from(transfer.raw_amount).map_err(|_| BaseDepositError::AmountOutOfRange)?;

    let money = Money::from_network_units(asset, Chain::Base, minor)
        .map_err(|_| BaseDepositError::AmountOutOfRange)?;

    let reference = format_base_erc20_reference(&transfer.tx_hash, transfer.log_index)?;

    Ok(ObservedDeposit {
        money,
        address: transfer.to_address.clone(),
        reference,
        confirmations: transfer.confirmations,
    })
}

/// Converts an observed Base native ETH transfer into an [`ObservedDeposit`].
pub fn deposit_from_eth(transfer: &BaseEthTransfer) -> Result<ObservedDeposit, BaseDepositError> {
    let minor =
        i128::try_from(transfer.wei_amount).map_err(|_| BaseDepositError::AmountOutOfRange)?;

    let money = Money::from_network_units(Asset::Eth, Chain::Base, minor)
        .map_err(|_| BaseDepositError::AmountOutOfRange)?;

    let reference = format_base_native_eth_reference(&transfer.tx_hash)?;

    Ok(ObservedDeposit {
        money,
        address: transfer.to_address.clone(),
        reference,
        confirmations: transfer.confirmations,
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    const SAMPLE_HASH_LOWER: &str =
        "0x4a2c14041b619ee945842fcb0be0f81d113ae8b9d88ab1a129033f6797a7a14e";
    const SAMPLE_HASH_UPPER: &str =
        "0X4A2C14041B619EE945842FCB0BE0F81D113AE8B9D88AB1A129033F6797A7A14E";
    const SAMPLE_HASH_RAW: &str =
        "4a2c14041b619ee945842fcb0be0f81d113ae8b9d88ab1a129033f6797a7a14e";

    #[test]
    fn erc20_reference_format_matches_specification() {
        let reference = format_base_erc20_reference(SAMPLE_HASH_LOWER, 0).unwrap();
        assert_eq!(
            reference,
            "base:0x4a2c14041b619ee945842fcb0be0f81d113ae8b9d88ab1a129033f6797a7a14e:0"
        );

        let reference_log_12 = format_base_erc20_reference(SAMPLE_HASH_LOWER, 12).unwrap();
        assert_eq!(
            reference_log_12,
            "base:0x4a2c14041b619ee945842fcb0be0f81d113ae8b9d88ab1a129033f6797a7a14e:12"
        );
    }

    #[test]
    fn native_eth_reference_format_matches_specification() {
        let reference = format_base_native_eth_reference(SAMPLE_HASH_LOWER).unwrap();
        assert_eq!(
            reference,
            "base:eth:0x4a2c14041b619ee945842fcb0be0f81d113ae8b9d88ab1a129033f6797a7a14e"
        );
    }

    #[test]
    fn multi_transfer_transactions_produce_unique_references() {
        // Multi-transfer transactions produce unique references per log index
        let ref_transfer_0 = format_base_erc20_reference(SAMPLE_HASH_LOWER, 0).unwrap();
        let ref_transfer_1 = format_base_erc20_reference(SAMPLE_HASH_LOWER, 1).unwrap();
        let ref_transfer_2 = format_base_erc20_reference(SAMPLE_HASH_LOWER, 2).unwrap();

        assert_ne!(ref_transfer_0, ref_transfer_1);
        assert_ne!(ref_transfer_1, ref_transfer_2);
        assert_ne!(ref_transfer_0, ref_transfer_2);
    }

    #[test]
    fn normalizes_hash_case_and_prefix() {
        // Uppercase input is canonicalized to lowercase
        let ref_upper = format_base_erc20_reference(SAMPLE_HASH_UPPER, 5).unwrap();
        let ref_lower = format_base_erc20_reference(SAMPLE_HASH_LOWER, 5).unwrap();
        let ref_raw = format_base_erc20_reference(SAMPLE_HASH_RAW, 5).unwrap();

        assert_eq!(ref_upper, ref_lower);
        assert_eq!(ref_raw, ref_lower);
    }

    #[test]
    fn roundtrip_from_str_and_display() {
        let erc20_str = format!("base:{SAMPLE_HASH_LOWER}:42");
        let parsed_erc20: BaseDepositReference = erc20_str.parse().unwrap();
        assert_eq!(
            parsed_erc20.kind(),
            BaseTransferKind::Erc20 { log_index: 42 }
        );
        assert_eq!(parsed_erc20.tx_hash(), SAMPLE_HASH_LOWER);
        assert_eq!(parsed_erc20.to_string(), erc20_str);

        let eth_str = format!("base:eth:{SAMPLE_HASH_LOWER}");
        let parsed_eth: BaseDepositReference = eth_str.parse().unwrap();
        assert_eq!(parsed_eth.kind(), BaseTransferKind::NativeEth);
        assert_eq!(parsed_eth.tx_hash(), SAMPLE_HASH_LOWER);
        assert_eq!(parsed_eth.to_string(), eth_str);
    }

    #[test]
    fn rejects_invalid_tx_hashes() {
        // Empty
        assert!(matches!(
            format_base_erc20_reference("", 0),
            Err(BaseReferenceError::EmptyTxHash)
        ));
        // Too short
        assert!(matches!(
            format_base_erc20_reference("0x1234", 0),
            Err(BaseReferenceError::InvalidLength(4))
        ));
        // Too long
        assert!(matches!(
            format_base_erc20_reference(&format!("{SAMPLE_HASH_LOWER}aa"), 0),
            Err(BaseReferenceError::InvalidLength(66))
        ));
        // Non-hex
        let mut non_hex = SAMPLE_HASH_LOWER.to_owned();
        non_hex.replace_range(10..11, "z");
        assert!(matches!(
            format_base_erc20_reference(&non_hex, 0),
            Err(BaseReferenceError::InvalidHex(_))
        ));
    }

    #[test]
    fn rejects_malformed_reference_strings() {
        assert!("invalid:format".parse::<BaseDepositReference>().is_err());
        assert!("base:eth".parse::<BaseDepositReference>().is_err());
        assert!(
            "base:0x123:notanumber"
                .parse::<BaseDepositReference>()
                .is_err()
        );
        assert!("stellar:0x123:0".parse::<BaseDepositReference>().is_err());
    }

    #[test]
    fn constructs_observed_deposit_from_erc20() {
        let transfer = BaseErc20Transfer {
            tx_hash: SAMPLE_HASH_LOWER.to_owned(),
            log_index: 3,
            to_address: "0x1111111111111111111111111111111111111111".to_owned(),
            token_address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".to_owned(),
            raw_amount: 10_000_000, // 10 USDC (6 decimals on Base)
            confirmations: 15,
        };

        let deposit = deposit_from_erc20(&transfer, Asset::Usdc).unwrap();
        assert_eq!(deposit.reference, format!("base:{SAMPLE_HASH_LOWER}:3"));
        assert_eq!(deposit.address, transfer.to_address);
        assert_eq!(deposit.confirmations, 15);
        // Ledger USDC has 7 decimals: 10 USDC = 100_000_000 minor units
        assert_eq!(deposit.money, Money::from_minor(Asset::Usdc, 100_000_000));
    }

    #[test]
    fn constructs_observed_deposit_from_native_eth() {
        let transfer = BaseEthTransfer {
            tx_hash: SAMPLE_HASH_LOWER.to_owned(),
            to_address: "0x2222222222222222222222222222222222222222".to_owned(),
            wei_amount: 1_000_000_000_000_000_000, // 1 ETH (18 decimals)
            confirmations: 20,
        };

        let deposit = deposit_from_eth(&transfer).unwrap();
        assert_eq!(deposit.reference, format!("base:eth:{SAMPLE_HASH_LOWER}"));
        assert_eq!(deposit.address, transfer.to_address);
        assert_eq!(deposit.confirmations, 20);
        assert_eq!(
            deposit.money,
            Money::from_minor(Asset::Eth, 1_000_000_000_000_000_000)
        );
    }

    #[test]
    fn direct_helpers_format_without_panicking() {
        assert_eq!(
            base_erc20_deposit_reference(SAMPLE_HASH_LOWER, 7),
            format!("base:{SAMPLE_HASH_LOWER}:7")
        );
        assert_eq!(
            base_native_eth_deposit_reference(SAMPLE_HASH_LOWER),
            format!("base:eth:{SAMPLE_HASH_LOWER}")
        );
    }
}
