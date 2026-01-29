import { ChainType } from "@atomiqlabs/base";
import { ISwap } from "./ISwap";
export interface IClaimableSwap<T extends ChainType = ChainType, S extends number = number> extends ISwap<T, S> {
    isClaimable(): boolean;
    txsClaim(_signer?: T["Signer"] | T["NativeSigner"]): Promise<T["TX"][]>;
    claim(_signer?: T["Signer"] | T["NativeSigner"], abortSignal?: AbortSignal): Promise<string>;
}
