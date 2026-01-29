import {ISwap} from "../ISwap";
import {ChainType} from "@atomiqlabs/base";
import {IToBTCSwap} from "../escrow_swaps/tobtc/IToBTCSwap";
import {IFromBTCSwap} from "../escrow_swaps/frombtc/IFromBTCSwap";
import {FromBTCLNSwap} from "../escrow_swaps/frombtc/ln/FromBTCLNSwap";

export type SwapWithSigner<T extends ISwap> = {
    [K in keyof T]:
        K extends "commit" ? (abortSignal?: AbortSignal, skipChecks?: boolean) => Promise<string> :
        K extends "refund" ? (abortSignal?: AbortSignal) => Promise<string> :
        K extends "claim" ? (abortSignal?: AbortSignal) => Promise<string> :
        K extends "commitAndClaim" ? (abortSignal?: AbortSignal, skipChecks?: boolean) => Promise<string> :
            T[K];
};

export function wrapSwapWithSigner<C extends ChainType, T extends ISwap<C>>(swap: T, signer: C["Signer"]): SwapWithSigner<T> {
    return new Proxy(swap, {
        get: (target, prop, receiver) => {
            // Override the "sayGoodbye" method
            if (prop === "commit") {
                if(swap instanceof IToBTCSwap || swap instanceof IFromBTCSwap) {
                    return (abortSignal?: AbortSignal, skipChecks?: boolean) =>
                        swap.commit(signer, abortSignal, skipChecks);
                }
            }
            if (prop === "refund") {
                if(swap instanceof IToBTCSwap) {
                    return (abortSignal?: AbortSignal) =>
                        swap.refund(signer, abortSignal);
                }
            }
            if (prop === "claim") {
                if(swap instanceof IFromBTCSwap) {
                    return (abortSignal?: AbortSignal) =>
                        swap.claim(signer, abortSignal);
                }
            }
            if (prop === "commitAndClaim") {
                if(swap instanceof FromBTCLNSwap) {
                    return (abortSignal?: AbortSignal, skipChecks?: boolean) =>
                        swap.commitAndClaim(signer, abortSignal, skipChecks);
                }
            }

            // Delegate other properties and methods to the original instance
            return Reflect.get(target, prop, receiver);
        }
    }) as SwapWithSigner<T>;
}
