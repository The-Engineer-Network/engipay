import { ISwapPrice, PriceInfoType } from "./abstract/ISwapPrice";
import { ChainIds, MultiChain } from "../swaps/swapper/Swapper";
import { Token } from "../Tokens";
export declare class SwapPriceWithChain<T extends MultiChain, ChainIdentifier extends ChainIds<T>> {
    swapPrice: ISwapPrice<T>;
    chainIdentifier: ChainIdentifier;
    maxAllowedFeeDifferencePPM: bigint;
    constructor(swapPrice: ISwapPrice<T>, chainIdentifier: ChainIdentifier);
    /**
     * Checks whether the swap amounts are valid given the current market rate for a given pair
     *
     * @param amountSats Amount of sats (BTC) to be received from the swap
     * @param satsBaseFee Base fee in sats (BTC) as reported by the intermediary
     * @param feePPM PPM fee rate as reported by the intermediary
     * @param paidToken Amount of token to be paid to the swap
     * @param token
     * @param abortSignal
     * @param preFetchedPrice Already pre-fetched price
     */
    isValidAmountSend(amountSats: bigint, satsBaseFee: bigint, feePPM: bigint, paidToken: bigint, token: string, abortSignal?: AbortSignal, preFetchedPrice?: bigint): Promise<PriceInfoType>;
    /**
     * Checks whether the swap amounts are valid given the current market rate for a given pair
     *
     * @param amountSats Amount of sats (BTC) to be paid to the swap
     * @param satsBaseFee Base fee in sats (BTC) as reported by the intermediary
     * @param feePPM PPM fee rate as reported by the intermediary
     * @param receiveToken Amount of token to be received from the swap
     * @param token
     * @param abortSignal
     * @param preFetchedPrice Already pre-fetched price
     */
    isValidAmountReceive(amountSats: bigint, satsBaseFee: bigint, feePPM: bigint, receiveToken: bigint, token: string, abortSignal?: AbortSignal, preFetchedPrice?: bigint): Promise<PriceInfoType>;
    preFetchPrice(token: string, abortSignal?: AbortSignal): Promise<bigint>;
    preFetchUsdPrice(abortSignal?: AbortSignal): Promise<number>;
    /**
     * Returns amount of {toToken} that are equivalent to {fromAmount} satoshis
     *
     * @param fromAmount        Amount of satoshis
     * @param toToken           Token
     * @param abortSignal
     * @param preFetchedPrice
     * @throws {Error} when token is not found
     */
    getFromBtcSwapAmount(fromAmount: bigint, toToken: string, abortSignal?: AbortSignal, preFetchedPrice?: bigint): Promise<bigint>;
    /**
     * Returns amount of satoshis that are equivalent to {fromAmount} of {fromToken}
     *
     * @param fromAmount Amount of the token
     * @param fromToken Token
     * @param abortSignal
     * @param preFetchedPrice Pre-fetched swap price if available
     * @throws {Error} when token is not found
     */
    getToBtcSwapAmount(fromAmount: bigint, fromToken: string, abortSignal?: AbortSignal, preFetchedPrice?: bigint): Promise<bigint>;
    /**
     * Returns whether the token should be ignored and pricing for it not calculated
     *
     * @param tokenAddress
     * @throws {Error} if token is not found
     */
    shouldIgnore(tokenAddress: string): boolean;
    getBtcUsdValue(btcSats: bigint, abortSignal?: AbortSignal, preFetchedPrice?: number): Promise<number>;
    getTokenUsdValue(tokenAmount: bigint, token: string, abortSignal?: AbortSignal, preFetchedPrice?: number): Promise<number>;
    getUsdValue(amount: bigint, token: Token<ChainIdentifier>, abortSignal?: AbortSignal, preFetchedUsdPrice?: number): Promise<number>;
}
