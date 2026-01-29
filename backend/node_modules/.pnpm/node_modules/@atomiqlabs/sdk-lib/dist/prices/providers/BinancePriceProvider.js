"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinancePriceProvider = void 0;
const ExchangePriceProvider_1 = require("./abstract/ExchangePriceProvider");
const Utils_1 = require("../../utils/Utils");
class BinancePriceProvider extends ExchangePriceProvider_1.ExchangePriceProvider {
    constructor(coinsMap, url = "https://api.binance.com/api/v3", httpRequestTimeout) {
        super(coinsMap, url, httpRequestTimeout);
    }
    async fetchPair(pair, abortSignal) {
        const response = await (0, Utils_1.httpGet)(this.url + "/ticker/price?symbol=" + pair, this.httpRequestTimeout, abortSignal);
        return parseFloat(response.price);
    }
    async fetchUsdPrice(abortSignal) {
        const response = await (0, Utils_1.httpGet)(this.url + "/ticker/price?symbol=BTCUSDC", this.httpRequestTimeout, abortSignal);
        return parseFloat(response.price) / 100000000;
    }
}
exports.BinancePriceProvider = BinancePriceProvider;
