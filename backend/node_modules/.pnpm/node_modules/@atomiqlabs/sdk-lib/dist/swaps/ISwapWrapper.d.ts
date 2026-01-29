/// <reference types="node" />
/// <reference types="node" />
import { ChainEvent, ChainType, SwapCommitState } from "@atomiqlabs/base";
import { EventEmitter } from "events";
import { ISwap } from "./ISwap";
import { ISwapPrice, PriceInfoType } from "../prices/abstract/ISwapPrice";
import { SCToken } from "../Tokens";
import { ChainIds, MultiChain } from "./swapper/Swapper";
import { UnifiedSwapEventListener } from "../events/UnifiedSwapEventListener";
import { SwapType } from "./enums/SwapType";
import { UnifiedSwapStorage } from "../storage/UnifiedSwapStorage";
import { Intermediary } from "../intermediaries/Intermediary";
export type AmountData = {
    amount: bigint;
    token: string;
    exactIn?: boolean;
};
export type ISwapWrapperOptions = {
    getRequestTimeout?: number;
    postRequestTimeout?: number;
};
export type WrapperCtorTokens<T extends MultiChain = MultiChain> = {
    ticker: string;
    name: string;
    chains: {
        [chainId in ChainIds<T>]?: {
            address: string;
            decimals: number;
            displayDecimals?: number;
        };
    };
}[];
export declare abstract class ISwapWrapper<T extends ChainType, S extends ISwap<T>, O extends ISwapWrapperOptions = ISwapWrapperOptions> {
    abstract readonly TYPE: SwapType;
    protected readonly logger: import("../utils/Utils").LoggerType;
    abstract readonly swapDeserializer: new (wrapper: ISwapWrapper<T, S, O>, data: any) => S;
    readonly unifiedStorage: UnifiedSwapStorage<T>;
    readonly unifiedChainEvents: UnifiedSwapEventListener<T>;
    readonly chainIdentifier: T["ChainId"];
    readonly chain: T["ChainInterface"];
    readonly prices: ISwapPrice;
    readonly events: EventEmitter<{
        swapState: [ISwap];
    }>;
    readonly options: O;
    readonly tokens: {
        [tokenAddress: string]: SCToken<T["ChainId"]>;
    };
    readonly pendingSwaps: Map<string, WeakRef<S>>;
    isInitialized: boolean;
    tickInterval: NodeJS.Timeout;
    /**
     * @param chainIdentifier
     * @param unifiedStorage
     * @param unifiedChainEvents
     * @param chain
     * @param prices Swap pricing handler
     * @param tokens Chain specific token data
     * @param options
     * @param events Instance to use for emitting events
     */
    constructor(chainIdentifier: T["ChainId"], unifiedStorage: UnifiedSwapStorage<T>, unifiedChainEvents: UnifiedSwapEventListener<T>, chain: T["ChainInterface"], prices: ISwapPrice, tokens: WrapperCtorTokens, options: O, events?: EventEmitter<{
        swapState: [ISwap];
    }>);
    /**
     * Pre-fetches swap price for a given swap
     *
     * @param amountData
     * @param abortSignal
     * @protected
     * @returns Price of the token in uSats (micro sats)
     */
    protected preFetchPrice(amountData: {
        token: string;
    }, abortSignal?: AbortSignal): Promise<bigint | null>;
    /**
     * Verifies returned  price for swaps
     *
     * @param lpServiceData Service data for the service in question (TO_BTCLN, TO_BTC, etc.) of the given intermediary
     * @param send Whether this is a send (SOL -> SC) or receive (BTC -> SC) swap
     * @param amountSats Amount in BTC
     * @param amountToken Amount in token
     * @param token Token used in the swap
     * @param feeData Fee data as returned by the intermediary
     * @param pricePrefetchPromise Price pre-fetch promise
     * @param abortSignal
     * @protected
     * @returns Price info object
     * @throws {IntermediaryError} if the calculated fee is too high
     */
    protected verifyReturnedPrice(lpServiceData: {
        swapBaseFee: number;
        swapFeePPM: number;
    }, send: boolean, amountSats: bigint, amountToken: bigint, token: string, feeData: {
        networkFee?: bigint;
    }, pricePrefetchPromise?: Promise<bigint>, abortSignal?: AbortSignal): Promise<PriceInfoType>;
    abstract readonly pendingSwapStates: Array<S["state"]>;
    abstract readonly tickSwapState: Array<S["state"]>;
    /**
     * Processes a single SC on-chain event
     * @private
     * @param event
     * @param swap
     */
    protected abstract processEvent?(event: ChainEvent<T["Data"]>, swap: S): Promise<boolean>;
    /**
     * Initializes the swap wrapper, needs to be called before any other action can be taken
     */
    init(noTimers?: boolean, noCheckPastSwaps?: boolean): Promise<void>;
    protected startTickInterval(): void;
    protected _checkPastSwaps(pastSwaps: S[]): Promise<{
        changedSwaps: S[];
        removeSwaps: S[];
    }>;
    checkPastSwaps(pastSwaps?: S[], noSave?: boolean): Promise<{
        removeSwaps: S[];
        changedSwaps: S[];
    }>;
    tick(swaps?: S[]): Promise<void>;
    saveSwapData(swap: S): Promise<void>;
    removeSwapData(swap: S): Promise<void>;
    recoverFromSwapDataAndState(init: {
        data: T["Data"];
        getInitTxId: () => Promise<string>;
        getTxBlock: () => Promise<{
            blockTime: number;
            blockHeight: number;
        }>;
    }, state: SwapCommitState, lp: Intermediary): Promise<S>;
    /**
     * Un-subscribes from event listeners on Solana
     */
    stop(): Promise<void>;
    /**
     * Returns the smart chain's native token used to pay for fees
     */
    getNativeToken(): SCToken<T["ChainId"]>;
}
