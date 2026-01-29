"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapperFactory = void 0;
var base_1 = require("@atomiqlabs/base");
var sdk_lib_1 = require("@atomiqlabs/sdk-lib");
var SmartChainAssets_1 = require("./SmartChainAssets");
var LocalStorageManager_1 = require("./storage/LocalStorageManager");
var registries = (_a = {},
    _a[base_1.BitcoinNetwork.MAINNET] = "https://api.github.com/repos/adambor/SolLightning-registry/contents/registry-mainnet.json?ref=main",
    _a[base_1.BitcoinNetwork.TESTNET] = "https://api.github.com/repos/adambor/SolLightning-registry/contents/registry.json?ref=main",
    _a[base_1.BitcoinNetwork.TESTNET4] = "https://api.github.com/repos/adambor/SolLightning-registry/contents/registry-testnet4.json?ref=main",
    _a);
var trustedIntermediaries = (_b = {},
    _b[base_1.BitcoinNetwork.MAINNET] = "https://node3.gethopa.com:34100",
    _b[base_1.BitcoinNetwork.TESTNET] = "https://node3.gethopa.com:24100",
    _b);
var mempoolUrls = (_c = {},
    _c[base_1.BitcoinNetwork.MAINNET] = [
        "https://mempool.space/api/",
        "https://mempool.fra.mempool.space/api/",
        "https://mempool.va1.mempool.space/api/",
        "https://mempool.tk7.mempool.space/api/"
    ],
    _c[base_1.BitcoinNetwork.TESTNET] = [
        "https://mempool.space/testnet/api/",
        "https://mempool.fra.mempool.space/testnet/api/",
        "https://mempool.va1.mempool.space/testnet/api/",
        "https://mempool.tk7.mempool.space/testnet/api/"
    ],
    _c[base_1.BitcoinNetwork.TESTNET4] = [
        "https://mempool.space/testnet4/api/",
        "https://mempool.fra.mempool.space/testnet4/api/",
        "https://mempool.va1.mempool.space/testnet4/api/",
        "https://mempool.tk7.mempool.space/testnet4/api/"
    ],
    _c);
var SwapperFactory = /** @class */ (function () {
    function SwapperFactory(initializers) {
        var _this = this;
        this.initializers = initializers;
        this.Tokens = {
            BITCOIN: sdk_lib_1.BitcoinTokens
        };
        this.TokenResolver = {};
        this.initializers = initializers;
        initializers.forEach(function (initializer) {
            var addressMap = {};
            _this.Tokens[initializer.chainId] = {};
            for (var ticker in initializer.tokens) {
                var assetData = initializer.tokens[ticker];
                _this.Tokens[initializer.chainId][ticker] = addressMap[assetData.address] = {
                    chain: "SC",
                    chainId: initializer.chainId,
                    address: assetData.address,
                    name: SmartChainAssets_1.SmartChainAssets[ticker].name,
                    decimals: assetData.decimals,
                    displayDecimals: assetData.displayDecimals,
                    ticker: ticker
                };
            }
            _this.TokenResolver[initializer.chainId] = {
                getToken: function (address) { return addressMap[address]; }
            };
        });
    }
    SwapperFactory.prototype.newSwapper = function (options) {
        var _this = this;
        var _a, _b, _c, _d, _e, _f, _g, _h;
        (_a = options.bitcoinNetwork) !== null && _a !== void 0 ? _a : (options.bitcoinNetwork = base_1.BitcoinNetwork.MAINNET);
        (_b = options.storagePrefix) !== null && _b !== void 0 ? _b : (options.storagePrefix = "atomiqsdk-" + options.bitcoinNetwork + "-");
        (_c = options.defaultTrustedIntermediaryUrl) !== null && _c !== void 0 ? _c : (options.defaultTrustedIntermediaryUrl = trustedIntermediaries[options.bitcoinNetwork]);
        (_d = options.registryUrl) !== null && _d !== void 0 ? _d : (options.registryUrl = registries[options.bitcoinNetwork]);
        var b;
        if (options.mempoolApi instanceof sdk_lib_1.MempoolApi)
            var mempoolApi = (_e = options.mempoolApi) !== null && _e !== void 0 ? _e : new sdk_lib_1.MempoolApi(mempoolUrls[options.bitcoinNetwork]);
        var bitcoinRpc = new sdk_lib_1.MempoolBitcoinRpc(mempoolApi);
        var pricingAssets = [];
        Object.keys(SmartChainAssets_1.SmartChainAssets).forEach(function (ticker) {
            var chains = {};
            for (var _i = 0, _a = _this.initializers; _i < _a.length; _i++) {
                var _b = _a[_i], tokens = _b.tokens, chainId = _b.chainId;
                if (tokens[ticker] != null)
                    chains[chainId] = tokens[ticker];
            }
            var assetData = SmartChainAssets_1.SmartChainAssets[ticker];
            pricingAssets.push(__assign(__assign({}, assetData.pricing), { chains: chains, ticker: ticker, name: assetData.name }));
        });
        (_f = options.chainStorageCtor) !== null && _f !== void 0 ? _f : (options.chainStorageCtor = function (name) { return new LocalStorageManager_1.LocalStorageManager(name); });
        var chains = {};
        for (var _i = 0, _j = this.initializers; _i < _j.length; _i++) {
            var _k = _j[_i], initializer = _k.initializer, chainId = _k.chainId;
            if (options.chains[chainId] == null)
                continue;
            chains[chainId] = initializer(options.chains[chainId], bitcoinRpc, options.bitcoinNetwork, options.chainStorageCtor);
        }
        var swapPricing = options.getPriceFn != null ?
            new sdk_lib_1.SingleSwapPrice((_g = options.pricingFeeDifferencePPM) !== null && _g !== void 0 ? _g : 10000n, new sdk_lib_1.CustomPriceProvider(pricingAssets.map(function (val) {
                return {
                    coinId: val.ticker,
                    chains: val.chains
                };
            }), options.getPriceFn)) :
            sdk_lib_1.RedundantSwapPrice.createFromTokenMap((_h = options.pricingFeeDifferencePPM) !== null && _h !== void 0 ? _h : 10000n, pricingAssets);
        return new sdk_lib_1.Swapper(bitcoinRpc, chains, swapPricing, pricingAssets, options);
    };
    return SwapperFactory;
}());
exports.SwapperFactory = SwapperFactory;
