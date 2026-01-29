/// <reference types="node" />
/// <reference types="node" />
import { FieldTypeEnum, RequestSchemaResult } from "../utils/paramcoders/SchemaVerifier";
export type InfoHandlerResponse = {
    envelope: string;
    chains: {
        [chainIdentifier: string]: {
            address: string;
            signature: string;
        };
    };
};
export declare enum RefundAuthorizationResponseCodes {
    EXPIRED = 20010,
    REFUND_DATA = 20000,
    NOT_FOUND = 20007,
    PENDING = 20008,
    PAID = 20006
}
export declare enum PaymentAuthorizationResponseCodes {
    AUTH_DATA = 10000,
    EXPIRED = 10001,
    PAID = 10002,
    PENDING = 10003,
    ALREADY_COMMITTED = 10004
}
export declare enum InvoiceStatusResponseCodes {
    PAID = 10000,
    EXPIRED = 10001,
    SETTLED = 10002,
    PENDING = 10003
}
export type RefundAuthorizationResponse = {
    code: RefundAuthorizationResponseCodes.PAID;
    msg: string;
    data: {
        secret?: string;
        txId?: string;
    };
} | {
    code: RefundAuthorizationResponseCodes.REFUND_DATA;
    msg: string;
    data: {
        address: string;
        prefix: string;
        timeout: string;
        signature: string;
    };
} | {
    code: Exclude<RefundAuthorizationResponseCodes, RefundAuthorizationResponseCodes.PAID | RefundAuthorizationResponseCodes.REFUND_DATA>;
    msg: string;
};
export type PaymentAuthorizationResponse = {
    code: PaymentAuthorizationResponseCodes.AUTH_DATA;
    msg: string;
    data: {
        address: string;
        data: any;
        nonce: number;
        prefix: string;
        timeout: string;
        signature: string;
    };
} | {
    code: Exclude<PaymentAuthorizationResponseCodes, PaymentAuthorizationResponseCodes.AUTH_DATA>;
    msg: string;
};
export type InvoiceStatusResponse = {
    code: Exclude<InvoiceStatusResponseCodes, InvoiceStatusResponseCodes.PAID>;
    msg: string;
} | {
    code: InvoiceStatusResponseCodes.PAID;
    msg: string;
    data: {
        data: any;
    };
};
export type SwapInit = {
    token: string;
    additionalParams?: {
        [name: string]: any;
    };
};
export type BaseFromBTCSwapInit = SwapInit & {
    claimer: string;
    amount: bigint;
    exactOut: boolean;
    feeRate: Promise<string>;
};
export type BaseToBTCSwapInit = SwapInit & {
    offerer: string;
};
declare const ToBTCResponseSchema: {
    readonly data: FieldTypeEnum.Any;
    readonly prefix: FieldTypeEnum.String;
    readonly timeout: FieldTypeEnum.String;
    readonly signature: FieldTypeEnum.String;
    readonly amount: FieldTypeEnum.BigInt;
    readonly address: FieldTypeEnum.String;
    readonly satsPervByte: FieldTypeEnum.BigInt;
    readonly networkFee: FieldTypeEnum.BigInt;
    readonly swapFee: FieldTypeEnum.BigInt;
    readonly totalFee: FieldTypeEnum.BigInt;
    readonly total: FieldTypeEnum.BigInt;
    readonly minRequiredExpiry: FieldTypeEnum.BigInt;
};
export type ToBTCResponseType = RequestSchemaResult<typeof ToBTCResponseSchema>;
export type ToBTCInit = BaseToBTCSwapInit & {
    btcAddress: string;
    exactIn: boolean;
    amount: bigint;
    confirmationTarget: number;
    confirmations: number;
    nonce: bigint;
    feeRate: Promise<string>;
};
declare const ToBTCLNResponseSchema: {
    readonly data: FieldTypeEnum.Any;
    readonly prefix: FieldTypeEnum.String;
    readonly timeout: FieldTypeEnum.String;
    readonly signature: FieldTypeEnum.String;
    readonly maxFee: FieldTypeEnum.BigInt;
    readonly swapFee: FieldTypeEnum.BigInt;
    readonly total: FieldTypeEnum.BigInt;
    readonly confidence: FieldTypeEnum.Number;
    readonly address: FieldTypeEnum.String;
    readonly routingFeeSats: FieldTypeEnum.BigInt;
};
export type ToBTCLNResponseType = RequestSchemaResult<typeof ToBTCLNResponseSchema>;
export type ToBTCLNInit = BaseToBTCSwapInit & {
    pr: string;
    maxFee: bigint;
    expiryTimestamp: bigint;
    feeRate: Promise<any>;
};
declare const ToBTCLNPrepareExactInSchema: {
    readonly amount: FieldTypeEnum.BigInt;
    readonly reqId: FieldTypeEnum.String;
};
export type ToBTCLNPrepareExactInResponseType = RequestSchemaResult<typeof ToBTCLNPrepareExactInSchema>;
export type ToBTCLNPrepareExactIn = BaseToBTCSwapInit & {
    pr: string;
    amount: bigint;
    maxFee: bigint;
    expiryTimestamp: bigint;
};
export type ToBTCLNInitExactIn = {
    pr: string;
    reqId: string;
    feeRate: Promise<any>;
    additionalParams?: {
        [name: string]: any;
    };
};
declare const FromBTCResponseSchema: {
    readonly data: FieldTypeEnum.Any;
    readonly prefix: FieldTypeEnum.String;
    readonly timeout: FieldTypeEnum.String;
    readonly signature: FieldTypeEnum.String;
    readonly amount: FieldTypeEnum.BigInt;
    readonly btcAddress: FieldTypeEnum.String;
    readonly address: FieldTypeEnum.String;
    readonly swapFee: FieldTypeEnum.BigInt;
    readonly total: FieldTypeEnum.BigInt;
    readonly confirmations: FieldTypeEnum.NumberOptional;
};
export type FromBTCResponseType = RequestSchemaResult<typeof FromBTCResponseSchema>;
export type FromBTCInit = BaseFromBTCSwapInit & {
    sequence: bigint;
    claimerBounty: Promise<{
        feePerBlock: bigint;
        safetyFactor: number;
        startTimestamp: bigint;
        addBlock: number;
        addFee: bigint;
    }>;
};
declare const FromBTCLNResponseSchema: {
    readonly pr: FieldTypeEnum.String;
    readonly swapFee: FieldTypeEnum.BigInt;
    readonly total: FieldTypeEnum.BigInt;
    readonly intermediaryKey: FieldTypeEnum.String;
    readonly securityDeposit: FieldTypeEnum.BigInt;
};
export type FromBTCLNResponseType = RequestSchemaResult<typeof FromBTCLNResponseSchema>;
export type FromBTCLNInit = BaseFromBTCSwapInit & {
    paymentHash: Buffer;
    descriptionHash?: Buffer;
};
declare const FromBTCLNAutoResponseSchema: {
    readonly intermediaryKey: FieldTypeEnum.String;
    readonly pr: FieldTypeEnum.String;
    readonly btcAmountSwap: FieldTypeEnum.BigInt;
    readonly btcAmountGas: FieldTypeEnum.BigInt;
    readonly total: FieldTypeEnum.BigInt;
    readonly totalGas: FieldTypeEnum.BigInt;
    readonly totalFeeBtc: FieldTypeEnum.BigInt;
    readonly swapFeeBtc: FieldTypeEnum.BigInt;
    readonly swapFee: FieldTypeEnum.BigInt;
    readonly gasSwapFeeBtc: FieldTypeEnum.BigInt;
    readonly gasSwapFee: FieldTypeEnum.BigInt;
    readonly claimerBounty: FieldTypeEnum.BigInt;
};
export type FromBTCLNAutoResponseType = RequestSchemaResult<typeof FromBTCLNAutoResponseSchema>;
export type FromBTCLNAutoInit = Omit<BaseFromBTCSwapInit, "feeRate"> & {
    paymentHash: Buffer;
    gasToken: string;
    descriptionHash?: Buffer;
    gasAmount?: bigint;
    claimerBounty?: Promise<bigint>;
};
declare const SpvFromBTCPrepareResponseSchema: {
    readonly quoteId: FieldTypeEnum.String;
    readonly expiry: FieldTypeEnum.Number;
    readonly address: FieldTypeEnum.String;
    readonly vaultId: FieldTypeEnum.BigInt;
    readonly vaultBtcAddress: FieldTypeEnum.String;
    readonly btcAddress: FieldTypeEnum.String;
    readonly btcUtxo: FieldTypeEnum.String;
    readonly btcFeeRate: FieldTypeEnum.Number;
    readonly btcAmount: FieldTypeEnum.BigInt;
    readonly btcAmountSwap: FieldTypeEnum.BigInt;
    readonly btcAmountGas: FieldTypeEnum.BigInt;
    readonly total: FieldTypeEnum.BigInt;
    readonly totalGas: FieldTypeEnum.BigInt;
    readonly totalFeeBtc: FieldTypeEnum.BigInt;
    readonly swapFeeBtc: FieldTypeEnum.BigInt;
    readonly swapFee: FieldTypeEnum.BigInt;
    readonly gasSwapFeeBtc: FieldTypeEnum.BigInt;
    readonly gasSwapFee: FieldTypeEnum.BigInt;
    readonly callerFeeShare: FieldTypeEnum.BigInt;
    readonly frontingFeeShare: FieldTypeEnum.BigInt;
    readonly executionFeeShare: FieldTypeEnum.BigInt;
};
export type SpvFromBTCPrepareResponseType = RequestSchemaResult<typeof SpvFromBTCPrepareResponseSchema>;
export type SpvFromBTCPrepare = SwapInit & {
    address: string;
    amount: bigint;
    gasAmount: bigint;
    gasToken: string;
    exactOut: boolean;
    callerFeeRate: Promise<bigint>;
    frontingFeeRate: bigint;
};
declare const SpvFromBTCInitResponseSchema: {
    readonly txId: FieldTypeEnum.String;
};
export type SpvFromBTCInitResponseType = RequestSchemaResult<typeof SpvFromBTCInitResponseSchema>;
export type SpvFromBTCInit = {
    quoteId: string;
    psbtHex: string;
};
export declare class IntermediaryAPI {
    /**
     * Returns the information about a specific intermediary
     *
     * @param baseUrl Base URL of the intermediary
     * @param timeout Timeout in milliseconds for the HTTP request
     * @param abortSignal
     *
     * @throws {RequestError} If non-200 http response code is returned
     * @throws {Error} If the supplied nonce doesn't match the response
     */
    static getIntermediaryInfo(baseUrl: string, timeout?: number, abortSignal?: AbortSignal): Promise<InfoHandlerResponse>;
    /**
     * Returns the information about an outcome of the To BTC swap
     *
     * @param url URL of the intermediary
     * @param paymentHash Payment hash of the swap
     * @param sequence Swap's sequence number
     * @param timeout Timeout in milliseconds for the HTTP request
     * @param abortSignal
     *
     * @throws {RequestError} If non-200 http response code is returned
     */
    static getRefundAuthorization(url: string, paymentHash: string, sequence: bigint, timeout?: number, abortSignal?: AbortSignal): Promise<RefundAuthorizationResponse>;
    /**
     * Returns the information about the payment of the From BTCLN swaps
     *
     * @param url URL of the intermediary
     * @param paymentHash Payment hash of the swap
     * @param timeout Timeout in milliseconds for the HTTP request
     * @param abortSignal
     *
     * @throws {RequestError} If non-200 http response code is returned
     */
    static getPaymentAuthorization(url: string, paymentHash: string, timeout?: number, abortSignal?: AbortSignal): Promise<PaymentAuthorizationResponse>;
    /**
     * Returns the status of the payment of the From BTCLN swaps
     *
     * @param url URL of the intermediary
     * @param paymentHash Payment hash of the swap
     * @param timeout Timeout in milliseconds for the HTTP request
     * @param abortSignal
     *
     * @throws {RequestError} If non-200 http response code is returned
     */
    static getInvoiceStatus(url: string, paymentHash: string, timeout?: number, abortSignal?: AbortSignal): Promise<InvoiceStatusResponse>;
    /**
     * Initiate To BTC swap with an intermediary
     *
     * @param chainIdentifier
     * @param baseUrl Base URL of the intermediary
     * @param init Swap initialization parameters
     * @param timeout Timeout in milliseconds for the HTTP request
     * @param abortSignal
     * @param streamRequest Whether to force streaming (or not streaming) the request, default is autodetect
     *
     * @throws {RequestError} If non-200 http response code is returned
     */
    static initToBTC(chainIdentifier: string, baseUrl: string, init: ToBTCInit, timeout?: number, abortSignal?: AbortSignal, streamRequest?: boolean): {
        signDataPrefetch: Promise<any>;
        response: Promise<ToBTCResponseType>;
    };
    /**
     * Initiate From BTC swap with an intermediary
     *
     * @param chainIdentifier
     * @param baseUrl Base URL of the intermediary
     * @param depositToken
     * @param init Swap initialization parameters
     * @param timeout Timeout in milliseconds for the HTTP request
     * @param abortSignal
     * @param streamRequest Whether to force streaming (or not streaming) the request, default is autodetect
     *
     * @throws {RequestError} If non-200 http response code is returned
     */
    static initFromBTC(chainIdentifier: string, baseUrl: string, depositToken: string, init: FromBTCInit, timeout?: number, abortSignal?: AbortSignal, streamRequest?: boolean): {
        signDataPrefetch: Promise<any>;
        response: Promise<FromBTCResponseType>;
    };
    /**
     * Initiate From BTCLN swap with an intermediary
     *
     * @param chainIdentifier
     * @param baseUrl Base URL of the intermediary
     * @param depositToken
     * @param init Swap initialization parameters
     * @param timeout Timeout in milliseconds for the HTTP request
     * @param abortSignal
     * @param streamRequest Whether to force streaming (or not streaming) the request, default is autodetect
     *
     * @throws {RequestError} If non-200 http response code is returned
     */
    static initFromBTCLN(chainIdentifier: string, baseUrl: string, depositToken: string, init: FromBTCLNInit, timeout?: number, abortSignal?: AbortSignal, streamRequest?: boolean): {
        lnPublicKey: Promise<string>;
        response: Promise<FromBTCLNResponseType>;
    };
    /**
     * Initiate From BTCLN swap with auto-initilization by an intermediary
     *
     * @param chainIdentifier
     * @param baseUrl Base URL of the intermediary
     * @param init Swap initialization parameters
     * @param timeout Timeout in milliseconds for the HTTP request
     * @param abortSignal
     * @param streamRequest Whether to force streaming (or not streaming) the request, default is autodetect
     *
     * @throws {RequestError} If non-200 http response code is returned
     */
    static initFromBTCLNAuto(chainIdentifier: string, baseUrl: string, init: FromBTCLNAutoInit, timeout?: number, abortSignal?: AbortSignal, streamRequest?: boolean): {
        lnPublicKey: Promise<string>;
        response: Promise<FromBTCLNAutoResponseType>;
    };
    /**
     * Initiate To BTCLN swap with an intermediary
     *
     * @param chainIdentifier
     * @param baseUrl Base URL of the intermediary
     * @param init Swap initialization parameters
     * @param timeout Timeout in milliseconds for the HTTP request
     * @param abortSignal
     * @param streamRequest Whether to force streaming (or not streaming) the request, default is autodetect
     *
     * @throws {RequestError} If non-200 http response code is returned
     */
    static initToBTCLN(chainIdentifier: string, baseUrl: string, init: ToBTCLNInit, timeout?: number, abortSignal?: AbortSignal, streamRequest?: boolean): {
        signDataPrefetch: Promise<any>;
        response: Promise<ToBTCLNResponseType>;
    };
    /**
     * Initiate To BTCLN exact in swap with an intermediary
     *
     * @param baseUrl Base URL of the intermediary
     * @param init Swap initialization parameters
     * @param timeout Timeout in milliseconds for the HTTP request
     * @param abortSignal
     * @param streamRequest Whether to force streaming (or not streaming) the request, default is autodetect
     *
     * @throws {RequestError} If non-200 http response code is returned
     */
    static initToBTCLNExactIn(baseUrl: string, init: ToBTCLNInitExactIn, timeout?: number, abortSignal?: AbortSignal, streamRequest?: boolean): Promise<ToBTCLNResponseType>;
    /**
     * Prepare To BTCLN exact in swap with an intermediary
     *
     * @param chainIdentifier
     * @param baseUrl Base URL of the intermediary
     * @param init Swap initialization parameters
     * @param timeout Timeout in milliseconds for the HTTP request
     * @param abortSignal
     * @param streamRequest Whether to force streaming (or not streaming) the request, default is autodetect
     *
     * @throws {RequestError} If non-200 http response code is returned
     */
    static prepareToBTCLNExactIn(chainIdentifier: string, baseUrl: string, init: ToBTCLNPrepareExactIn, timeout?: number, abortSignal?: AbortSignal, streamRequest?: boolean): {
        signDataPrefetch: Promise<any>;
        response: Promise<ToBTCLNPrepareExactInResponseType>;
    };
    /**
     * Prepare From BTC swap via new spv vault swaps with an intermediary
     *
     * @param chainIdentifier
     * @param baseUrl Base URL of the intermediary
     * @param init Swap initialization parameters
     * @param timeout Timeout in milliseconds for the HTTP request
     * @param abortSignal
     * @param streamRequest Whether to force streaming (or not streaming) the request, default is autodetect
     *
     * @throws {RequestError} If non-200 http response code is returned
     */
    static prepareSpvFromBTC(chainIdentifier: string, baseUrl: string, init: SpvFromBTCPrepare, timeout?: number, abortSignal?: AbortSignal, streamRequest?: boolean): Promise<SpvFromBTCPrepareResponseType>;
    /**
     * Prepare From BTC swap via new spv vault swaps with an intermediary
     *
     * @param chainIdentifier
     * @param url
     * @param init Swap initialization parameters
     * @param timeout Timeout in milliseconds for the HTTP request
     * @param abortSignal
     * @param streamRequest Whether to force streaming (or not streaming) the request, default is autodetect
     *
     * @throws {RequestError} If non-200 http response code is returned
     */
    static initSpvFromBTC(chainIdentifier: string, url: string, init: SpvFromBTCInit, timeout?: number, abortSignal?: AbortSignal, streamRequest?: boolean): Promise<SpvFromBTCInitResponseType>;
}
export {};
