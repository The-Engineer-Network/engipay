"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmartChainAssets = void 0;
exports.SmartChainAssets = {
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
    }
};
