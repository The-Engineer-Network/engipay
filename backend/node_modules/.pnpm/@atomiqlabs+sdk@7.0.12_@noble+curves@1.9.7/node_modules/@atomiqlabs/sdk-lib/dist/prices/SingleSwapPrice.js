"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SingleSwapPrice = void 0;
const ICachedSwapPrice_1 = require("./abstract/ICachedSwapPrice");
/**
 * Swap price API using single price source
 */
class SingleSwapPrice extends ICachedSwapPrice_1.ICachedSwapPrice {
    constructor(maxAllowedFeeDiffPPM, priceProvider, cacheTimeout) {
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
    fetchPrice(chainIdentifier, token, abortSignal) {
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
    getDecimals(chainIdentifier, token) {
        return this.priceProvider.getDecimals(chainIdentifier, token.toString());
    }
    fetchUsdPrice(abortSignal) {
        return this.priceProvider.getUsdPrice(abortSignal);
    }
}
exports.SingleSwapPrice = SingleSwapPrice;
