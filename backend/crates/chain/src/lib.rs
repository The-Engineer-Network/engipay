//! The chain service.
//!
//! This is the only EngiPay process that will ever hold signing keys, which is
//! why it is a separate binary from the API: the API can be compromised without
//! the attacker gaining the ability to move funds.
//!
//! Each network sits behind the same [`ChainClient`] trait, so the API and the
//! deposit watcher never care which network they are talking to. Stellar is
//! implemented ([`stellar`]); Base (via `alloy`) and Bitcoin (via `bdk`) come
//! next.

pub mod stellar;

use engipay_core::{Asset, Chain, Money};

#[derive(Debug, thiserror::Error)]
pub enum ChainError {
    #[error("{0:?} is not supported by this client")]
    UnsupportedChain(Chain),
    #[error("{0} is not supported by this client")]
    UnsupportedAsset(Asset),
    #[error("the node or RPC endpoint is unavailable: {0}")]
    Unavailable(String),
    /// The network refused a transaction, e.g. insufficient funds or a bad
    /// sequence number. Not retried blindly: the reason decides what happens.
    #[error("the network rejected the transaction: {0}")]
    Rejected(String),
    #[error("configuration: {0}")]
    Config(String),
    #[error("not implemented yet")]
    NotImplemented,
}

/// A transfer seen on-chain into one of EngiPay's deposit addresses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedDeposit {
    pub money: Money,
    pub address: String,
    /// Unique per credit, e.g. `base:<tx hash>:<log index>`. This becomes the
    /// ledger reference, which is what stops a deposit being credited twice.
    pub reference: String,
    pub confirmations: u32,
}

/// What every network implementation provides.
pub trait ChainClient: Send + Sync {
    fn chain(&self) -> Chain;

    /// Confirmations required before a deposit is credited.
    fn required_confirmations(&self) -> u32 {
        match self.chain() {
            Chain::Base => 12,
            Chain::Bitcoin => 2,
            // Stellar ledgers are final once closed: there are no reorgs to wait out.
            Chain::Stellar => 1,
        }
    }

    fn latest_height(&self) -> impl std::future::Future<Output = Result<u64, ChainError>> + Send;

    fn deposits_since(
        &self,
        height: u64,
    ) -> impl std::future::Future<Output = Result<Vec<ObservedDeposit>, ChainError>> + Send;
}

/// Whether an observed deposit may be credited yet.
pub fn is_creditable(client: &impl ChainClient, deposit: &ObservedDeposit) -> bool {
    deposit.money.is_positive() && deposit.confirmations >= client.required_confirmations()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeBase;

    impl ChainClient for FakeBase {
        fn chain(&self) -> Chain {
            Chain::Base
        }
        async fn latest_height(&self) -> Result<u64, ChainError> {
            Ok(100)
        }
        async fn deposits_since(&self, _height: u64) -> Result<Vec<ObservedDeposit>, ChainError> {
            Ok(Vec::new())
        }
    }

    fn deposit(confirmations: u32, minor: i128) -> ObservedDeposit {
        ObservedDeposit {
            money: Money::from_minor(Asset::Usdc, minor),
            address: "0xabc".to_owned(),
            reference: "base:0x1:0".to_owned(),
            confirmations,
        }
    }

    #[test]
    fn deposits_wait_for_enough_confirmations() {
        assert!(!is_creditable(&FakeBase, &deposit(11, 5)));
        assert!(is_creditable(&FakeBase, &deposit(12, 5)));
    }

    #[test]
    fn zero_value_deposits_are_never_credited() {
        assert!(!is_creditable(&FakeBase, &deposit(50, 0)));
    }
}
