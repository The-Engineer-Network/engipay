"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrustedIntermediaryAPI = exports.InvoiceStatusResponseCodes = exports.AddressStatusResponseCodes = void 0;
const Utils_1 = require("../utils/Utils");
const RequestError_1 = require("../errors/RequestError");
const SchemaVerifier_1 = require("../utils/paramcoders/SchemaVerifier");
var AddressStatusResponseCodes;
(function (AddressStatusResponseCodes) {
    AddressStatusResponseCodes[AddressStatusResponseCodes["EXPIRED"] = 10001] = "EXPIRED";
    AddressStatusResponseCodes[AddressStatusResponseCodes["PAID"] = 10000] = "PAID";
    AddressStatusResponseCodes[AddressStatusResponseCodes["AWAIT_PAYMENT"] = 10010] = "AWAIT_PAYMENT";
    AddressStatusResponseCodes[AddressStatusResponseCodes["AWAIT_CONFIRMATION"] = 10011] = "AWAIT_CONFIRMATION";
    AddressStatusResponseCodes[AddressStatusResponseCodes["PENDING"] = 10013] = "PENDING";
    AddressStatusResponseCodes[AddressStatusResponseCodes["TX_SENT"] = 10012] = "TX_SENT";
    AddressStatusResponseCodes[AddressStatusResponseCodes["REFUNDED"] = 10014] = "REFUNDED";
    AddressStatusResponseCodes[AddressStatusResponseCodes["DOUBLE_SPENT"] = 10015] = "DOUBLE_SPENT";
    AddressStatusResponseCodes[AddressStatusResponseCodes["REFUNDABLE"] = 10016] = "REFUNDABLE";
})(AddressStatusResponseCodes = exports.AddressStatusResponseCodes || (exports.AddressStatusResponseCodes = {}));
const TrustedFromBTCResponseSchema = {
    paymentHash: SchemaVerifier_1.FieldTypeEnum.String,
    sequence: SchemaVerifier_1.FieldTypeEnum.BigInt,
    btcAddress: SchemaVerifier_1.FieldTypeEnum.String,
    amountSats: SchemaVerifier_1.FieldTypeEnum.BigInt,
    swapFeeSats: SchemaVerifier_1.FieldTypeEnum.BigInt,
    swapFee: SchemaVerifier_1.FieldTypeEnum.BigInt,
    total: SchemaVerifier_1.FieldTypeEnum.BigInt,
    intermediaryKey: SchemaVerifier_1.FieldTypeEnum.String,
    recommendedFee: SchemaVerifier_1.FieldTypeEnum.Number,
    expiresAt: SchemaVerifier_1.FieldTypeEnum.Number
};
var InvoiceStatusResponseCodes;
(function (InvoiceStatusResponseCodes) {
    InvoiceStatusResponseCodes[InvoiceStatusResponseCodes["EXPIRED"] = 10001] = "EXPIRED";
    InvoiceStatusResponseCodes[InvoiceStatusResponseCodes["PAID"] = 10000] = "PAID";
    InvoiceStatusResponseCodes[InvoiceStatusResponseCodes["AWAIT_PAYMENT"] = 10010] = "AWAIT_PAYMENT";
    InvoiceStatusResponseCodes[InvoiceStatusResponseCodes["PENDING"] = 10011] = "PENDING";
    InvoiceStatusResponseCodes[InvoiceStatusResponseCodes["TX_SENT"] = 10012] = "TX_SENT";
})(InvoiceStatusResponseCodes = exports.InvoiceStatusResponseCodes || (exports.InvoiceStatusResponseCodes = {}));
const TrustedFromBTCLNResponseSchema = {
    pr: SchemaVerifier_1.FieldTypeEnum.String,
    swapFee: SchemaVerifier_1.FieldTypeEnum.BigInt,
    total: SchemaVerifier_1.FieldTypeEnum.BigInt
};
class TrustedIntermediaryAPI {
    /**
     * Fetches the invoice status from the intermediary node
     *
     * @param url Url of the trusted intermediary
     * @param paymentHash Payment hash of the lightning invoice
     * @param timeout Timeout in milliseconds
     * @param abortSignal
     * @throws {RequestError} if non-200 http response is returned
     */
    static async getInvoiceStatus(url, paymentHash, timeout, abortSignal) {
        return (0, Utils_1.tryWithRetries)(() => (0, Utils_1.httpGet)(url + "/getInvoiceStatus?paymentHash=" + encodeURIComponent(paymentHash), timeout, abortSignal), null, RequestError_1.RequestError, abortSignal);
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
    static async initTrustedFromBTCLN(chainIdentifier, baseUrl, init, timeout, abortSignal) {
        const resp = await (0, Utils_1.tryWithRetries)(() => (0, Utils_1.httpGet)(baseUrl + "/lnforgas/createInvoice" +
            "?address=" + encodeURIComponent(init.address) +
            "&amount=" + encodeURIComponent(init.amount.toString(10)) +
            "&chain=" + encodeURIComponent(chainIdentifier) +
            "&token=" + encodeURIComponent(init.token), timeout, abortSignal), null, RequestError_1.RequestError, abortSignal);
        if (resp.code !== 10000)
            throw RequestError_1.RequestError.parse(JSON.stringify(resp), 400);
        return (0, SchemaVerifier_1.verifySchema)(resp.data, TrustedFromBTCLNResponseSchema);
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
    static async getAddressStatus(url, paymentHash, sequence, timeout, abortSignal) {
        return (0, Utils_1.tryWithRetries)(() => (0, Utils_1.httpGet)(url + "/getAddressStatus?paymentHash=" + encodeURIComponent(paymentHash) + "&sequence=" + encodeURIComponent(sequence.toString(10)), timeout, abortSignal), null, RequestError_1.RequestError, abortSignal);
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
    static async setRefundAddress(url, paymentHash, sequence, refundAddress, timeout, abortSignal) {
        return (0, Utils_1.tryWithRetries)(() => (0, Utils_1.httpGet)(url + "/setRefundAddress" +
            "?paymentHash=" + encodeURIComponent(paymentHash) +
            "&sequence=" + encodeURIComponent(sequence.toString(10)) +
            "&refundAddress=" + encodeURIComponent(refundAddress), timeout, abortSignal), null, RequestError_1.RequestError, abortSignal);
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
    static async initTrustedFromBTC(chainIdentifier, baseUrl, init, timeout, abortSignal) {
        const resp = await (0, Utils_1.tryWithRetries)(() => (0, Utils_1.httpGet)(baseUrl + "/frombtc_trusted/getAddress?chain=" + encodeURIComponent(chainIdentifier) +
            "&address=" + encodeURIComponent(init.address) +
            "&amount=" + encodeURIComponent(init.amount.toString(10)) +
            "&refundAddress=" + encodeURIComponent(init.refundAddress) +
            "&exactIn=true" +
            "&token=" + encodeURIComponent(init.token), timeout, abortSignal), null, RequestError_1.RequestError, abortSignal);
        if (resp.code !== 10000)
            throw RequestError_1.RequestError.parse(JSON.stringify(resp), 400);
        return (0, SchemaVerifier_1.verifySchema)(resp.data, TrustedFromBTCResponseSchema);
    }
}
exports.TrustedIntermediaryAPI = TrustedIntermediaryAPI;
