"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KrakenPriceProvider = void 0;
const ExchangePriceProvider_1 = require("./abstract/ExchangePriceProvider");
const Utils_1 = require("../../utils/Utils");
class KrakenPriceProvider extends ExchangePriceProvider_1.ExchangePriceProvider {
    constructor(coinsMap, url = "https://api.kraken.com/0", httpRequestTimeout) {
        super(coinsMap, url, httpRequestTimeout);
    }
    async fetchPair(pair, abortSignal) {
        const response = await (0, Utils_1.httpGet)(this.url + "/public/Ticker?pair=" + pair, this.httpRequestTimeout, abortSignal);
        return parseFloat(response.result[pair].c[0]);
    }
    async fetchUsdPrice(abortSignal) {
        const response = await (0, Utils_1.httpGet)(this.url + "/public/Ticker?pair=XBTUSDC", this.httpRequestTimeout, abortSignal);
        return parseFloat(response.result["XBTUSDC"].c[0]) / 100000000;
    }
    async fetchPrice(token, abortSignal) {
        const pairs = token.coinId.split(";");
        const response = await (0, Utils_1.httpGet)(this.url + "/public/Ticker?pair=" + pairs.map(val => val.startsWith("!") ? val.substring(1) : val).join(","), this.httpRequestTimeout, abortSignal);
        const prices = pairs.map(pair => {
            let invert = pair.startsWith("!");
            if (invert)
                pair = pair.substring(1);
            const value = parseFloat(response.result[pair].c[0]);
            return invert ? 1 / value : value;
        });
        const price = prices.reduce((previousValue, currentValue) => previousValue * currentValue, 1);
        return BigInt(Math.floor(price * 100000000000000));
    }
}
exports.KrakenPriceProvider = KrakenPriceProvider;
