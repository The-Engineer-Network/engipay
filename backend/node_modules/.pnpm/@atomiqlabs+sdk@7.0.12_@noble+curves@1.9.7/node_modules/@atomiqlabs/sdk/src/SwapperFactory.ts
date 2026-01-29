import {
    ChainData,
    BitcoinNetwork,
    BitcoinRpc,
    BaseTokenType,
    ChainType,
    StorageObject,
    IStorageManager, Messenger
} from "@atomiqlabs/base";
import {
    BitcoinTokens,
    BtcToken, CustomPriceFunction, CustomPriceProvider,
    MempoolApi,
    MempoolBitcoinRpc, RedundantSwapPrice,
    RedundantSwapPriceAssets, SCToken, SingleSwapPrice, Swapper,
    SwapperOptions
} from "@atomiqlabs/sdk-lib";
import {SmartChainAssets} from "./SmartChainAssets";
import {LocalStorageManager} from "./storage/LocalStorageManager";
import {NostrMessenger} from "@atomiqlabs/messenger-nostr";

type ChainInitializer<O, C extends ChainType, T extends BaseTokenType> = {
    chainId: ChainType["ChainId"],
    chainType: ChainType,
    initializer: (
        options: O,
        bitcoinRelay: BitcoinRpc<any>,
        network: BitcoinNetwork,
        storageCtor: <T extends StorageObject>(name: string) => IStorageManager<T>
    ) => ChainData<C>,
    tokens: T,
    options: O
}

type TokensDict<T extends ChainInitializer<any, any, any>> = {
    [K in T["chainId"]]: {
        [val in keyof T["tokens"]]: SCToken<K>
    }
};
type GetAllTokens<T extends readonly ChainInitializer<any, any, any>[]> =
    (T extends readonly [infer First extends ChainInitializer<any, any, any>, ...infer Rest extends ChainInitializer<any, any, any>[]]
        ? TokensDict<First> & GetAllTokens<Rest>
        : unknown);

export type TokenResolverDict<T extends ChainInitializer<any, any, any>> = {[K in T["chainId"]]: {
    getToken: (address: string) => SCToken<K>
}};
type GetAllTokenResolvers<T extends readonly ChainInitializer<any, any, any>[]> =
    (T extends readonly [infer First extends ChainInitializer<any, any, any>, ...infer Rest extends ChainInitializer<any, any, any>[]]
        ? TokenResolverDict<First> & GetAllTokenResolvers<Rest>
        : unknown);

type OptionsDict<T extends ChainInitializer<any, any, any>> = {[K in T["chainId"]]: T["options"]};
type GetAllOptions<T extends readonly ChainInitializer<any, any, any>[]> =
    (T extends readonly [infer First extends ChainInitializer<any, any, any>, ...infer Rest extends ChainInitializer<any, any, any>[]]
        ? OptionsDict<First> & GetAllOptions<Rest>
        : unknown);

type ChainTypeDict<T extends ChainInitializer<any, any, any>> = {[K in T["chainId"]]: T["chainType"]};
type ToMultichain<T extends readonly ChainInitializer<any, any, any>[]> =
    (T extends readonly [infer First extends ChainInitializer<any, any, any>, ...infer Rest extends ChainInitializer<any, any, any>[]]
        ? ChainTypeDict<First> & ToMultichain<Rest>
        : {});

export type MultichainSwapperOptions<T extends readonly ChainInitializer<any, any, any>[]> = SwapperOptions & {
    chains: GetAllOptions<T>
} & {
    chainStorageCtor?: <T extends StorageObject>(name: string) => IStorageManager<T>,
    pricingFeeDifferencePPM?: bigint,
    mempoolApi?: MempoolApi | MempoolBitcoinRpc | string | string[],
    messenger?: Messenger,
    getPriceFn?: CustomPriceFunction
};

const registries = {
    [BitcoinNetwork.MAINNET]: "https://api.github.com/repos/adambor/SolLightning-registry/contents/registry-mainnet.json?ref=main",
    [BitcoinNetwork.TESTNET]: "https://api.github.com/repos/adambor/SolLightning-registry/contents/registry.json?ref=main",
    [BitcoinNetwork.TESTNET4]: "https://api.github.com/repos/adambor/SolLightning-registry/contents/registry-testnet4.json?ref=main"
}

const trustedIntermediaries = {
    [BitcoinNetwork.MAINNET]: "https://node3.gethopa.com:34100",
    [BitcoinNetwork.TESTNET]: "https://node3.gethopa.com:24100"
}

