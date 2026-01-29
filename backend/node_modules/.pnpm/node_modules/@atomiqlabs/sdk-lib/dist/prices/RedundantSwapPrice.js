"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedundantSwapPrice = void 0;
const BinancePriceProvider_1 = require("./providers/BinancePriceProvider");
const OKXPriceProvider_1 = require("./providers/OKXPriceProvider");
const CoinGeckoPriceProvider_1 = require("./providers/CoinGeckoPriceProvider");
const CoinPaprikaPriceProvider_1 = require("./providers/CoinPaprikaPriceProvider");
const Utils_1 = require("../utils/Utils");
const ICachedSwapPrice_1 = require("./abstract/ICachedSwapPrice");
const RequestError_1 = require("../errors/RequestError");
const KrakenPriceProvider_1 = require("./providers/KrakenPriceProvider");
const logger = (0, Utils_1.getLogger)("RedundantSwapPrice: ");
/**
 * Swap price API using multiple price sources, handles errors on the APIs and automatically switches between them, such
 *  that there always is a functional API
 */
class RedundantSwapPrice extends ICachedSwapPrice_1.ICachedSwapPrice {
    static createFromTokenMap(maxAllowedFeeDiffPPM, assets, cacheTimeout) {
        const priceApis = [
            new BinancePriceProvider_1.BinancePriceProvider(assets.map(coinData => {
                return {
                    coinId: coinData.binancePair,
                    chains: coinData.chains
                };
            })),
            new OKXPriceProvider_1.OKXPriceProvider(assets.map(coinData => {
                return {
                    coinId: coinData.okxPair,
                    chains: coinData.chains
                };
            })),
            new CoinGeckoPriceProvider_1.CoinGeckoPriceProvider(assets.map(coinData => {
                return {
                    coinId: coinData.coinGeckoCoinId,
                    chains: coinData.chains
                };
            })),
            new CoinPaprikaPriceProvider_1.CoinPaprikaPriceProvider(assets.map(coinData => {
                return {
                    coinId: coinData.coinPaprikaCoinId,
                    chains: coinData.chains
                };
            })),
            new KrakenPriceProvider_1.KrakenPriceProvider(assets.map(coinData => {
                return {
                    coinId: coinData.krakenPair,
                    chains: coinData.chains
                };
            }))
        ];
        return new RedundantSwapPrice(maxAllowedFeeDiffPPM, assets, priceApis, cacheTimeout);
    }
    constructor(maxAllowedFeeDiffPPM, coinsDecimals, priceApis, cacheTimeout) {
        super(maxAllowedFeeDiffPPM, cacheTimeout);
        this.coinsDecimals = {};
        for (let coinData of coinsDecimals) {
            for (let chainId in coinData.chains) {
                const { address, decimals } = coinData.chains[chainId];
                this.coinsDecimals[chainId] ??= {};
                this.coinsDecimals[chainId][address.toString()] = decimals;
            }
        }
        this.priceApis = priceApis.map(api => {
            return {
                priceApi: api,
                operational: null
            };
        });
    }
    /**
     * Returns price api that should be operational
     *
     * @private
     */
    getOperationalPriceApi() {
        return this.priceApis.find(e => e.operational === true);
    }
    /**
     * Returns price apis that are maybe operational, in case none is considered operational returns all of the price
     *  apis such that they can be tested again whether they are operational
     *
     * @private
     */
    getMaybeOperationalPriceApis() {
        let operational = this.priceApis.filter(e => e.operational === true || e.operational === null);
        if (operational.length === 0) {
            this.priceApis.forEach(e => e.operational = null);
            operational = this.priceApis;
        }
        return operational;
    }
    /**
     * Fetches price in parallel from multiple maybe operational price APIs
     *
     * @param chainIdentifier
     * @param token
     * @param abortSignal
     * @private
     */
    async fetchPriceFromMaybeOperationalPriceApis(chainIdentifier, token, abortSignal) {
        try {
            return await (0, Utils_1.promiseAny)(this.getMaybeOperationalPriceApis().map(obj => (async () => {
                try {
                    const price = await obj.priceApi.getPrice(chainIdentifier, token, abortSignal);
                    logger.debug("fetchPrice(): Price from " + obj.priceApi.constructor.name + ": ", price.toString(10));
                    obj.operational = true;
                    return price;
                }
                catch (e) {
                    if (abortSignal != null)
                        abortSignal.throwIfAborted();
                    obj.operational = false;
                    throw e;
                }
            })()));
        }
        catch (e) {
            if (abortSignal != null)
                abortSignal.throwIfAborted();
            throw e.find(err => !(err instanceof RequestError_1.RequestError)) || e[0];
        }
    }
    /**
     * Fetches the prices, first tries to use the operational price API (if any) and if that fails it falls back
     *  to using maybe operational price APIs
     *
     * @param chainIdentifier
     * @param token
     * @param abortSignal
     * @private
     */
    fetchPrice(chainIdentifier, token, abortSignal) {
        return (0, Utils_1.tryWithRetries)(async () => {
            const operationalPriceApi = this.getOperationalPriceApi();
            if (operationalPriceApi != null) {
                try {
                    return await operationalPriceApi.priceApi.getPrice(chainIdentifier, token, abortSignal);
                }
                catch (err) {
                    if (abortSignal != null)
                        abortSignal.throwIfAborted();
                    operationalPriceApi.operational = false;
                    return await this.fetchPriceFromMaybeOperationalPriceApis(chainIdentifier, token, abortSignal);
                }
            }
            return await this.fetchPriceFromMaybeOperationalPriceApis(chainIdentifier, token, abortSignal);
        }, null, RequestError_1.RequestError, abortSignal);
    }
    getDecimals(chainIdentifier, token) {
        if (this.coinsDecimals[chainIdentifier] == null)
            return null;
        return this.coinsDecimals[chainIdentifier][token.toString()];
    }
    /**
     * Fetches BTC price in USD in parallel from multiple maybe operational price APIs
     *
     * @param abortSignal
     * @private
     */
    async fetchUsdPriceFromMaybeOperationalPriceApis(abortSignal) {
        try {
            return await (0, Utils_1.promiseAny)(this.getMaybeOperationalPriceApis().map(obj => (async () => {
                try {
                    const price = await obj.priceApi.getUsdPrice(abortSignal);
                    logger.debug("fetchPrice(): USD price from " + obj.priceApi.constructor.name + ": ", price.toString(10));
                    obj.operational = true;
                    return price;
                }
                catch (e) {
                    if (abortSignal != null)
                        abortSignal.throwIfAborted();
                    obj.operational = false;
                    throw e;
                }
            })()));
        }
        catch (e) {
            if (abortSignal != null)
                abortSignal.throwIfAborted();
            throw e.find(err => !(err instanceof RequestError_1.RequestError)) || e[0];
        }
    }
    fetchUsdPrice(abortSignal) {
        return (0, Utils_1.tryWithRetries)(() => {
            const operationalPriceApi = this.getOperationalPriceApi();
            if (operationalPriceApi != null) {
                return operationalPriceApi.priceApi.getUsdPrice(abortSignal).catch(err => {
                    if (abortSignal != null)
                        abortSignal.throwIfAborted();
                    operationalPriceApi.operational = false;
                    return this.fetchUsdPriceFromMaybeOperationalPriceApis(abortSignal);
                });
            }
            return this.fetchUsdPriceFromMaybeOperationalPriceApis(abortSignal);
        }, null, RequestError_1.RequestError, abortSignal);
    }
}
exports.RedundantSwapPrice = RedundantSwapPrice;
