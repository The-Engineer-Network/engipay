"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSwapWithGasDrop = void 0;
function isSwapWithGasDrop(swap) {
    return swap != null && typeof (swap.getGasDropOutput) === "function";
}
exports.isSwapWithGasDrop = isSwapWithGasDrop;
