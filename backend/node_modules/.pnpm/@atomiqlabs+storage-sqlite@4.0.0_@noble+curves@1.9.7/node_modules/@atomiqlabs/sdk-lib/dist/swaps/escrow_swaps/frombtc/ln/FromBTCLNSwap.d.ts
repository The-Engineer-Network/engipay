/// <reference types="node" />
/// <reference types="node" />
import { FromBTCLNWrapper } from "./FromBTCLNWrapper";
import { IFromBTCSwap } from "../IFromBTCSwap";
import { SwapType } from "../../../enums/SwapType";
import { ChainType, SignatureData, SwapCommitState, SwapData } from "@atomiqlabs/base";
import { Buffer } from "buffer";
import { LNURLWithdraw } from "../../../../utils/LNURL";
import { BtcToken, SCToken, TokenAmount } from "../../../../Tokens";
import { MinimalLightningNetworkWalletInterface } from "../../../../btc/wallet/MinimalLightningNetworkWalletInterface";
import { IClaimableSwap } from "../../../IClaimableSwap";
import { IAddressSwap } from "../../../IAddressSwap";
import { IEscrowSelfInitSwapInit } from "../../IEscrowSelfInitSwap";
export declare enum FromBTCLNSwapState {
    FAILED = -4,
    QUOTE_EXPIRED = -3,
    QUOTE_SOFT_EXPIRED = -2,
    EXPIRED = -1,
    PR_CREATED = 0,
    PR_PAID = 1,
    CLAIM_COMMITED = 2,
    CLAIM_CLAIMED = 3
}
export type FromBTCLNSwapInit<T extends SwapData> = IEscrowSelfInitSwapInit<T> & {
    pr: string;
    secret: string;
    initialSwapData: T;
    lnurl?: string;
    lnurlK1?: string;
    lnurlCallback?: string;
};
export declare function isFromBTCLNSwapInit<T extends SwapData>(obj: any): obj is FromBTCLNSwapInit<T>;
export declare class FromBTCLNSwap<T extends ChainType = ChainType> extends IFromBTCSwap<T, FromBTCLNSwapState> implements IAddressSwap, IClaimableSwap<T, FromBTCLNSwapState> {
    protected readonly inputToken: BtcToken<true>;
    protected readonly TYPE = SwapType.FROM_BTCLN;
    protected readonly lnurlFailSignal: AbortController;
    protected readonly pr: string;
    protected readonly secret: string;
    protected initialSwapData: T["Data"];
    lnurl?: string;
    lnurlK1?: string;
    lnurlCallback?: string;
    prPosted?: boolean;
    wrapper: FromBTCLNWrapper<T>;
    protected getSwapData(): T["Data"];
    constructor(wrapper: FromBTCLNWrapper<T>, init: FromBTCLNSwapInit<T["Data"]>);
    constructor(wrapper: FromBTCLNWrapper<T>, obj: any);
    protected upgradeVersion(): void;
    protected getIdentifierHash(): Buffer;
    protected getPaymentHash(): Buffer;
    protected canCommit(): boolean;
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
     * Returns timeout time (in UNIX milliseconds) when the LN invoice will expire
     */
    getTimeoutTime(): number;
    /**
     * Returns timeout time (in UNIX milliseconds) when the swap htlc will expire
     */
    getHtlcTimeoutTime(): number;
    isFinished(): boolean;
    isClaimable(): boolean;
    isSuccessful(): boolean;
    isFailed(): boolean;
    isQuoteExpired(): boolean;
    isQuoteSoftExpired(): boolean;
    _verifyQuoteDefinitelyExpired(): Promise<boolean>;
    verifyQuoteValid(): Promise<boolean>;
    getInput(): TokenAmount<T["ChainId"], BtcToken<true>>;
    getSmartChainNetworkFee(): Promise<TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>>;
    hasEnoughForTxFees(): Promise<{
        enoughBalance: boolean;
        balance: TokenAmount;
        required: TokenAmount;
    }>;
    /**
     * Executes the swap with the provided bitcoin lightning network wallet or LNURL
     *
     * @param dstSigner Signer on the destination network, needs to have the same address as the one specified when
     *  quote was created, this is required for legacy swaps because the destination wallet needs to actively claim
     *  the swap funds on the destination (this also means you need native token to cover gas costs)
     * @param walletOrLnurlWithdraw Bitcoin lightning wallet to use to pay the lightning network invoice, or an LNURL-withdraw
     *  link, wallet is not required and the LN invoice can be paid externally as well (just pass null or undefined here)
     * @param callbacks Callbacks to track the progress of the swap
     * @param options Optional options for the swap like feeRate, AbortSignal, and timeouts/intervals
     */
    execute(dstSigner: T["Signer"] | T["NativeSigner"], walletOrLnurlWithdraw?: MinimalLightningNetworkWalletInterface | LNURLWithdraw | string | null | undefined, callbacks?: {
        onSourceTransactionReceived?: (sourceTxId: string) => void;
        onDestinationCommitSent?: (destinationCommitTxId: string) => void;
        onDestinationClaimSent?: (destinationClaimTxId: string) => void;
        onSwapSettled?: (destinationTxId: string) => void;
    }, options?: {
        abortSignal?: AbortSignal;
        lightningTxCheckIntervalSeconds?: number;
        delayBetweenCommitAndClaimSeconds?: number;
    }): Promise<void>;
    /**
     * Checks whether the LP received the LN payment and we can continue by committing & claiming the HTLC on-chain
     *
     * @param save If the new swap state should be saved
     */
    _checkIntermediaryPaymentReceived(save?: boolean): Promise<boolean | null>;
    /**
     * Checks the data returned by the intermediary in the payment auth request
     *
     * @param signer Smart chain signer's address initiating the swap
     * @param data Parsed swap data as returned by the intermediary
     * @param signature Signature data as returned by the intermediary
     * @protected
     * @throws {IntermediaryError} If the returned are not valid
     * @throws {SignatureVerificationError} If the returned signature is not valid
     * @throws {Error} If the swap is already committed on-chain
     */
    protected checkIntermediaryReturnedAuthData(signer: string, data: T["Data"], signature: SignatureData): Promise<void>;
    /**
     * Waits till an LN payment is received by the intermediary and client can continue commiting & claiming the HTLC
     *
     * @param onPaymentReceived Callback as for when the LP reports having received the ln payment
     * @param abortSignal Abort signal to stop waiting for payment
     * @param checkIntervalSeconds How often to poll the intermediary for answer
     */
    waitForPayment(onPaymentReceived?: (txId: string) => void, checkIntervalSeconds?: number, abortSignal?: AbortSignal): Promise<boolean>;
    /**
     * Commits the swap on-chain, locking the tokens from the intermediary in an HTLC
     *
     * @param _signer Signer to sign the transactions with, must be the same as used in the initialization
     * @param abortSignal Abort signal to stop waiting for the transaction confirmation and abort
     * @param skipChecks Skip checks like making sure init signature is still valid and swap wasn't commited yet
     *  (this is handled when swap is created (quoted), if you commit right after quoting, you can use skipChecks=true)
     * @param onBeforeTxSent
     * @throws {Error} If invalid signer is provided that doesn't match the swap data
     */
    commit(_signer: T["Signer"] | T["NativeSigner"], abortSignal?: AbortSignal, skipChecks?: boolean, onBeforeTxSent?: (txId: string) => void): Promise<string>;
    waitTillCommited(abortSignal?: AbortSignal): Promise<void>;
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
     * @param onBeforeTxSent
     */
    claim(_signer: T["Signer"] | T["NativeSigner"], abortSignal?: AbortSignal, onBeforeTxSent?: (txId: string) => void): Promise<string>;
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
     * Estimated transaction fee for commit & claim txs combined
     */
    getCommitAndClaimFee(): Promise<bigint>;
    canCommitAndClaimInOneShot(): boolean;
    /**
     * Returns transactions for both commit & claim operation together, such that they can be signed all at once by
     *  the wallet. CAUTION: transactions must be sent sequentially, such that the claim (2nd) transaction is only
     *  sent after the commit (1st) transaction confirms. Failure to do so can reveal the HTLC pre-image too soon,
     *  opening a possibility for the LP to steal funds.
     *
     * @param skipChecks Skip checks like making sure init signature is still valid and swap wasn't commited yet
     *  (this is handled when swap is created (quoted), if you commit right after quoting, you can use skipChecks=true)
     *
     * @throws {Error} If in invalid state (must be PR_PAID or CLAIM_COMMITED)
     */
    txsCommitAndClaim(skipChecks?: boolean): Promise<T["TX"][]>;
    /**
     * Commits and claims the swap, in a way that the transactions can be signed together by the underlying provider and
     *  then sent sequentially
     *
     * @param _signer Signer to sign the transactions with, must be the same as used in the initialization
     * @param abortSignal Abort signal to stop waiting for the transaction confirmation and abort
     * @param skipChecks Skip checks like making sure init signature is still valid and swap wasn't commited yet
     *  (this is handled when swap is created (quoted), if you commit right after quoting, you can use skipChecks=true)
     * @param onBeforeCommitTxSent
     * @param onBeforeClaimTxSent
     * @throws {Error} If in invalid state (must be PR_PAID or CLAIM_COMMITED)
     * @throws {Error} If invalid signer is provided that doesn't match the swap data
     */
    commitAndClaim(_signer: T["Signer"] | T["NativeSigner"], abortSignal?: AbortSignal, skipChecks?: boolean, onBeforeCommitTxSent?: (txId: string) => void, onBeforeClaimTxSent?: (txId: string) => void): Promise<string[]>;
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
    _shouldFetchExpiryStatus(): boolean;
    _shouldFetchCommitStatus(): boolean;
    _shouldCheckIntermediary(): boolean;
    _sync(save?: boolean, quoteDefinitelyExpired?: boolean, commitStatus?: SwapCommitState, skipLpCheck?: boolean): Promise<boolean>;
    _tick(save?: boolean): Promise<boolean>;
}
