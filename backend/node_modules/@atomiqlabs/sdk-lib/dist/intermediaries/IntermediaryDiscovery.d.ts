/// <reference types="node" />
import { Intermediary } from "./Intermediary";
import { SwapType } from "../swaps/enums/SwapType";
import { SwapContract } from "@atomiqlabs/base";
import { EventEmitter } from "events";
export declare enum SwapHandlerType {
    TO_BTC = "TO_BTC",
    FROM_BTC = "FROM_BTC",
    TO_BTCLN = "TO_BTCLN",
    FROM_BTCLN = "FROM_BTCLN",
    FROM_BTC_TRUSTED = "FROM_BTC_TRUSTED",
    FROM_BTCLN_TRUSTED = "FROM_BTCLN_TRUSTED",
    FROM_BTC_SPV = "FROM_BTC_SPV",
    FROM_BTCLN_AUTO = "FROM_BTCLN_AUTO"
}
export type SwapHandlerInfoType = {
    swapFeePPM: number;
    swapBaseFee: number;
    min: number;
    max: number;
    tokens: string[];
    chainTokens?: {
        [chainId: string]: string[];
    };
    data?: any;
};
export type TokenBounds = {
    [token: string]: {
        min: bigint;
        max: bigint;
    };
};
export type MultichainTokenBounds = {
    [chainId: string]: TokenBounds;
};
export type SwapBounds = {
    [key in SwapType]?: TokenBounds;
};
export type MultichainSwapBounds = {
    [key in SwapType]?: MultichainTokenBounds;
};
export declare class IntermediaryDiscovery extends EventEmitter {
    intermediaries: Intermediary[];
    swapContracts: {
        [key: string]: SwapContract;
    };
    registryUrl: string;
    httpRequestTimeout?: number;
    private overrideNodeUrls?;
    constructor(swapContracts: {
        [key: string]: SwapContract;
    }, registryUrl?: string, nodeUrls?: string[], httpRequestTimeout?: number);
    /**
     * Fetches the URLs of swap intermediaries from registry or from a pre-defined array of node urls
     *
     * @param abortSignal
     */
    private getIntermediaryUrls;
    /**
     * Returns data as reported by a specific node (as identified by its URL)
     *
     * @param url
     * @param abortSignal
     */
    private getNodeInfo;
    private loadIntermediary;
    /**
     * Fetches data about all intermediaries in the network, pinging every one of them and ensuring they are online
     *
     * @param abortSignal
     * @private
     * @throws {Error} When no online intermediary was found
     */
    private fetchIntermediaries;
    /**
     * Returns the intermediary at the provided URL, either from the already fetched list of LPs or fetches the data on-demand
     *
     * @param url
     * @param abortSignal
     */
    getIntermediary(url: string, abortSignal?: AbortSignal): Promise<Intermediary>;
    /**
     * Reloads the saves a list of intermediaries
     * @param abortSignal
     */
    reloadIntermediaries(abortSignal?: AbortSignal): Promise<void>;
    /**
     * Initializes the discovery by fetching/reloading intermediaries
     *
     * @param abortSignal
     */
    init(abortSignal?: AbortSignal): Promise<void>;
    getMultichainSwapBounds(): MultichainSwapBounds;
    /**
     * Returns aggregate swap bounds (in sats - BTC) as indicated by the intermediaries
     */
    getSwapBounds(chainIdentifier: string): SwapBounds;
    /**
     * Returns the aggregate swap minimum (in sats - BTC) for a specific swap type & token
     *  as indicated by the intermediaries
     *
     * @param chainIdentifier
     * @param swapType
     * @param token
     */
    getSwapMinimum(chainIdentifier: string, swapType: SwapType, token: any): number;
    /**
     * Returns the aggregate swap maximum (in sats - BTC) for a specific swap type & token
     *  as indicated by the intermediaries
     *
     * @param chainIdentifier
     * @param swapType
     * @param token
     */
    getSwapMaximum(chainIdentifier: string, swapType: SwapType, token: any): number;
    /**
     * Returns swap candidates for a specific swap type & token address
     *
     * @param chainIdentifier
     * @param swapType
     * @param tokenAddress
     * @param amount Amount to be swapped in sats - BTC
     * @param count How many intermediaries to return at most
     */
    getSwapCandidates(chainIdentifier: string, swapType: SwapType, tokenAddress: any, amount?: bigint, count?: number): Intermediary[];
    /**
     * Removes a specific intermediary from the list of active intermediaries (used for blacklisting)
     *
     * @param intermediary
     */
    removeIntermediary(intermediary: Intermediary): boolean;
}
