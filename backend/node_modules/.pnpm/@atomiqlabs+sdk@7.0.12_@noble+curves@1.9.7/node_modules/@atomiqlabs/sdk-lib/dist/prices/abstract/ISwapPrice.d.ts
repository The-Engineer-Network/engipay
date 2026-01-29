import { ChainIds, MultiChain } from "../../swaps/swapper/Swapper";
import { Token } from "../../Tokens";
export type PriceInfoType = {
    isValid: boolean;
    differencePPM: bigint;
    satsBaseFee: bigint;
    feePPM: bigint;
    realPriceUSatPerToken: bigint;
    swapPriceUSatPerToken: bigint;
};
export declare function isPriceInfoType(obj: any): obj is PriceInfoType;
export declare abstract class ISwapPrice<T extends MultiChain = MultiChain> {
    maxAllowedFeeDifferencePPM: bigint;
    protected constructor(maxAllowedFeeDifferencePPM: bigint);
    /**
     * Gets the decimal places for a given token, returns -1 if token should be ignored & null if token is not found
     * @param chainIdentifier
     * @param token
     * @protected
     */
    protected abstract getDecimals<C extends ChainIds<T>>(chainIdentifier: C, token: string): number | null;
    /**
     * Returns the price of the token in BTC uSats (microSats)
     *
     * @param chainIdentifier
     * @param token
     * @param abortSignal
     * @protected
     */
    protected abstract getPrice<C extends ChainIds<T>>(chainIdentifier: C, token: string, abortSignal?: AbortSignal): Promise<bigint>;
    /**
     * Returns the price of bitcoin in USD, (sats/USD)
     *
     * @param abortSignal
     * @protected
     */
    protected abstract getUsdPrice(abortSignal?: AbortSignal): Promise<number>;
    /**
     * Recomputes pricing info without fetching the current price
     *
     * @param chainIdentifier
     * @param amountSats
     * @param satsBaseFee
     * @param feePPM
     * @param paidToken
     * @param token
     */
    recomputePriceInfoSend<C extends ChainIds<T>>(chainIdentifier: C, amountSats: bigint, satsBaseFee: bigint, feePPM: bigint, paidToken: bigint, token: string): PriceInfoType;
    /**
     * Checks whether the swap amounts are valid given the current market rate for a given pair
     *
     * @param chainIdentifier
     * @param amountSats Amount of sats (BTC) to be received from the swap
     * @param satsBaseFee Base fee in sats (BTC) as reported by the intermediary
     * @param feePPM PPM fee rate as reported by the intermediary
     * @param paidToken Amount of token to be paid to the swap
     * @param token
     * @param abortSignal
     * @param preFetchedPrice Already pre-fetched price
     */
    isValidAmountSend<C extends ChainIds<T>>(chainIdentifier: C, amountSats: bigint, satsBaseFee: bigint, feePPM: bigint, paidToken: bigint, token: string, abortSignal?: AbortSignal, preFetchedPrice?: bigint): Promise<PriceInfoType>;
    /**
     * Recomputes pricing info without fetching the current price
     *
     * @param chainIdentifier
     * @param amountSats
     * @param satsBaseFee
     * @param feePPM
     * @param receiveToken
     * @param token
     */
    recomputePriceInfoReceive<C extends ChainIds<T>>(chainIdentifier: C, amountSats: bigint, satsBaseFee: bigint, feePPM: bigint, receiveToken: bigint, token: string): PriceInfoType;
    /**
     * Checks whether the swap amounts are valid given the current market rate for a given pair
     *
     * @param chainIdentifier
     * @param amountSats Amount of sats (BTC) to be paid to the swap
     * @param satsBaseFee Base fee in sats (BTC) as reported by the intermediary
     * @param feePPM PPM fee rate as reported by the intermediary
     * @param receiveToken Amount of token to be received from the swap
     * @param token
     * @param abortSignal
     * @param preFetchedPrice Already pre-fetched price
     */
    isValidAmountReceive<C extends ChainIds<T>>(chainIdentifier: C, amountSats: bigint, satsBaseFee: bigint, feePPM: bigint, receiveToken: bigint, token: string, abortSignal?: AbortSignal, preFetchedPrice?: bigint): Promise<PriceInfoType>;
    preFetchPrice<C extends ChainIds<T>>(chainIdentifier: C, token: string, abortSignal?: AbortSignal): Promise<bigint>;
    preFetchUsdPrice(abortSignal?: AbortSignal): Promise<number>;
    /**
     * Returns amount of {toToken} that are equivalent to {fromAmount} satoshis
     *
     * @param chainIdentifier
     * @param fromAmount        Amount of satoshis
     * @param toToken           Token
     * @param abortSignal
     * @param preFetchedPrice
     * @throws {Error} when token is not found
     */
    getFromBtcSwapAmount<C extends ChainIds<T>>(chainIdentifier: C, fromAmount: bigint, toToken: string, abortSignal?: AbortSignal, preFetchedPrice?: bigint): Promise<bigint>;
    /**
     * Returns amount of satoshis that are equivalent to {fromAmount} of {fromToken}
     *
     * @param chainIdentifier
     * @param fromAmount Amount of the token
     * @param fromToken Token
     * @param abortSignal
     * @param preFetchedPrice Pre-fetched swap price if available
     * @throws {Error} when token is not found
     */
    getToBtcSwapAmount<C extends ChainIds<T>>(chainIdentifier: C, fromAmount: bigint, fromToken: string, abortSignal?: AbortSignal, preFetchedPrice?: bigint): Promise<bigint>;
    /**
     * Returns whether the token should be ignored and pricing for it not calculated
     * @param chainIdentifier
     * @param tokenAddress
     * @throws {Error} if token is not found
     */
    shouldIgnore<C extends ChainIds<T>>(chainIdentifier: C, tokenAddress: string): boolean;
    getBtcUsdValue(btcSats: bigint, abortSignal?: AbortSignal, preFetchedPrice?: number): Promise<number>;
    getTokenUsdValue<C extends ChainIds<T>>(chainId: C, tokenAmount: bigint, token: string, abortSignal?: AbortSignal, preFetchedPrice?: number): Promise<number>;
    getUsdValue<C extends ChainIds<T>>(amount: bigint, token: Token<C>, abortSignal?: AbortSignal, preFetchedUsdPrice?: number): Promise<number>;
}
