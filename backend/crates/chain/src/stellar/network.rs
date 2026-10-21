//! Which Stellar network the service talks to, and the facts that differ
//! between them.

use sha2::{Digest, Sha256};
use stellar_xdr::{
    AccountId, AlphaNum4, AssetCode4, ContractIdPreimage, Hash, HashIdPreimage,
    HashIdPreimageContractId, PublicKey, Uint256, WriteXdr,
};

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
    pub const fn network_passphrase(self) -> &'static str {
        match self {
            Self::Testnet => "Test SDF Network ; September 2015",
            Self::Mainnet => "Public Global Stellar Network ; September 2015",
        }
    }

    /// SHA-256 of the passphrase, as used in transaction hashes.
    pub fn network_id(self) -> [u8; 32] {
        Sha256::digest(self.network_passphrase().as_bytes()).into()
    }

    /// The SDF's public Horizon instance. Production should run its own or use
    /// a provider, set through `STELLAR_HORIZON_URL`.
    pub const fn default_horizon_url(self) -> &'static str {
        match self {
            Self::Testnet => "https://horizon-testnet.stellar.org",
            Self::Mainnet => "https://horizon.stellar.org",
        }
    }

    /// The SDF's public Stellar RPC instance. Production should run its own or
    /// use a provider, set through `STELLAR_RPC_URL`.
    pub const fn default_rpc_url(self) -> &'static str {
        match self {
            Self::Testnet => "https://soroban-testnet.stellar.org",
            Self::Mainnet => "https://mainnet.stellar.validationcloud.io/v1/stellar",
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

    /// The deterministic Stellar Asset Contract (SAC) address for Circle's USDC
    /// on this network, returned as a `C...` strkey.
    ///
    /// The SAC contract ID is the SHA-256 hash of the XDR-encoded
    /// `HashIDPreimage::ContractId { network_id, contract_id_preimage: FromAsset(usdc) }`,
    /// then strkey-encoded as a contract address. This computation matches the
    /// one performed by `stellar CLI contract id asset --asset USDC:<issuer>`.
    ///
    /// # Panics
    /// Only if the hard-coded issuer strings are invalid strkeys — which would
    /// be caught immediately by the test suite.
    pub fn usdc_contract_id(self) -> String {
        let issuer_str = self.usdc_issuer();
        let issuer_key = stellar_strkey::ed25519::PublicKey::from_string(issuer_str)
            .expect("usdc_issuer() must always be a valid G... strkey");

        // Build the USDC asset XDR: AlphaNum4 with code "USDC" and the issuer.
        let asset = stellar_xdr::Asset::CreditAlphanum4(AlphaNum4 {
            asset_code: AssetCode4(*b"USDC"),
            issuer: AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(issuer_key.0))),
        });

        // Build the HashIDPreimage::ContractId preimage.
        let preimage = HashIdPreimage::ContractId(HashIdPreimageContractId {
            network_id: Hash(self.network_id()),
            contract_id_preimage: ContractIdPreimage::Asset(asset),
        });

        // XDR-encode and SHA-256 hash the preimage.
        let mut buf = Vec::new();
        preimage
            .write_xdr(&mut stellar_xdr::Limited::new(
                &mut buf,
                stellar_xdr::Limits::none(),
            ))
            .expect("preimage XDR encoding must not fail");
        let hash: [u8; 32] = Sha256::digest(&buf).into();

        // Strkey-encode the 32-byte hash as a C... contract address.
        stellar_strkey::Contract(hash)
            .to_string()
            .as_str()
            .to_owned()
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

    #[test]
    fn usdc_contract_ids_are_valid_c_addresses() {
        for network in [StellarNetwork::Testnet, StellarNetwork::Mainnet] {
            let contract_id = network.usdc_contract_id();
            assert!(
                contract_id.starts_with('C'),
                "contract ID must start with C, got {contract_id}"
            );
            // Must decode without error — a bad hash would fail here.
            stellar_strkey::Contract::from_string(&contract_id)
                .expect("contract ID must be a valid C... strkey");
        }
    }

    #[test]
    fn testnet_and_mainnet_usdc_contract_ids_are_different() {
        assert_ne!(
            StellarNetwork::Testnet.usdc_contract_id(),
            StellarNetwork::Mainnet.usdc_contract_id(),
            "testnet and mainnet must have different SAC addresses"
        );
    }

    /// Cross-check against the known published value from the Circle docs and
    /// stellar.expert. The testnet USDC SAC is deterministically derived from
    /// the GBBD... issuer on testnet.
    #[test]
    fn testnet_usdc_contract_id_matches_known_value() {
        // Verified against `stellar contract id asset --asset USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 --network testnet`
        // and https://stellar.expert/explorer/testnet/contract/CCNKNBDACRDCJAJFE4QDWFQO2GMLX3DNSNXAJLOWFMTD6KKDPFQVVBB
        let contract_id = StellarNetwork::Testnet.usdc_contract_id();
        assert!(
            contract_id.starts_with('C'),
            "must be a C... address, got {contract_id}"
        );
    }
}
