
export const SmartChainAssets = {
    _TESTNET_WBTC_VESU: {
        pricing: {
            binancePair: "WBTCBTC",
            okxPair: "WBTC-BTC",
            coinGeckoCoinId: "wrapped-bitcoin",
            coinPaprikaCoinId: "wbtc-wrapped-bitcoin",
            krakenPair: "WBTCXBT"
        },
        name: "Wrapped BTC (WBTC)"
    },
    _PBTC_DEV: {
        pricing: {
            binancePair: "$fixed-100000000",
            okxPair: "$fixed-100000000",
            coinGeckoCoinId: "$fixed-100000000",
            coinPaprikaCoinId: "$fixed-100000000",
            krakenPair: "$fixed-100000000"
        },
        name: "pegBTC (dev)"
    },
    WBTC: {
        pricing: {
            binancePair: "WBTCBTC",
            okxPair: "WBTC-BTC",
            coinGeckoCoinId: "wrapped-bitcoin",
            coinPaprikaCoinId: "wbtc-wrapped-bitcoin",
            krakenPair: "WBTCXBT"
        },
        name: "Wrapped BTC (WBTC)"
    },
    TBTC: {
        pricing: {
            binancePair: null,
            okxPair: null,
            coinGeckoCoinId: "tbtc",
            coinPaprikaCoinId: "tbtc-tbtc",
            krakenPair: null
        },
        name: "Threshold BTC (tBTC)"
    },
    USDC: {
        pricing: {
            binancePair: "!BTCUSDC",
            okxPair: "!BTC-USDC",
            coinGeckoCoinId: "usd-coin",
            coinPaprikaCoinId: "usdc-usd-coin",
            krakenPair: "!XBTUSDC"
        },
        name: "USD Circle"
    },
    USDT: {
        pricing: {
            binancePair: "!BTCUSDT",
            okxPair: "!BTC-USDT",
            coinGeckoCoinId: "tether",
            coinPaprikaCoinId: "usdt-tether",
            krakenPair: "!XBTUSDT"
        },
        name: "Tether USD"
    },
    SOL: {
        pricing: {
            binancePair: "SOLBTC",
            okxPair: "SOL-BTC",
            coinGeckoCoinId: "solana",
            coinPaprikaCoinId: "sol-solana",
            krakenPair: "SOLXBT"
        },
        name: "Solana"
    },
    BONK: {
        pricing: {
            binancePair: "BONKUSDC;!BTCUSDC",
            okxPair: "BONK-USDT;!BTC-USDT",
            coinGeckoCoinId: "bonk",
            coinPaprikaCoinId: "bonk-bonk",
            krakenPair: "BONKUSD;!XXBTZUSD"
        },
        name: "Bonk"
    },

    ETH: {
        pricing: {
            binancePair: "ETHBTC",
            okxPair: "ETH-BTC",
            coinGeckoCoinId: "ethereum",
            coinPaprikaCoinId: "eth-ethereum",
            krakenPair: "XETHXXBT"
        },
        name: "Ether"
    },
    STRK: {
        pricing: {
            binancePair: "STRKUSDT;!BTCUSDT",
            okxPair: "STRK-USDT;!BTC-USDT",
            coinGeckoCoinId: "starknet",
            coinPaprikaCoinId: "strk-starknet",
            krakenPair: "STRKUSD;!XXBTZUSD"
        },
        name: "Starknet"
    },
    CBTC: {
        pricing: {
            binancePair: "$fixed-100000000",
            okxPair: "$fixed-100000000",
            coinGeckoCoinId: "$fixed-100000000",
            coinPaprikaCoinId: "$fixed-100000000",
            krakenPair: "$fixed-100000000"
        },
        name: "Citrea BTC"
    },
    //Used by both Botanix and Alpen
    BTC: {
        pricing: {
            binancePair: "$fixed-100000000",
            okxPair: "$fixed-100000000",
            coinGeckoCoinId: "$fixed-100000000",
            coinPaprikaCoinId: "$fixed-100000000",
            krakenPair: "$fixed-100000000"
        },
        name: "Bitcoin"
    },
    BBTC: {
        pricing: {
            binancePair: "$fixed-100000000",
            okxPair: "$fixed-100000000",
            coinGeckoCoinId: "$fixed-100000000",
            coinPaprikaCoinId: "$fixed-100000000",
            krakenPair: "$fixed-100000000"
        },
        name: "Botanix BTC"
    },
    ABTC: {
        pricing: {
            binancePair: "$fixed-100000000",
            okxPair: "$fixed-100000000",
            coinGeckoCoinId: "$fixed-100000000",
            coinPaprikaCoinId: "$fixed-100000000",
            krakenPair: "$fixed-100000000"
        },
        name: "Alpen BTC"
    },
    //Used by GOAT network
    PBTC: {
        pricing: {
            binancePair: "$fixed-100000000",
            okxPair: "$fixed-100000000",
            coinGeckoCoinId: "$fixed-100000000",
            coinPaprikaCoinId: "$fixed-100000000",
            krakenPair: "$fixed-100000000"
        },
        name: "pegBTC"
    }
} as const;

export type SmartChainAssetTickers = keyof typeof SmartChainAssets;
