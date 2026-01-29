import { FieldTypeEnum, RequestSchemaResult } from "../utils/paramcoders/SchemaVerifier";
export declare enum AddressStatusResponseCodes {
    EXPIRED = 10001,
    PAID = 10000,
    AWAIT_PAYMENT = 10010,
    AWAIT_CONFIRMATION = 10011,
    PENDING = 10013,
    TX_SENT = 10012,
    REFUNDED = 10014,
    DOUBLE_SPENT = 10015,
    REFUNDABLE = 10016
}
export type AddressStatusResponse = {
    code: AddressStatusResponseCodes.TX_SENT | AddressStatusResponseCodes.PAID;
    msg: string;
    data: {
        adjustedAmount: string;
        adjustedTotal: string;
        adjustedFee?: string;
        adjustedFeeSats?: string;
        txId: string;
        scTxId: string;
    };
} | {
    code: AddressStatusResponseCodes.AWAIT_CONFIRMATION | AddressStatusResponseCodes.PENDING;
    msg: string;
    data: {
        adjustedAmount: string;
        adjustedTotal: string;
        adjustedFee?: string;
        adjustedFeeSats?: string;
        txId: string;
    };
} | {
    code: AddressStatusResponseCodes.REFUNDABLE;
    msg: string;
    data: {
        adjustedAmount: string;
    };
} | {
    code: AddressStatusResponseCodes.REFUNDED | AddressStatusResponseCodes.DOUBLE_SPENT;
    msg: string;
    data: {
        txId: string;
    };
} | {
    code: AddressStatusResponseCodes.AWAIT_PAYMENT | AddressStatusResponseCodes.EXPIRED;
    msg: string;
};
export type TrustedFromBTCInit = {
    address: string;
    amount: bigint;
    token: string;
    refundAddress?: string;
};
declare const TrustedFromBTCResponseSchema: {
    readonly paymentHash: FieldTypeEnum.String;
    readonly sequence: FieldTypeEnum.BigInt;
    readonly btcAddress: FieldTypeEnum.String;
    readonly amountSats: FieldTypeEnum.BigInt;
    readonly swapFeeSats: FieldTypeEnum.BigInt;
    readonly swapFee: FieldTypeEnum.BigInt;
    readonly total: FieldTypeEnum.BigInt;
    readonly intermediaryKey: FieldTypeEnum.String;
    readonly recommendedFee: FieldTypeEnum.Number;
    readonly expiresAt: FieldTypeEnum.Number;
};
export type TrustedFromBTCResponseType = RequestSchemaResult<typeof TrustedFromBTCResponseSchema>;
export declare enum InvoiceStatusResponseCodes {
    EXPIRED = 10001,
    PAID = 10000,
    AWAIT_PAYMENT = 10010,
    PENDING = 10011,
    TX_SENT = 10012
}
export type InvoiceStatusResponse = {
    code: InvoiceStatusResponseCodes.TX_SENT | InvoiceStatusResponseCodes.PAID;
    msg: string;
    data: {
        txId: string;
    };
} | {
    code: Exclude<InvoiceStatusResponseCodes, InvoiceStatusResponseCodes.TX_SENT | InvoiceStatusResponseCodes.PAID>;
    msg: string;
};
export type TrustedFromBTCLNInit = {
    address: string;
    amount: bigint;
    token: string;
};
declare const TrustedFromBTCLNResponseSchema: {
    readonly pr: FieldTypeEnum.String;
    readonly swapFee: FieldTypeEnum.BigInt;
    readonly total: FieldTypeEnum.BigInt;
};
export type TrustedFromBTCLNResponseType = RequestSchemaResult<typeof TrustedFromBTCLNResponseSchema>;
export declare class TrustedIntermediaryAPI {
    /**
     * Fetches the invoice status from the intermediary node
     *
     * @param url Url of the trusted intermediary
     * @param paymentHash Payment hash of the lightning invoice
     * @param timeout Timeout in milliseconds
     * @param abortSignal
     * @throws {RequestError} if non-200 http response is returned
     */
    static getInvoiceStatus(url: string, paymentHash: string, timeout?: number, abortSignal?: AbortSignal): Promise<InvoiceStatusResponse>;
    /**
     * Initiate a trusted swap from BTCLN to SC native currency, retries!
     *
     * @param chainIdentifier
     * @param baseUrl Base url of the trusted swap intermediary
     * @param init Initialization parameters
     * @param timeout Timeout in milliseconds for the request
     * @param abortSignal
     * @throws {RequestError} If the response is non-200
     */
    static initTrustedFromBTCLN(chainIdentifier: string, baseUrl: string, init: TrustedFromBTCLNInit, timeout?: number, abortSignal?: AbortSignal): Promise<TrustedFromBTCLNResponseType>;
    /**
     * Fetches the address status from the intermediary node
     *
     * @param url Url of the trusted intermediary
     * @param paymentHash Payment hash of the swap
     * @param sequence Sequence number of the swap
     * @param timeout Timeout in milliseconds
     * @param abortSignal
     * @throws {RequestError} if non-200 http response is returned
     */
    static getAddressStatus(url: string, paymentHash: string, sequence: bigint, timeout?: number, abortSignal?: AbortSignal): Promise<AddressStatusResponse>;
    /**
     * Sets the refund address for an on-chain gas swap
     *
     * @param url Url of the trusted intermediary
     * @param paymentHash Payment hash of the swap
     * @param sequence Sequence number of the swap
     * @param refundAddress Refund address to set for the swap
     * @param timeout Timeout in milliseconds
     * @param abortSignal
     * @throws {RequestError} if non-200 http response is returned
     */
    static setRefundAddress(url: string, paymentHash: string, sequence: bigint, refundAddress: string, timeout?: number, abortSignal?: AbortSignal): Promise<void>;
    /**
     * Initiate a trusted swap from BTC to SC native currency, retries!
     *
     * @param chainIdentifier
     * @param baseUrl Base url of the trusted swap intermediary
     * @param init Initialization parameters
     * @param timeout Timeout in milliseconds for the request
     * @param abortSignal
     * @throws {RequestError} If the response is non-200
     */
    static initTrustedFromBTC(chainIdentifier: string, baseUrl: string, init: TrustedFromBTCInit, timeout?: number, abortSignal?: AbortSignal): Promise<TrustedFromBTCResponseType>;
}
export {};
