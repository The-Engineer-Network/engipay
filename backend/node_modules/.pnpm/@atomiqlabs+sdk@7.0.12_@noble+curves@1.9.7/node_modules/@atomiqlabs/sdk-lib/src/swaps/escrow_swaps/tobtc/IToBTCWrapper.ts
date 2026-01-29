import {IToBTCSwap, ToBTCSwapState} from "./IToBTCSwap";
import {ChainType, ClaimEvent, InitializeEvent, RefundEvent} from "@atomiqlabs/base";
import {AmountData, ISwapWrapperOptions} from "../../ISwapWrapper";
import {tryWithRetries} from "../../../utils/Utils";
import {Intermediary, SingleChainReputationType} from "../../../intermediaries/Intermediary";
import {IntermediaryError} from "../../../errors/IntermediaryError";
import {IEscrowSwapWrapper} from "../IEscrowSwapWrapper";


export abstract class IToBTCWrapper<
    T extends ChainType,
    S extends IToBTCSwap<T> = IToBTCSwap<T>,
    O extends ISwapWrapperOptions = ISwapWrapperOptions
> extends IEscrowSwapWrapper<T, S, O> {

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
    protected preFetchIntermediaryReputation(
        amountData: Omit<AmountData, "amount">,
        lp: Intermediary,
        abortController: AbortController
    ): Promise<SingleChainReputationType | null> {
        return lp.getReputation(this.chainIdentifier, this.contract, [amountData.token.toString()], abortController.signal).then(res => {
            if(res==null) throw new IntermediaryError("Invalid data returned - invalid LP vault");
            return res;
        }).catch(e => {
            this.logger.warn("preFetchIntermediaryReputation(): Error: ", e);
            abortController.abort(e);
            return null;
        });
    }

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
    protected preFetchFeeRate(signer: string, amountData: Omit<AmountData, "amount">, claimHash: string | null, abortController: AbortController): Promise<any | null> {
        return tryWithRetries(
            () => this.contract.getInitPayInFeeRate(signer, null, amountData.token, claimHash),
            null, null, abortController.signal
        ).catch(e => {
            this.logger.warn("preFetchFeeRate(): Error: ", e);
            abortController.abort(e);
            return null;
        });
    }

    public readonly pendingSwapStates = [
        ToBTCSwapState.CREATED,
        ToBTCSwapState.QUOTE_SOFT_EXPIRED,
        ToBTCSwapState.COMMITED,
        ToBTCSwapState.SOFT_CLAIMED,
        ToBTCSwapState.REFUNDABLE
    ];
    public readonly tickSwapState = [ToBTCSwapState.CREATED, ToBTCSwapState.COMMITED, ToBTCSwapState.SOFT_CLAIMED];
    public readonly refundableSwapStates = [ToBTCSwapState.REFUNDABLE];

    protected async processEventInitialize(swap: S, event: InitializeEvent<T["Data"]>): Promise<boolean> {
        if(swap.state===ToBTCSwapState.CREATED || swap.state===ToBTCSwapState.QUOTE_SOFT_EXPIRED) {
            const swapData = await event.swapData();
            if(swap.data!=null && !swap.data.equals(swapData)) return false;
            if(swap.state===ToBTCSwapState.CREATED || swap.state===ToBTCSwapState.QUOTE_SOFT_EXPIRED) swap.state = ToBTCSwapState.COMMITED;
            if(swap.commitTxId==null) swap.commitTxId = event.meta.txId;
            swap.data = swapData;
            return true;
        }
    }

    protected processEventClaim(swap: S, event: ClaimEvent<T["Data"]>): Promise<boolean> {
        if(swap.state!==ToBTCSwapState.REFUNDED && swap.state!==ToBTCSwapState.CLAIMED) {
            swap.state = ToBTCSwapState.CLAIMED;
            if(swap.claimTxId==null) swap.claimTxId = event.meta.txId;
            swap._setPaymentResult({secret: event.result, txId: Buffer.from(event.result, "hex").reverse().toString("hex")});
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }

    protected processEventRefund(swap: S, event: RefundEvent<T["Data"]>): Promise<boolean> {
        if(swap.state!==ToBTCSwapState.CLAIMED && swap.state!==ToBTCSwapState.REFUNDED) {
            swap.state = ToBTCSwapState.REFUNDED;
            if(swap.refundTxId==null) swap.refundTxId = event.meta.txId;
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }

}
