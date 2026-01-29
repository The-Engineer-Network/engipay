/// <reference types="node" />
/// <reference types="node" />
import { SwapType } from "../../../enums/SwapType";
import { ChainType, SwapCommitState, SwapData } from "@atomiqlabs/base";
import { Buffer } from "buffer";
import { LNURLWithdraw } from "../../../../utils/LNURL";
import { BtcToken, SCToken, TokenAmount } from "../../../../Tokens";
import { Fee, FeeType } from "../../../fee/Fee";
import { IAddressSwap } from "../../../IAddressSwap";
import { FromBTCLNAutoWrapper } from "./FromBTCLNAutoWrapper";
import { ISwapWithGasDrop } from "../../../ISwapWithGasDrop";
import { MinimalLightningNetworkWalletInterface } from "../../../../btc/wallet/MinimalLightningNetworkWalletInterface";
import { IClaimableSwap } from "../../../IClaimableSwap";
import { IEscrowSwap, IEscrowSwapInit } from "../../IEscrowSwap";
export declare enum FromBTCLNAutoSwapState {
    FAILED = -4,
    QUOTE_EXPIRED = -3,
    QUOTE_SOFT_EXPIRED = -2,
    EXPIRED = -1,
    PR_CREATED = 0,
    PR_PAID = 1,
    CLAIM_COMMITED = 2,
    CLAIM_CLAIMED = 3
}
export type FromBTCLNAutoSwapInit<T extends SwapData> = IEscrowSwapInit<T> & {
    pr: string;
    secret: string;
    initialSwapData: T;
    btcAmountSwap: bigint;
    btcAmountGas: bigint;
    gasSwapFeeBtc: bigint;
    gasSwapFee: bigint;
    lnurl?: string;
    lnurlK1?: string;
    lnurlCallback?: string;
};
export declare function isFromBTCLNAutoSwapInit<T extends SwapData>(obj: any): obj is FromBTCLNAutoSwapInit<T>;
export declare class FromBTCLNAutoSwap<T extends ChainType = ChainType> extends IEscrowSwap<T, FromBTCLNAutoSwapState> implements IAddressSwap, ISwapWithGasDrop<T>, IClaimableSwap<T, FromBTCLNAutoSwapState> {
    protected readonly inputToken: BtcToken<true>;
    protected readonly TYPE = SwapType.FROM_BTCLN_AUTO;
    protected readonly lnurlFailSignal: AbortController;
    protected readonly pr: string;
    protected readonly secret: string;
    protected initialSwapData: T["Data"];
    protected readonly btcAmountSwap: bigint;
    protected readonly btcAmountGas: bigint;
    protected readonly gasSwapFeeBtc: bigint;
    protected readonly gasSwapFee: bigint;
    lnurl?: string;
    lnurlK1?: string;
    lnurlCallback?: string;
    prPosted?: boolean;
    wrapper: FromBTCLNAutoWrapper<T>;
    protected getSwapData(): T["Data"];
    constructor(wrapper: FromBTCLNAutoWrapper<T>, init: FromBTCLNAutoSwapInit<T["Data"]>);
    constructor(wrapper: FromBTCLNAutoWrapper<T>, obj: any);
    protected upgradeVersion(): void;
    /**
     * In case swapFee in BTC is not supplied it recalculates it based on swap price
     * @protected
     */
    protected tryRecomputeSwapPrice(): void;
    refreshPriceData(): Promise<void>;
    _getEscrowHash(): string | null;
    _getInitiator(): string;
    getId(): string;
    getOutputAddress(): string | null;
    getOutputTxId(): string | null;
    requiresAction(): boolean;
    protected getIdentifierHashString(): string;
    protected getPaymentHash(): Buffer;
    getInputTxId(): string | null;
    /**
     * Returns the lightning network BOLT11 invoice that needs to be paid as an input to the swap
     */
    getAddress(): string;
    getHyperlink(): string;
    /**
     * Returns the timeout time (in UNIX milliseconds) when the swap will definitelly be considered as expired
     *  if the LP doesn't make it expired sooner
     */
    getDefinitiveExpiryTime(): number;
    /**
     * Returns timeout time (in UNIX milliseconds) when the swap htlc will expire
     */
    getHtlcTimeoutTime(): number | null;
    isFinished(): boolean;
    isClaimable(): boolean;
    isSuccessful(): boolean;
    isFailed(): boolean;
    isQuoteExpired(): boolean;
    isQuoteSoftExpired(): boolean;
    _verifyQuoteDefinitelyExpired(): Promise<boolean>;
    verifyQuoteValid(): Promise<boolean>;
    protected getLightningInvoiceSats(): bigint;
    protected getWatchtowerFeeAmountBtc(): bigint;
    protected getInputSwapAmountWithoutFee(): bigint;
    protected getInputGasAmountWithoutFee(): bigint;
    protected getInputAmountWithoutFee(): bigint;
    protected getOutputAmountWithoutFee(): bigint;
    getInput(): TokenAmount<T["ChainId"], BtcToken<true>>;
    getInputWithoutFee(): TokenAmount;
    getOutput(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
    getGasDropOutput(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
    protected getSwapFee(): Fee<T["ChainId"], BtcToken<true>, SCToken<T["ChainId"]>>;
    protected getWatchtowerFee(): Fee<T["ChainId"], BtcToken<true>, SCToken<T["ChainId"]>>;
    getFee(): Fee<T["ChainId"], BtcToken<true>, SCToken<T["ChainId"]>>;
    getFeeBreakdown(): [
        {
            type: FeeType.SWAP;
            fee: Fee<T["ChainId"], BtcToken<true>, SCToken<T["ChainId"]>>;
        },
        {
            type: FeeType.NETWORK_OUTPUT;
            fee: Fee<T["ChainId"], BtcToken<true>, SCToken<T["ChainId"]>>;
        }
    ];
    /**
     * Executes the swap with the provided bitcoin lightning network wallet or LNURL
     *
     * @param walletOrLnurlWithdraw Bitcoin lightning wallet to use to pay the lightning network invoice, or an LNURL-withdraw
     *  link, wallet is not required and the LN invoice can be paid externally as well (just pass null or undefined here)
     * @param callbacks Callbacks to track the progress of the swap
     * @param options Optional options for the swap like feeRate, AbortSignal, and timeouts/intervals
     *
     * @returns {boolean} Whether a swap was settled automatically by swap watchtowers or requires manual claim by the
     *  user, in case `false` is returned the user should call `swap.claim()` to settle the swap on the destination manually
     */
    execute(walletOrLnurlWithdraw?: MinimalLightningNetworkWalletInterface | LNURLWithdraw | string | null | undefined, callbacks?: {
        onSourceTransactionReceived?: (sourceTxId: string) => void;
        onSwapSettled?: (destinationTxId: string) => void;
    }, options?: {
        abortSignal?: AbortSignal;
        lightningTxCheckIntervalSeconds?: number;
        maxWaitTillAutomaticSettlementSeconds?: number;
    }): Promise<boolean>;
    /**
     * Checks whether the LP received the LN payment and we can continue by committing & claiming the HTLC on-chain
     *
     * @param save If the new swap state should be saved
     */
    _checkIntermediaryPaymentReceived(save?: boolean): Promise<boolean | null>;
    _saveRealSwapData(data: T["Data"], save?: boolean): Promise<boolean>;
    /**
     * Checks the data returned by the intermediary in the payment auth request
     *
     * @param data Parsed swap data as returned by the intermediary
     * @protected
     * @throws {IntermediaryError} If the returned are not valid
     * @throws {Error} If the swap is already committed on-chain
     */
    protected checkIntermediaryReturnedData(data: T["Data"]): Promise<void>;
    /**
     * Waits till an LN payment is received by the intermediary and client can continue commiting & claiming the HTLC
     *
     * @param onPaymentReceived Callback as for when the LP reports having received the ln payment
     * @param checkIntervalSeconds How often to poll the intermediary for answer (default 5 seconds)
     * @param abortSignal Abort signal to stop waiting for payment
     */
    waitForPayment(onPaymentReceived?: (txId: string) => void, checkIntervalSeconds?: number, abortSignal?: AbortSignal): Promise<boolean>;
    protected waitTillCommited(checkIntervalSeconds?: number, abortSignal?: AbortSignal): Promise<void>;
    /**
     * Returns transactions required for claiming the HTLC and finishing the swap by revealing the HTLC secret
     *  (hash preimage)
     *
     * @param _signer Optional signer address to use for claiming the swap, can also be different from the initializer
     * @throws {Error} If in invalid state (must be CLAIM_COMMITED)
     */
    txsClaim(_signer?: T["Signer"] | T["NativeSigner"]): Promise<T["TX"][]>;
    /**
     * Claims and finishes the swap
     *
     * @param _signer Signer to sign the transactions with, can also be different to the initializer
     * @param abortSignal Abort signal to stop waiting for transaction confirmation
     */
    claim(_signer: T["Signer"] | T["NativeSigner"], abortSignal?: AbortSignal): Promise<string>;
    /**
     * Waits till the swap is successfully claimed
     *
     * @param maxWaitTimeSeconds Maximum time in seconds to wait for the swap to be settled
     * @param abortSignal AbortSignal
     * @throws {Error} If swap is in invalid state (must be BTC_TX_CONFIRMED)
     * @throws {Error} If the LP refunded sooner than we were able to claim
     * @returns {boolean} whether the swap was claimed in time or not
     */
    waitTillClaimed(maxWaitTimeSeconds?: number, abortSignal?: AbortSignal): Promise<boolean>;
    /**
     * Is this an LNURL-withdraw swap?
     */
    isLNURL(): boolean;
    /**
     * Gets the used LNURL or null if this is not an LNURL-withdraw swap
     */
    getLNURL(): string | null;
    /**
     * Pay the generated lightning network invoice with LNURL-withdraw
     */
    settleWithLNURLWithdraw(lnurl: string | LNURLWithdraw): Promise<void>;
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
    _shouldCheckIntermediary(): boolean;
    _sync(save?: boolean, quoteDefinitelyExpired?: boolean, commitStatus?: SwapCommitState, skipLpCheck?: boolean): Promise<boolean>;
    private broadcastTickCounter;
    _broadcastSecret(noCheckExpiry?: boolean): Promise<void>;
    _tick(save?: boolean): Promise<boolean>;
}
