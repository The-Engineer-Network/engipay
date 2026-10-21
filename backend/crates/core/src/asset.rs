use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// The networks EngiPay moves money on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Chain {
    Base,
    Bitcoin,
    Stellar,
}

impl Chain {
    pub const ALL: [Chain; 3] = [Chain::Base, Chain::Bitcoin, Chain::Stellar];
}

/// Every asset EngiPay holds. Adding one is a deliberate change here, not a
/// string that shows up in a request.
///
/// An asset is the *currency*, not where it lives. A user holding USDC has one
/// USDC balance whether it arrived on Base or on Stellar; the network only
/// matters when money enters or leaves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(into = "&'static str", try_from = "String")]
pub enum Asset {
    Eth,
    Usdc,
    Btc,
    Xlm,
}

impl Asset {
    pub const ALL: [Asset; 4] = [Asset::Eth, Asset::Usdc, Asset::Btc, Asset::Xlm];

    pub const fn symbol(self) -> &'static str {
        match self {
            Asset::Eth => "ETH",
            Asset::Usdc => "USDC",
            Asset::Btc => "BTC",
            Asset::Xlm => "XLM",
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Asset::Eth => "Ether",
            Asset::Usdc => "USD Coin",
            Asset::Btc => "Bitcoin",
            Asset::Xlm => "Stellar Lumens",
        }
    }

    /// The networks this asset can be deposited from and withdrawn to.
    pub const fn networks(self) -> &'static [Chain] {
        match self {
            Asset::Eth => &[Chain::Base],
            Asset::Usdc => &[Chain::Base, Chain::Stellar],
            Asset::Btc => &[Chain::Bitcoin],
            Asset::Xlm => &[Chain::Stellar],
        }
    }

    pub fn is_on(self, chain: Chain) -> bool {
        self.networks().contains(&chain)
    }

    /// Precision the *ledger* stores this asset at: the finest precision of any
    /// network it lives on, so a deposit from any network is recorded exactly.
    /// USDC is 6 decimals on Base but 7 on Stellar, so the ledger uses 7.
    pub const fn decimals(self) -> u32 {
        match self {
            Asset::Eth => 18,
            Asset::Usdc => 7,
            Asset::Btc => 8,
            Asset::Xlm => 7,
        }
    }

    /// Precision on a specific network, or `None` if the asset is not on it.
    pub const fn network_decimals(self, chain: Chain) -> Option<u32> {
        match (self, chain) {
            (Asset::Eth, Chain::Base) => Some(18),
            (Asset::Usdc, Chain::Base) => Some(6),
            (Asset::Usdc, Chain::Stellar) => Some(7),
            (Asset::Btc, Chain::Bitcoin) => Some(8),
            (Asset::Xlm, Chain::Stellar) => Some(7),
            _ => None,
        }
    }

    /// The Stellar asset code, or `None` if the asset is not on Stellar.
    ///
    /// XLM is the native asset and has no issuer; issued assets use their
    /// on-chain code, which may differ in case from the ledger symbol.
    pub const fn stellar_asset_code(self) -> Option<&'static str> {
        match self {
            Asset::Usdc => Some("USDC"),
            Asset::Xlm => Some("XLM"),
            _ => None,
        }
    }

    /// The Stellar issuer account for an issued asset, or `None` for the
    /// native asset (XLM) and for assets that are not on Stellar.
    pub const fn stellar_issuer(self) -> Option<&'static str> {
        match self {
            Asset::Usdc => Some(USDC_STELLAR_ISSUER),
            _ => None,
        }
    }

    /// The `CODE:ISSUER` identifier Horizon uses in path queries, or `None`
    /// if the asset is not on Stellar.
    ///
    /// The native asset is identified as `native`, which is what Horizon
    /// expects in `source_asset_*` / `destination_asset_*` parameters.
    pub fn stellar_asset_id(self) -> Option<String> {
        if !self.is_on(Chain::Stellar) {
            return None;
        }
        match (self.stellar_asset_code(), self.stellar_issuer()) {
            (Some(code), Some(issuer)) => Some(format!("{code}:{issuer}")),
            (Some(_), None) => Some("native".to_owned()),
            (None, _) => None,
        }
    }
}

