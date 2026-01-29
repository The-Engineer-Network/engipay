/// <reference types="node" />
/// <reference types="node" />
import { ISwap, ISwapInit } from "../ISwap";
import { ChainType, SwapCommitState, SwapData, SwapExpiredState, SwapNotCommitedState, SwapPaidState } from "@atomiqlabs/base";
import { IEscrowSwapWrapper } from "./IEscrowSwapWrapper";
import { Buffer } from "buffer";
export type IEscrowSwapInit<T extends SwapData> = ISwapInit & {
    data?: T;
};
export declare function isIEscrowSwapInit<T extends SwapData>(obj: any): obj is IEscrowSwapInit<T>;
export declare abstract class IEscrowSwap<T extends ChainType = ChainType, S extends number = number> extends ISwap<T, S> {
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
    /**
     * Returns the identification hash of the swap, usually claim data hash, but can be overriden, e.g. for
     *  lightning swaps the identifier hash is used instead of claim data hash
     */
    protected getIdentifierHash(): Buffer;
    /**
     * Returns the identification hash of the swap, usually claim data hash, but can be overriden, e.g. for
     *  lightning swaps the identifier hash is used instead of claim data hash
     */
    protected getIdentifierHashString(): string;
    _getEscrowHash(): string | null;
    /**
     * Returns the escrow hash - i.e. hash of the escrow data
     */
    getEscrowHash(): string | null;
    /**
     * Returns the claim data hash - i.e. hash passed to the claim handler
     */
    getClaimHash(): string;
    getId(): string;
    /**
     * Periodically checks the chain to see whether the swap is committed
     *
     * @param intervalSeconds How often to check (in seconds), default to 5s
     * @param abortSignal
     * @protected
     */
    protected watchdogWaitTillCommited(intervalSeconds?: number, abortSignal?: AbortSignal): Promise<boolean>;
    /**
     * Periodically checks the chain to see whether the swap was finished (claimed or refunded)
     *
     * @param intervalSeconds How often to check (in seconds), default to 5s
     * @param abortSignal
     * @protected
     */
    protected watchdogWaitTillResult(intervalSeconds?: number, abortSignal?: AbortSignal): Promise<SwapPaidState | SwapExpiredState | SwapNotCommitedState>;
    /**
     * Checks if the swap's quote is expired for good (i.e. the swap strictly cannot be committed on-chain anymore)
     */
    abstract _verifyQuoteDefinitelyExpired(): Promise<boolean>;
    /**
     * Checks if the swap's quote is still valid
     */
    abstract verifyQuoteValid(): Promise<boolean>;
    abstract _shouldFetchCommitStatus(): boolean;
    abstract _shouldFetchExpiryStatus(): boolean;
    abstract _sync(save?: boolean, quoteDefinitelyExpired?: boolean, commitStatus?: SwapCommitState): Promise<boolean>;
    serialize(): any;
}
