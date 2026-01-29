"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wrapSwapWithSigner = void 0;
const IToBTCSwap_1 = require("../escrow_swaps/tobtc/IToBTCSwap");
const IFromBTCSwap_1 = require("../escrow_swaps/frombtc/IFromBTCSwap");
const FromBTCLNSwap_1 = require("../escrow_swaps/frombtc/ln/FromBTCLNSwap");
function wrapSwapWithSigner(swap, signer) {
    return new Proxy(swap, {
        get: (target, prop, receiver) => {
            // Override the "sayGoodbye" method
            if (prop === "commit") {
                if (swap instanceof IToBTCSwap_1.IToBTCSwap || swap instanceof IFromBTCSwap_1.IFromBTCSwap) {
                    return (abortSignal, skipChecks) => swap.commit(signer, abortSignal, skipChecks);
                }
            }
            if (prop === "refund") {
                if (swap instanceof IToBTCSwap_1.IToBTCSwap) {
                    return (abortSignal) => swap.refund(signer, abortSignal);
                }
            }
            if (prop === "claim") {
                if (swap instanceof IFromBTCSwap_1.IFromBTCSwap) {
                    return (abortSignal) => swap.claim(signer, abortSignal);
                }
            }
            if (prop === "commitAndClaim") {
                if (swap instanceof FromBTCLNSwap_1.FromBTCLNSwap) {
                    return (abortSignal, skipChecks) => swap.commitAndClaim(signer, abortSignal, skipChecks);
                }
            }
            // Delegate other properties and methods to the original instance
            return Reflect.get(target, prop, receiver);
        }
    });
}
exports.wrapSwapWithSigner = wrapSwapWithSigner;
