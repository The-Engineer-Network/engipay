"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomPriceProvider = void 0;
const IPriceProvider_1 = require("../abstract/IPriceProvider");
class CustomPriceProvider extends IPriceProvider_1.IPriceProvider {
    constructor(coinsMap, getUsdPriceFn) {
        super(coinsMap);
        this.getUsdPriceFn = getUsdPriceFn;
    }
    async fetchPrice(token, abortSignal) {
        const [btcPrice, tokenPrice] = await this.getUsdPriceFn(["BTC", token.coinId], abortSignal);
        const priceInBtc = tokenPrice / btcPrice;
        return BigInt(Math.floor(priceInBtc * 100000000 * 1000000));
    }
    async fetchUsdPrice(abortSignal) {
        const [btcPrice] = await this.getUsdPriceFn(["BTC"], abortSignal);
        return btcPrice / 100000000;
    }
}
exports.CustomPriceProvider = CustomPriceProvider;
