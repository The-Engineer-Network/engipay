"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ICachedSwapPrice = void 0;
const ISwapPrice_1 = require("./ISwapPrice");
const DEFAULT_CACHE_DURATION = 10000;
class ICachedSwapPrice extends ISwapPrice_1.ISwapPrice {
    constructor(maxAllowedFeeDiffPPM, cacheTimeout) {
        super(maxAllowedFeeDiffPPM);
        this.cache = {};
        this.cacheTimeout = cacheTimeout || DEFAULT_CACHE_DURATION;
    }
    getPrice(chainIdentifier, tokenAddress, abortSignal) {
        const token = tokenAddress.toString();
        const chainCache = this.cache[chainIdentifier];
        if (chainCache != null) {
            const cachedValue = chainCache[token];
            if (cachedValue != null && cachedValue.expiry > Date.now()) {
                //Cache still fresh
                return cachedValue.price.catch(e => this.fetchPrice(chainIdentifier, token, abortSignal));
            }
        }
        //Refresh cache
        const thisFetch = this.fetchPrice(chainIdentifier, token);
        this.cache[chainIdentifier] ??= {};
        this.cache[chainIdentifier][token] = {
            price: thisFetch,
            expiry: Date.now() + this.cacheTimeout
        };
        thisFetch.catch(e => {
            if (this.cache[chainIdentifier] != null &&
                this.cache[chainIdentifier][token] != null &&
                this.cache[chainIdentifier][token].price === thisFetch)
                delete this.cache[token];
            throw e;
        });
        return thisFetch;
    }
    /**
     * Returns BTC price in USD (sats/USD)
     *
     * @param abortSignal
     * @throws {Error} if token is not found
     */
    getUsdPrice(abortSignal) {
        if (this.usdCache != null && this.usdCache.expiry > Date.now()) {
            //Cache still fresh
            return this.usdCache.price.catch(e => this.fetchUsdPrice(abortSignal));
        }
        //Refresh cache
        const thisFetch = this.fetchUsdPrice();
        this.usdCache = {
            price: thisFetch,
            expiry: Date.now() + this.cacheTimeout
        };
        thisFetch.catch(e => {
            if (this.usdCache != null &&
                this.usdCache.price === thisFetch)
                delete this.usdCache;
            throw e;
        });
        return thisFetch;
    }
}
exports.ICachedSwapPrice = ICachedSwapPrice;
