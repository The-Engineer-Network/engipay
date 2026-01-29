/// <reference types="node" />
import { ISwapWrapper, ISwapWrapperOptions, WrapperCtorTokens } from "../../ISwapWrapper";
import { ChainType } from "@atomiqlabs/base";
import { OnchainForGasSwap, OnchainForGasSwapState } from "./OnchainForGasSwap";
import { BitcoinRpcWithAddressIndex } from "../../../btc/BitcoinRpcWithAddressIndex";
import { ISwapPrice } from "../../../prices/abstract/ISwapPrice";
import { EventEmitter } from "events";
import { Intermediary } from "../../../intermediaries/Intermediary";
import { SwapType } from "../../enums/SwapType";
import { UnifiedSwapEventListener } from "../../../events/UnifiedSwapEventListener";
import { UnifiedSwapStorage } from "../../../storage/UnifiedSwapStorage";
import { ISwap } from "../../ISwap";
import { BTC_NETWORK } from "@scure/btc-signer/utils";
export type OnchainForGasWrapperOptions = ISwapWrapperOptions & {
    bitcoinNetwork: BTC_NETWORK;
};
export declare class OnchainForGasWrapper<T extends ChainType> extends ISwapWrapper<T, OnchainForGasSwap<T>, OnchainForGasWrapperOptions> {
    readonly TYPE = SwapType.TRUSTED_FROM_BTC;
    readonly swapDeserializer: typeof OnchainForGasSwap;
    readonly btcRpc: BitcoinRpcWithAddressIndex<any>;
    /**
     * @param chainIdentifier
     * @param unifiedStorage Storage interface for the current environment
     * @param unifiedChainEvents On-chain event listener
     * @param chain
     * @param prices Pricing to use
     * @param tokens
     * @param btcRpc Bitcoin RPC which also supports getting transactions by txoHash
     * @param options
     * @param events Instance to use for emitting events
     */
    constructor(chainIdentifier: string, unifiedStorage: UnifiedSwapStorage<T>, unifiedChainEvents: UnifiedSwapEventListener<T>, chain: T["ChainInterface"], prices: ISwapPrice, tokens: WrapperCtorTokens, btcRpc: BitcoinRpcWithAddressIndex<any>, options?: OnchainForGasWrapperOptions, events?: EventEmitter<{
        swapState: [ISwap];
    }>);
    /**
     * Returns a newly created swap, receiving 'amount' base units of gas token
     *
     * @param signer
     * @param amount            Amount you wish to receive in base units
     * @param lpOrUrl           Intermediary/Counterparty swap service Intermediary object or raw url
     * @param refundAddress     Bitcoin address to receive refund on in case the counterparty cannot execute the swap
     */
    create(signer: string, amount: bigint, lpOrUrl: Intermediary | string, refundAddress?: string): Promise<OnchainForGasSwap<T>>;
    readonly pendingSwapStates: OnchainForGasSwapState[];
    readonly tickSwapState: any;
    protected processEvent: any;
}
