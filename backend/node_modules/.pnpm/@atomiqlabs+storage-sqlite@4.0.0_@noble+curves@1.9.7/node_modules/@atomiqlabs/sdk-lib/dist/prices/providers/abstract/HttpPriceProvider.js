"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpPriceProvider = void 0;
const IPriceProvider_1 = require("../../abstract/IPriceProvider");
class HttpPriceProvider extends IPriceProvider_1.IPriceProvider {
    constructor(coinsMap, url, httpRequestTimeout) {
        super(coinsMap);
        this.url = url;
        this.httpRequestTimeout = httpRequestTimeout;
    }
}
exports.HttpPriceProvider = HttpPriceProvider;
