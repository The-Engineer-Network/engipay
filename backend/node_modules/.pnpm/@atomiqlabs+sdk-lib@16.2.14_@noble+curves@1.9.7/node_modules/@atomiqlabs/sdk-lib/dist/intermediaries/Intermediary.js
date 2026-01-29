"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Intermediary = void 0;
const SwapType_1 = require("../swaps/enums/SwapType");
const Utils_1 = require("../utils/Utils");
class Intermediary {
    constructor(url, addresses, services, reputation = {}) {
        this.reputation = {};
        this.liquidity = {};
        this.url = url;
        this.addresses = addresses;
        this.services = services;
        this.reputation = reputation;
        this.swapBounds = {};
        for (let _swapType in this.services) {
            const swapType = parseInt(_swapType);
            const serviceInfo = this.services[_swapType];
            const btcBounds = { min: BigInt(serviceInfo.min), max: BigInt(serviceInfo.max) };
            const isSend = swapType === SwapType_1.SwapType.TO_BTC || swapType === SwapType_1.SwapType.TO_BTCLN;
            this.swapBounds[swapType] = {};
            for (let chainIdentifier in serviceInfo.chainTokens) {
                this.swapBounds[swapType][chainIdentifier] = {};
                for (let tokenAddress of serviceInfo.chainTokens[chainIdentifier]) {
                    this.swapBounds[swapType][chainIdentifier][tokenAddress] = {
                        input: isSend ? { min: null, max: null } : btcBounds,
                        output: !isSend ? { min: null, max: null } : btcBounds,
                    };
                }
            }
        }
    }
    getSwapLimits(swapType, chainId, tokenAddress) {
        return this.swapBounds[swapType]?.[chainId]?.[tokenAddress];
    }
    /**
     * Returns tokens supported by the intermediary, optionally constrained to the specific swap types
     *
     * @param chainIdentifier
     * @param swapTypesArr
     * @private
     */
    getSupportedTokens(chainIdentifier, swapTypesArr = [
        SwapType_1.SwapType.TO_BTC,
        SwapType_1.SwapType.TO_BTCLN,
        SwapType_1.SwapType.FROM_BTC,
        SwapType_1.SwapType.FROM_BTCLN,
        SwapType_1.SwapType.SPV_VAULT_FROM_BTC,
        SwapType_1.SwapType.FROM_BTCLN_AUTO
    ]) {
        const swapTypes = new Set(swapTypesArr);
        let tokens = new Set();
        swapTypes.forEach((swapType) => {
            if (this.services[swapType] != null &&
                this.services[swapType].chainTokens != null &&
                this.services[swapType].chainTokens[chainIdentifier] != null)
                this.services[swapType].chainTokens[chainIdentifier].forEach(token => tokens.add(token));
        });
        return tokens;
    }
    /**
     * Fetches, returns and saves the reputation of the intermediary, either for all or just for a single token
     *
     * @param chainIdentifier
     * @param swapContract
     * @param tokens
     * @param abortSignal
     */
    async getReputation(chainIdentifier, swapContract, tokens, abortSignal) {
        const checkReputationTokens = tokens == null ?
            this.getSupportedTokens(chainIdentifier, [SwapType_1.SwapType.TO_BTC, SwapType_1.SwapType.TO_BTCLN]) :
            new Set(tokens);
        const promises = [];
        const reputation = {};
        for (let token of checkReputationTokens) {
            promises.push((0, Utils_1.tryWithRetries)(() => swapContract.getIntermediaryReputation(this.getAddress(chainIdentifier), token), null, null, abortSignal).then(result => {
                reputation[token] = result;
            }));
        }
        await Promise.all(promises);
        this.reputation ??= {};
        this.reputation[chainIdentifier] ??= {};
        for (let key in reputation) {
            this.reputation[chainIdentifier][key] = reputation[key];
        }
        return reputation;
    }
    /**
     * Fetches, returns and saves the liquidity of the intermediaryfor a specific token
     *
     * @param chainIdentifier
     * @param swapContract
     * @param token
     * @param abortSignal
     */
    async getLiquidity(chainIdentifier, swapContract, token, abortSignal) {
        const result = await (0, Utils_1.tryWithRetries)(() => swapContract.getBalance(this.getAddress(chainIdentifier), token, true), null, null, abortSignal);
        this.liquidity ??= {};
        this.liquidity[chainIdentifier] ??= {};
        this.liquidity[chainIdentifier][token] = result;
        return result;
    }
    supportsChain(chainIdentifier) {
        if (this.addresses[chainIdentifier] == null)
            return false;
        return this.getSupportedTokens(chainIdentifier).size !== 0;
    }
    getAddress(chainIdentifier) {
        return this.addresses[chainIdentifier];
    }
}
exports.Intermediary = Intermediary;
