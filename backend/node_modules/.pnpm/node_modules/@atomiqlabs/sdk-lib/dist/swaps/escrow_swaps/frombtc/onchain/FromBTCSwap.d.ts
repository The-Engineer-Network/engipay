import { IFromBTCSwap } from "../IFromBTCSwap";
import { SwapType } from "../../../enums/SwapType";
import { FromBTCWrapper } from "./FromBTCWrapper";
import { ChainType, SwapCommitState, SwapData } from "@atomiqlabs/base";
import { BtcToken, SCToken, TokenAmount } from "../../../../Tokens";
import { IBitcoinWallet } from "../../../../btc/wallet/IBitcoinWallet";
import { IBTCWalletSwap } from "../../../IBTCWalletSwap";
import { Transaction } from "@scure/btc-signer";
import { MinimalBitcoinWalletInterface, MinimalBitcoinWalletInterfaceWithSigner } from "../../../../btc/wallet/MinimalBitcoinWalletInterface";
import { IClaimableSwap } from "../../../IClaimableSwap";
import { IEscrowSelfInitSwapInit } from "../../IEscrowSelfInitSwap";
export declare enum FromBTCSwapState {
    FAILED = -4,
    EXPIRED = -3,
    QUOTE_EXPIRED = -2,
    QUOTE_SOFT_EXPIRED = -1,
    PR_CREATED = 0,
    CLAIM_COMMITED = 1,
    BTC_TX_CONFIRMED = 2,
    CLAIM_CLAIMED = 3
}
export type FromBTCSwapInit<T extends SwapData> = IEscrowSelfInitSwapInit<T> & {
    address: string;
    amount: bigint;
    requiredConfirmations: number;
};
export declare function isFromBTCSwapInit<T extends SwapData>(obj: any): obj is FromBTCSwapInit<T>;
export declare class FromBTCSwap<T extends ChainType = ChainType> extends IFromBTCSwap<T, FromBTCSwapState> implements IBTCWalletSwap, IClaimableSwap<T, FromBTCSwapState> {
    protected readonly inputToken: BtcToken<false>;
    protected readonly TYPE = SwapType.FROM_BTC;
    readonly wrapper: FromBTCWrapper<T>;
    readonly address: string;
    readonly amount: bigint;
    readonly requiredConfirmations: number;
    txId?: string;
    vout?: number;
    constructor(wrapper: FromBTCWrapper<T>, init: FromBTCSwapInit<T["Data"]>);
    constructor(wrapper: FromBTCWrapper<T>, obj: any);
    protected upgradeVersion(): void;
    /**
     * Returns bitcoin address where the on-chain BTC should be sent to
     */
    getAddress(): string;
    getHyperlink(): string;
    getInputTxId(): string | null;
    /**
     * Returns timeout time (in UNIX milliseconds) when the on-chain address will expire and no funds should be sent
     *  to that address anymore
     */
    getTimeoutTime(): number;
    requiresAction(): boolean;
    isFinished(): boolean;
    isClaimable(): boolean;
    isSuccessful(): boolean;
    isFailed(): boolean;
    isQuoteExpired(): boolean;
    isQuoteSoftExpired(): boolean;
    protected canCommit(): boolean;
    getInput(): TokenAmount<T["ChainId"], BtcToken<false>>;
    /**
     * Returns claimer bounty, acting as a reward for watchtowers to claim the swap automatically
     */
    getClaimerBounty(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
    getRequiredConfirmationsCount(): number;
    /**
     * Checks whether a bitcoin payment was already made, returns the payment or null when no payment has been made.
     */
    protected getBitcoinPayment(): Promise<{
        txId: string;
        vout: number;
        confirmations: number;
        targetConfirmations: number;
    } | null>;
    /**
     * Waits till the bitcoin transaction confirms and swap becomes claimable
     *
     * @param updateCallback Callback called when txId is found, and also called with subsequent confirmations
     * @param checkIntervalSeconds How often to check the bitcoin transaction
     * @param abortSignal Abort signal
     * @throws {Error} if in invalid state (must be CLAIM_COMMITED)
     */
    waitForBitcoinTransaction(updateCallback?: (txId: string, confirmations: number, targetConfirmations: number, txEtaMs: number) => void, checkIntervalSeconds?: number, abortSignal?: AbortSignal): Promise<string>;
    /**
     * Returns the PSBT that is already funded with wallet's UTXOs (runs a coin-selection algorithm to choose UTXOs to use),
     *  also returns inputs indices that need to be signed by the wallet before submitting the PSBT back to the SDK with
     *  `swap.submitPsbt()`
     *
     * @param _bitcoinWallet Sender's bitcoin wallet
     * @param feeRate Optional fee rate for the transaction, needs to be at least as big as {minimumBtcFeeRate} field
     * @param additionalOutputs additional outputs to add to the PSBT - can be used to collect fees from users
     */
    getFundedPsbt(_bitcoinWallet: IBitcoinWallet | MinimalBitcoinWalletInterface, feeRate?: number, additionalOutputs?: ({
        amount: bigint;
        outputScript: Uint8Array;
    } | {
        amount: bigint;
        address: string;
    })[]): Promise<{
        psbt: Transaction;
        psbtHex: string;
        psbtBase64: string;
        signInputs: number[];
    }>;
    /**
     * Submits a PSBT signed by the wallet back to the SDK
     *
     * @param _psbt A psbt - either a Transaction object or a hex or base64 encoded PSBT string
     */
    submitPsbt(_psbt: Transaction | string): Promise<string>;
    estimateBitcoinFee(_bitcoinWallet: IBitcoinWallet | MinimalBitcoinWalletInterface, feeRate?: number): Promise<TokenAmount<any, BtcToken<false>>>;
    sendBitcoinTransaction(wallet: IBitcoinWallet | MinimalBitcoinWalletInterfaceWithSigner, feeRate?: number): Promise<string>;
    /**
     * Executes the swap with the provided bitcoin wallet,
     *
     * @param dstSigner Signer on the destination network, needs to have the same address as the one specified when
     *  quote was created, this is required for legacy swaps because the destination wallet needs to actively open
     *  a bitcoin swap address to which the BTC is then sent, this means that the address also needs to have enough
     *  native tokens to pay for gas on the destination network
     * @param wallet Bitcoin wallet to use to sign the bitcoin transaction, can also be null - then the execution waits
     *  till a transaction is received from an external wallet
     * @param callbacks Callbacks to track the progress of the swap
     * @param options Optional options for the swap like feeRate, AbortSignal, and timeouts/intervals
     *
     * @returns {boolean} Whether a swap was settled automatically by swap watchtowers or requires manual claim by the
     *  user, in case `false` is returned the user should call `swap.claim()` to settle the swap on the destination manually
     */
    execute(dstSigner: T["Signer"] | T["NativeSigner"], wallet?: IBitcoinWallet | MinimalBitcoinWalletInterfaceWithSigner | null | undefined, callbacks?: {
        onDestinationCommitSent?: (destinationCommitTxId: string) => void;
        onSourceTransactionSent?: (sourceTxId: string) => void;
        onSourceTransactionConfirmationStatus?: (sourceTxId: string, confirmations: number, targetConfirations: number, etaMs: number) => void;
        onSourceTransactionConfirmed?: (sourceTxId: string) => void;
        onSwapSettled?: (destinationTxId: string) => void;
    }, options?: {
        feeRate?: number;
        abortSignal?: AbortSignal;
        btcTxCheckIntervalSeconds?: number;
        maxWaitTillAutomaticSettlementSeconds?: number;
    }): Promise<boolean>;
    /**
     * Commits the swap on-chain, locking the tokens from the intermediary in a PTLC
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
     * Returns transactions required to claim the swap on-chain (and possibly also sync the bitcoin light client)
     *  after a bitcoin transaction was sent and confirmed
     *
     * @throws {Error} If the swap is in invalid state (must be BTC_TX_CONFIRMED)
     */
    txsClaim(_signer?: string | T["Signer"] | T["NativeSigner"]): Promise<T["TX"][]>;
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
