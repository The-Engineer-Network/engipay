/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import { FromBTCLNSwap, FromBTCLNSwapState } from "./FromBTCLNSwap";
import { ChainType, ClaimEvent, InitializeEvent, RefundEvent } from "@atomiqlabs/base";
import { Intermediary } from "../../../../intermediaries/Intermediary";
import { Buffer } from "buffer";
import { SwapType } from "../../../enums/SwapType";
import { LightningNetworkApi } from "../../../../btc/LightningNetworkApi";
import { ISwapPrice } from "../../../../prices/abstract/ISwapPrice";
import { EventEmitter } from "events";
import { AmountData, ISwapWrapperOptions, WrapperCtorTokens } from "../../../ISwapWrapper";
import { LNURLWithdrawParamsWithUrl } from "../../../../utils/LNURL";
import { UnifiedSwapEventListener } from "../../../../events/UnifiedSwapEventListener";
import { UnifiedSwapStorage } from "../../../../storage/UnifiedSwapStorage";
import { ISwap } from "../../../ISwap";
import { IFromBTCLNWrapper } from "../IFromBTCLNWrapper";
import { IClaimableSwapWrapper } from "../../../IClaimableSwapWrapper";
export type FromBTCLNOptions = {
    descriptionHash?: Buffer;
    unsafeSkipLnNodeCheck?: boolean;
};
export type FromBTCLNWrapperOptions = ISwapWrapperOptions & {
    unsafeSkipLnNodeCheck?: boolean;
    safetyFactor?: number;
    bitcoinBlocktime?: number;
};
export declare class FromBTCLNWrapper<T extends ChainType> extends IFromBTCLNWrapper<T, FromBTCLNSwap<T>, FromBTCLNWrapperOptions> implements IClaimableSwapWrapper<FromBTCLNSwap<T>> {
    readonly claimableSwapStates: FromBTCLNSwapState[];
    readonly TYPE = SwapType.FROM_BTCLN;
    readonly swapDeserializer: typeof FromBTCLNSwap;
    /**
     * @param chainIdentifier
     * @param unifiedStorage Storage interface for the current environment
     * @param unifiedChainEvents On-chain event listener
     * @param chain
     * @param contract Underlying contract handling the swaps
     * @param prices Swap pricing handler
     * @param tokens
     * @param swapDataDeserializer Deserializer for SwapData
     * @param lnApi
     * @param options
     * @param events Instance to use for emitting events
     */
    constructor(chainIdentifier: string, unifiedStorage: UnifiedSwapStorage<T>, unifiedChainEvents: UnifiedSwapEventListener<T>, chain: T["ChainInterface"], contract: T["Contract"], prices: ISwapPrice, tokens: WrapperCtorTokens, swapDataDeserializer: new (data: any) => T["Data"], lnApi: LightningNetworkApi, options: FromBTCLNWrapperOptions, events?: EventEmitter<{
        swapState: [ISwap];
    }>);
    readonly pendingSwapStates: FromBTCLNSwapState[];
    readonly tickSwapState: FromBTCLNSwapState[];
    protected processEventInitialize(swap: FromBTCLNSwap<T>, event: InitializeEvent<T["Data"]>): Promise<boolean>;
    protected processEventClaim(swap: FromBTCLNSwap<T>, event: ClaimEvent<T["Data"]>): Promise<boolean>;
    protected processEventRefund(swap: FromBTCLNSwap<T>, event: RefundEvent<T["Data"]>): Promise<boolean>;
    /**
     * Verifies response returned from intermediary
     *
     * @param resp Response as returned by the intermediary
     * @param amountData
     * @param lp Intermediary
     * @param options Options as passed to the swap creation function
     * @param decodedPr Decoded bolt11 lightning network invoice
     * @param paymentHash Expected payment hash of the bolt11 lightning network invoice
     * @private
     * @throws {IntermediaryError} in case the response is invalid
     */
    private verifyReturnedData;
    /**
     * Returns a newly created swap, receiving 'amount' on lightning network
     *
     * @param signer                Smart chain signer's address intiating the swap
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers) to get the quotes from
     * @param options               Quote options
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     * @param preFetches
     */
    create(signer: string, amountData: AmountData, lps: Intermediary[], options: FromBTCLNOptions, additionalParams?: Record<string, any>, abortSignal?: AbortSignal, preFetches?: {
        pricePrefetchPromise?: Promise<bigint>;
        feeRatePromise?: Promise<any>;
    }): {
        quote: Promise<FromBTCLNSwap<T>>;
        intermediary: Intermediary;
    }[];
    /**
     * Returns a newly created swap, receiving 'amount' from the lnurl-withdraw
     *
     * @param signer                Smart chains signer's address intiating the swap
     * @param lnurl                 LNURL-withdraw to withdraw funds from
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers) to get the quotes from
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     */
    createViaLNURL(signer: string, lnurl: string | LNURLWithdrawParamsWithUrl, amountData: AmountData, lps: Intermediary[], additionalParams?: Record<string, any>, abortSignal?: AbortSignal): Promise<{
        quote: Promise<FromBTCLNSwap<T>>;
        intermediary: Intermediary;
    }[]>;
    protected _checkPastSwaps(pastSwaps: FromBTCLNSwap<T>[]): Promise<{
        changedSwaps: FromBTCLNSwap<T>[];
        removeSwaps: FromBTCLNSwap<T>[];
    }>;
}
