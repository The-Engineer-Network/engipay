/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import { ChainType, ClaimEvent, InitializeEvent, Messenger, RefundEvent } from "@atomiqlabs/base";
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
import { FromBTCLNAutoSwap, FromBTCLNAutoSwapState } from "./FromBTCLNAutoSwap";
import { IFromBTCLNWrapper } from "../IFromBTCLNWrapper";
import { IClaimableSwapWrapper } from "../../../IClaimableSwapWrapper";
export type FromBTCLNAutoOptions = {
    descriptionHash?: Buffer;
    unsafeSkipLnNodeCheck?: boolean;
    gasAmount?: bigint;
    unsafeZeroWatchtowerFee?: boolean;
    feeSafetyFactor?: number;
};
export type FromBTCLNAutoWrapperOptions = ISwapWrapperOptions & {
    safetyFactor?: number;
    bitcoinBlocktime?: number;
    unsafeSkipLnNodeCheck?: boolean;
};
export declare class FromBTCLNAutoWrapper<T extends ChainType> extends IFromBTCLNWrapper<T, FromBTCLNAutoSwap<T>, FromBTCLNAutoWrapperOptions> implements IClaimableSwapWrapper<FromBTCLNAutoSwap<T>> {
    readonly claimableSwapStates: FromBTCLNAutoSwapState[];
    readonly TYPE = SwapType.FROM_BTCLN_AUTO;
    readonly swapDeserializer: typeof FromBTCLNAutoSwap;
    protected readonly lnApi: LightningNetworkApi;
    readonly messenger: Messenger;
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
     * @param messenger
     * @param options
     * @param events Instance to use for emitting events
     */
    constructor(chainIdentifier: string, unifiedStorage: UnifiedSwapStorage<T>, unifiedChainEvents: UnifiedSwapEventListener<T>, chain: T["ChainInterface"], contract: T["Contract"], prices: ISwapPrice, tokens: WrapperCtorTokens, swapDataDeserializer: new (data: any) => T["Data"], lnApi: LightningNetworkApi, messenger: Messenger, options: FromBTCLNAutoWrapperOptions, events?: EventEmitter<{
        swapState: [ISwap];
    }>);
    readonly pendingSwapStates: FromBTCLNAutoSwapState[];
    readonly tickSwapState: FromBTCLNAutoSwapState[];
    protected processEventInitialize(swap: FromBTCLNAutoSwap<T>, event: InitializeEvent<T["Data"]>): Promise<boolean>;
    protected processEventClaim(swap: FromBTCLNAutoSwap<T>, event: ClaimEvent<T["Data"]>): Promise<boolean>;
    protected processEventRefund(swap: FromBTCLNAutoSwap<T>, event: RefundEvent<T["Data"]>): Promise<boolean>;
    /**
     * Pre-fetches claimer (watchtower) bounty data for the swap. Doesn't throw, instead returns null and aborts the
     *  provided abortController
     *
     * @param signer Smartchain signer address initiating the swap
     * @param amountData
     * @param options Options as passed to the swap creation function
     * @param abortController
     * @private
     */
    private preFetchClaimerBounty;
    /**
     * Verifies response returned from intermediary
     *
     * @param resp Response as returned by the intermediary
     * @param amountData
     * @param lp Intermediary
     * @param options Options as passed to the swap creation function
     * @param decodedPr Decoded bolt11 lightning network invoice
     * @param paymentHash Expected payment hash of the bolt11 lightning network invoice
     * @param claimerBounty Claimer bounty as request by the user
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
    create(signer: string, amountData: AmountData, lps: Intermediary[], options: FromBTCLNAutoOptions, additionalParams?: Record<string, any>, abortSignal?: AbortSignal, preFetches?: {
        pricePrefetchPromise?: Promise<bigint>;
        gasTokenPricePrefetchPromise?: Promise<bigint>;
        claimerBountyPrefetch?: Promise<bigint>;
    }): {
        quote: Promise<FromBTCLNAutoSwap<T>>;
        intermediary: Intermediary;
    }[];
    /**
     * Returns a newly created swap, receiving 'amount' from the lnurl-withdraw
     *
     * @param signer                Smart chains signer's address intiating the swap
     * @param lnurl                 LNURL-withdraw to withdraw funds from
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers) to get the quotes from
     * @param options
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     */
    createViaLNURL(signer: string, lnurl: string | LNURLWithdrawParamsWithUrl, amountData: AmountData, lps: Intermediary[], options: FromBTCLNAutoOptions, additionalParams?: Record<string, any>, abortSignal?: AbortSignal): Promise<{
        quote: Promise<FromBTCLNAutoSwap<T>>;
        intermediary: Intermediary;
    }[]>;
    protected _checkPastSwaps(pastSwaps: FromBTCLNAutoSwap<T>[]): Promise<{
        changedSwaps: FromBTCLNAutoSwap<T>[];
        removeSwaps: FromBTCLNAutoSwap<T>[];
    }>;
}
