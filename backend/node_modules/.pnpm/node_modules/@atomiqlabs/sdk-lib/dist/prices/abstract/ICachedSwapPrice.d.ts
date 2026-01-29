import { ISwapPrice } from "./ISwapPrice";
import { ChainIds, MultiChain } from "../../swaps/swapper/Swapper";
export declare abstract class ICachedSwapPrice<T extends MultiChain> extends ISwapPrice<T> {
    cache: {
        [chainIdentifier in keyof T]?: {
            [tokenAddress: string]: {
                price: Promise<bigint>;
                expiry: number;
            };
        };
    };
    usdCache: {
        price: Promise<number>;
        expiry: number;
    };
    cacheTimeout: number;
    protected constructor(maxAllowedFeeDiffPPM: bigint, cacheTimeout?: number);
    protected abstract fetchPrice<C extends ChainIds<T>>(chainIdentifier: C, token: string, abortSignal?: AbortSignal): Promise<bigint>;
    protected abstract fetchUsdPrice(abortSignal?: AbortSignal): Promise<number>;
    protected getPrice<C extends ChainIds<T>>(chainIdentifier: C, tokenAddress: string, abortSignal?: AbortSignal): Promise<bigint>;
    /**
     * Returns BTC price in USD (sats/USD)
     *
     * @param abortSignal
     * @throws {Error} if token is not found
     */
    protected getUsdPrice(abortSignal?: AbortSignal): Promise<number>;
}
