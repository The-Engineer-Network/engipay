import {isISwapInit, ISwap, ISwapInit} from "../ISwap";
import {
    ChainType,
    SwapCommitState,
    SwapCommitStateType,
    SwapData,
    SwapExpiredState,
    SwapNotCommitedState,
    SwapPaidState
} from "@atomiqlabs/base";
import {IEscrowSwapWrapper} from "./IEscrowSwapWrapper";
import {timeoutPromise} from "../../utils/Utils";
import {Buffer} from "buffer";

export type IEscrowSwapInit<T extends SwapData> = ISwapInit & {
    data?: T,
};

export function isIEscrowSwapInit<T extends SwapData>(obj: any): obj is IEscrowSwapInit<T> {
    return typeof obj === 'object' &&
        (obj.data == null || typeof obj.data === 'object') &&
        isISwapInit(obj);
}

export abstract class IEscrowSwap<
    T extends ChainType = ChainType,
    S extends number = number
> extends ISwap<T, S> {

    protected readonly wrapper: IEscrowSwapWrapper<T, IEscrowSwap<T, S>>;

    data?: T["Data"];

    /**
     * Transaction IDs for the swap on the smart chain side
     */
    commitTxId: string;
    refundTxId?: string;
    claimTxId?: string;

    protected constructor(wrapper: IEscrowSwapWrapper<T, IEscrowSwap<T, S>>, obj: any);
    protected constructor(wrapper: IEscrowSwapWrapper<T, IEscrowSwap<T, S>>, swapInit: IEscrowSwapInit<T["Data"]>);
    protected constructor(
        wrapper: IEscrowSwapWrapper<T, IEscrowSwap<T, S>>,
        swapInitOrObj: IEscrowSwapInit<T["Data"]> | any,
    ) {
        super(wrapper, swapInitOrObj);

        if(!isIEscrowSwapInit(swapInitOrObj)) {
            this.data = swapInitOrObj.data!=null ? new wrapper.swapDataDeserializer(swapInitOrObj.data) : null;

            this.commitTxId = swapInitOrObj.commitTxId;
            this.claimTxId = swapInitOrObj.claimTxId;
            this.refundTxId = swapInitOrObj.refundTxId;
        }
    }


    //////////////////////////////
    //// Identifiers

    /**
     * Returns the identification hash of the swap, usually claim data hash, but can be overriden, e.g. for
     *  lightning swaps the identifier hash is used instead of claim data hash
     */
    protected getIdentifierHash(): Buffer {
        const claimHashBuffer = Buffer.from(this.getClaimHash(), "hex");
        if(this.randomNonce==null) return claimHashBuffer;
        return Buffer.concat([claimHashBuffer, Buffer.from(this.randomNonce, "hex")]);
    }

    /**
     * Returns the identification hash of the swap, usually claim data hash, but can be overriden, e.g. for
     *  lightning swaps the identifier hash is used instead of claim data hash
     */
    protected getIdentifierHashString(): string {
        const identifierHash = this.getIdentifierHash();
        if(identifierHash==null) return null;
        return identifierHash.toString("hex");
    }

    _getEscrowHash(): string | null {
        return this.data?.getEscrowHash();
    }

    /**
     * Returns the escrow hash - i.e. hash of the escrow data
     */
    getEscrowHash(): string | null {
        return this._getEscrowHash();
    }

    /**
     * Returns the claim data hash - i.e. hash passed to the claim handler
     */
    getClaimHash(): string {
        return this.data?.getClaimHash();
    }

    getId(): string {
        return this.getIdentifierHashString();
    }


    //////////////////////////////
    //// Watchdogs

    /**
     * Periodically checks the chain to see whether the swap is committed
     *
     * @param intervalSeconds How often to check (in seconds), default to 5s
     * @param abortSignal
     * @protected
     */
    protected async watchdogWaitTillCommited(intervalSeconds?: number, abortSignal?: AbortSignal): Promise<boolean> {
        intervalSeconds ??= 5;
        let status: SwapCommitState = {type: SwapCommitStateType.NOT_COMMITED};
        while(status?.type===SwapCommitStateType.NOT_COMMITED) {
            await timeoutPromise(intervalSeconds*1000, abortSignal);
            try {
                status = await this.wrapper.contract.getCommitStatus(this._getInitiator(), this.data);
                if(
                    status?.type===SwapCommitStateType.NOT_COMMITED &&
                    await this._verifyQuoteDefinitelyExpired()
                ) return false;
            } catch (e) {
                this.logger.error("watchdogWaitTillCommited(): Error when fetching commit status or signature expiry: ", e);
            }
        }
        if(abortSignal!=null) abortSignal.throwIfAborted();
        return status?.type!==SwapCommitStateType.EXPIRED;
    }

    /**
     * Periodically checks the chain to see whether the swap was finished (claimed or refunded)
     *
     * @param intervalSeconds How often to check (in seconds), default to 5s
     * @param abortSignal
     * @protected
     */
    protected async watchdogWaitTillResult(intervalSeconds?: number, abortSignal?: AbortSignal): Promise<
        SwapPaidState | SwapExpiredState | SwapNotCommitedState
    > {
        intervalSeconds ??= 5;
        let status: SwapCommitState = {type: SwapCommitStateType.COMMITED};
        while(status?.type===SwapCommitStateType.COMMITED || status?.type===SwapCommitStateType.REFUNDABLE) {
            await timeoutPromise(intervalSeconds*1000, abortSignal);
            try {
                status = await this.wrapper.contract.getCommitStatus(this._getInitiator(), this.data);
            } catch (e) {
                this.logger.error("watchdogWaitTillResult(): Error when fetching commit status: ", e);
            }
        }
        if(abortSignal!=null) abortSignal.throwIfAborted();
        return status;
    }


    //////////////////////////////
    //// Quote verification

    /**
     * Checks if the swap's quote is expired for good (i.e. the swap strictly cannot be committed on-chain anymore)
     */
    abstract _verifyQuoteDefinitelyExpired(): Promise<boolean>;

    /**
     * Checks if the swap's quote is still valid
     */
    abstract verifyQuoteValid(): Promise<boolean>;


    //////////////////////////////
    //// Helpers for batched swap checks

    abstract _shouldFetchCommitStatus(): boolean;

    abstract _shouldFetchExpiryStatus(): boolean;

    abstract _sync(save?: boolean, quoteDefinitelyExpired?: boolean, commitStatus?: SwapCommitState): Promise<boolean>;

    serialize(): any {
        return {
            ...super.serialize(),
            data: this.data!=null ? this.data.serialize() : null,
            commitTxId: this.commitTxId,
            claimTxId: this.claimTxId,
            refundTxId: this.refundTxId
        }
    };

}