/// Issuer of USDC on Stellar. Mainnet and testnet use different issuers, so
/// callers that need testnet must override this via configuration.
pub const USDC_STELLAR_ISSUER: &str =
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

impl fmt::Display for Asset {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.symbol())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("unsupported asset: {0}")]
pub struct UnknownAsset(pub String);

impl FromStr for Asset {
    type Err = UnknownAsset;

    /// Case-insensitive, so "usdc" and "USDC" are the same asset.
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Asset::ALL
            .into_iter()
            .find(|asset| asset.symbol().eq_ignore_ascii_case(value.trim()))
            .ok_or_else(|| UnknownAsset(value.to_owned()))
    }
}

impl From<Asset> for &'static str {
    fn from(asset: Asset) -> Self {
        asset.symbol()
    }
}

impl TryFrom<String> for Asset {
    type Error = UnknownAsset;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        value.parse()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_symbols_case_insensitively() {
        assert_eq!("usdc".parse::<Asset>(), Ok(Asset::Usdc));
        assert_eq!(" BTC ".parse::<Asset>(), Ok(Asset::Btc));
        assert_eq!("xlm".parse::<Asset>(), Ok(Asset::Xlm));
    }

    #[test]
    fn rejects_unknown_assets() {
        assert!("DOGE".parse::<Asset>().is_err());
        assert!("".parse::<Asset>().is_err());
    }

    #[test]
    fn serialises_as_the_symbol() {
        assert_eq!(
            serde_json::to_string(&Asset::Eth).ok().as_deref(),
            Some("\"ETH\"")
        );
        assert_eq!(
            serde_json::from_str::<Asset>("\"usdc\"").ok(),
            Some(Asset::Usdc)
        );
    }

    #[test]
    fn usdc_lives_on_base_and_stellar() {
        assert_eq!(Asset::Usdc.networks(), &[Chain::Base, Chain::Stellar]);
        assert!(Asset::Xlm.is_on(Chain::Stellar));
        assert!(!Asset::Eth.is_on(Chain::Stellar));
        assert!(!Asset::Btc.is_on(Chain::Base));
    }

    /// The ledger must be able to record any deposit exactly, so its precision
    /// is never coarser than any network the asset lives on.
    #[test]
    fn ledger_precision_covers_every_network() {
        for asset in Asset::ALL {
            assert!(!asset.networks().is_empty(), "{asset} has no network");
            for &chain in asset.networks() {
                let network = asset.network_decimals(chain);
                assert!(network.is_some(), "{asset} on {chain:?} has no precision");
                assert!(
                    network.is_some_and(|d| d <= asset.decimals()),
                    "{asset} on {chain:?} is finer than the ledger"
                );
            }
        }
    }

    #[test]
    fn network_precision_is_none_off_network() {
        assert_eq!(Asset::Usdc.network_decimals(Chain::Base), Some(6));
        assert_eq!(Asset::Usdc.network_decimals(Chain::Stellar), Some(7));
        assert_eq!(Asset::Eth.network_decimals(Chain::Stellar), None);
    }

    #[test]
    fn stellar_asset_ids_are_code_colon_issuer() {
        assert_eq!(
            Asset::Usdc.stellar_asset_id().as_deref(),
            Some("USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN")
        );
        assert_eq!(Asset::Xlm.stellar_asset_id().as_deref(), Some("native"));
    }

    #[test]
    fn stellar_asset_ids_are_none_off_stellar() {
        assert_eq!(Asset::Eth.stellar_asset_id(), None);
        assert_eq!(Asset::Btc.stellar_asset_id(), None);
        assert_eq!(Asset::Eth.stellar_asset_code(), None);
        assert_eq!(Asset::Btc.stellar_issuer(), None);
    }

    #[test]
    fn native_asset_has_no_issuer() {
        assert_eq!(Asset::Xlm.stellar_asset_code(), Some("XLM"));
        assert_eq!(Asset::Xlm.stellar_issuer(), None);
    }
}
