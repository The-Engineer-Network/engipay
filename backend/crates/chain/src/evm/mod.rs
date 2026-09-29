//! Base EVM chain support.

pub mod erc20;

pub use erc20::{
    BaseDepositReference, BaseReferenceError, BaseTransferKind, base_erc20_deposit_reference,
    base_native_eth_deposit_reference, format_base_erc20_reference,
    format_base_native_eth_reference,
};
