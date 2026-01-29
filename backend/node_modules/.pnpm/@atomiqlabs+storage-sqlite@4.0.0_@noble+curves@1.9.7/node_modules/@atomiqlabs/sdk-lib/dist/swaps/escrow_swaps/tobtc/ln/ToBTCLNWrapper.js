"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToBTCLNWrapper = exports.isInvoiceCreateService = void 0;
const bolt11_1 = require("@atomiqlabs/bolt11");
const ToBTCLNSwap_1 = require("./ToBTCLNSwap");
const IToBTCWrapper_1 = require("../IToBTCWrapper");
const UserError_1 = require("../../../../errors/UserError");
const base_1 = require("@atomiqlabs/base");
const IntermediaryError_1 = require("../../../../errors/IntermediaryError");
const SwapType_1 = require("../../../enums/SwapType");
const Utils_1 = require("../../../../utils/Utils");
const IntermediaryAPI_1 = require("../../../../intermediaries/IntermediaryAPI");
const RequestError_1 = require("../../../../errors/RequestError");
const LNURL_1 = require("../../../../utils/LNURL");
const IToBTCSwap_1 = require("../IToBTCSwap");
const sha2_1 = require("@noble/hashes/sha2");
function isInvoiceCreateService(obj) {
    return typeof (obj) === "object" &&
        typeof (obj.getInvoice) === "function" &&
        (obj.minMsats == null || typeof (obj.minMsats) === "bigint") &&
        (obj.maxMSats == null || typeof (obj.maxMSats) === "bigint");
}
exports.isInvoiceCreateService = isInvoiceCreateService;
class ToBTCLNWrapper extends IToBTCWrapper_1.IToBTCWrapper {
    constructor(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, contract, prices, tokens, swapDataDeserializer, options, events) {
        if (options == null)
            options = {};
        options.paymentTimeoutSeconds ??= 4 * 24 * 60 * 60;
        options.lightningBaseFee ??= 10;
        options.lightningFeePPM ??= 2000;
        super(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, contract, prices, tokens, swapDataDeserializer, options, events);
        this.TYPE = SwapType_1.SwapType.TO_BTCLN;
        this.swapDeserializer = ToBTCLNSwap_1.ToBTCLNSwap;
    }
    async checkPaymentHashWasPaid(paymentHash) {
        const swaps = await this.unifiedStorage.query([[{ key: "type", value: this.TYPE }, { key: "paymentHash", value: paymentHash }]], (obj) => new this.swapDeserializer(this, obj));
        for (let value of swaps) {
            if (value.state === IToBTCSwap_1.ToBTCSwapState.CLAIMED || value.state === IToBTCSwap_1.ToBTCSwapState.SOFT_CLAIMED)
                throw new UserError_1.UserError("Lightning invoice was already paid!");
        }
    }
    /**
     * Calculates maximum lightning network routing fee based on amount
     *
     * @param amount BTC amount of the swap in satoshis
     * @param overrideBaseFee Override wrapper's default base fee
     * @param overrideFeePPM Override wrapper's default PPM
     * @private
     * @returns Maximum lightning routing fee in sats
     */
    calculateFeeForAmount(amount, overrideBaseFee, overrideFeePPM) {
        return BigInt(overrideBaseFee ?? this.options.lightningBaseFee)
            + (amount * BigInt(overrideFeePPM ?? this.options.lightningFeePPM) / 1000000n);
    }
    /**
     * Verifies returned LP data
     *
     * @param signer
     * @param resp Response as returned by the LP
     * @param parsedPr Parsed bolt11 lightning invoice
     * @param token Smart chain token to be used in the swap
     * @param lp
     * @param options Swap options as passed to the swap create function
     * @param data Parsed swap data returned by the LP
     * @param requiredTotal Required total to be paid on the input (for exactIn swaps)
     * @private
     * @throws {IntermediaryError} In case the response is not valid
     */
    async verifyReturnedData(signer, resp, parsedPr, token, lp, options, data, requiredTotal) {
        if (resp.routingFeeSats > await options.maxFee)
            throw new IntermediaryError_1.IntermediaryError("Invalid max fee sats returned");
        if (requiredTotal != null && resp.total !== requiredTotal)
            throw new IntermediaryError_1.IntermediaryError("Invalid data returned - total amount");
        const claimHash = this.contract.getHashForHtlc(Buffer.from(parsedPr.tagsObject.payment_hash, "hex"));
        if (data.getAmount() !== resp.total ||
            !Buffer.from(data.getClaimHash(), "hex").equals(claimHash) ||
            data.getExpiry() !== options.expiryTimestamp ||
            data.getType() !== base_1.ChainSwapType.HTLC ||
            !data.isPayIn() ||
            !data.isToken(token) ||
            !data.isClaimer(lp.getAddress(this.chainIdentifier)) ||
            !data.isOfferer(signer) ||
            data.getTotalDeposit() !== 0n) {
            throw new IntermediaryError_1.IntermediaryError("Invalid data returned");
        }
    }
    /**
     * Returns the quote/swap from a given intermediary
     *
     * @param signer Smartchain signer initiating the swap
     * @param amountData
     * @param lp Intermediary
     * @param pr bolt11 lightning network invoice
     * @param parsedPr Parsed bolt11 lightning network invoice
     * @param options Options as passed to the swap create function
     * @param preFetches
     * @param abort Abort signal or controller, if AbortController is passed it is used as-is, when AbortSignal is passed
     *  it is extended with extendAbortController and then used
     * @param additionalParams Additional params that should be sent to the LP
     * @private
     */
    async getIntermediaryQuote(signer, amountData, lp, pr, parsedPr, options, preFetches, abort, additionalParams) {
        const abortController = abort instanceof AbortController ? abort : (0, Utils_1.extendAbortController)(abort);
        const reputationPromise = this.preFetchIntermediaryReputation(amountData, lp, abortController);
        try {
            const { signDataPromise, resp } = await (0, Utils_1.tryWithRetries)(async (retryCount) => {
                const { signDataPrefetch, response } = IntermediaryAPI_1.IntermediaryAPI.initToBTCLN(this.chainIdentifier, lp.url, {
                    offerer: signer,
                    pr,
                    maxFee: await options.maxFee,
                    expiryTimestamp: options.expiryTimestamp,
                    token: amountData.token,
                    feeRate: preFetches.feeRatePromise,
                    additionalParams
                }, this.options.postRequestTimeout, abortController.signal, retryCount > 0 ? false : null);
                return {
                    signDataPromise: preFetches.signDataPrefetchPromise ?? this.preFetchSignData(signDataPrefetch),
                    resp: await response
                };
            }, null, e => e instanceof RequestError_1.RequestError, abortController.signal);
            const amountOut = (BigInt(parsedPr.millisatoshis) + 999n) / 1000n;
            const totalFee = resp.swapFee + resp.maxFee;
            const data = new this.swapDataDeserializer(resp.data);
            data.setOfferer(signer);
            await this.verifyReturnedData(signer, resp, parsedPr, amountData.token, lp, options, data);
            const [pricingInfo, signatureExpiry, reputation] = await Promise.all([
                this.verifyReturnedPrice(lp.services[SwapType_1.SwapType.TO_BTCLN], true, amountOut, data.getAmount(), amountData.token, { networkFee: resp.maxFee }, preFetches.pricePreFetchPromise, abortController.signal),
                this.verifyReturnedSignature(signer, data, resp, preFetches.feeRatePromise, signDataPromise, abortController.signal),
                reputationPromise
            ]);
            abortController.signal.throwIfAborted();
            lp.reputation[amountData.token.toString()] = reputation;
            const quote = new ToBTCLNSwap_1.ToBTCLNSwap(this, {
                pricingInfo,
                url: lp.url,
                expiry: signatureExpiry,
                swapFee: resp.swapFee,
                feeRate: await preFetches.feeRatePromise,
                signatureData: resp,
                data,
                networkFee: resp.maxFee,
                networkFeeBtc: resp.routingFeeSats,
                confidence: resp.confidence,
                pr,
                exactIn: false
            });
            await quote._save();
            return quote;
        }
        catch (e) {
            abortController.abort(e);
            throw e;
        }
    }
    /**
     * Returns a newly created swap, paying for 'bolt11PayRequest' - a bitcoin LN invoice
     *
     * @param signer                Smartchain signer's address initiating the swap
     * @param bolt11PayRequest      BOLT11 payment request (bitcoin lightning invoice) you wish to pay
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers) to get the quotes from
     * @param options               Quote options
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     * @param preFetches            Existing pre-fetches for the swap (only used internally for LNURL swaps)
     */
    async create(signer, bolt11PayRequest, amountData, lps, options, additionalParams, abortSignal, preFetches) {
        options ??= {};
        options.expirySeconds ??= this.options.paymentTimeoutSeconds;
        options.expiryTimestamp ??= BigInt(Math.floor(Date.now() / 1000) + options.expirySeconds);
        const parsedPr = (0, bolt11_1.decode)(bolt11PayRequest);
        if (parsedPr.millisatoshis == null)
            throw new UserError_1.UserError("Must be an invoice with amount");
        const amountOut = (BigInt(parsedPr.millisatoshis) + 999n) / 1000n;
        options.maxFee ??= this.calculateFeeForAmount(amountOut, options.maxRoutingBaseFee, options.maxRoutingPPM);
        await this.checkPaymentHashWasPaid(parsedPr.tagsObject.payment_hash);
        const claimHash = this.contract.getHashForHtlc(Buffer.from(parsedPr.tagsObject.payment_hash, "hex"));
        const _abortController = (0, Utils_1.extendAbortController)(abortSignal);
        if (preFetches == null)
            preFetches = {
                pricePreFetchPromise: this.preFetchPrice(amountData, _abortController.signal),
                feeRatePromise: this.preFetchFeeRate(signer, amountData, claimHash.toString("hex"), _abortController),
                signDataPrefetchPromise: this.contract.preFetchBlockDataForSignatures == null ? this.preFetchSignData(Promise.resolve(true)) : null
            };
        return lps.map(lp => {
            return {
                intermediary: lp,
                quote: this.getIntermediaryQuote(signer, amountData, lp, bolt11PayRequest, parsedPr, options, preFetches, _abortController.signal, additionalParams)
            };
        });
    }
    /**
     * Parses and fetches lnurl pay params from the specified lnurl
     *
     * @param lnurl LNURL to be parsed and fetched
     * @param abortSignal
     * @private
     * @throws {UserError} if the LNURL is invalid or if it's not a LNURL-pay
     */
    async getLNURLPay(lnurl, abortSignal) {
        if (typeof (lnurl) !== "string")
            return lnurl;
        const res = await LNURL_1.LNURL.getLNURL(lnurl, true, this.options.getRequestTimeout, abortSignal);
        if (res == null)
            throw new UserError_1.UserError("Invalid LNURL");
        if (res.tag !== "payRequest")
            throw new UserError_1.UserError("Not a LNURL-pay");
        return res;
    }
    /**
     * Returns the quote/swap from the given LP
     *
     * @param signer Smartchain signer's address initiating the swap
     * @param amountData
     * @param invoiceCreateService Service for creating fixed amount invoices
     * @param lp Intermediary
     * @param dummyPr Dummy minimum value bolt11 lightning invoice returned from the LNURL-pay
     * @param options Options as passed to the swap create function
     * @param preFetches
     * @param abortSignal
     * @param additionalParams Additional params to be sent to the intermediary
     * @private
     */
    async getIntermediaryQuoteExactIn(signer, amountData, invoiceCreateService, lp, dummyPr, options, preFetches, abortSignal, additionalParams) {
        const abortController = (0, Utils_1.extendAbortController)(abortSignal);
        const reputationPromise = this.preFetchIntermediaryReputation(amountData, lp, abortController);
        try {
            const { signDataPromise, prepareResp } = await (0, Utils_1.tryWithRetries)(async (retryCount) => {
                const { signDataPrefetch, response } = IntermediaryAPI_1.IntermediaryAPI.prepareToBTCLNExactIn(this.chainIdentifier, lp.url, {
                    token: amountData.token,
                    offerer: signer,
                    pr: dummyPr,
                    amount: amountData.amount,
                    maxFee: await options.maxFee,
                    expiryTimestamp: options.expiryTimestamp,
                    additionalParams
                }, this.options.postRequestTimeout, abortController.signal, retryCount > 0 ? false : null);
                return {
                    signDataPromise: this.preFetchSignData(signDataPrefetch),
                    prepareResp: await response
                };
            }, null, e => e instanceof RequestError_1.RequestError, abortController.signal);
            if (prepareResp.amount <= 0n)
                throw new IntermediaryError_1.IntermediaryError("Invalid amount returned (zero or negative)");
            if (invoiceCreateService.minMsats != null) {
                if (prepareResp.amount < invoiceCreateService.minMsats / 1000n)
                    throw new UserError_1.UserError("Amount less than minimum");
            }
            if (invoiceCreateService.maxMSats != null) {
                if (prepareResp.amount > invoiceCreateService.maxMSats / 1000n)
                    throw new UserError_1.UserError("Amount more than maximum");
            }
            const invoice = await invoiceCreateService.getInvoice(Number(prepareResp.amount), abortController.signal);
            const parsedInvoice = (0, bolt11_1.decode)(invoice);
            const resp = await (0, Utils_1.tryWithRetries)((retryCount) => IntermediaryAPI_1.IntermediaryAPI.initToBTCLNExactIn(lp.url, {
                pr: invoice,
                reqId: prepareResp.reqId,
                feeRate: preFetches.feeRatePromise,
                additionalParams
            }, this.options.postRequestTimeout, abortController.signal, retryCount > 0 ? false : null), null, RequestError_1.RequestError, abortController.signal);
            const totalFee = resp.swapFee + resp.maxFee;
            const data = new this.swapDataDeserializer(resp.data);
            data.setOfferer(signer);
            await this.verifyReturnedData(signer, resp, parsedInvoice, amountData.token, lp, options, data, amountData.amount);
            const [pricingInfo, signatureExpiry, reputation] = await Promise.all([
                this.verifyReturnedPrice(lp.services[SwapType_1.SwapType.TO_BTCLN], true, prepareResp.amount, data.getAmount(), amountData.token, { networkFee: resp.maxFee }, preFetches.pricePreFetchPromise, abortSignal),
                this.verifyReturnedSignature(signer, data, resp, preFetches.feeRatePromise, signDataPromise, abortController.signal),
                reputationPromise
            ]);
            abortController.signal.throwIfAborted();
            lp.reputation[amountData.token.toString()] = reputation;
            const quote = new ToBTCLNSwap_1.ToBTCLNSwap(this, {
                pricingInfo,
                url: lp.url,
                expiry: signatureExpiry,
                swapFee: resp.swapFee,
                feeRate: await preFetches.feeRatePromise,
                signatureData: resp,
                data,
                networkFee: resp.maxFee,
                networkFeeBtc: resp.routingFeeSats,
                confidence: resp.confidence,
                pr: invoice,
                exactIn: true
            });
            await quote._save();
            return quote;
        }
        catch (e) {
            abortController.abort(e);
            throw e;
        }
    }
    /**
     * Returns a newly created swap, allowing exactIn swaps with invoice creation service
     *
     * @param signer                Smartchain signer's address initiating the swap
     * @param invoiceCreateServicePromise
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers/intermediaries) to get the quotes from
     * @param options               Quote options
     * @param additionalParams      Additional parameters sent to the intermediary when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     */
    async createViaInvoiceCreateService(signer, invoiceCreateServicePromise, amountData, lps, options, additionalParams, abortSignal) {
        if (!this.isInitialized)
            throw new Error("Not initialized, call init() first!");
        options ??= {};
        options.expirySeconds ??= this.options.paymentTimeoutSeconds;
        options.expiryTimestamp ??= BigInt(Math.floor(Date.now() / 1000) + options.expirySeconds);
        const _abortController = (0, Utils_1.extendAbortController)(abortSignal);
        const pricePreFetchPromise = this.preFetchPrice(amountData, _abortController.signal);
        const feeRatePromise = this.preFetchFeeRate(signer, amountData, null, _abortController);
        const signDataPrefetchPromise = this.contract.preFetchBlockDataForSignatures == null ? this.preFetchSignData(Promise.resolve(true)) : null;
        options.maxRoutingPPM ??= BigInt(this.options.lightningFeePPM);
        options.maxRoutingBaseFee ??= BigInt(this.options.lightningBaseFee);
        if (amountData.exactIn) {
            options.maxFee ??= pricePreFetchPromise
                .then(val => this.prices.getFromBtcSwapAmount(this.chainIdentifier, options.maxRoutingBaseFee, amountData.token, abortSignal, val))
                .then(_maxBaseFee => this.calculateFeeForAmount(amountData.amount, _maxBaseFee, options.maxRoutingPPM));
        }
        else {
            options.maxFee = this.calculateFeeForAmount(amountData.amount, options.maxRoutingBaseFee, options.maxRoutingPPM);
        }
        try {
            const invoiceCreateService = await invoiceCreateServicePromise;
            if (amountData.exactIn) {
                const dummyInvoice = await invoiceCreateService.getInvoice(invoiceCreateService.minMsats == null ? 1 : Number(invoiceCreateService.minMsats / 1000n), _abortController.signal);
                return lps.map(lp => {
                    return {
                        quote: this.getIntermediaryQuoteExactIn(signer, amountData, invoiceCreateService, lp, dummyInvoice, options, {
                            pricePreFetchPromise,
                            feeRatePromise
                        }, _abortController.signal, additionalParams),
                        intermediary: lp
                    };
                });
            }
            else {
                if (invoiceCreateService.minMsats != null) {
                    if (amountData.amount < invoiceCreateService.minMsats / 1000n)
                        throw new UserError_1.UserError("Amount less than minimum");
                }
                if (invoiceCreateService.maxMSats != null) {
                    if (amountData.amount > invoiceCreateService.maxMSats / 1000n)
                        throw new UserError_1.UserError("Amount more than maximum");
                }
                const invoice = await invoiceCreateService.getInvoice(Number(amountData.amount), _abortController.signal);
                return (await this.create(signer, invoice, amountData, lps, options, additionalParams, _abortController.signal, {
                    feeRatePromise,
                    pricePreFetchPromise,
                    signDataPrefetchPromise
                }));
            }
        }
        catch (e) {
            _abortController.abort(e);
            throw e;
        }
    }
    /**
     * Returns a newly created swap, paying for 'lnurl' - a lightning LNURL-pay
     *
     * @param signer                Smartchain signer's address initiating the swap
     * @param lnurl                 LMURL-pay you wish to pay
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers/intermediaries) to get the quotes from
     * @param options               Quote options
     * @param additionalParams      Additional parameters sent to the intermediary when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     */
    async createViaLNURL(signer, lnurl, amountData, lps, options, additionalParams, abortSignal) {
        let successActions = {};
        const _abortController = (0, Utils_1.extendAbortController)(abortSignal);
        const invoiceCreateService = (async () => {
            let payRequest = await this.getLNURLPay(lnurl, _abortController.signal);
            if (options?.comment != null &&
                (payRequest.commentAllowed == null || options.comment.length > payRequest.commentAllowed))
                throw new UserError_1.UserError("Comment not allowed or too long");
            return {
                getInvoice: async (amountSats, abortSignal) => {
                    const { invoice, successAction } = await LNURL_1.LNURL.useLNURLPay(payRequest, BigInt(amountSats), options?.comment, this.options.getRequestTimeout, abortSignal);
                    successActions[invoice] = successAction;
                    return invoice;
                },
                minMsats: BigInt(payRequest.minSendable),
                maxMsats: BigInt(payRequest.maxSendable),
                url: payRequest.url
            };
        })();
        const quotes = await this.createViaInvoiceCreateService(signer, invoiceCreateService, amountData, lps, options, additionalParams, _abortController.signal);
        _abortController.signal.throwIfAborted();
        const resolved = await invoiceCreateService;
        _abortController.signal.throwIfAborted();
        return quotes.map(value => ({
            quote: value.quote.then(quote => {
                quote.lnurl = resolved.url;
                const successAction = successActions[quote.getOutputAddress()];
                if (successAction != null)
                    quote.successAction = successAction;
                return quote;
            }),
            intermediary: value.intermediary
        }));
    }
    async recoverFromSwapDataAndState(init, state, lp) {
        const data = init.data;
        let paymentHash = data.getHTLCHashHint();
        if (state.type === base_1.SwapCommitStateType.PAID) {
            const secret = await state.getClaimResult();
            paymentHash = Buffer.from((0, sha2_1.sha256)(Buffer.from(secret, "hex"))).toString("hex");
        }
        const swap = new ToBTCLNSwap_1.ToBTCLNSwap(this, {
            pricingInfo: {
                isValid: true,
                satsBaseFee: 0n,
                swapPriceUSatPerToken: 100000000000000n,
                realPriceUSatPerToken: 100000000000000n,
                differencePPM: 0n,
                feePPM: 0n,
            },
            url: lp?.url,
            expiry: 0,
            swapFee: 0n,
            swapFeeBtc: 0n,
            feeRate: "",
            signatureData: null,
            data,
            networkFee: 0n,
            networkFeeBtc: 0n,
            confidence: 0,
            pr: paymentHash,
            exactIn: false
        });
        swap.commitTxId = await init.getInitTxId();
        const blockData = await init.getTxBlock();
        swap.createdAt = blockData.blockTime * 1000;
        swap._setInitiated();
        switch (state.type) {
            case base_1.SwapCommitStateType.PAID:
                const secret = await state.getClaimResult();
                await swap._setPaymentResult({ secret }, false);
                swap.claimTxId = await state.getClaimTxId();
                swap.state = IToBTCSwap_1.ToBTCSwapState.CLAIMED;
                break;
            case base_1.SwapCommitStateType.NOT_COMMITED:
            case base_1.SwapCommitStateType.EXPIRED:
                if (state.getRefundTxId == null)
                    return null;
                swap.refundTxId = await state.getRefundTxId();
                swap.state = IToBTCSwap_1.ToBTCSwapState.REFUNDED;
                break;
            case base_1.SwapCommitStateType.COMMITED:
                swap.state = IToBTCSwap_1.ToBTCSwapState.COMMITED;
                //Try to fetch refund signature
                if (lp != null)
                    await swap._sync(false, false, state);
                break;
            case base_1.SwapCommitStateType.REFUNDABLE:
                swap.state = IToBTCSwap_1.ToBTCSwapState.REFUNDABLE;
                break;
        }
        await swap._save();
        return swap;
    }
}
exports.ToBTCLNWrapper = ToBTCLNWrapper;
