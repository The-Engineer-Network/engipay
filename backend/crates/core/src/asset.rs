use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// The networks EngiPay moves money on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Chain {
    Base,
    Bitcoin,
}

/// Every asset EngiPay holds. Adding one is a deliberate change here, not a
/// string that shows up in a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(into = "&'static str", try_from = "String")]
pub enum Asset {
    Eth,
    Usdc,
    Btc,
}

impl Asset {
    pub const ALL: [Asset; 3] = [Asset::Eth, Asset::Usdc, Asset::Btc];

    pub const fn symbol(self) -> &'static str {
        match self {
            Asset::Eth => "ETH",
            Asset::Usdc => "USDC",
            Asset::Btc => "BTC",
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Asset::Eth => "Ether",
            Asset::Usdc => "USD Coin",
            Asset::Btc => "Bitcoin",
        }
    }

    /// Smallest-unit precision, as the chain defines it: wei, USDC units, sats.
    pub const fn decimals(self) -> u32 {
        match self {
            Asset::Eth => 18,
            Asset::Usdc => 6,
            Asset::Btc => 8,
        }
    }

    pub const fn chain(self) -> Chain {
        match self {
            Asset::Eth | Asset::Usdc => Chain::Base,
            Asset::Btc => Chain::Bitcoin,
        }
    }
}

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
    fn decimals_match_the_chains() {
        assert_eq!(Asset::Eth.decimals(), 18);
        assert_eq!(Asset::Usdc.decimals(), 6);
        assert_eq!(Asset::Btc.decimals(), 8);
        assert_eq!(Asset::Btc.chain(), Chain::Bitcoin);
    }
}
