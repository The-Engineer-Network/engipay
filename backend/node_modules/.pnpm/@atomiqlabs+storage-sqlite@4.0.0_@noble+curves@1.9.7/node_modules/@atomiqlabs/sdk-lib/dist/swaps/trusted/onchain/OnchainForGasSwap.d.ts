import { SwapType } from "../../enums/SwapType";
import { ChainType } from "@atomiqlabs/base";
import { ISwap, ISwapInit } from "../../ISwap";
import { BtcToken, SCToken, TokenAmount } from "../../../Tokens";
import { OnchainForGasWrapper } from "./OnchainForGasWrapper";
import { Fee, FeeType } from "../../fee/Fee";
import { IBitcoinWallet } from "../../../btc/wallet/IBitcoinWallet";
import { IAddressSwap } from "../../IAddressSwap";
import { IBTCWalletSwap } from "../../IBTCWalletSwap";
import { Transaction } from "@scure/btc-signer";
import { MinimalBitcoinWalletInterface, MinimalBitcoinWalletInterfaceWithSigner } from "../../../btc/wallet/MinimalBitcoinWalletInterface";
export declare enum OnchainForGasSwapState {
    EXPIRED = -3,
    FAILED = -2,
    REFUNDED = -1,
    PR_CREATED = 0,
    FINISHED = 1,
    REFUNDABLE = 2
}
export type OnchainForGasSwapInit = ISwapInit & {
    paymentHash: string;
    sequence: bigint;
    address: string;
    inputAmount: bigint;
    outputAmount: bigint;
    recipient: string;
    token: string;
    refundAddress?: string;
};
export declare function isOnchainForGasSwapInit(obj: any): obj is OnchainForGasSwapInit;
export declare class OnchainForGasSwap<T extends ChainType = ChainType> extends ISwap<T, OnchainForGasSwapState> implements IAddressSwap, IBTCWalletSwap {
    getSmartChainNetworkFee: any;
    protected readonly TYPE: SwapType;
    private readonly paymentHash;
    private readonly sequence;
    private readonly address;
    private readonly recipient;
    private readonly token;
    private inputAmount;
    private outputAmount;
    private refundAddress;
    scTxId: string;
    txId: string;
    refundTxId: string;
    wrapper: OnchainForGasWrapper<T>;
    constructor(wrapper: OnchainForGasWrapper<T>, init: OnchainForGasSwapInit);
    constructor(wrapper: OnchainForGasWrapper<T>, obj: any);
    protected upgradeVersion(): void;
    /**
     * In case swapFee in BTC is not supplied it recalculates it based on swap price
     * @protected
     */
    protected tryRecomputeSwapPrice(): void;
    _getEscrowHash(): string;
    getOutputAddress(): string | null;
    getInputTxId(): string | null;
    getOutputTxId(): string | null;
    getId(): string;
    getAddress(): string;
    getHyperlink(): string;
    requiresAction(): boolean;
    isFinished(): boolean;
    isQuoteExpired(): boolean;
    isQuoteSoftExpired(): boolean;
    isFailed(): boolean;
    isSuccessful(): boolean;
    verifyQuoteValid(): Promise<boolean>;
    protected getOutAmountWithoutFee(): bigint;
    getOutput(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
    getInput(): TokenAmount<T["ChainId"], BtcToken<false>>;
    getInputWithoutFee(): TokenAmount<T["ChainId"], BtcToken<false>>;
    protected getSwapFee(): Fee<T["ChainId"], BtcToken<false>, SCToken<T["ChainId"]>>;
    getFee(): Fee<T["ChainId"], BtcToken<false>, SCToken<T["ChainId"]>>;
    getFeeBreakdown(): [{
        type: FeeType.SWAP;
        fee: Fee<T["ChainId"], BtcToken<false>, SCToken<T["ChainId"]>>;
    }];
    getRequiredConfirmationsCount(): number;
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
    protected checkAddress(save?: boolean): Promise<boolean>;
    protected setRefundAddress(refundAddress: string): Promise<void>;
    /**
     * A blocking promise resolving when payment was received by the intermediary and client can continue
     * rejecting in case of failure
     *
     * @param abortSignal Abort signal
     * @param checkIntervalSeconds How often to poll the intermediary for answer
     * @param updateCallback Callback called when txId is found, and also called with subsequent confirmations
     * @throws {PaymentAuthError} If swap expired or failed
     * @throws {Error} When in invalid state (not PR_CREATED)
     */
    waitForBitcoinTransaction(updateCallback?: (txId: string, confirmations: number, targetConfirmations: number, txEtaMs: number) => void, checkIntervalSeconds?: number, abortSignal?: AbortSignal): Promise<string>;
    waitTillRefunded(checkIntervalSeconds?: number, abortSignal?: AbortSignal): Promise<void>;
    requestRefund(refundAddress?: string, abortSignal?: AbortSignal): Promise<void>;
    serialize(): any;
    _getInitiator(): string;
    _sync(save?: boolean): Promise<boolean>;
    _tick(save?: boolean): Promise<boolean>;
}
