use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::AppState;

/// Supported chains for deposit address generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Chain {
    Stellar,
    Base,
    Bitcoin,
}

/// Base mainnet chain id used by EIP-681 payment URIs.
const BASE_CHAIN_ID: u64 = 8453;

/// Response payload for a deposit address request.
///
/// Includes the raw address plus a standards-compliant payment URI so that
/// external wallets can render a scannable QR code without extra metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DepositAddressResponse {
    pub chain: Chain,
    pub address: String,
    /// Standard payment URI for the chain:
    /// - Stellar: `web+stellar:pay?destination=M...` (SEP-7)
    /// - Base: `ethereum:0x...@8453` (EIP-681)
    /// - Bitcoin: `bitcoin:<address>` (BIP-21)
    pub payment_uri: String,
}

/// Build a SEP-7 payment URI for a Stellar account.
///
/// Reference: <https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md>
pub fn stellar_payment_uri(destination: &str) -> String {
    format!("web+stellar:pay?destination={destination}")
}

/// Build an EIP-681 payment URI for an EVM address on Base mainnet.
///
/// Reference: <https://eips.ethereum.org/EIPS/eip-681>
pub fn base_payment_uri(address: &str) -> String {
    format!("ethereum:{address}@{BASE_CHAIN_ID}")
}

/// Build a BIP-21 payment URI for a Bitcoin address.
///
/// Reference: <https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki>
pub fn bitcoin_payment_uri(address: &str) -> String {
    format!("bitcoin:{address}")
}

/// Generate the standard payment URI for the given chain and address.
pub fn payment_uri_for(chain: Chain, address: &str) -> String {
    match chain {
        Chain::Stellar => stellar_payment_uri(address),
        Chain::Base => base_payment_uri(address),
        Chain::Bitcoin => bitcoin_payment_uri(address),
    }
}

/// `GET /v1/deposits/:chain/:address`
///
/// Returns the deposit address together with its standard payment URI.
pub async fn get_deposit_address(
    State(_state): State<AppState>,
    Path((chain, address)): Path<(Chain, String)>,
) -> impl IntoResponse {
    let payment_uri = payment_uri_for(chain, &address);
    (
        StatusCode::OK,
        Json(DepositAddressResponse {
            chain,
            address,
            payment_uri,
        }),
    )
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/deposits/:chain/:address", get(get_deposit_address))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stellar_uri_matches_sep7_format() {
        let uri = stellar_payment_uri("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
        assert_eq!(
            uri,
            "web+stellar:pay?destination=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        );
        assert!(uri.starts_with("web+stellar:pay?destination="));
    }

    #[test]
    fn base_uri_matches_eip681_format() {
        let uri = base_payment_uri("0x1234567890abcdef1234567890abcdef12345678");
        assert_eq!(
            uri,
            "ethereum:0x1234567890abcdef1234567890abcdef12345678@8453"
        );
        assert!(uri.starts_with("ethereum:0x"));
        assert!(uri.ends_with("@8453"));
    }

    #[test]
    fn bitcoin_uri_matches_bip21_format() {
        let uri = bitcoin_payment_uri("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
        assert_eq!(uri, "bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
        assert!(uri.starts_with("bitcoin:"));
    }

    #[test]
    fn payment_uri_for_dispatches_by_chain() {
        assert_eq!(
            payment_uri_for(Chain::Stellar, "GABC"),
            "web+stellar:pay?destination=GABC"
        );
        assert_eq!(payment_uri_for(Chain::Base, "0xabc"), "ethereum:0xabc@8453");
        assert_eq!(payment_uri_for(Chain::Bitcoin, "bc1abc"), "bitcoin:bc1abc");
    }
}
