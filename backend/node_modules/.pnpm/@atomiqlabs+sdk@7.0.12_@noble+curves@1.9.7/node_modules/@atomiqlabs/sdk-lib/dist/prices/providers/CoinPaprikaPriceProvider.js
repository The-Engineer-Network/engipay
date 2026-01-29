"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoinPaprikaPriceProvider = void 0;
const HttpPriceProvider_1 = require("./abstract/HttpPriceProvider");
const Utils_1 = require("../../utils/Utils");
class CoinPaprikaPriceProvider extends HttpPriceProvider_1.HttpPriceProvider {
    constructor(coinsMap, url = "https://api.coinpaprika.com/v1", httpRequestTimeout) {
        super(coinsMap, url, httpRequestTimeout);
    }
    async fetchPrice(token, abortSignal) {
        const response = await (0, Utils_1.httpGet)(this.url + "/tickers/" + token.coinId + "?quotes=BTC", this.httpRequestTimeout, abortSignal);
        return BigInt(Math.floor(response.quotes.BTC.price * 100000000000000));
    }
    async fetchUsdPrice(abortSignal) {
        const response = await (0, Utils_1.httpGet)(this.url + "/tickers/btc-bitcoin?quotes=USD", this.httpRequestTimeout, abortSignal);
        return response.quotes.USD.price / 100000000;
    }
}
exports.CoinPaprikaPriceProvider = CoinPaprikaPriceProvider;
