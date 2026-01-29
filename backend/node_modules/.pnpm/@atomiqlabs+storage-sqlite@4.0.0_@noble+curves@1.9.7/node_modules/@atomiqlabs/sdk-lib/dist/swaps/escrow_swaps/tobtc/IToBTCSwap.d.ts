import { IToBTCWrapper } from "./IToBTCWrapper";
import { ChainType, SwapCommitState, SwapData } from "@atomiqlabs/base";
import { RefundAuthorizationResponse } from "../../../intermediaries/IntermediaryAPI";
import { BtcToken, SCToken, TokenAmount } from "../../../Tokens";
import { Fee, FeeType } from "../../fee/Fee";
import { IEscrowSelfInitSwap, IEscrowSelfInitSwapInit } from "../IEscrowSelfInitSwap";
export type IToBTCSwapInit<T extends SwapData> = IEscrowSelfInitSwapInit<T> & {
    networkFee: bigint;
    networkFeeBtc?: bigint;
};
export declare function isIToBTCSwapInit<T extends SwapData>(obj: any): obj is IToBTCSwapInit<T>;
export declare abstract class IToBTCSwap<T extends ChainType = ChainType> extends IEscrowSelfInitSwap<T, ToBTCSwapState> {
    protected readonly networkFee: bigint;
    protected networkFeeBtc?: bigint;
    protected readonly abstract outputToken: BtcToken;
    protected constructor(wrapper: IToBTCWrapper<T, IToBTCSwap<T>>, serializedObject: any);
    protected constructor(wrapper: IToBTCWrapper<T, IToBTCSwap<T>>, init: IToBTCSwapInit<T["Data"]>);
    protected upgradeVersion(): void;
    /**
     * In case swapFee in BTC is not supplied it recalculates it based on swap price
     * @protected
     */
    protected tryRecomputeSwapPrice(): void;
    /**
     * Returns the payment hash identifier to be sent to the LP for getStatus and getRefund
     * @protected
     */
    protected getLpIdentifier(): string;
    /**
     * Sets the payment result for the swap, optionally also checking it (checking that tx exist or swap secret is valid)
     *
     * @param result Result returned by the LP
     * @param check Whether to check the passed result
     * @returns true if check passed, false if check failed with a soft error (e.g. tx not yet found in the mempool)
     * @throws {IntermediaryError} When the data returned by the intermediary isn't valid
     */
    abstract _setPaymentResult(result: {
        secret?: string;
        txId?: string;
    }, check?: boolean): Promise<boolean>;
    getInputTxId(): string | null;
    requiresAction(): boolean;
    /**
     * Returns whether the swap is finished and in its terminal state (this can mean successful, refunded or failed)
     */
    isFinished(): boolean;
    isRefundable(): boolean;
    isQuoteExpired(): boolean;
    isQuoteSoftExpired(): boolean;
    isSuccessful(): boolean;
    isFailed(): boolean;
    _getInitiator(): string;
    protected getSwapFee(): Fee<T["ChainId"], SCToken<T["ChainId"]>, BtcToken>;
    /**
     * Returns network fee for the swap, the fee is represented in source currency & destination currency, but is
     *  paid only once
     */
    protected getNetworkFee(): Fee<T["ChainId"], SCToken<T["ChainId"]>, BtcToken>;
    getFee(): Fee<T["ChainId"], SCToken<T["ChainId"]>, BtcToken>;
    getFeeBreakdown(): [
        {
            type: FeeType.SWAP;
            fee: Fee<T["ChainId"], SCToken<T["ChainId"]>, BtcToken>;
        },
        {
            type: FeeType.NETWORK_OUTPUT;
            fee: Fee<T["ChainId"], SCToken<T["ChainId"]>, BtcToken>;
        }
    ];
    getInput(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
    getInputWithoutFee(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
    /**
     * Checks if the intiator/sender has enough balance to go through with the swap
     */
    hasEnoughBalance(): Promise<{
        enoughBalance: boolean;
        balance: TokenAmount;
        required: TokenAmount;
    }>;
    /**
     * Check if the initiator/sender has enough balance to cover the transaction fee for processing the swap
     */
    hasEnoughForTxFees(): Promise<{
        enoughBalance: boolean;
        balance: TokenAmount;
        required: TokenAmount;
    }>;
    /**
     * Executes the swap with the provided smart chain wallet/signer
     *
     * @param signer Smart chain wallet/signer to use to sign the transaction on the source chain
     * @param callbacks Callbacks to track the progress of the swap
     * @param options Optional options for the swap like feeRate, AbortSignal, and timeouts/intervals
     *
     * @returns {boolean} Whether the swap was successfully processed by the LP, in case `false` is returned
     *  the user can refund their funds back on the source chain by calling `swap.refund()`
     */
    execute(signer: T["Signer"] | T["NativeSigner"], callbacks?: {
        onSourceTransactionSent?: (sourceTxId: string) => void;
        onSourceTransactionConfirmed?: (sourceTxId: string) => void;
        onSwapSettled?: (destinationTxId: string) => void;
    }, options?: {
        abortSignal?: AbortSignal;
        paymentCheckIntervalSeconds?: number;
        maxWaitTillSwapProcessedSeconds?: number;
    }): Promise<boolean>;
    /**
     * Returns transactions for committing the swap on-chain, initiating the swap
     *
     * @param skipChecks Skip checks like making sure init signature is still valid and swap wasn't commited yet
     *  (this is handled on swap creation, if you commit right after quoting, you can use skipChecks=true)
     *
     * @throws {Error} When in invalid state (not PR_CREATED)
     */
    txsCommit(skipChecks?: boolean): Promise<T["TX"][]>;
    /**
     * Commits the swap on-chain, initiating the swap
     *
     * @param _signer Signer to sign the transactions with, must be the same as used in the initialization
     * @param abortSignal Abort signal
     * @param skipChecks Skip checks like making sure init signature is still valid and swap wasn't commited yet
     *  (this is handled on swap creation, if you commit right after quoting, you can skipChecks)`
     * @param onBeforeTxSent
     * @throws {Error} If invalid signer is provided that doesn't match the swap data
     */
    commit(_signer: T["Signer"] | T["NativeSigner"], abortSignal?: AbortSignal, skipChecks?: boolean, onBeforeTxSent?: (txId: string) => void): Promise<string>;
    /**
     * Waits till a swap is committed, should be called after sending the commit transactions manually
     *
     * @param abortSignal   AbortSignal
     * @throws {Error} If swap is not in the correct state (must be CREATED)
     */
    waitTillCommited(abortSignal?: AbortSignal): Promise<void>;
    protected waitTillIntermediarySwapProcessed(checkIntervalSeconds?: number, abortSignal?: AbortSignal): Promise<RefundAuthorizationResponse>;
    /**
     * Checks whether the swap was already processed by the LP and is either successful (requires proof which is
     *  either a HTLC pre-image for LN swaps or valid txId for on-chain swap) or failed and we can cooperatively
     *  refund.
     *
     * @param save whether to save the data
     * @returns true if swap is processed, false if the swap is still ongoing
     * @private
     */
    protected checkIntermediarySwapProcessed(save?: boolean): Promise<boolean>;
    /**
     * A blocking promise resolving when swap was concluded by the intermediary,
     *  rejecting in case of failure
     *
     * @param maxWaitTimeSeconds Maximum time in seconds to wait for the swap to be settled, an error is thrown if the
     *  swap is taking too long to claim
     * @param checkIntervalSeconds  How often to poll the intermediary for answer
     * @param abortSignal           Abort signal
     * @returns {Promise<boolean>}  Was the payment successful? If not we can refund.
     * @throws {IntermediaryError} If a swap is determined expired by the intermediary, but it is actually still valid
     * @throws {SignatureVerificationError} If the swap should be cooperatively refundable but the intermediary returned
     *  invalid refund signature
     * @throws {Error} When swap expires or if the swap has invalid state (must be COMMITED)
     */
    waitForPayment(maxWaitTimeSeconds?: number, checkIntervalSeconds?: number, abortSignal?: AbortSignal): Promise<boolean>;
    /**
     * Get the estimated smart chain transaction fee of the refund transaction
     */
    getRefundFee(): Promise<bigint>;
    /**
     * Returns transactions for refunding the swap if the swap is in refundable state, you can check so with isRefundable()
     *
     * @throws {IntermediaryError} If intermediary returns invalid response in case cooperative refund should be used
     * @throws {SignatureVerificationError} If intermediary returned invalid cooperative refund signature
     * @throws {Error} When state is not refundable
     */
    txsRefund(signer?: string): Promise<T["TX"][]>;
    /**
     * Refunds the swap if the swap is in refundable state, you can check so with isRefundable()
     *
     * @param _signer Signer to sign the transactions with, must be the same as used in the initialization
     * @param abortSignal               Abort signal
     * @throws {Error} If invalid signer is provided that doesn't match the swap data
     */
    refund(_signer: T["Signer"] | T["NativeSigner"], abortSignal?: AbortSignal): Promise<string>;
    /**
     * Waits till a swap is refunded, should be called after sending the refund transactions manually
     *
     * @param abortSignal   AbortSignal
     * @throws {Error} When swap is not in a valid state (must be COMMITED)
     * @throws {Error} If we tried to refund but claimer was able to claim first
     */
    waitTillRefunded(abortSignal?: AbortSignal): Promise<void>;
    serialize(): any;
    /**
     * Checks the swap's state on-chain and compares it to its internal state, updates/changes it according to on-chain
     *  data
     *
     * @private
     */
    private syncStateFromChain;
    _shouldFetchCommitStatus(): boolean;
    _shouldFetchExpiryStatus(): boolean;
    _sync(save?: boolean, quoteDefinitelyExpired?: boolean, commitStatus?: SwapCommitState): Promise<boolean>;
    _tick(save?: boolean): Promise<boolean>;
}
export declare enum ToBTCSwapState {
    REFUNDED = -3,
    QUOTE_EXPIRED = -2,
    QUOTE_SOFT_EXPIRED = -1,
    CREATED = 0,
    COMMITED = 1,
    SOFT_CLAIMED = 2,
    CLAIMED = 3,
    REFUNDABLE = 4
}
