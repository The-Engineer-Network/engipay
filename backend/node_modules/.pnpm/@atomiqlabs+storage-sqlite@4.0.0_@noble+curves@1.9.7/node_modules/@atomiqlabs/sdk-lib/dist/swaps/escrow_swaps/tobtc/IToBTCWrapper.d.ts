import { IToBTCSwap, ToBTCSwapState } from "./IToBTCSwap";
import { ChainType, ClaimEvent, InitializeEvent, RefundEvent } from "@atomiqlabs/base";
import { AmountData, ISwapWrapperOptions } from "../../ISwapWrapper";
import { Intermediary, SingleChainReputationType } from "../../../intermediaries/Intermediary";
import { IEscrowSwapWrapper } from "../IEscrowSwapWrapper";
export declare abstract class IToBTCWrapper<T extends ChainType, S extends IToBTCSwap<T> = IToBTCSwap<T>, O extends ISwapWrapperOptions = ISwapWrapperOptions> extends IEscrowSwapWrapper<T, S, O> {
    /**
     * Pre-fetches intermediary's reputation, doesn't throw, instead aborts via abortController and returns null
     *
     * @param amountData
     * @param lp Intermediary
     * @param abortController
     * @protected
     * @returns Intermediary's reputation or null if failed
     * @throws {IntermediaryError} If the intermediary vault doesn't exist
     */
    protected preFetchIntermediaryReputation(amountData: Omit<AmountData, "amount">, lp: Intermediary, abortController: AbortController): Promise<SingleChainReputationType | null>;
    /**
     * Pre-fetches feeRate for a given swap
     *
     * @param signer Address of the swap initiator
     * @param amountData
     * @param claimHash optional hash of the swap or null
     * @param abortController
     * @protected
     * @returns Fee rate
     */
    protected preFetchFeeRate(signer: string, amountData: Omit<AmountData, "amount">, claimHash: string | null, abortController: AbortController): Promise<any | null>;
    readonly pendingSwapStates: ToBTCSwapState[];
    readonly tickSwapState: ToBTCSwapState[];
    readonly refundableSwapStates: ToBTCSwapState[];
    protected processEventInitialize(swap: S, event: InitializeEvent<T["Data"]>): Promise<boolean>;
    protected processEventClaim(swap: S, event: ClaimEvent<T["Data"]>): Promise<boolean>;
    protected processEventRefund(swap: S, event: RefundEvent<T["Data"]>): Promise<boolean>;
}
