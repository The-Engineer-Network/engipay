import {httpGet, tryWithRetries} from "../utils/Utils";
import {RequestError} from "../errors/RequestError";
import {FieldTypeEnum, RequestSchemaResult, verifySchema} from "../utils/paramcoders/SchemaVerifier";


export enum AddressStatusResponseCodes {
    EXPIRED=10001,
    PAID=10000,
    AWAIT_PAYMENT=10010,
    AWAIT_CONFIRMATION=10011,
    PENDING=10013,
    TX_SENT=10012,
    REFUNDED=10014,
    DOUBLE_SPENT=10015,
    REFUNDABLE=10016
}

export type AddressStatusResponse = {
    code: AddressStatusResponseCodes.TX_SENT | AddressStatusResponseCodes.PAID,
    msg: string,
    data: {
        adjustedAmount: string,
        adjustedTotal: string,
        adjustedFee?: string,
        adjustedFeeSats?: string,
        txId: string,
        scTxId: string
    }
} | {
    code: AddressStatusResponseCodes.AWAIT_CONFIRMATION | AddressStatusResponseCodes.PENDING,
    msg: string,
    data: {
        adjustedAmount: string,
        adjustedTotal: string,
        adjustedFee?: string,
        adjustedFeeSats?: string,
        txId: string
    }
} | {
    code: AddressStatusResponseCodes.REFUNDABLE,
    msg: string,
    data: {
        adjustedAmount: string
    }
} | {
    code: AddressStatusResponseCodes.REFUNDED | AddressStatusResponseCodes.DOUBLE_SPENT,
    msg: string,
    data: {
        txId: string
    }
} | {
    code: AddressStatusResponseCodes.AWAIT_PAYMENT | AddressStatusResponseCodes.EXPIRED,
    msg: string
};

export type TrustedFromBTCInit = {
    address: string,
    amount: bigint,
    token: string,
    refundAddress?: string
};

const TrustedFromBTCResponseSchema = {
    paymentHash: FieldTypeEnum.String,
    sequence: FieldTypeEnum.BigInt,
    btcAddress: FieldTypeEnum.String,
    amountSats: FieldTypeEnum.BigInt,
    swapFeeSats: FieldTypeEnum.BigInt,
    swapFee: FieldTypeEnum.BigInt,
    total: FieldTypeEnum.BigInt,
    intermediaryKey: FieldTypeEnum.String,
    recommendedFee: FieldTypeEnum.Number,
    expiresAt: FieldTypeEnum.Number
} as const;

export type TrustedFromBTCResponseType = RequestSchemaResult<typeof TrustedFromBTCResponseSchema>;

export enum InvoiceStatusResponseCodes {
    EXPIRED=10001,
    PAID=10000,
    AWAIT_PAYMENT=10010,
    PENDING=10011,
    TX_SENT=10012
}

export type InvoiceStatusResponse = {
    code: InvoiceStatusResponseCodes.TX_SENT | InvoiceStatusResponseCodes.PAID,
    msg: string,
    data: {
        txId: string
    }
} | {
    code: Exclude<InvoiceStatusResponseCodes, InvoiceStatusResponseCodes.TX_SENT | InvoiceStatusResponseCodes.PAID>,
    msg: string
};

export type TrustedFromBTCLNInit = {
    address: string,
    amount: bigint,
    token: string
};

const TrustedFromBTCLNResponseSchema = {
    pr: FieldTypeEnum.String,
    swapFee: FieldTypeEnum.BigInt,
    total: FieldTypeEnum.BigInt
} as const;

export type TrustedFromBTCLNResponseType = RequestSchemaResult<typeof TrustedFromBTCLNResponseSchema>;

export class TrustedIntermediaryAPI {

    /**
     * Fetches the invoice status from the intermediary node
     *
     * @param url Url of the trusted intermediary
     * @param paymentHash Payment hash of the lightning invoice
     * @param timeout Timeout in milliseconds
     * @param abortSignal
     * @throws {RequestError} if non-200 http response is returned
     */
    static async getInvoiceStatus(
        url: string,
        paymentHash: string,
        timeout?: number,
        abortSignal?: AbortSignal
    ): Promise<InvoiceStatusResponse> {
        return tryWithRetries(() => httpGet<InvoiceStatusResponse>(
            url+"/getInvoiceStatus?paymentHash="+encodeURIComponent(paymentHash),
            timeout, abortSignal
        ), null, RequestError, abortSignal);
    }

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
    static async initTrustedFromBTCLN(
        chainIdentifier: string,
        baseUrl: string,
        init: TrustedFromBTCLNInit,
        timeout?: number,
        abortSignal?: AbortSignal
    ): Promise<TrustedFromBTCLNResponseType> {
        const resp = await tryWithRetries(
            () => httpGet<{code: number, msg: string, data?: any}>(
                baseUrl+"/lnforgas/createInvoice" +
                    "?address="+encodeURIComponent(init.address) +
                    "&amount="+encodeURIComponent(init.amount.toString(10))+
                    "&chain="+encodeURIComponent(chainIdentifier)+
                    "&token="+encodeURIComponent(init.token),
                timeout,
                abortSignal
            ), null, RequestError, abortSignal
        );

        if(resp.code!==10000) throw RequestError.parse(JSON.stringify(resp), 400);
        return verifySchema(resp.data, TrustedFromBTCLNResponseSchema);
    }

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
    static async getAddressStatus(
        url: string,
        paymentHash: string,
        sequence: bigint,
        timeout?: number,
        abortSignal?: AbortSignal
    ): Promise<AddressStatusResponse> {
        return tryWithRetries(() => httpGet<AddressStatusResponse>(
            url+"/getAddressStatus?paymentHash="+encodeURIComponent(paymentHash)+"&sequence="+encodeURIComponent(sequence.toString(10)),
            timeout, abortSignal
        ), null, RequestError, abortSignal);
    }

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
    static async setRefundAddress(
        url: string,
        paymentHash: string,
        sequence: bigint,
        refundAddress: string,
        timeout?: number,
        abortSignal?: AbortSignal
    ): Promise<void> {
        return tryWithRetries(() => httpGet<void>(
            url+"/setRefundAddress" +
                "?paymentHash="+encodeURIComponent(paymentHash)+
                "&sequence="+encodeURIComponent(sequence.toString(10))+
                "&refundAddress="+encodeURIComponent(refundAddress),
            timeout, abortSignal
        ), null, RequestError, abortSignal);
    }

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
    static async initTrustedFromBTC(
        chainIdentifier: string,
        baseUrl: string,
        init: TrustedFromBTCInit,
        timeout?: number,
        abortSignal?: AbortSignal
    ): Promise<TrustedFromBTCResponseType> {
        const resp = await tryWithRetries(
            () => httpGet<{code: number, msg: string, data?: any}>(
                baseUrl+"/frombtc_trusted/getAddress?chain="+encodeURIComponent(chainIdentifier)+
                    "&address="+encodeURIComponent(init.address)+
                    "&amount="+encodeURIComponent(init.amount.toString(10))+
                    "&refundAddress="+encodeURIComponent(init.refundAddress)+
                    "&exactIn=true"+
                    "&token="+encodeURIComponent(init.token),
                timeout,
                abortSignal
            ), null, RequestError, abortSignal
        );

        if(resp.code!==10000) throw RequestError.parse(JSON.stringify(resp), 400);
        return verifySchema(resp.data, TrustedFromBTCResponseSchema);
    }

}