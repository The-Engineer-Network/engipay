"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChainSwapType = void 0;
var ChainSwapType;
(function (ChainSwapType) {
    ChainSwapType[ChainSwapType["HTLC"] = 0] = "HTLC";
    ChainSwapType[ChainSwapType["CHAIN"] = 1] = "CHAIN";
    ChainSwapType[ChainSwapType["CHAIN_NONCED"] = 2] = "CHAIN_NONCED";
    ChainSwapType[ChainSwapType["CHAIN_TXID"] = 3] = "CHAIN_TXID";
})(ChainSwapType = exports.ChainSwapType || (exports.ChainSwapType = {}));
