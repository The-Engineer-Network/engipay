import { ISwap } from "../ISwap";
import { ChainType } from "@atomiqlabs/base";
export type SwapWithSigner<T extends ISwap> = {
    [K in keyof T]: K extends "commit" ? (abortSignal?: AbortSignal, skipChecks?: boolean) => Promise<string> : K extends "refund" ? (abortSignal?: AbortSignal) => Promise<string> : K extends "claim" ? (abortSignal?: AbortSignal) => Promise<string> : K extends "commitAndClaim" ? (abortSignal?: AbortSignal, skipChecks?: boolean) => Promise<string> : T[K];
};
export declare function wrapSwapWithSigner<C extends ChainType, T extends ISwap<C>>(swap: T, signer: C["Signer"]): SwapWithSigner<T>;
