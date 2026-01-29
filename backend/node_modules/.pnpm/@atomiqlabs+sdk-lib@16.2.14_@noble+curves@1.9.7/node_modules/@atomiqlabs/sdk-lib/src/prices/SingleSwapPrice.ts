import {IPriceProvider} from "./abstract/IPriceProvider";
import {ICachedSwapPrice} from "./abstract/ICachedSwapPrice";
import {ChainIds, MultiChain} from "../swaps/swapper/Swapper";

/**
 * Swap price API using single price source
 */
export class SingleSwapPrice<T extends MultiChain> extends ICachedSwapPrice<T> {

    priceProvider: IPriceProvider<T>;

    constructor(maxAllowedFeeDiffPPM: bigint, priceProvider: IPriceProvider<T>, cacheTimeout?: number) {
        super(maxAllowedFeeDiffPPM, cacheTimeout);
        this.priceProvider = priceProvider;
    }

    /**
     * Fetch price in uSats (micro sats) for a given token against BTC
     *
     * @param chainIdentifier
     * @param token
     * @param abortSignal
     * @protected
     * @returns token price in uSats (micro sats)
     */
    protected fetchPrice<C extends ChainIds<T>>(chainIdentifier: C, token: string, abortSignal?: AbortSignal): Promise<bigint> {
        return this.priceProvider.getPrice(chainIdentifier, token, abortSignal);
    }

    /**
     * Returns the decimal places of the specified token, or -1 if token should be ignored, returns null if
     *  token is not found
     *
     * @param chainIdentifier
     * @param token
     * @protected
     */
    protected getDecimals<C extends ChainIds<T>>(chainIdentifier: C, token: string): number | null {
        return this.priceProvider.getDecimals(chainIdentifier, token.toString());
    }

    protected fetchUsdPrice(abortSignal?: AbortSignal): Promise<number> {
        return this.priceProvider.getUsdPrice(abortSignal);
    }

}
