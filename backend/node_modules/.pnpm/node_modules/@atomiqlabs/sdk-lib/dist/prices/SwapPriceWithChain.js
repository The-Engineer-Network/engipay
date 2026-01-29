"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapPriceWithChain = void 0;
class SwapPriceWithChain {
    constructor(swapPrice, chainIdentifier) {
        this.swapPrice = swapPrice;
        this.chainIdentifier = chainIdentifier;
    }
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
    async isValidAmountSend(amountSats, satsBaseFee, feePPM, paidToken, token, abortSignal, preFetchedPrice) {
        return this.swapPrice.isValidAmountSend(this.chainIdentifier, amountSats, satsBaseFee, feePPM, paidToken, token, abortSignal, preFetchedPrice);
    }
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
    async isValidAmountReceive(amountSats, satsBaseFee, feePPM, receiveToken, token, abortSignal, preFetchedPrice) {
        return this.swapPrice.isValidAmountReceive(this.chainIdentifier, amountSats, satsBaseFee, feePPM, receiveToken, token, abortSignal, preFetchedPrice);
    }
    preFetchPrice(token, abortSignal) {
        return this.swapPrice.preFetchPrice(this.chainIdentifier, token, abortSignal);
    }
    preFetchUsdPrice(abortSignal) {
        return this.swapPrice.preFetchUsdPrice(abortSignal);
    }
    /**
     * Returns amount of {toToken} that are equivalent to {fromAmount} satoshis
     *
     * @param fromAmount        Amount of satoshis
     * @param toToken           Token
     * @param abortSignal
     * @param preFetchedPrice
     * @throws {Error} when token is not found
     */
    async getFromBtcSwapAmount(fromAmount, toToken, abortSignal, preFetchedPrice) {
        return this.swapPrice.getFromBtcSwapAmount(this.chainIdentifier, fromAmount, toToken, abortSignal, preFetchedPrice);
    }
    /**
     * Returns amount of satoshis that are equivalent to {fromAmount} of {fromToken}
     *
     * @param fromAmount Amount of the token
     * @param fromToken Token
     * @param abortSignal
     * @param preFetchedPrice Pre-fetched swap price if available
     * @throws {Error} when token is not found
     */
    async getToBtcSwapAmount(fromAmount, fromToken, abortSignal, preFetchedPrice) {
        return this.swapPrice.getToBtcSwapAmount(this.chainIdentifier, fromAmount, fromToken, abortSignal, preFetchedPrice);
    }
    /**
     * Returns whether the token should be ignored and pricing for it not calculated
     *
     * @param tokenAddress
     * @throws {Error} if token is not found
     */
    shouldIgnore(tokenAddress) {
        return this.swapPrice.shouldIgnore(this.chainIdentifier, tokenAddress);
    }
    async getBtcUsdValue(btcSats, abortSignal, preFetchedPrice) {
        return this.swapPrice.getBtcUsdValue(btcSats, abortSignal, preFetchedPrice);
    }
    async getTokenUsdValue(tokenAmount, token, abortSignal, preFetchedPrice) {
        return this.swapPrice.getTokenUsdValue(this.chainIdentifier, tokenAmount, token, abortSignal, preFetchedPrice);
    }
    getUsdValue(amount, token, abortSignal, preFetchedUsdPrice) {
        return this.swapPrice.getUsdValue(amount, token, abortSignal, preFetchedUsdPrice);
    }
}
exports.SwapPriceWithChain = SwapPriceWithChain;
