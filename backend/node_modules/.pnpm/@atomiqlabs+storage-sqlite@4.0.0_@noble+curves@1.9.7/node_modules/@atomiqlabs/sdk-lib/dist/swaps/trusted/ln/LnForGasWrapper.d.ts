import { LnForGasSwap, LnForGasSwapState } from "./LnForGasSwap";
import { ISwapWrapper } from "../../ISwapWrapper";
import { ChainType } from "@atomiqlabs/base";
import { Intermediary } from "../../../intermediaries/Intermediary";
import { SwapType } from "../../enums/SwapType";
export declare class LnForGasWrapper<T extends ChainType> extends ISwapWrapper<T, LnForGasSwap<T>> {
    TYPE: SwapType;
    readonly swapDeserializer: typeof LnForGasSwap;
    /**
     * Returns a newly created swap, receiving 'amount' on lightning network
     *
     * @param signer
     * @param amount            Amount you wish to receive in base units (satoshis)
     * @param lpOrUrl           Intermediary/Counterparty swap service Intermediary object or raw url
     */
    create(signer: string, amount: bigint, lpOrUrl: Intermediary | string): Promise<LnForGasSwap<T>>;
    readonly pendingSwapStates: LnForGasSwapState[];
    readonly tickSwapState: any;
    protected processEvent: any;
}
