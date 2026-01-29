/// <reference types="node" />
import { ToBTCLNSwap } from "./ToBTCLNSwap";
import { IToBTCWrapper } from "../IToBTCWrapper";
import { ChainType, SwapCommitState } from "@atomiqlabs/base";
import { Intermediary } from "../../../../intermediaries/Intermediary";
import { AmountData, ISwapWrapperOptions, WrapperCtorTokens } from "../../../ISwapWrapper";
import { ISwapPrice } from "../../../../prices/abstract/ISwapPrice";
import { EventEmitter } from "events";
import { SwapType } from "../../../enums/SwapType";
import { LNURLPayParamsWithUrl } from "../../../../utils/LNURL";
import { UnifiedSwapEventListener } from "../../../../events/UnifiedSwapEventListener";
import { UnifiedSwapStorage } from "../../../../storage/UnifiedSwapStorage";
import { ISwap } from "../../../ISwap";
export type LightningWalletCallback = (valueSats: number, abortSignal?: AbortSignal) => Promise<string>;
export type InvoiceCreateService = {
    getInvoice: LightningWalletCallback;
    minMsats?: bigint;
    maxMSats?: bigint;
};
export declare function isInvoiceCreateService(obj: any): obj is InvoiceCreateService;
export type ToBTCLNOptions = {
    expirySeconds?: number;
    maxFee?: bigint | Promise<bigint>;
    expiryTimestamp?: bigint;
    maxRoutingPPM?: bigint;
    maxRoutingBaseFee?: bigint;
};
export type ToBTCLNWrapperOptions = ISwapWrapperOptions & {
    lightningBaseFee?: number;
    lightningFeePPM?: number;
    paymentTimeoutSeconds?: number;
};
export declare class ToBTCLNWrapper<T extends ChainType> extends IToBTCWrapper<T, ToBTCLNSwap<T>, ToBTCLNWrapperOptions> {
    readonly TYPE = SwapType.TO_BTCLN;
    readonly swapDeserializer: typeof ToBTCLNSwap;
    constructor(chainIdentifier: string, unifiedStorage: UnifiedSwapStorage<T>, unifiedChainEvents: UnifiedSwapEventListener<T>, chain: T["ChainInterface"], contract: T["Contract"], prices: ISwapPrice, tokens: WrapperCtorTokens, swapDataDeserializer: new (data: any) => T["Data"], options?: ToBTCLNWrapperOptions, events?: EventEmitter<{
        swapState: [ISwap];
    }>);
    private checkPaymentHashWasPaid;
    /**
     * Calculates maximum lightning network routing fee based on amount
     *
     * @param amount BTC amount of the swap in satoshis
     * @param overrideBaseFee Override wrapper's default base fee
     * @param overrideFeePPM Override wrapper's default PPM
     * @private
     * @returns Maximum lightning routing fee in sats
     */
    private calculateFeeForAmount;
    /**
     * Verifies returned LP data
     *
     * @param signer
     * @param resp Response as returned by the LP
     * @param parsedPr Parsed bolt11 lightning invoice
     * @param token Smart chain token to be used in the swap
     * @param lp
     * @param options Swap options as passed to the swap create function
     * @param data Parsed swap data returned by the LP
     * @param requiredTotal Required total to be paid on the input (for exactIn swaps)
     * @private
     * @throws {IntermediaryError} In case the response is not valid
     */
    private verifyReturnedData;
    /**
     * Returns the quote/swap from a given intermediary
     *
     * @param signer Smartchain signer initiating the swap
     * @param amountData
     * @param lp Intermediary
     * @param pr bolt11 lightning network invoice
     * @param parsedPr Parsed bolt11 lightning network invoice
     * @param options Options as passed to the swap create function
     * @param preFetches
     * @param abort Abort signal or controller, if AbortController is passed it is used as-is, when AbortSignal is passed
     *  it is extended with extendAbortController and then used
     * @param additionalParams Additional params that should be sent to the LP
     * @private
     */
    private getIntermediaryQuote;
    /**
     * Returns a newly created swap, paying for 'bolt11PayRequest' - a bitcoin LN invoice
     *
     * @param signer                Smartchain signer's address initiating the swap
     * @param bolt11PayRequest      BOLT11 payment request (bitcoin lightning invoice) you wish to pay
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers) to get the quotes from
     * @param options               Quote options
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     * @param preFetches            Existing pre-fetches for the swap (only used internally for LNURL swaps)
     */
    create(signer: string, bolt11PayRequest: string, amountData: Omit<AmountData, "amount">, lps: Intermediary[], options?: ToBTCLNOptions, additionalParams?: Record<string, any>, abortSignal?: AbortSignal, preFetches?: {
        feeRatePromise: Promise<any>;
        pricePreFetchPromise: Promise<bigint>;
        signDataPrefetchPromise?: Promise<any>;
    }): Promise<{
        quote: Promise<ToBTCLNSwap<T>>;
        intermediary: Intermediary;
    }[]>;
    /**
     * Parses and fetches lnurl pay params from the specified lnurl
     *
     * @param lnurl LNURL to be parsed and fetched
     * @param abortSignal
     * @private
     * @throws {UserError} if the LNURL is invalid or if it's not a LNURL-pay
     */
    private getLNURLPay;
    /**
     * Returns the quote/swap from the given LP
     *
     * @param signer Smartchain signer's address initiating the swap
     * @param amountData
     * @param invoiceCreateService Service for creating fixed amount invoices
     * @param lp Intermediary
     * @param dummyPr Dummy minimum value bolt11 lightning invoice returned from the LNURL-pay
     * @param options Options as passed to the swap create function
     * @param preFetches
     * @param abortSignal
     * @param additionalParams Additional params to be sent to the intermediary
     * @private
     */
    private getIntermediaryQuoteExactIn;
    /**
     * Returns a newly created swap, allowing exactIn swaps with invoice creation service
     *
     * @param signer                Smartchain signer's address initiating the swap
     * @param invoiceCreateServicePromise
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers/intermediaries) to get the quotes from
     * @param options               Quote options
     * @param additionalParams      Additional parameters sent to the intermediary when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     */
    createViaInvoiceCreateService(signer: string, invoiceCreateServicePromise: Promise<InvoiceCreateService>, amountData: AmountData, lps: Intermediary[], options: ToBTCLNOptions, additionalParams?: Record<string, any>, abortSignal?: AbortSignal): Promise<{
        quote: Promise<ToBTCLNSwap<T>>;
        intermediary: Intermediary;
    }[]>;
    /**
     * Returns a newly created swap, paying for 'lnurl' - a lightning LNURL-pay
     *
     * @param signer                Smartchain signer's address initiating the swap
     * @param lnurl                 LMURL-pay you wish to pay
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers/intermediaries) to get the quotes from
     * @param options               Quote options
     * @param additionalParams      Additional parameters sent to the intermediary when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     */
    createViaLNURL(signer: string, lnurl: string | LNURLPayParamsWithUrl, amountData: AmountData, lps: Intermediary[], options?: ToBTCLNOptions & {
        comment?: string;
    }, additionalParams?: Record<string, any>, abortSignal?: AbortSignal): Promise<{
        quote: Promise<ToBTCLNSwap<T>>;
        intermediary: Intermediary;
    }[]>;
    recoverFromSwapDataAndState(init: {
        data: T["Data"];
        getInitTxId: () => Promise<string>;
        getTxBlock: () => Promise<{
            blockTime: number;
            blockHeight: number;
        }>;
    }, state: SwapCommitState, lp: Intermediary): Promise<ToBTCLNSwap<T>>;
}
