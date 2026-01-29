"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntermediaryAPI = exports.InvoiceStatusResponseCodes = exports.PaymentAuthorizationResponseCodes = exports.RefundAuthorizationResponseCodes = void 0;
const RequestError_1 = require("../errors/RequestError");
const SchemaVerifier_1 = require("../utils/paramcoders/SchemaVerifier");
const StreamingFetchPromise_1 = require("../utils/paramcoders/client/StreamingFetchPromise");
const Utils_1 = require("../utils/Utils");
var RefundAuthorizationResponseCodes;
(function (RefundAuthorizationResponseCodes) {
    RefundAuthorizationResponseCodes[RefundAuthorizationResponseCodes["EXPIRED"] = 20010] = "EXPIRED";
    RefundAuthorizationResponseCodes[RefundAuthorizationResponseCodes["REFUND_DATA"] = 20000] = "REFUND_DATA";
    RefundAuthorizationResponseCodes[RefundAuthorizationResponseCodes["NOT_FOUND"] = 20007] = "NOT_FOUND";
    RefundAuthorizationResponseCodes[RefundAuthorizationResponseCodes["PENDING"] = 20008] = "PENDING";
    RefundAuthorizationResponseCodes[RefundAuthorizationResponseCodes["PAID"] = 20006] = "PAID";
})(RefundAuthorizationResponseCodes = exports.RefundAuthorizationResponseCodes || (exports.RefundAuthorizationResponseCodes = {}));
var PaymentAuthorizationResponseCodes;
(function (PaymentAuthorizationResponseCodes) {
    PaymentAuthorizationResponseCodes[PaymentAuthorizationResponseCodes["AUTH_DATA"] = 10000] = "AUTH_DATA";
    PaymentAuthorizationResponseCodes[PaymentAuthorizationResponseCodes["EXPIRED"] = 10001] = "EXPIRED";
    PaymentAuthorizationResponseCodes[PaymentAuthorizationResponseCodes["PAID"] = 10002] = "PAID";
    PaymentAuthorizationResponseCodes[PaymentAuthorizationResponseCodes["PENDING"] = 10003] = "PENDING";
    PaymentAuthorizationResponseCodes[PaymentAuthorizationResponseCodes["ALREADY_COMMITTED"] = 10004] = "ALREADY_COMMITTED";
})(PaymentAuthorizationResponseCodes = exports.PaymentAuthorizationResponseCodes || (exports.PaymentAuthorizationResponseCodes = {}));
var InvoiceStatusResponseCodes;
(function (InvoiceStatusResponseCodes) {
    InvoiceStatusResponseCodes[InvoiceStatusResponseCodes["PAID"] = 10000] = "PAID";
    InvoiceStatusResponseCodes[InvoiceStatusResponseCodes["EXPIRED"] = 10001] = "EXPIRED";
    InvoiceStatusResponseCodes[InvoiceStatusResponseCodes["SETTLED"] = 10002] = "SETTLED";
    InvoiceStatusResponseCodes[InvoiceStatusResponseCodes["PENDING"] = 10003] = "PENDING";
})(InvoiceStatusResponseCodes = exports.InvoiceStatusResponseCodes || (exports.InvoiceStatusResponseCodes = {}));
const SwapResponseSchema = {
    data: SchemaVerifier_1.FieldTypeEnum.Any,
    prefix: SchemaVerifier_1.FieldTypeEnum.String,
    timeout: SchemaVerifier_1.FieldTypeEnum.String,
    signature: SchemaVerifier_1.FieldTypeEnum.String
};
/////////////////////////
///// To BTC
const ToBTCResponseSchema = {
    amount: SchemaVerifier_1.FieldTypeEnum.BigInt,
    address: SchemaVerifier_1.FieldTypeEnum.String,
    satsPervByte: SchemaVerifier_1.FieldTypeEnum.BigInt,
    networkFee: SchemaVerifier_1.FieldTypeEnum.BigInt,
    swapFee: SchemaVerifier_1.FieldTypeEnum.BigInt,
    totalFee: SchemaVerifier_1.FieldTypeEnum.BigInt,
    total: SchemaVerifier_1.FieldTypeEnum.BigInt,
    minRequiredExpiry: SchemaVerifier_1.FieldTypeEnum.BigInt,
    ...SwapResponseSchema
};
/////////////////////////
///// To BTCLN
const ToBTCLNResponseSchema = {
    maxFee: SchemaVerifier_1.FieldTypeEnum.BigInt,
    swapFee: SchemaVerifier_1.FieldTypeEnum.BigInt,
    total: SchemaVerifier_1.FieldTypeEnum.BigInt,
    confidence: SchemaVerifier_1.FieldTypeEnum.Number,
    address: SchemaVerifier_1.FieldTypeEnum.String,
    routingFeeSats: SchemaVerifier_1.FieldTypeEnum.BigInt,
    ...SwapResponseSchema
};
const ToBTCLNPrepareExactInSchema = {
    amount: SchemaVerifier_1.FieldTypeEnum.BigInt,
    reqId: SchemaVerifier_1.FieldTypeEnum.String
};
/////////////////////////
///// From BTC
const FromBTCResponseSchema = {
    amount: SchemaVerifier_1.FieldTypeEnum.BigInt,
    btcAddress: SchemaVerifier_1.FieldTypeEnum.String,
    address: SchemaVerifier_1.FieldTypeEnum.String,
    swapFee: SchemaVerifier_1.FieldTypeEnum.BigInt,
    total: SchemaVerifier_1.FieldTypeEnum.BigInt,
    confirmations: SchemaVerifier_1.FieldTypeEnum.NumberOptional,
    ...SwapResponseSchema
};
/////////////////////////
///// From BTCLN
const FromBTCLNResponseSchema = {
    pr: SchemaVerifier_1.FieldTypeEnum.String,
    swapFee: SchemaVerifier_1.FieldTypeEnum.BigInt,
    total: SchemaVerifier_1.FieldTypeEnum.BigInt,
    intermediaryKey: SchemaVerifier_1.FieldTypeEnum.String,
    securityDeposit: SchemaVerifier_1.FieldTypeEnum.BigInt
};
/////////////////////////
///// From BTCLN Auto
const FromBTCLNAutoResponseSchema = {
    intermediaryKey: SchemaVerifier_1.FieldTypeEnum.String,
    pr: SchemaVerifier_1.FieldTypeEnum.String,
    btcAmountSwap: SchemaVerifier_1.FieldTypeEnum.BigInt,
    btcAmountGas: SchemaVerifier_1.FieldTypeEnum.BigInt,
    total: SchemaVerifier_1.FieldTypeEnum.BigInt,
    totalGas: SchemaVerifier_1.FieldTypeEnum.BigInt,
    totalFeeBtc: SchemaVerifier_1.FieldTypeEnum.BigInt,
    swapFeeBtc: SchemaVerifier_1.FieldTypeEnum.BigInt,
    swapFee: SchemaVerifier_1.FieldTypeEnum.BigInt,
    gasSwapFeeBtc: SchemaVerifier_1.FieldTypeEnum.BigInt,
    gasSwapFee: SchemaVerifier_1.FieldTypeEnum.BigInt,
    claimerBounty: SchemaVerifier_1.FieldTypeEnum.BigInt
};
/////////////////////////
///// Spv vault from BTC
const SpvFromBTCPrepareResponseSchema = {
    quoteId: SchemaVerifier_1.FieldTypeEnum.String,
    expiry: SchemaVerifier_1.FieldTypeEnum.Number,
    address: SchemaVerifier_1.FieldTypeEnum.String,
    vaultId: SchemaVerifier_1.FieldTypeEnum.BigInt,
    vaultBtcAddress: SchemaVerifier_1.FieldTypeEnum.String,
    btcAddress: SchemaVerifier_1.FieldTypeEnum.String,
    btcUtxo: SchemaVerifier_1.FieldTypeEnum.String,
    btcFeeRate: SchemaVerifier_1.FieldTypeEnum.Number,
    btcAmount: SchemaVerifier_1.FieldTypeEnum.BigInt,
    btcAmountSwap: SchemaVerifier_1.FieldTypeEnum.BigInt,
    btcAmountGas: SchemaVerifier_1.FieldTypeEnum.BigInt,
    total: SchemaVerifier_1.FieldTypeEnum.BigInt,
    totalGas: SchemaVerifier_1.FieldTypeEnum.BigInt,
    totalFeeBtc: SchemaVerifier_1.FieldTypeEnum.BigInt,
    swapFeeBtc: SchemaVerifier_1.FieldTypeEnum.BigInt,
    swapFee: SchemaVerifier_1.FieldTypeEnum.BigInt,
    gasSwapFeeBtc: SchemaVerifier_1.FieldTypeEnum.BigInt,
    gasSwapFee: SchemaVerifier_1.FieldTypeEnum.BigInt,
    callerFeeShare: SchemaVerifier_1.FieldTypeEnum.BigInt,
    frontingFeeShare: SchemaVerifier_1.FieldTypeEnum.BigInt,
    executionFeeShare: SchemaVerifier_1.FieldTypeEnum.BigInt
};
const SpvFromBTCInitResponseSchema = {
    txId: SchemaVerifier_1.FieldTypeEnum.String
};
class IntermediaryAPI {
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
    static async getIntermediaryInfo(baseUrl, timeout, abortSignal) {
        const nonce = (0, Utils_1.randomBytes)(32).toString("hex");
        const abortController = (0, Utils_1.extendAbortController)(abortSignal);
        //We don't know whether the node supports only POST or also has GET info support enabled
        // here we try both, and abort when the first one returns (which should be GET)
        const response = await Promise.any([
            (0, Utils_1.httpGet)(baseUrl + "/info?nonce=" + nonce, timeout, abortController.signal),
            (0, Utils_1.httpPost)(baseUrl + "/info", {
                nonce,
            }, timeout, abortController.signal)
        ]);
        abortController.abort();
        const info = JSON.parse(response.envelope);
        if (nonce !== info.nonce)
            throw new Error("Invalid response - nonce");
        return response;
    }
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
    static async getRefundAuthorization(url, paymentHash, sequence, timeout, abortSignal) {
        return (0, Utils_1.tryWithRetries)(() => (0, Utils_1.httpGet)(url + "/getRefundAuthorization" +
            "?paymentHash=" + encodeURIComponent(paymentHash) +
            "&sequence=" + encodeURIComponent(sequence.toString(10)), timeout, abortSignal), null, RequestError_1.RequestError, abortSignal);
    }
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
    static async getPaymentAuthorization(url, paymentHash, timeout, abortSignal) {
        return (0, Utils_1.tryWithRetries)(() => (0, Utils_1.httpGet)(url + "/getInvoicePaymentAuth" +
            "?paymentHash=" + encodeURIComponent(paymentHash), timeout, abortSignal), null, RequestError_1.RequestError, abortSignal);
    }
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
    static async getInvoiceStatus(url, paymentHash, timeout, abortSignal) {
        return (0, Utils_1.tryWithRetries)(() => (0, Utils_1.httpGet)(url + "/getInvoiceStatus" +
            "?paymentHash=" + encodeURIComponent(paymentHash), timeout, abortSignal), null, RequestError_1.RequestError, abortSignal);
    }
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
    static initToBTC(chainIdentifier, baseUrl, init, timeout, abortSignal, streamRequest) {
        const responseBodyPromise = (0, StreamingFetchPromise_1.streamingFetchPromise)(baseUrl + "/tobtc/payInvoice?chain=" + encodeURIComponent(chainIdentifier), {
            ...init.additionalParams,
            address: init.btcAddress,
            amount: init.amount.toString(10),
            exactIn: init.exactIn,
            confirmationTarget: init.confirmationTarget,
            confirmations: init.confirmations,
            nonce: init.nonce.toString(10),
            token: init.token,
            offerer: init.offerer,
            feeRate: init.feeRate
        }, {
            code: SchemaVerifier_1.FieldTypeEnum.Number,
            msg: SchemaVerifier_1.FieldTypeEnum.String,
            data: SchemaVerifier_1.FieldTypeEnum.AnyOptional,
            signDataPrefetch: SchemaVerifier_1.FieldTypeEnum.AnyOptional
        }, timeout, abortSignal, streamRequest);
        return {
            signDataPrefetch: responseBodyPromise.then(responseBody => responseBody.signDataPrefetch),
            response: responseBodyPromise.then((responseBody) => Promise.all([
                responseBody.code,
                responseBody.msg,
                responseBody.data,
            ])).then(([code, msg, data]) => {
                if (code !== 20000) {
                    throw RequestError_1.RequestError.parse(JSON.stringify({ code, msg, data }), 400);
                }
                return (0, SchemaVerifier_1.verifySchema)(data, ToBTCResponseSchema);
            })
        };
    }
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
    static initFromBTC(chainIdentifier, baseUrl, depositToken, init, timeout, abortSignal, streamRequest) {
        const responseBodyPromise = (0, StreamingFetchPromise_1.streamingFetchPromise)(baseUrl + "/frombtc/getAddress?chain=" + encodeURIComponent(chainIdentifier) + "&depositToken=" + encodeURIComponent(depositToken), {
            ...init.additionalParams,
            address: init.claimer,
            amount: init.amount.toString(10),
            token: init.token,
            exactOut: init.exactOut,
            sequence: init.sequence.toString(10),
            claimerBounty: init.claimerBounty.then(claimerBounty => {
                return {
                    feePerBlock: claimerBounty.feePerBlock.toString(10),
                    safetyFactor: claimerBounty.safetyFactor,
                    startTimestamp: claimerBounty.startTimestamp.toString(10),
                    addBlock: claimerBounty.addBlock,
                    addFee: claimerBounty.addFee.toString(10)
                };
            }),
            feeRate: init.feeRate
        }, {
            code: SchemaVerifier_1.FieldTypeEnum.Number,
            msg: SchemaVerifier_1.FieldTypeEnum.String,
            data: SchemaVerifier_1.FieldTypeEnum.AnyOptional,
            signDataPrefetch: SchemaVerifier_1.FieldTypeEnum.AnyOptional
        }, timeout, abortSignal, streamRequest);
        return {
            signDataPrefetch: responseBodyPromise.then(responseBody => responseBody.signDataPrefetch),
            response: responseBodyPromise.then((responseBody) => Promise.all([
                responseBody.code,
                responseBody.msg,
                responseBody.data,
            ])).then(([code, msg, data]) => {
                if (code !== 20000) {
                    throw RequestError_1.RequestError.parse(JSON.stringify({ code, msg, data }), 400);
                }
                return (0, SchemaVerifier_1.verifySchema)(data, FromBTCResponseSchema);
            })
        };
    }
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
    static initFromBTCLN(chainIdentifier, baseUrl, depositToken, init, timeout, abortSignal, streamRequest) {
        const responseBodyPromise = (0, StreamingFetchPromise_1.streamingFetchPromise)(baseUrl + "/frombtcln/createInvoice?chain=" + encodeURIComponent(chainIdentifier) + "&depositToken=" + encodeURIComponent(depositToken), {
            ...init.additionalParams,
            paymentHash: init.paymentHash.toString("hex"),
            amount: init.amount.toString(),
            address: init.claimer,
            token: init.token,
            descriptionHash: init.descriptionHash == null ? null : init.descriptionHash.toString("hex"),
            exactOut: init.exactOut,
            feeRate: init.feeRate
        }, {
            code: SchemaVerifier_1.FieldTypeEnum.Number,
            msg: SchemaVerifier_1.FieldTypeEnum.String,
            data: SchemaVerifier_1.FieldTypeEnum.AnyOptional,
            lnPublicKey: SchemaVerifier_1.FieldTypeEnum.StringOptional
        }, timeout, abortSignal, streamRequest);
        return {
            lnPublicKey: responseBodyPromise.then(responseBody => responseBody.lnPublicKey),
            response: responseBodyPromise.then((responseBody) => Promise.all([
                responseBody.code,
                responseBody.msg,
                responseBody.data,
            ])).then(([code, msg, data]) => {
                if (code !== 20000) {
                    throw RequestError_1.RequestError.parse(JSON.stringify({ code, msg, data }), 400);
                }
                return (0, SchemaVerifier_1.verifySchema)(data, FromBTCLNResponseSchema);
            })
        };
    }
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
    static initFromBTCLNAuto(chainIdentifier, baseUrl, init, timeout, abortSignal, streamRequest) {
        const responseBodyPromise = (0, StreamingFetchPromise_1.streamingFetchPromise)(baseUrl + "/frombtcln_auto/createInvoice?chain=" + encodeURIComponent(chainIdentifier), {
            ...init.additionalParams,
            paymentHash: init.paymentHash.toString("hex"),
            amount: init.amount.toString(),
            address: init.claimer,
            token: init.token,
            descriptionHash: init.descriptionHash == null ? null : init.descriptionHash.toString("hex"),
            exactOut: init.exactOut,
            gasToken: init.gasToken,
            gasAmount: (init.gasAmount ?? 0n).toString(10),
            claimerBounty: init.claimerBounty.then(val => val.toString(10)) ?? "0"
        }, {
            code: SchemaVerifier_1.FieldTypeEnum.Number,
            msg: SchemaVerifier_1.FieldTypeEnum.String,
            data: SchemaVerifier_1.FieldTypeEnum.AnyOptional,
            lnPublicKey: SchemaVerifier_1.FieldTypeEnum.StringOptional
        }, timeout, abortSignal, streamRequest);
        return {
            lnPublicKey: responseBodyPromise.then(responseBody => responseBody.lnPublicKey),
            response: responseBodyPromise.then((responseBody) => Promise.all([
                responseBody.code,
                responseBody.msg,
                responseBody.data,
            ])).then(([code, msg, data]) => {
                if (code !== 20000) {
                    throw RequestError_1.RequestError.parse(JSON.stringify({ code, msg, data }), 400);
                }
                return (0, SchemaVerifier_1.verifySchema)(data, FromBTCLNAutoResponseSchema);
            })
        };
    }
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
    static initToBTCLN(chainIdentifier, baseUrl, init, timeout, abortSignal, streamRequest) {
        const responseBodyPromise = (0, StreamingFetchPromise_1.streamingFetchPromise)(baseUrl + "/tobtcln/payInvoice?chain=" + encodeURIComponent(chainIdentifier), {
            exactIn: false,
            ...init.additionalParams,
            pr: init.pr,
            maxFee: init.maxFee.toString(10),
            expiryTimestamp: init.expiryTimestamp.toString(10),
            token: init.token,
            offerer: init.offerer,
            feeRate: init.feeRate,
            amount: null
        }, {
            code: SchemaVerifier_1.FieldTypeEnum.Number,
            msg: SchemaVerifier_1.FieldTypeEnum.String,
            data: SchemaVerifier_1.FieldTypeEnum.AnyOptional,
            signDataPrefetch: SchemaVerifier_1.FieldTypeEnum.AnyOptional
        }, timeout, abortSignal, streamRequest);
        return {
            signDataPrefetch: responseBodyPromise.then(responseBody => responseBody.signDataPrefetch),
            response: responseBodyPromise.then((responseBody) => Promise.all([
                responseBody.code,
                responseBody.msg,
                responseBody.data,
            ])).then(([code, msg, data]) => {
                if (code !== 20000) {
                    throw RequestError_1.RequestError.parse(JSON.stringify({ code, msg, data }), 400);
                }
                return (0, SchemaVerifier_1.verifySchema)(data, ToBTCLNResponseSchema);
            })
        };
    }
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
    static async initToBTCLNExactIn(baseUrl, init, timeout, abortSignal, streamRequest) {
        const responseBody = await (0, StreamingFetchPromise_1.streamingFetchPromise)(baseUrl + "/tobtcln/payInvoiceExactIn", {
            ...init.additionalParams,
            pr: init.pr,
            reqId: init.reqId,
            feeRate: init.feeRate
        }, {
            code: SchemaVerifier_1.FieldTypeEnum.Number,
            msg: SchemaVerifier_1.FieldTypeEnum.String,
            data: SchemaVerifier_1.FieldTypeEnum.AnyOptional
        }, timeout, abortSignal, streamRequest);
        const [code, msg, data] = await Promise.all([
            responseBody.code,
            responseBody.msg,
            responseBody.data,
        ]);
        if (code !== 20000)
            throw RequestError_1.RequestError.parse(JSON.stringify({ code, msg, data }), 400);
        return (0, SchemaVerifier_1.verifySchema)(data, ToBTCLNResponseSchema);
    }
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
    static prepareToBTCLNExactIn(chainIdentifier, baseUrl, init, timeout, abortSignal, streamRequest) {
        const responseBodyPromise = (0, StreamingFetchPromise_1.streamingFetchPromise)(baseUrl + "/tobtcln/payInvoice?chain=" + encodeURIComponent(chainIdentifier), {
            exactIn: true,
            ...init.additionalParams,
            pr: init.pr,
            maxFee: init.maxFee.toString(10),
            expiryTimestamp: init.expiryTimestamp.toString(10),
            token: init.token,
            offerer: init.offerer,
            amount: init.amount.toString(10)
        }, {
            code: SchemaVerifier_1.FieldTypeEnum.Number,
            msg: SchemaVerifier_1.FieldTypeEnum.String,
            data: SchemaVerifier_1.FieldTypeEnum.AnyOptional,
            signDataPrefetch: SchemaVerifier_1.FieldTypeEnum.AnyOptional
        }, timeout, abortSignal, streamRequest);
        return {
            signDataPrefetch: responseBodyPromise.then(responseBody => responseBody.signDataPrefetch),
            response: responseBodyPromise.then((responseBody) => Promise.all([
                responseBody.code,
                responseBody.msg,
                responseBody.data,
            ])).then(([code, msg, data]) => {
                if (code !== 20000) {
                    throw RequestError_1.RequestError.parse(JSON.stringify({ code, msg, data }), 400);
                }
                return (0, SchemaVerifier_1.verifySchema)(data, ToBTCLNPrepareExactInSchema);
            })
        };
    }
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
    static prepareSpvFromBTC(chainIdentifier, baseUrl, init, timeout, abortSignal, streamRequest) {
        const responseBodyPromise = (0, StreamingFetchPromise_1.streamingFetchPromise)(baseUrl + "/frombtc_spv/getQuote?chain=" + encodeURIComponent(chainIdentifier), {
            exactOut: init.exactOut,
            ...init.additionalParams,
            address: init.address,
            amount: init.amount.toString(10),
            token: init.token,
            gasAmount: init.gasAmount.toString(10),
            gasToken: init.gasToken,
            frontingFeeRate: init.frontingFeeRate.toString(10),
            callerFeeRate: init.callerFeeRate.then(val => val.toString(10))
        }, {
            code: SchemaVerifier_1.FieldTypeEnum.Number,
            msg: SchemaVerifier_1.FieldTypeEnum.String,
            data: SchemaVerifier_1.FieldTypeEnum.AnyOptional
        }, timeout, abortSignal, streamRequest);
        return responseBodyPromise.then((responseBody) => Promise.all([
            responseBody.code,
            responseBody.msg,
            responseBody.data,
        ])).then(([code, msg, data]) => {
            if (code !== 20000) {
                throw RequestError_1.RequestError.parse(JSON.stringify({ code, msg, data }), 400);
            }
            return (0, SchemaVerifier_1.verifySchema)(data, SpvFromBTCPrepareResponseSchema);
        });
    }
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
    static initSpvFromBTC(chainIdentifier, url, init, timeout, abortSignal, streamRequest) {
        const responseBodyPromise = (0, StreamingFetchPromise_1.streamingFetchPromise)(url + "/postQuote?chain=" + encodeURIComponent(chainIdentifier), {
            quoteId: init.quoteId,
            psbtHex: init.psbtHex
        }, {
            code: SchemaVerifier_1.FieldTypeEnum.Number,
            msg: SchemaVerifier_1.FieldTypeEnum.String,
            data: SchemaVerifier_1.FieldTypeEnum.AnyOptional
        }, timeout, abortSignal, streamRequest);
        return responseBodyPromise.then((responseBody) => Promise.all([
            responseBody.code,
            responseBody.msg,
            responseBody.data,
        ])).then(([code, msg, data]) => {
            if (code !== 20000) {
                throw RequestError_1.RequestError.parse(JSON.stringify({ code, msg, data }), 400);
            }
            return (0, SchemaVerifier_1.verifySchema)(data, SpvFromBTCInitResponseSchema);
        });
    }
}
exports.IntermediaryAPI = IntermediaryAPI;
