/// <reference types="node" />
import { ISwapWrapper, ISwapWrapperOptions, WrapperCtorTokens } from "../ISwapWrapper";
import { ChainType, ClaimEvent, InitializeEvent, RefundEvent, SignatureData, SwapEvent } from "@atomiqlabs/base";
import { ISwap } from "../ISwap";
import { UnifiedSwapStorage } from "../../storage/UnifiedSwapStorage";
import { UnifiedSwapEventListener } from "../../events/UnifiedSwapEventListener";
import { ISwapPrice } from "../../prices/abstract/ISwapPrice";
import { EventEmitter } from "events";
import { SwapType } from "../enums/SwapType";
import { IEscrowSwap } from "./IEscrowSwap";
export declare abstract class IEscrowSwapWrapper<T extends ChainType, S extends IEscrowSwap<T>, O extends ISwapWrapperOptions = ISwapWrapperOptions> extends ISwapWrapper<T, S, O> {
    readonly abstract TYPE: SwapType;
    readonly abstract pendingSwapStates: Array<S["state"]>;
    readonly abstract swapDeserializer: {
        new (wrapper: ISwapWrapper<T, S, O>, data: any): S;
    };
    readonly abstract tickSwapState: Array<S["state"]>;
    readonly contract: T["Contract"];
    readonly swapDataDeserializer: new (data: any) => T["Data"];
    constructor(chainIdentifier: string, unifiedStorage: UnifiedSwapStorage<T>, unifiedChainEvents: UnifiedSwapEventListener<T>, chain: T["ChainInterface"], contract: T["Contract"], prices: ISwapPrice, tokens: WrapperCtorTokens, swapDataDeserializer: new (data: any) => T["Data"], options: O, events?: EventEmitter<{
        swapState: [ISwap];
    }>);
    /**
     * Pre-fetches signature verification data from the server's pre-sent promise, doesn't throw, instead returns null
     *
     * @param signDataPrefetch Promise that resolves when we receive "signDataPrefetch" from the LP in streaming mode
     * @protected
     * @returns Pre-fetched signature verification data or null if failed
     */
    protected preFetchSignData(signDataPrefetch: Promise<any | null>): Promise<any | null>;
    /**
     * Verifies swap initialization signature returned by the intermediary
     *
     * @param initiator A smart chain account initiating the swap
     * @param data Parsed swap data from the intermediary
     * @param signature Response of the intermediary
     * @param feeRatePromise Pre-fetched fee rate promise
     * @param preFetchSignatureVerificationData Pre-fetched signature verification data
     * @param abortSignal
     * @protected
     * @returns Swap initialization signature expiry
     * @throws {SignatureVerificationError} when swap init signature is invalid
     */
    protected verifyReturnedSignature(initiator: string, data: T["Data"], signature: SignatureData, feeRatePromise: Promise<any>, preFetchSignatureVerificationData: Promise<any>, abortSignal?: AbortSignal): Promise<number>;
    /**
     * Processes InitializeEvent for a given swap
     * @param swap
     * @param event
     * @protected
     * @returns Whether the swap was updated/changed
     */
    protected processEventInitialize?(swap: S, event: InitializeEvent<T["Data"]>): Promise<boolean>;
    /**
     * Processes ClaimEvent for a given swap
     * @param swap
     * @param event
     * @protected
     * @returns Whether the swap was updated/changed
     */
    protected processEventClaim?(swap: S, event: ClaimEvent<T["Data"]>): Promise<boolean>;
    /**
     * Processes RefundEvent for a given swap
     * @param swap
     * @param event
     * @protected
     * @returns Whether the swap was updated/changed
     */
    protected processEventRefund?(swap: S, event: RefundEvent<T["Data"]>): Promise<boolean>;
    /**
     * Processes a single SC on-chain event
     * @private
     * @param event
     * @param swap
     */
    protected processEvent(event: SwapEvent<T["Data"]>, swap: S): Promise<boolean>;
    protected _checkPastSwaps(pastSwaps: S[]): Promise<{
        changedSwaps: S[];
        removeSwaps: S[];
    }>;
}
