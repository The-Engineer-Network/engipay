//! Base EVM RPC connectivity. Deposit watching and signing are separate concerns.

pub mod provider;

pub use provider::{AlloyProvider, BaseNetwork, ProviderHealth};
