/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import { ChainType, SwapData } from "@atomiqlabs/base";
import { IFromBTCWrapper } from "./IFromBTCWrapper";
import { ISwapWrapperOptions, WrapperCtorTokens } from "../../ISwapWrapper";
import { LightningNetworkApi, LNNodeLiquidity } from "../../../btc/LightningNetworkApi";
import { UnifiedSwapStorage } from "../../../storage/UnifiedSwapStorage";
import { UnifiedSwapEventListener } from "../../../events/UnifiedSwapEventListener";
import { ISwapPrice } from "../../../prices/abstract/ISwapPrice";
import { EventEmitter } from "events";
import { Buffer } from "buffer";
import { Intermediary } from "../../../intermediaries/Intermediary";
import { PaymentRequestObject, TagsObject } from "@atomiqlabs/bolt11";
import { LNURLWithdrawParamsWithUrl } from "../../../utils/LNURL";
import { IEscrowSwap } from "../IEscrowSwap";
export declare abstract class IFromBTCLNWrapper<T extends ChainType, S extends IEscrowSwap<T>, O extends ISwapWrapperOptions = ISwapWrapperOptions> extends IFromBTCWrapper<T, S, O> {
    protected readonly lnApi: LightningNetworkApi;
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
    constructor(chainIdentifier: string, unifiedStorage: UnifiedSwapStorage<T>, unifiedChainEvents: UnifiedSwapEventListener<T>, chain: T["ChainInterface"], contract: T["Contract"], prices: ISwapPrice, tokens: WrapperCtorTokens, swapDataDeserializer: new (data: any) => T["Data"], lnApi: LightningNetworkApi, options: O, events?: EventEmitter<{
        swapState: [IEscrowSwap];
    }>);
    /**
     * Returns the swap expiry, leaving enough time for the user to claim the HTLC
     *
     * @param data Parsed swap data
     */
    getHtlcTimeout(data: SwapData): bigint;
    /**
     * Generates a new 32-byte secret to be used as pre-image for lightning network invoice & HTLC swap\
     *
     * @private
     * @returns Hash pre-image & payment hash
     */
    protected getSecretAndHash(): {
        secret: Buffer;
        paymentHash: Buffer;
    };
    /**
     * Pre-fetches intermediary's LN node capacity, doesn't throw, instead returns null
     *
     * @param pubkeyPromise Promise that resolves when we receive "lnPublicKey" param from the intermediary thorugh
     *  streaming
     * @private
     * @returns LN Node liquidity
     */
    protected preFetchLnCapacity(pubkeyPromise: Promise<string>): Promise<LNNodeLiquidity | null>;
    /**
     * Verifies whether the intermediary's lightning node has enough inbound capacity to receive the LN payment
     *
     * @param lp Intermediary
     * @param decodedPr Decoded bolt11 lightning network invoice
     * @param amountIn Amount to be paid for the swap in sats
     * @param lnCapacityPrefetchPromise Pre-fetch for LN node capacity, preFetchLnCapacity()
     * @param abortSignal
     * @private
     * @throws {IntermediaryError} if the lightning network node doesn't have enough inbound liquidity
     * @throws {Error} if the lightning network node's inbound liquidity might be enough, but the swap would
     *  deplete more than half of the liquidity
     */
    protected verifyLnNodeCapacity(lp: Intermediary, decodedPr: PaymentRequestObject & {
        tagsObject: TagsObject;
    }, lnCapacityPrefetchPromise: Promise<LNNodeLiquidity | null>, abortSignal?: AbortSignal): Promise<void>;
    /**
     * Parses and fetches lnurl withdraw params from the specified lnurl
     *
     * @param lnurl LNURL to be parsed and fetched
     * @param abortSignal
     * @private
     * @throws {UserError} if the LNURL is invalid or if it's not a LNURL-withdraw
     */
    protected getLNURLWithdraw(lnurl: string | LNURLWithdrawParamsWithUrl, abortSignal: AbortSignal): Promise<LNURLWithdrawParamsWithUrl>;
}
