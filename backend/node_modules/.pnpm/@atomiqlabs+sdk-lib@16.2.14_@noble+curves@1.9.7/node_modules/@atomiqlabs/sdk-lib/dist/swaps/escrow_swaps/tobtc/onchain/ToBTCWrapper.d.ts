/// <reference types="node" />
import { ToBTCSwap } from "./ToBTCSwap";
import { IToBTCWrapper } from "../IToBTCWrapper";
import { ChainType, BitcoinRpc } from "@atomiqlabs/base";
import { Intermediary } from "../../../../intermediaries/Intermediary";
import { ISwapPrice } from "../../../../prices/abstract/ISwapPrice";
import { EventEmitter } from "events";
import { AmountData, ISwapWrapperOptions, WrapperCtorTokens } from "../../../ISwapWrapper";
import { SwapType } from "../../../enums/SwapType";
import { BTC_NETWORK } from "@scure/btc-signer/utils";
import { UnifiedSwapEventListener } from "../../../../events/UnifiedSwapEventListener";
import { UnifiedSwapStorage } from "../../../../storage/UnifiedSwapStorage";
import { ISwap } from "../../../ISwap";
export type ToBTCOptions = {
    confirmationTarget?: number;
    confirmations?: number;
};
export type ToBTCWrapperOptions = ISwapWrapperOptions & {
    safetyFactor?: number;
    maxConfirmations?: number;
    bitcoinNetwork?: BTC_NETWORK;
    bitcoinBlocktime?: number;
    maxExpectedOnchainSendSafetyFactor?: number;
    maxExpectedOnchainSendGracePeriodBlocks?: number;
};
export declare class ToBTCWrapper<T extends ChainType> extends IToBTCWrapper<T, ToBTCSwap<T>, ToBTCWrapperOptions> {
    readonly TYPE = SwapType.TO_BTC;
    readonly swapDeserializer: typeof ToBTCSwap;
    readonly btcRpc: BitcoinRpc<any>;
    /**
     * @param chainIdentifier
     * @param unifiedStorage Storage interface for the current environment
     * @param unifiedChainEvents Smart chain on-chain event listener
     * @param chain
     * @param contract Chain specific swap contract
     * @param prices Swap pricing handler
     * @param tokens
     * @param swapDataDeserializer Deserializer for chain specific SwapData
     * @param btcRpc Bitcoin RPC api
     * @param options
     * @param events Instance to use for emitting events
     */
    constructor(chainIdentifier: string, unifiedStorage: UnifiedSwapStorage<T>, unifiedChainEvents: UnifiedSwapEventListener<T>, chain: T["ChainInterface"], contract: T["Contract"], prices: ISwapPrice, tokens: WrapperCtorTokens, swapDataDeserializer: new (data: any) => T["Data"], btcRpc: BitcoinRpc<any>, options?: ToBTCWrapperOptions, events?: EventEmitter<{
        swapState: [ISwap];
    }>);
    /**
     * Returns randomly generated random escrow nonce to be used for to BTC on-chain swaps
     * @private
     * @returns Escrow nonce
     */
    private getRandomNonce;
    /**
     * Converts bitcoin address to its corresponding output script
     *
     * @param addr Bitcoin address to get the output script for
     * @private
     * @returns Output script as Buffer
     * @throws {UserError} if invalid address is specified
     */
    private btcAddressToOutputScript;
    /**
     * Verifies returned LP data
     *
     * @param signer
     * @param resp LP's response
     * @param amountData
     * @param lp
     * @param options Options as passed to the swap create function
     * @param data LP's returned parsed swap data
     * @param hash Payment hash of the swap
     * @private
     * @throws {IntermediaryError} if returned data are not correct
     */
    private verifyReturnedData;
    /**
     * Returns quotes fetched from LPs, paying to an 'address' - a bitcoin address
     *
     * @param signer                Smart-chain signer address initiating the swap
     * @param address               Bitcoin on-chain address you wish to pay to
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers) to get the quotes from
     * @param options               Quote options
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     */
    create(signer: string, address: string, amountData: AmountData, lps: Intermediary[], options?: ToBTCOptions, additionalParams?: Record<string, any>, abortSignal?: AbortSignal): {
        quote: Promise<ToBTCSwap<T>>;
        intermediary: Intermediary;
    }[];
}
