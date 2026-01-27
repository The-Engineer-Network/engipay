export declare const SmartChainAssets: {
    readonly _TESTNET_WBTC_VESU: {
        readonly pricing: {
            readonly binancePair: "WBTCBTC";
            readonly okxPair: "WBTC-BTC";
            readonly coinGeckoCoinId: "wrapped-bitcoin";
            readonly coinPaprikaCoinId: "wbtc-wrapped-bitcoin";
            readonly krakenPair: "WBTCXBT";
        };
        readonly name: "Wrapped BTC (WBTC)";
    };
    readonly _PBTC_DEV: {
        readonly pricing: {
            readonly binancePair: "$fixed-100000000";
            readonly okxPair: "$fixed-100000000";
            readonly coinGeckoCoinId: "$fixed-100000000";
            readonly coinPaprikaCoinId: "$fixed-100000000";
            readonly krakenPair: "$fixed-100000000";
        };
        readonly name: "pegBTC (dev)";
    };
    readonly WBTC: {
        readonly pricing: {
            readonly binancePair: "WBTCBTC";
            readonly okxPair: "WBTC-BTC";
            readonly coinGeckoCoinId: "wrapped-bitcoin";
            readonly coinPaprikaCoinId: "wbtc-wrapped-bitcoin";
            readonly krakenPair: "WBTCXBT";
        };
        readonly name: "Wrapped BTC (WBTC)";
    };
    readonly TBTC: {
        readonly pricing: {
            readonly binancePair: any;
            readonly okxPair: any;
            readonly coinGeckoCoinId: "tbtc";
            readonly coinPaprikaCoinId: "tbtc-tbtc";
            readonly krakenPair: any;
        };
        readonly name: "Threshold BTC (tBTC)";
    };
    readonly USDC: {
        readonly pricing: {
            readonly binancePair: "!BTCUSDC";
            readonly okxPair: "!BTC-USDC";
            readonly coinGeckoCoinId: "usd-coin";
            readonly coinPaprikaCoinId: "usdc-usd-coin";
            readonly krakenPair: "!XBTUSDC";
        };
        readonly name: "USD Circle";
    };
    readonly USDT: {
        readonly pricing: {
            readonly binancePair: "!BTCUSDT";
            readonly okxPair: "!BTC-USDT";
            readonly coinGeckoCoinId: "tether";
            readonly coinPaprikaCoinId: "usdt-tether";
            readonly krakenPair: "!XBTUSDT";
        };
        readonly name: "Tether USD";
    };
    readonly SOL: {
        readonly pricing: {
            readonly binancePair: "SOLBTC";
            readonly okxPair: "SOL-BTC";
            readonly coinGeckoCoinId: "solana";
            readonly coinPaprikaCoinId: "sol-solana";
            readonly krakenPair: "SOLXBT";
        };
        readonly name: "Solana";
    };
    readonly BONK: {
        readonly pricing: {
            readonly binancePair: "BONKUSDC;!BTCUSDC";
            readonly okxPair: "BONK-USDT;!BTC-USDT";
            readonly coinGeckoCoinId: "bonk";
            readonly coinPaprikaCoinId: "bonk-bonk";
            readonly krakenPair: "BONKUSD;!XXBTZUSD";
        };
        readonly name: "Bonk";
    };
    readonly ETH: {
        readonly pricing: {
            readonly binancePair: "ETHBTC";
            readonly okxPair: "ETH-BTC";
            readonly coinGeckoCoinId: "ethereum";
            readonly coinPaprikaCoinId: "eth-ethereum";
            readonly krakenPair: "XETHXXBT";
        };
        readonly name: "Ether";
    };
    readonly STRK: {
        readonly pricing: {
            readonly binancePair: "STRKUSDT;!BTCUSDT";
            readonly okxPair: "STRK-USDT;!BTC-USDT";
            readonly coinGeckoCoinId: "starknet";
            readonly coinPaprikaCoinId: "strk-starknet";
            readonly krakenPair: "STRKUSD;!XXBTZUSD";
        };
        readonly name: "Starknet";
    };
    readonly CBTC: {
        readonly pricing: {
            readonly binancePair: "$fixed-100000000";
            readonly okxPair: "$fixed-100000000";
            readonly coinGeckoCoinId: "$fixed-100000000";
            readonly coinPaprikaCoinId: "$fixed-100000000";
            readonly krakenPair: "$fixed-100000000";
        };
        readonly name: "Citrea BTC";
    };
    readonly BTC: {
        readonly pricing: {
            readonly binancePair: "$fixed-100000000";
            readonly okxPair: "$fixed-100000000";
            readonly coinGeckoCoinId: "$fixed-100000000";
            readonly coinPaprikaCoinId: "$fixed-100000000";
            readonly krakenPair: "$fixed-100000000";
        };
        readonly name: "Bitcoin";
    };
    readonly BBTC: {
        readonly pricing: {
            readonly binancePair: "$fixed-100000000";
            readonly okxPair: "$fixed-100000000";
            readonly coinGeckoCoinId: "$fixed-100000000";
            readonly coinPaprikaCoinId: "$fixed-100000000";
            readonly krakenPair: "$fixed-100000000";
        };
        readonly name: "Botanix BTC";
    };
    readonly ABTC: {
        readonly pricing: {
            readonly binancePair: "$fixed-100000000";
            readonly okxPair: "$fixed-100000000";
            readonly coinGeckoCoinId: "$fixed-100000000";
            readonly coinPaprikaCoinId: "$fixed-100000000";
            readonly krakenPair: "$fixed-100000000";
        };
        readonly name: "Alpen BTC";
    };
    readonly PBTC: {
        readonly pricing: {
            readonly binancePair: "$fixed-100000000";
            readonly okxPair: "$fixed-100000000";
            readonly coinGeckoCoinId: "$fixed-100000000";
            readonly coinPaprikaCoinId: "$fixed-100000000";
            readonly krakenPair: "$fixed-100000000";
        };
        readonly name: "pegBTC";
    };
};
export type SmartChainAssetTickers = keyof typeof SmartChainAssets;
