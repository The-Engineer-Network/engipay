import { IPriceProvider } from "./abstract/IPriceProvider";
import { ICachedSwapPrice } from "./abstract/ICachedSwapPrice";
import { ChainIds, MultiChain } from "../swaps/swapper/Swapper";
export type RedundantSwapPriceAssets<T extends MultiChain> = {
    binancePair?: string;
    okxPair?: string;
    coinGeckoCoinId?: string;
    coinPaprikaCoinId?: string;
    krakenPair?: string;
    chains: {
        [chainIdentifier in keyof T]?: {
            address: string;
            decimals: number;
        };
    };
}[];
export type CtorCoinDecimals<T extends MultiChain> = {
    chains: {
        [chainIdentifier in keyof T]?: {
            address: string;
            decimals: number;
        };
    };
}[];
type CoinDecimals<T extends MultiChain> = {
    [chainIdentifier in keyof T]?: {
        [tokenAddress: string]: number;
    };
};
/**
 * Swap price API using multiple price sources, handles errors on the APIs and automatically switches between them, such
 *  that there always is a functional API
 */
export declare class RedundantSwapPrice<T extends MultiChain> extends ICachedSwapPrice<T> {
    static createFromTokenMap<T extends MultiChain>(maxAllowedFeeDiffPPM: bigint, assets: RedundantSwapPriceAssets<T>, cacheTimeout?: number): RedundantSwapPrice<T>;
    coinsDecimals: CoinDecimals<T>;
    priceApis: {
        priceApi: IPriceProvider<T>;
        operational: boolean;
    }[];
    constructor(maxAllowedFeeDiffPPM: bigint, coinsDecimals: CtorCoinDecimals<T>, priceApis: IPriceProvider<T>[], cacheTimeout?: number);
    /**
     * Returns price api that should be operational
     *
     * @private
     */
    private getOperationalPriceApi;
    /**
     * Returns price apis that are maybe operational, in case none is considered operational returns all of the price
     *  apis such that they can be tested again whether they are operational
     *
     * @private
     */
    private getMaybeOperationalPriceApis;
    /**
     * Fetches price in parallel from multiple maybe operational price APIs
     *
     * @param chainIdentifier
     * @param token
     * @param abortSignal
     * @private
     */
    private fetchPriceFromMaybeOperationalPriceApis;
    /**
     * Fetches the prices, first tries to use the operational price API (if any) and if that fails it falls back
     *  to using maybe operational price APIs
     *
     * @param chainIdentifier
     * @param token
     * @param abortSignal
     * @private
     */
    protected fetchPrice<C extends ChainIds<T>>(chainIdentifier: C, token: string, abortSignal?: AbortSignal): Promise<bigint>;
    protected getDecimals<C extends ChainIds<T>>(chainIdentifier: C, token: string): number | null;
    /**
     * Fetches BTC price in USD in parallel from multiple maybe operational price APIs
     *
     * @param abortSignal
     * @private
     */
    private fetchUsdPriceFromMaybeOperationalPriceApis;
    protected fetchUsdPrice(abortSignal?: AbortSignal): Promise<number>;
}
export {};
