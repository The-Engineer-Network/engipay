"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapType = void 0;
var SwapType;
(function (SwapType) {
    SwapType[SwapType["FROM_BTC"] = 0] = "FROM_BTC";
    SwapType[SwapType["FROM_BTCLN"] = 1] = "FROM_BTCLN";
    SwapType[SwapType["TO_BTC"] = 2] = "TO_BTC";
    SwapType[SwapType["TO_BTCLN"] = 3] = "TO_BTCLN";
    SwapType[SwapType["TRUSTED_FROM_BTC"] = 4] = "TRUSTED_FROM_BTC";
    SwapType[SwapType["TRUSTED_FROM_BTCLN"] = 5] = "TRUSTED_FROM_BTCLN";
    SwapType[SwapType["SPV_VAULT_FROM_BTC"] = 6] = "SPV_VAULT_FROM_BTC";
    SwapType[SwapType["FROM_BTCLN_AUTO"] = 7] = "FROM_BTCLN_AUTO";
})(SwapType = exports.SwapType || (exports.SwapType = {}));
