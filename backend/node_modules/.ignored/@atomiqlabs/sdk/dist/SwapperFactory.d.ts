import { ChainData, BitcoinNetwork, BitcoinRpc, BaseTokenType, ChainType, StorageObject, IStorageManager, Messenger } from "@atomiqlabs/base";
import { BtcToken, CustomPriceFunction, MempoolApi, MempoolBitcoinRpc, SCToken, Swapper, SwapperOptions } from "@atomiqlabs/sdk-lib";
type ChainInitializer<O, C extends ChainType, T extends BaseTokenType> = {
    chainId: ChainType["ChainId"];
    chainType: ChainType;
    initializer: (options: O, bitcoinRelay: BitcoinRpc<any>, network: BitcoinNetwork, storageCtor: <T extends StorageObject>(name: string) => IStorageManager<T>) => ChainData<C>;
    tokens: T;
    options: O;
};
type TokensDict<T extends ChainInitializer<any, any, any>> = {
    [K in T["chainId"]]: {
        [val in keyof T["tokens"]]: SCToken<K>;
    };
};
type GetAllTokens<T extends readonly ChainInitializer<any, any, any>[]> = (T extends readonly [infer First extends ChainInitializer<any, any, any>, ...infer Rest extends ChainInitializer<any, any, any>[]] ? TokensDict<First> & GetAllTokens<Rest> : unknown);
export type TokenResolverDict<T extends ChainInitializer<any, any, any>> = {
    [K in T["chainId"]]: {
        getToken: (address: string) => SCToken<K>;
    };
};
type GetAllTokenResolvers<T extends readonly ChainInitializer<any, any, any>[]> = (T extends readonly [infer First extends ChainInitializer<any, any, any>, ...infer Rest extends ChainInitializer<any, any, any>[]] ? TokenResolverDict<First> & GetAllTokenResolvers<Rest> : unknown);
type OptionsDict<T extends ChainInitializer<any, any, any>> = {
    [K in T["chainId"]]: T["options"];
};
type GetAllOptions<T extends readonly ChainInitializer<any, any, any>[]> = (T extends readonly [infer First extends ChainInitializer<any, any, any>, ...infer Rest extends ChainInitializer<any, any, any>[]] ? OptionsDict<First> & GetAllOptions<Rest> : unknown);
type ChainTypeDict<T extends ChainInitializer<any, any, any>> = {
    [K in T["chainId"]]: T["chainType"];
};
type ToMultichain<T extends readonly ChainInitializer<any, any, any>[]> = (T extends readonly [infer First extends ChainInitializer<any, any, any>, ...infer Rest extends ChainInitializer<any, any, any>[]] ? ChainTypeDict<First> & ToMultichain<Rest> : {});
export type MultichainSwapperOptions<T extends readonly ChainInitializer<any, any, any>[]> = SwapperOptions & {
    chains: GetAllOptions<T>;
} & {
    chainStorageCtor?: <T extends StorageObject>(name: string) => IStorageManager<T>;
    pricingFeeDifferencePPM?: bigint;
    mempoolApi?: MempoolApi | MempoolBitcoinRpc | string | string[];
    messenger?: Messenger;
    getPriceFn?: CustomPriceFunction;
};
export declare class SwapperFactory<T extends readonly ChainInitializer<any, any, any>[]> {
    readonly initializers: T;
    Tokens: GetAllTokens<T> & {
        BITCOIN: {
            BTC: BtcToken<false>;
            BTCLN: BtcToken<true>;
        };
    };
    TokenResolver: GetAllTokenResolvers<T>;
    constructor(initializers: T);
    newSwapper(options: MultichainSwapperOptions<T>): Swapper<ToMultichain<T>>;
    newSwapperInitialized(options: MultichainSwapperOptions<T>): Promise<Swapper<ToMultichain<T>>>;
}
export {};
