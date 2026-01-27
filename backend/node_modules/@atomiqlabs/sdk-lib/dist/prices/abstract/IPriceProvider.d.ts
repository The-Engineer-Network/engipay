import { ChainIds, MultiChain } from "../../swaps/swapper/Swapper";
export type CoinType = {
    coinId: string;
    decimals: number;
};
export type CtorCoinTypes<T extends MultiChain> = {
    coinId: string;
    chains: {
        [chainId in keyof T]?: {
            address: string;
            decimals: number;
        };
    };
}[];
export type CoinTypes<T extends MultiChain> = {
    [chainId in keyof T]?: {
        [address: string]: CoinType;
    };
};
export declare abstract class IPriceProvider<T extends MultiChain> {
    coinsMap: CoinTypes<T>;
    protected constructor(coins: CtorCoinTypes<T>);
    /**
     * Fetches the price for a given token against BTC
     *
     * @param token
     * @param abortSignal
     * @protected
     * @returns Price per token in uSats (micro sats)
     */
    protected abstract fetchPrice(token: CoinType, abortSignal?: AbortSignal): Promise<bigint>;
    /**
     * Fetches the USD price of BTC
     *
     * @param abortSignal
     * @protected
     */
    protected abstract fetchUsdPrice(abortSignal?: AbortSignal): Promise<number>;
    /**
     * Returns coin price in uSat (microSat)
     *
     * @param chainIdentifier
     * @param token
     * @param abortSignal
     * @throws {Error} if token is not found
     */
    getPrice<C extends ChainIds<T>>(chainIdentifier: C, token: string, abortSignal?: AbortSignal): Promise<bigint>;
    /**
     * Returns coin price in uSat (microSat)
     *
     * @param abortSignal
     * @throws {Error} if token is not found
     */
    getUsdPrice(abortSignal?: AbortSignal): Promise<number>;
    /**
     * Returns the decimal places of the specified token, or -1 if token should be ignored, returns null if
     *  token is not found
     *
     * @param chainIdentifier
     * @param token
     * @protected
     * @throws {Error} If token is not found
     */
    getDecimals<C extends ChainIds<T>>(chainIdentifier: C, token: string): number;
}