const mempoolUrls = {
    [BitcoinNetwork.MAINNET]: [
        "https://mempool.space/api/",
        // "https://mempool.holdings/api/",
        "https://mempool.fra.mempool.space/api/",
        "https://mempool.va1.mempool.space/api/",
        "https://mempool.tk7.mempool.space/api/"
    ],
    [BitcoinNetwork.TESTNET]: [
        "https://mempool.space/testnet/api/",
        // "https://mempool.holdings/testnet/api/",
        "https://mempool.fra.mempool.space/testnet/api/",
        "https://mempool.va1.mempool.space/testnet/api/",
        "https://mempool.tk7.mempool.space/testnet/api/"
    ],
    [BitcoinNetwork.TESTNET4]: [
        "https://mempool.space/testnet4/api/",
        // "https://mempool.holdings/testnet4/api/",
        "https://mempool.fra.mempool.space/testnet4/api/",
        "https://mempool.va1.mempool.space/testnet4/api/",
        "https://mempool.tk7.mempool.space/testnet4/api/"
    ]
}

const nostrUrls: string[] = [
    "wss://relay.damus.io", "wss://nostr.einundzwanzig.space", "wss://relay01.lnfi.network/", "wss://relay.puresignal.news/", "wss://relay.fountain.fm/", "wss://sendit.nosflare.com/"
];

export class SwapperFactory<T extends readonly ChainInitializer<any, any, any>[]> {

    Tokens: GetAllTokens<T> & {
        BITCOIN: {
            BTC: BtcToken<false>,
            BTCLN: BtcToken<true>
        }
    } = {
        BITCOIN: BitcoinTokens
    } as any;
    TokenResolver: GetAllTokenResolvers<T> = {} as any;

    constructor(readonly initializers: T) {
        this.initializers = initializers;
        initializers.forEach(initializer => {
            const addressMap: {[tokenAddress: string]: SCToken} = {};

            this.Tokens[initializer.chainId] = {} as any;

            for(let ticker in initializer.tokens) {
                const assetData = initializer.tokens[ticker] as any;
                this.Tokens[initializer.chainId][ticker] = addressMap[assetData.address] = {
                    chain: "SC",
                    chainId: initializer.chainId,
                    address: assetData.address,
                    name: SmartChainAssets[ticker]?.name ?? ticker,
                    decimals: assetData.decimals,
                    displayDecimals: assetData.displayDecimals,
                    ticker
                } as any;
            }

            this.TokenResolver[initializer.chainId] = {
                getToken: (address: string) => addressMap[address]
            } as any;
        });
    }

    newSwapper(options: MultichainSwapperOptions<T>) {
        options.bitcoinNetwork ??= BitcoinNetwork.MAINNET as any;
        options.storagePrefix ??= "atomiqsdk-"+options.bitcoinNetwork+"-";
        options.messenger ??= new NostrMessenger(options.bitcoinNetwork, nostrUrls);

        options.defaultTrustedIntermediaryUrl ??= trustedIntermediaries[options.bitcoinNetwork];

        options.registryUrl ??= registries[options.bitcoinNetwork];

        const mempoolApi = options.mempoolApi ?? new MempoolBitcoinRpc(mempoolUrls[options.bitcoinNetwork]);
        const bitcoinRpc = mempoolApi instanceof MempoolBitcoinRpc ? mempoolApi : new MempoolBitcoinRpc(mempoolApi);

        const pricingAssets: (RedundantSwapPriceAssets<ToMultichain<T>>[number] & {ticker: string, name: string})[] = [];
        Object.keys(SmartChainAssets).forEach((ticker) => {
            const chains: any = {};
            for(let {tokens, chainId} of this.initializers) {
                if(tokens[ticker]!=null) chains[chainId] = tokens[ticker];
            }
            const assetData = SmartChainAssets[ticker];
            pricingAssets.push({
                ...assetData.pricing,
                chains,
                ticker,
                name: assetData.name
            })
        });

        options.chainStorageCtor ??= (name: string) => new LocalStorageManager(name);

        const chains: {[key in T[number]["chainId"]]: ChainData<any>} = {} as any;
        for(let {initializer, chainId} of this.initializers) {
            if(options.chains[chainId]==null) continue;
            chains[chainId] = initializer(options.chains[chainId], bitcoinRpc, options.bitcoinNetwork, options.chainStorageCtor) as any;
        }

        const swapPricing = options.getPriceFn!=null ?
            new SingleSwapPrice(options.pricingFeeDifferencePPM ?? 10000n, new CustomPriceProvider(pricingAssets.map(val => {
                return {
                    coinId: val.ticker,
                    chains: val.chains
                }
            }), options.getPriceFn)) :
            RedundantSwapPrice.createFromTokenMap<ToMultichain<T>>(options.pricingFeeDifferencePPM ?? 10000n, pricingAssets);

        return new Swapper<ToMultichain<T>>(
            bitcoinRpc,
            chains as any,
            swapPricing,
            pricingAssets,
            options.messenger,
            options
        );
    }

    async newSwapperInitialized(options: MultichainSwapperOptions<T>) {
        const swapper = this.newSwapper(options);
        await swapper.init();
        return swapper;
    }

}
