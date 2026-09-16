//! Which Stellar network the service talks to, and the facts that differ
//! between them.

use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StellarNetwork {
    Testnet,
    Mainnet,
}

impl StellarNetwork {
    /// Reads `testnet` or `mainnet`. Anything else is an error, never a default:
    /// a typo must not quietly point a service at real money.
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "testnet" => Some(Self::Testnet),
            "mainnet" | "public" | "pubnet" => Some(Self::Mainnet),
            _ => None,
        }
    }

    /// The passphrase every transaction signature commits to. A transaction
    /// signed for one network is invalid on the other.
    pub const fn passphrase(self) -> &'static str {
        match self {
            Self::Testnet => "Test SDF Network ; September 2015",
            Self::Mainnet => "Public Global Stellar Network ; September 2015",
        }
    }

    /// SHA-256 of the passphrase, as used in transaction hashes.
    pub fn network_id(self) -> [u8; 32] {
        Sha256::digest(self.passphrase().as_bytes()).into()
    }

    /// The SDF's public Horizon instance. Production should run its own or use
    /// a provider, set through `STELLAR_HORIZON_URL`.
    pub const fn default_horizon_url(self) -> &'static str {
        match self {
            Self::Testnet => "https://horizon-testnet.stellar.org",
            Self::Mainnet => "https://horizon.stellar.org",
        }
    }

    /// Circle's USDC issuer. Only USDC from this exact account is USDC; any
    /// other account can issue a token called "USDC".
    pub const fn usdc_issuer(self) -> &'static str {
        match self {
            Self::Testnet => "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            Self::Mainnet => "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_network_names_are_refused() {
        assert_eq!(
            StellarNetwork::parse("Testnet"),
            Some(StellarNetwork::Testnet)
        );
        assert_eq!(
            StellarNetwork::parse("public"),
            Some(StellarNetwork::Mainnet)
        );
        assert_eq!(StellarNetwork::parse("tesnet"), None);
        assert_eq!(StellarNetwork::parse(""), None);
    }

    #[test]
    fn networks_have_different_ids() {
        assert_ne!(
            StellarNetwork::Testnet.network_id(),
            StellarNetwork::Mainnet.network_id()
        );
    }

    #[test]
    fn usdc_issuers_are_valid_accounts() {
        for network in [StellarNetwork::Testnet, StellarNetwork::Mainnet] {
            assert!(matches!(
                engipay_core::stellar::parse_address(network.usdc_issuer()),
                Ok(engipay_core::stellar::StellarAddress::Account(_))
            ));
        }
    }
}
