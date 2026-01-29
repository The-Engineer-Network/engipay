"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBTCLNAutoSwap = exports.isFromBTCLNAutoSwapInit = exports.FromBTCLNAutoSwapState = void 0;
const bolt11_1 = require("@atomiqlabs/bolt11");
const SwapType_1 = require("../../../enums/SwapType");
const base_1 = require("@atomiqlabs/base");
const buffer_1 = require("buffer");
const LNURL_1 = require("../../../../utils/LNURL");
const UserError_1 = require("../../../../errors/UserError");
const IntermediaryAPI_1 = require("../../../../intermediaries/IntermediaryAPI");
const IntermediaryError_1 = require("../../../../errors/IntermediaryError");
const Utils_1 = require("../../../../utils/Utils");
const Tokens_1 = require("../../../../Tokens");
const ISwap_1 = require("../../../ISwap");
const Fee_1 = require("../../../fee/Fee");
const IEscrowSwap_1 = require("../../IEscrowSwap");
var FromBTCLNAutoSwapState;
(function (FromBTCLNAutoSwapState) {
    FromBTCLNAutoSwapState[FromBTCLNAutoSwapState["FAILED"] = -4] = "FAILED";
    FromBTCLNAutoSwapState[FromBTCLNAutoSwapState["QUOTE_EXPIRED"] = -3] = "QUOTE_EXPIRED";
    FromBTCLNAutoSwapState[FromBTCLNAutoSwapState["QUOTE_SOFT_EXPIRED"] = -2] = "QUOTE_SOFT_EXPIRED";
    FromBTCLNAutoSwapState[FromBTCLNAutoSwapState["EXPIRED"] = -1] = "EXPIRED";
    FromBTCLNAutoSwapState[FromBTCLNAutoSwapState["PR_CREATED"] = 0] = "PR_CREATED";
    FromBTCLNAutoSwapState[FromBTCLNAutoSwapState["PR_PAID"] = 1] = "PR_PAID";
    FromBTCLNAutoSwapState[FromBTCLNAutoSwapState["CLAIM_COMMITED"] = 2] = "CLAIM_COMMITED";
    FromBTCLNAutoSwapState[FromBTCLNAutoSwapState["CLAIM_CLAIMED"] = 3] = "CLAIM_CLAIMED";
})(FromBTCLNAutoSwapState = exports.FromBTCLNAutoSwapState || (exports.FromBTCLNAutoSwapState = {}));
function isFromBTCLNAutoSwapInit(obj) {
    return typeof obj.pr === "string" &&
        typeof obj.secret === "string" &&
        typeof obj.btcAmountSwap === "bigint" &&
        typeof obj.btcAmountGas === "bigint" &&
        typeof obj.gasSwapFeeBtc === "bigint" &&
        typeof obj.gasSwapFee === "bigint" &&
        (obj.lnurl == null || typeof (obj.lnurl) === "string") &&
        (obj.lnurlK1 == null || typeof (obj.lnurlK1) === "string") &&
        (obj.lnurlCallback == null || typeof (obj.lnurlCallback) === "string") &&
        (0, IEscrowSwap_1.isIEscrowSwapInit)(obj);
}
exports.isFromBTCLNAutoSwapInit = isFromBTCLNAutoSwapInit;
class FromBTCLNAutoSwap extends IEscrowSwap_1.IEscrowSwap {
    getSwapData() {
        return this.data ?? this.initialSwapData;
    }
    constructor(wrapper, initOrObject) {
        if (isFromBTCLNAutoSwapInit(initOrObject))
            initOrObject.url += "/frombtcln_auto";
        super(wrapper, initOrObject);
        this.inputToken = Tokens_1.BitcoinTokens.BTCLN;
        this.TYPE = SwapType_1.SwapType.FROM_BTCLN_AUTO;
        this.lnurlFailSignal = new AbortController();
        this.prPosted = false;
        this.broadcastTickCounter = 0;
        if (isFromBTCLNAutoSwapInit(initOrObject)) {
            this.state = FromBTCLNAutoSwapState.PR_CREATED;
        }
        else {
            this.pr = initOrObject.pr;
            this.secret = initOrObject.secret;
            this.initialSwapData = initOrObject.initialSwapData == null ? null : base_1.SwapData.deserialize(initOrObject.initialSwapData);
            this.btcAmountSwap = initOrObject.btcAmountSwap == null ? null : BigInt(initOrObject.btcAmountSwap);
            this.btcAmountGas = initOrObject.btcAmountGas == null ? null : BigInt(initOrObject.btcAmountGas);
            this.gasSwapFeeBtc = initOrObject.gasSwapFeeBtc == null ? null : BigInt(initOrObject.gasSwapFeeBtc);
            this.gasSwapFee = initOrObject.gasSwapFee == null ? null : BigInt(initOrObject.gasSwapFee);
            this.data = initOrObject.data == null ? null : base_1.SwapData.deserialize(initOrObject.data);
            this.commitTxId = initOrObject.commitTxId;
            this.claimTxId = initOrObject.claimTxId;
            this.lnurl = initOrObject.lnurl;
            this.lnurlK1 = initOrObject.lnurlK1;
            this.lnurlCallback = initOrObject.lnurlCallback;
            this.prPosted = initOrObject.prPosted;
        }
        this.tryRecomputeSwapPrice();
        this.logger = (0, Utils_1.getLogger)("FromBTCLNAuto(" + this.getIdentifierHashString() + "): ");
    }
    upgradeVersion() { }
    /**
     * In case swapFee in BTC is not supplied it recalculates it based on swap price
     * @protected
     */
    tryRecomputeSwapPrice() {
        if (this.pricingInfo.swapPriceUSatPerToken == null) {
            this.pricingInfo = this.wrapper.prices.recomputePriceInfoReceive(this.chainIdentifier, this.btcAmountSwap, this.pricingInfo.satsBaseFee, this.pricingInfo.feePPM, this.getOutputAmountWithoutFee(), this.getSwapData().getToken());
        }
    }
    //////////////////////////////
    //// Pricing
    async refreshPriceData() {
        if (this.pricingInfo == null)
            return null;
        this.pricingInfo = await this.wrapper.prices.isValidAmountReceive(this.chainIdentifier, this.btcAmountSwap, this.pricingInfo.satsBaseFee, this.pricingInfo.feePPM, this.getOutputAmountWithoutFee(), this.getSwapData().getToken());
    }
    //////////////////////////////
    //// Getters & utils
    _getEscrowHash() {
        //Use claim hash in case the data is not yet known
        return this.data == null ? this.initialSwapData?.getClaimHash() : this.data?.getEscrowHash();
    }
    _getInitiator() {
        return this.getSwapData().getClaimer();
    }
    getId() {
        return this.getIdentifierHashString();
    }
    getOutputAddress() {
        return this._getInitiator();
    }
    getOutputTxId() {
        return this.claimTxId;
    }
    requiresAction() {
        return this.state === FromBTCLNAutoSwapState.CLAIM_COMMITED;
    }
    getIdentifierHashString() {
        const paymentHashBuffer = this.getPaymentHash();
        if (this.randomNonce == null)
            return paymentHashBuffer?.toString("hex");
        return paymentHashBuffer.toString("hex") + this.randomNonce;
    }
    getPaymentHash() {
        if (this.pr == null)
            return null;
        const decodedPR = (0, bolt11_1.decode)(this.pr);
        return buffer_1.Buffer.from(decodedPR.tagsObject.payment_hash, "hex");
    }
    getInputTxId() {
        return this.getPaymentHash().toString("hex");
    }
    /**
     * Returns the lightning network BOLT11 invoice that needs to be paid as an input to the swap
     */
    getAddress() {
        return this.pr;
    }
    getHyperlink() {
        return "lightning:" + this.pr.toUpperCase();
    }
    /**
     * Returns the timeout time (in UNIX milliseconds) when the swap will definitelly be considered as expired
     *  if the LP doesn't make it expired sooner
     */
    getDefinitiveExpiryTime() {
        if (this.pr == null)
            return null;
        const decoded = (0, bolt11_1.decode)(this.pr);
        const finalCltvExpiryDelta = decoded.tagsObject.min_final_cltv_expiry ?? 144;
        const finalCltvExpiryDelay = finalCltvExpiryDelta * this.wrapper.options.bitcoinBlocktime * this.wrapper.options.safetyFactor;
        return (decoded.timeExpireDate + finalCltvExpiryDelay) * 1000;
    }
    /**
     * Returns timeout time (in UNIX milliseconds) when the swap htlc will expire
     */
    getHtlcTimeoutTime() {
        return this.data == null ? null : Number(this.wrapper.getHtlcTimeout(this.data)) * 1000;
    }
    isFinished() {
        return this.state === FromBTCLNAutoSwapState.CLAIM_CLAIMED || this.state === FromBTCLNAutoSwapState.QUOTE_EXPIRED || this.state === FromBTCLNAutoSwapState.FAILED;
    }
    isClaimable() {
        return this.state === FromBTCLNAutoSwapState.CLAIM_COMMITED;
    }
    isSuccessful() {
        return this.state === FromBTCLNAutoSwapState.CLAIM_CLAIMED;
    }
    isFailed() {
        return this.state === FromBTCLNAutoSwapState.FAILED || this.state === FromBTCLNAutoSwapState.EXPIRED;
    }
    isQuoteExpired() {
        return this.state === FromBTCLNAutoSwapState.QUOTE_EXPIRED;
    }
    isQuoteSoftExpired() {
        return this.state === FromBTCLNAutoSwapState.QUOTE_EXPIRED;
    }
    _verifyQuoteDefinitelyExpired() {
        return Promise.resolve(this.getDefinitiveExpiryTime() < Date.now());
    }
    verifyQuoteValid() {
        return Promise.resolve(this.getQuoteExpiry() > Date.now());
    }
    //////////////////////////////
    //// Amounts & fees
    getLightningInvoiceSats() {
        const parsed = (0, bolt11_1.decode)(this.pr);
        return (BigInt(parsed.millisatoshis) + 999n) / 1000n;
    }
    getWatchtowerFeeAmountBtc() {
        return (this.btcAmountGas - this.gasSwapFeeBtc) * this.getSwapData().getClaimerBounty() / this.getSwapData().getTotalDeposit();
    }
    getInputSwapAmountWithoutFee() {
        return this.btcAmountSwap - this.swapFeeBtc;
    }
    getInputGasAmountWithoutFee() {
        return this.btcAmountGas - this.gasSwapFeeBtc;
    }
    getInputAmountWithoutFee() {
        return this.getInputSwapAmountWithoutFee() + this.getInputGasAmountWithoutFee() - this.getWatchtowerFeeAmountBtc();
    }
    getOutputAmountWithoutFee() {
        return this.getSwapData().getAmount() + this.swapFee;
    }
    getInput() {
        return (0, Tokens_1.toTokenAmount)(this.getLightningInvoiceSats(), this.inputToken, this.wrapper.prices);
    }
    getInputWithoutFee() {
        return (0, Tokens_1.toTokenAmount)(this.getInputAmountWithoutFee(), this.inputToken, this.wrapper.prices);
    }
    getOutput() {
        return (0, Tokens_1.toTokenAmount)(this.getSwapData().getAmount(), this.wrapper.tokens[this.getSwapData().getToken()], this.wrapper.prices);
    }
    getGasDropOutput() {
        return (0, Tokens_1.toTokenAmount)(this.getSwapData().getSecurityDeposit() - this.getSwapData().getClaimerBounty(), this.wrapper.tokens[this.getSwapData().getDepositToken()], this.wrapper.prices);
    }
    getSwapFee() {
        const outputToken = this.wrapper.tokens[this.getSwapData().getToken()];
        const gasSwapFeeInOutputToken = this.gasSwapFeeBtc
            * (10n ** BigInt(outputToken.decimals))
            * 1000000n
            / this.pricingInfo.swapPriceUSatPerToken;
        const feeWithoutBaseFee = this.gasSwapFeeBtc + this.swapFeeBtc - this.pricingInfo.satsBaseFee;
        const swapFeePPM = feeWithoutBaseFee * 1000000n / (this.getLightningInvoiceSats() - this.swapFeeBtc - this.gasSwapFeeBtc);
        return {
            amountInSrcToken: (0, Tokens_1.toTokenAmount)(this.swapFeeBtc + this.gasSwapFeeBtc, Tokens_1.BitcoinTokens.BTCLN, this.wrapper.prices),
            amountInDstToken: (0, Tokens_1.toTokenAmount)(this.swapFee + gasSwapFeeInOutputToken, outputToken, this.wrapper.prices),
            usdValue: (abortSignal, preFetchedUsdPrice) => this.wrapper.prices.getBtcUsdValue(this.swapFeeBtc + this.gasSwapFeeBtc, abortSignal, preFetchedUsdPrice),
            composition: {
                base: (0, Tokens_1.toTokenAmount)(this.pricingInfo.satsBaseFee, Tokens_1.BitcoinTokens.BTCLN, this.wrapper.prices),
                percentage: (0, ISwap_1.ppmToPercentage)(swapFeePPM)
            }
        };
    }
    getWatchtowerFee() {
        const btcWatchtowerFee = this.getWatchtowerFeeAmountBtc();
        const outputToken = this.wrapper.tokens[this.getSwapData().getToken()];
        const watchtowerFeeInOutputToken = btcWatchtowerFee
            * (10n ** BigInt(outputToken.decimals))
            * 1000000n
            / this.pricingInfo.swapPriceUSatPerToken;
        return {
            amountInSrcToken: (0, Tokens_1.toTokenAmount)(btcWatchtowerFee, Tokens_1.BitcoinTokens.BTCLN, this.wrapper.prices),
            amountInDstToken: (0, Tokens_1.toTokenAmount)(watchtowerFeeInOutputToken, outputToken, this.wrapper.prices),
            usdValue: (abortSignal, preFetchedUsdPrice) => this.wrapper.prices.getBtcUsdValue(btcWatchtowerFee, abortSignal, preFetchedUsdPrice)
        };
    }
    getFee() {
        const swapFee = this.getSwapFee();
        const watchtowerFee = this.getWatchtowerFee();
        return {
            amountInSrcToken: (0, Tokens_1.toTokenAmount)(swapFee.amountInSrcToken.rawAmount + watchtowerFee.amountInSrcToken.rawAmount, Tokens_1.BitcoinTokens.BTCLN, this.wrapper.prices),
            amountInDstToken: (0, Tokens_1.toTokenAmount)(swapFee.amountInDstToken.rawAmount + watchtowerFee.amountInDstToken.rawAmount, this.wrapper.tokens[this.getSwapData().getToken()], this.wrapper.prices),
            usdValue: (abortSignal, preFetchedUsdPrice) => this.wrapper.prices.getBtcUsdValue(swapFee.amountInSrcToken.rawAmount + watchtowerFee.amountInSrcToken.rawAmount, abortSignal, preFetchedUsdPrice)
        };
    }
    getFeeBreakdown() {
        return [
            {
                type: Fee_1.FeeType.SWAP,
                fee: this.getSwapFee()
            },
            {
                type: Fee_1.FeeType.NETWORK_OUTPUT,
                fee: this.getWatchtowerFee()
            }
        ];
    }
    //////////////////////////////
    //// Execution
    /**
     * Executes the swap with the provided bitcoin lightning network wallet or LNURL
     *
     * @param walletOrLnurlWithdraw Bitcoin lightning wallet to use to pay the lightning network invoice, or an LNURL-withdraw
     *  link, wallet is not required and the LN invoice can be paid externally as well (just pass null or undefined here)
     * @param callbacks Callbacks to track the progress of the swap
     * @param options Optional options for the swap like feeRate, AbortSignal, and timeouts/intervals
     *
     * @returns {boolean} Whether a swap was settled automatically by swap watchtowers or requires manual claim by the
     *  user, in case `false` is returned the user should call `swap.claim()` to settle the swap on the destination manually
     */
    async execute(walletOrLnurlWithdraw, callbacks, options) {
        if (this.state === FromBTCLNAutoSwapState.FAILED)
            throw new Error("Swap failed!");
        if (this.state === FromBTCLNAutoSwapState.EXPIRED)
            throw new Error("Swap HTLC expired!");
        if (this.state === FromBTCLNAutoSwapState.QUOTE_EXPIRED || this.state === FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED)
            throw new Error("Swap quote expired!");
        if (this.state === FromBTCLNAutoSwapState.CLAIM_CLAIMED)
            throw new Error("Swap already settled!");
        let abortSignal = options?.abortSignal;
        if (this.state === FromBTCLNAutoSwapState.PR_CREATED) {
            if (walletOrLnurlWithdraw != null && this.lnurl == null) {
                if (typeof (walletOrLnurlWithdraw) === "string" || (0, LNURL_1.isLNURLWithdraw)(walletOrLnurlWithdraw)) {
                    await this.settleWithLNURLWithdraw(walletOrLnurlWithdraw);
                }
                else {
                    const paymentPromise = walletOrLnurlWithdraw.payInvoice(this.pr);
                    const abortController = new AbortController();
                    paymentPromise.catch(e => abortController.abort(e));
                    if (options?.abortSignal != null)
                        options.abortSignal.addEventListener("abort", () => abortController.abort(options.abortSignal.reason));
                    abortSignal = abortController.signal;
                }
            }
        }
        if (this.state === FromBTCLNAutoSwapState.PR_CREATED || this.state === FromBTCLNAutoSwapState.PR_PAID) {
            const paymentSuccess = await this.waitForPayment(callbacks?.onSourceTransactionReceived, options?.lightningTxCheckIntervalSeconds, abortSignal);
            if (!paymentSuccess)
                throw new Error("Failed to receive lightning network payment");
        }
        if (this.state === FromBTCLNAutoSwapState.CLAIM_CLAIMED)
            return true;
        if (this.state === FromBTCLNAutoSwapState.CLAIM_COMMITED) {
            const success = await this.waitTillClaimed(options?.maxWaitTillAutomaticSettlementSeconds ?? 60, options?.abortSignal);
            if (success && callbacks?.onSwapSettled != null)
                callbacks.onSwapSettled(this.getOutputTxId());
            return success;
        }
    }
    //////////////////////////////
    //// Payment
    /**
     * Checks whether the LP received the LN payment and we can continue by committing & claiming the HTLC on-chain
     *
     * @param save If the new swap state should be saved
     */
    async _checkIntermediaryPaymentReceived(save = true) {
        if (this.state === FromBTCLNAutoSwapState.PR_PAID ||
            this.state === FromBTCLNAutoSwapState.CLAIM_COMMITED ||
            this.state === FromBTCLNAutoSwapState.CLAIM_CLAIMED ||
            this.state === FromBTCLNAutoSwapState.FAILED)
            return true;
        if (this.state === FromBTCLNAutoSwapState.QUOTE_EXPIRED)
            return false;
        const resp = await IntermediaryAPI_1.IntermediaryAPI.getInvoiceStatus(this.url, this.getPaymentHash().toString("hex"));
        switch (resp.code) {
            case IntermediaryAPI_1.InvoiceStatusResponseCodes.PAID:
                const data = new this.wrapper.swapDataDeserializer(resp.data.data);
                if (this.state === FromBTCLNAutoSwapState.PR_CREATED || this.state === FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED)
                    try {
                        await this._saveRealSwapData(data, save);
                        return true;
                    }
                    catch (e) { }
                return null;
            case IntermediaryAPI_1.InvoiceStatusResponseCodes.EXPIRED:
                this.state = FromBTCLNAutoSwapState.QUOTE_EXPIRED;
                this.initiated = true;
                if (save)
                    await this._saveAndEmit();
                return false;
            default:
                return null;
        }
    }
    async _saveRealSwapData(data, save) {
        await this.checkIntermediaryReturnedData(data);
        if (this.state === FromBTCLNAutoSwapState.PR_CREATED || this.state === FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED) {
            this.state = FromBTCLNAutoSwapState.PR_PAID;
            delete this.initialSwapData;
            this.data = data;
            this.initiated = true;
            if (save)
                await this._saveAndEmit();
            return true;
        }
        return false;
    }
    /**
     * Checks the data returned by the intermediary in the payment auth request
     *
     * @param data Parsed swap data as returned by the intermediary
     * @protected
     * @throws {IntermediaryError} If the returned are not valid
     * @throws {Error} If the swap is already committed on-chain
     */
    async checkIntermediaryReturnedData(data) {
        if (!data.isPayOut())
            throw new IntermediaryError_1.IntermediaryError("Invalid not pay out");
        if (data.getType() !== base_1.ChainSwapType.HTLC)
            throw new IntermediaryError_1.IntermediaryError("Invalid swap type");
        if (!data.isOfferer(this.getSwapData().getOfferer()))
            throw new IntermediaryError_1.IntermediaryError("Invalid offerer used");
        if (!data.isClaimer(this._getInitiator()))
            throw new IntermediaryError_1.IntermediaryError("Invalid claimer used");
        if (!data.isToken(this.getSwapData().getToken()))
            throw new IntermediaryError_1.IntermediaryError("Invalid token used");
        if (data.getSecurityDeposit() !== this.getSwapData().getSecurityDeposit())
            throw new IntermediaryError_1.IntermediaryError("Invalid security deposit!");
        if (data.getClaimerBounty() !== this.getSwapData().getClaimerBounty())
            throw new IntermediaryError_1.IntermediaryError("Invalid security deposit!");
        if (data.getAmount() < this.getSwapData().getAmount())
            throw new IntermediaryError_1.IntermediaryError("Invalid amount received!");
        if (data.getClaimHash() !== this.getSwapData().getClaimHash())
            throw new IntermediaryError_1.IntermediaryError("Invalid payment hash used!");
        if (!data.isDepositToken(this.getSwapData().getDepositToken()))
            throw new IntermediaryError_1.IntermediaryError("Invalid deposit token used!");
        if (data.hasSuccessAction())
            throw new IntermediaryError_1.IntermediaryError("Invalid has success action");
        if (await this.wrapper.contract.isExpired(this._getInitiator(), data))
            throw new IntermediaryError_1.IntermediaryError("Not enough time to claim!");
        if (this.wrapper.getHtlcTimeout(data) <= (Date.now() / 1000))
            throw new IntermediaryError_1.IntermediaryError("HTLC expires too soon!");
    }
    /**
     * Waits till an LN payment is received by the intermediary and client can continue commiting & claiming the HTLC
     *
     * @param onPaymentReceived Callback as for when the LP reports having received the ln payment
     * @param checkIntervalSeconds How often to poll the intermediary for answer (default 5 seconds)
     * @param abortSignal Abort signal to stop waiting for payment
     */
    async waitForPayment(onPaymentReceived, checkIntervalSeconds, abortSignal) {
        checkIntervalSeconds ??= 5;
        if (this.state === FromBTCLNAutoSwapState.PR_PAID) {
            await this.waitTillCommited(checkIntervalSeconds, abortSignal);
        }
        if (this.state >= FromBTCLNAutoSwapState.CLAIM_COMMITED)
            return true;
        if (this.state !== FromBTCLNAutoSwapState.PR_CREATED)
            throw new Error("Must be in PR_CREATED state!");
        const abortController = new AbortController();
        if (abortSignal != null)
            abortSignal.addEventListener("abort", () => abortController.abort(abortSignal.reason));
        let save = false;
        if (this.lnurl != null && !this.prPosted) {
            LNURL_1.LNURL.postInvoiceToLNURLWithdraw({ k1: this.lnurlK1, callback: this.lnurlCallback }, this.pr).catch(e => {
                this.lnurlFailSignal.abort(e);
            });
            this.prPosted = true;
            save ||= true;
        }
        if (!this.initiated) {
            this.initiated = true;
            save ||= true;
        }
        if (save)
            await this._saveAndEmit();
        let lnurlFailListener = () => abortController.abort(this.lnurlFailSignal.signal.reason);
        this.lnurlFailSignal.signal.addEventListener("abort", lnurlFailListener);
        this.lnurlFailSignal.signal.throwIfAborted();
        if (this.wrapper.messenger.warmup != null)
            await this.wrapper.messenger.warmup().catch(e => {
                this.logger.warn("waitForPayment(): Failed to warmup messenger: ", e);
            });
        if (this.state === FromBTCLNAutoSwapState.PR_CREATED) {
            const paymentResult = await Promise.any([
                this.waitTillState(FromBTCLNAutoSwapState.PR_PAID, "gte", abortController.signal).then(() => true),
                (async () => {
                    let resp = { code: IntermediaryAPI_1.InvoiceStatusResponseCodes.PENDING, msg: "" };
                    while (!abortController.signal.aborted && resp.code === IntermediaryAPI_1.InvoiceStatusResponseCodes.PENDING) {
                        resp = await IntermediaryAPI_1.IntermediaryAPI.getInvoiceStatus(this.url, this.getPaymentHash().toString("hex"));
                        if (resp.code === IntermediaryAPI_1.InvoiceStatusResponseCodes.PENDING)
                            await (0, Utils_1.timeoutPromise)(checkIntervalSeconds * 1000, abortController.signal);
                    }
                    this.lnurlFailSignal.signal.removeEventListener("abort", lnurlFailListener);
                    abortController.signal.throwIfAborted();
                    if (resp.code === IntermediaryAPI_1.InvoiceStatusResponseCodes.PAID) {
                        const swapData = new this.wrapper.swapDataDeserializer(resp.data.data);
                        return await this._saveRealSwapData(swapData, true);
                    }
                    if (this.state === FromBTCLNAutoSwapState.PR_CREATED || this.state === FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED) {
                        if (resp.code === IntermediaryAPI_1.InvoiceStatusResponseCodes.EXPIRED) {
                            await this._saveAndEmit(FromBTCLNAutoSwapState.QUOTE_EXPIRED);
                        }
                        return false;
                    }
                })()
            ]);
            abortController.abort();
            if (!paymentResult)
                return false;
            if (onPaymentReceived != null)
                onPaymentReceived(this.getInputTxId());
        }
        if (this.state === FromBTCLNAutoSwapState.PR_PAID) {
            await this.waitTillCommited(checkIntervalSeconds, abortSignal);
        }
        return this.state >= FromBTCLNAutoSwapState.CLAIM_COMMITED;
    }
    //////////////////////////////
    //// Commit
    async waitTillCommited(checkIntervalSeconds, abortSignal) {
        if (this.state === FromBTCLNAutoSwapState.CLAIM_COMMITED || this.state === FromBTCLNAutoSwapState.CLAIM_CLAIMED)
            return Promise.resolve();
        if (this.state !== FromBTCLNAutoSwapState.PR_PAID)
            throw new Error("Invalid state");
        const abortController = (0, Utils_1.extendAbortController)(abortSignal);
        let result;
        try {
            result = await Promise.race([
                this.watchdogWaitTillCommited(checkIntervalSeconds, abortController.signal),
                this.waitTillState(FromBTCLNAutoSwapState.CLAIM_COMMITED, "gte", abortController.signal).then(() => 0)
            ]);
            abortController.abort();
        }
        catch (e) {
            abortController.abort();
            throw e;
        }
        if (result === false) {
            this.logger.debug("waitTillCommited(): Resolved from watchdog - HTLC expired");
            if (this.state === FromBTCLNAutoSwapState.PR_PAID) {
                await this._saveAndEmit(FromBTCLNAutoSwapState.EXPIRED);
            }
            return;
        }
        if (this.state === FromBTCLNAutoSwapState.PR_PAID) {
            await this._saveAndEmit(FromBTCLNAutoSwapState.CLAIM_COMMITED);
        }
        if (result === 0)
            this.logger.debug("waitTillCommited(): Resolved from state changed");
        if (result === true) {
            this.logger.debug("waitTillCommited(): Resolved from watchdog - commited");
            await this._broadcastSecret().catch(e => {
                this.logger.error("waitTillCommited(): Error broadcasting swap secret: ", e);
            });
        }
    }
    //////////////////////////////
    //// Claim
    /**
     * Returns transactions required for claiming the HTLC and finishing the swap by revealing the HTLC secret
     *  (hash preimage)
     *
     * @param _signer Optional signer address to use for claiming the swap, can also be different from the initializer
     * @throws {Error} If in invalid state (must be CLAIM_COMMITED)
     */
    async txsClaim(_signer) {
        if (this.state !== FromBTCLNAutoSwapState.CLAIM_COMMITED)
            throw new Error("Must be in CLAIM_COMMITED state!");
        return await this.wrapper.contract.txsClaimWithSecret(_signer == null ?
            this._getInitiator() :
            ((0, base_1.isAbstractSigner)(_signer) ? _signer : await this.wrapper.chain.wrapSigner(_signer)), this.data, this.secret, true, true);
    }
    /**
     * Claims and finishes the swap
     *
     * @param _signer Signer to sign the transactions with, can also be different to the initializer
     * @param abortSignal Abort signal to stop waiting for transaction confirmation
     */
    async claim(_signer, abortSignal) {
        const signer = (0, base_1.isAbstractSigner)(_signer) ? _signer : await this.wrapper.chain.wrapSigner(_signer);
        const result = await this.wrapper.chain.sendAndConfirm(signer, await this.txsClaim(), true, abortSignal);
        this.claimTxId = result[0];
        if (this.state === FromBTCLNAutoSwapState.CLAIM_COMMITED || this.state === FromBTCLNAutoSwapState.EXPIRED || this.state === FromBTCLNAutoSwapState.FAILED) {
            await this._saveAndEmit(FromBTCLNAutoSwapState.CLAIM_CLAIMED);
        }
        return result[0];
    }
    /**
     * Waits till the swap is successfully claimed
     *
     * @param maxWaitTimeSeconds Maximum time in seconds to wait for the swap to be settled
     * @param abortSignal AbortSignal
     * @throws {Error} If swap is in invalid state (must be BTC_TX_CONFIRMED)
     * @throws {Error} If the LP refunded sooner than we were able to claim
     * @returns {boolean} whether the swap was claimed in time or not
     */
    async waitTillClaimed(maxWaitTimeSeconds, abortSignal) {
        if (this.state === FromBTCLNAutoSwapState.CLAIM_CLAIMED)
            return Promise.resolve(true);
        if (this.state !== FromBTCLNAutoSwapState.CLAIM_COMMITED)
            throw new Error("Invalid state (not CLAIM_COMMITED)");
        const abortController = new AbortController();
        if (abortSignal != null)
            abortSignal.addEventListener("abort", () => abortController.abort(abortSignal.reason));
        let timedOut = false;
        if (maxWaitTimeSeconds != null) {
            const timeout = setTimeout(() => {
                timedOut = true;
                abortController.abort();
            }, maxWaitTimeSeconds * 1000);
            abortController.signal.addEventListener("abort", () => clearTimeout(timeout));
        }
        let res;
        try {
            res = await Promise.race([
                this.watchdogWaitTillResult(undefined, abortController.signal),
                this.waitTillState(FromBTCLNAutoSwapState.CLAIM_CLAIMED, "eq", abortController.signal).then(() => 0),
                this.waitTillState(FromBTCLNAutoSwapState.EXPIRED, "eq", abortController.signal).then(() => 1),
            ]);
            abortController.abort();
        }
        catch (e) {
            abortController.abort();
            if (timedOut)
                return false;
            throw e;
        }
        if (res === 0) {
            this.logger.debug("waitTillClaimed(): Resolved from state change (CLAIM_CLAIMED)");
            return true;
        }
        if (res === 1) {
            this.logger.debug("waitTillClaimed(): Resolved from state change (EXPIRED)");
            throw new Error("Swap expired during claiming");
        }
        this.logger.debug("waitTillClaimed(): Resolved from watchdog");
        if (res?.type === base_1.SwapCommitStateType.PAID) {
            if (this.state !== FromBTCLNAutoSwapState.CLAIM_CLAIMED) {
                this.claimTxId = await res.getClaimTxId();
                await this._saveAndEmit(FromBTCLNAutoSwapState.CLAIM_CLAIMED);
            }
        }
        if (res?.type === base_1.SwapCommitStateType.NOT_COMMITED || res?.type === base_1.SwapCommitStateType.EXPIRED) {
            if (this.state !== FromBTCLNAutoSwapState.CLAIM_CLAIMED &&
                this.state !== FromBTCLNAutoSwapState.FAILED) {
                await this._saveAndEmit(FromBTCLNAutoSwapState.FAILED);
            }
            throw new Error("Swap expired during claiming");
        }
        return true;
    }
    //////////////////////////////
    //// LNURL
    /**
     * Is this an LNURL-withdraw swap?
     */
    isLNURL() {
        return this.lnurl != null;
    }
    /**
     * Gets the used LNURL or null if this is not an LNURL-withdraw swap
     */
    getLNURL() {
        return this.lnurl;
    }
    /**
     * Pay the generated lightning network invoice with LNURL-withdraw
     */
    async settleWithLNURLWithdraw(lnurl) {
        if (this.lnurl != null)
            throw new Error("Cannot settle LNURL-withdraw swap with different LNURL");
        let lnurlParams;
        if (typeof (lnurl) === "string") {
            const parsedLNURL = await LNURL_1.LNURL.getLNURL(lnurl);
            if (parsedLNURL == null || parsedLNURL.tag !== "withdrawRequest")
                throw new UserError_1.UserError("Invalid LNURL-withdraw to settle the swap");
            lnurlParams = parsedLNURL;
        }
        else {
            lnurlParams = lnurl.params;
        }
        LNURL_1.LNURL.useLNURLWithdraw(lnurlParams, this.pr).catch(e => this.lnurlFailSignal.abort(e));
        this.lnurl = lnurlParams.url;
        this.lnurlCallback = lnurlParams.callback;
        this.lnurlK1 = lnurlParams.k1;
        this.prPosted = true;
        await this._saveAndEmit();
    }
    //////////////////////////////
    //// Storage
    serialize() {
        return {
            ...super.serialize(),
            data: this.data == null ? null : this.data.serialize(),
            commitTxId: this.commitTxId,
            claimTxId: this.claimTxId,
            btcAmountSwap: this.btcAmountSwap == null ? null : this.btcAmountSwap.toString(10),
            btcAmountGas: this.btcAmountGas == null ? null : this.btcAmountGas.toString(10),
            gasSwapFeeBtc: this.gasSwapFeeBtc == null ? null : this.gasSwapFeeBtc.toString(10),
            gasSwapFee: this.gasSwapFee == null ? null : this.gasSwapFee.toString(10),
            pr: this.pr,
            secret: this.secret,
            lnurl: this.lnurl,
            lnurlK1: this.lnurlK1,
            lnurlCallback: this.lnurlCallback,
            prPosted: this.prPosted,
            initialSwapData: this.initialSwapData == null ? null : this.initialSwapData.serialize()
        };
    }
    //////////////////////////////
    //// Swap ticks & sync
    /**
     * Checks the swap's state on-chain and compares it to its internal state, updates/changes it according to on-chain
     *  data
     *
     * @private
     */
    async syncStateFromChain(quoteDefinitelyExpired, commitStatus) {
        //Check for expiry before the getCommitStatus to prevent race conditions
        let quoteExpired = false;
        if (this.state === FromBTCLNAutoSwapState.PR_PAID) {
            quoteExpired = quoteDefinitelyExpired ?? await this._verifyQuoteDefinitelyExpired();
        }
        if (this.state === FromBTCLNAutoSwapState.CLAIM_COMMITED || this.state === FromBTCLNAutoSwapState.EXPIRED) {
            //Check if it's already successfully paid
            commitStatus ??= await (0, Utils_1.tryWithRetries)(() => this.wrapper.contract.getCommitStatus(this._getInitiator(), this.data));
            if (commitStatus?.type === base_1.SwapCommitStateType.PAID) {
                if (this.claimTxId == null)
                    this.claimTxId = await commitStatus.getClaimTxId();
                this.state = FromBTCLNAutoSwapState.CLAIM_CLAIMED;
                return true;
            }
            if (commitStatus?.type === base_1.SwapCommitStateType.NOT_COMMITED || commitStatus?.type === base_1.SwapCommitStateType.EXPIRED) {
                this.state = FromBTCLNAutoSwapState.FAILED;
                return true;
            }
        }
        if (this.state === FromBTCLNAutoSwapState.PR_PAID) {
            //Check if it's already committed
            commitStatus ??= await (0, Utils_1.tryWithRetries)(() => this.wrapper.contract.getCommitStatus(this._getInitiator(), this.data));
            switch (commitStatus?.type) {
                case base_1.SwapCommitStateType.COMMITED:
                    this.state = FromBTCLNAutoSwapState.CLAIM_COMMITED;
                    return true;
                case base_1.SwapCommitStateType.EXPIRED:
                    this.state = FromBTCLNAutoSwapState.EXPIRED;
                    return true;
                case base_1.SwapCommitStateType.PAID:
                    if (this.claimTxId == null)
                        this.claimTxId = await commitStatus.getClaimTxId();
                    this.state = FromBTCLNAutoSwapState.CLAIM_CLAIMED;
                    return true;
            }
            if (quoteExpired) {
                this.state = FromBTCLNAutoSwapState.QUOTE_EXPIRED;
                return true;
            }
        }
    }
    _shouldFetchCommitStatus() {
        return this.state === FromBTCLNAutoSwapState.PR_PAID || this.state === FromBTCLNAutoSwapState.CLAIM_COMMITED || this.state === FromBTCLNAutoSwapState.EXPIRED;
    }
    _shouldFetchExpiryStatus() {
        return this.state === FromBTCLNAutoSwapState.PR_PAID;
    }
    _shouldCheckIntermediary() {
        return this.state === FromBTCLNAutoSwapState.PR_CREATED || this.state === FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED;
    }
    async _sync(save, quoteDefinitelyExpired, commitStatus, skipLpCheck) {
        let changed = false;
        if (this.state === FromBTCLNAutoSwapState.PR_CREATED || this.state === FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED) {
            if (this.state !== FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED && this.getQuoteExpiry() < Date.now()) {
                this.state = FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED;
                changed ||= true;
            }
            if (!skipLpCheck)
                try {
                    const result = await this._checkIntermediaryPaymentReceived(false);
                    if (result !== null)
                        changed ||= true;
                }
                catch (e) {
                    this.logger.error("_sync(): Failed to synchronize swap, error: ", e);
                }
            if (this.state === FromBTCLNAutoSwapState.PR_CREATED || this.state === FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED) {
                if (await this._verifyQuoteDefinitelyExpired()) {
                    this.state = FromBTCLNAutoSwapState.QUOTE_EXPIRED;
                    changed ||= true;
                }
            }
        }
        if (await this.syncStateFromChain(quoteDefinitelyExpired, commitStatus))
            changed = true;
        if (save && changed)
            await this._saveAndEmit();
        if (this.state === FromBTCLNAutoSwapState.CLAIM_COMMITED)
            await this._broadcastSecret().catch(e => {
                this.logger.error("_sync(): Error when broadcasting swap secret: ", e);
            });
        return changed;
    }
    async _broadcastSecret(noCheckExpiry) {
        if (this.state !== FromBTCLNAutoSwapState.CLAIM_COMMITED)
            throw new Error("Must be in CLAIM_COMMITED state to broadcast swap secret!");
        if (!noCheckExpiry) {
            if (await this.wrapper.contract.isExpired(this._getInitiator(), this.data))
                throw new Error("On-chain HTLC already expired!");
        }
        await this.wrapper.messenger.broadcast(new base_1.SwapClaimWitnessMessage(this.data, this.secret));
    }
    async _tick(save) {
        switch (this.state) {
            case FromBTCLNAutoSwapState.PR_CREATED:
                if (this.getQuoteExpiry() < Date.now()) {
                    this.state = FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED;
                    if (save)
                        await this._saveAndEmit();
                    return true;
                }
                break;
            case FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED:
                if (this.getDefinitiveExpiryTime() < Date.now()) {
                    this.state = FromBTCLNAutoSwapState.QUOTE_EXPIRED;
                    if (save)
                        await this._saveAndEmit();
                    return true;
                }
                break;
            case FromBTCLNAutoSwapState.PR_PAID:
            case FromBTCLNAutoSwapState.CLAIM_COMMITED:
                const expired = await this.wrapper.contract.isExpired(this._getInitiator(), this.data);
                if (expired) {
                    this.state = FromBTCLNAutoSwapState.EXPIRED;
                    if (save)
                        await this._saveAndEmit();
                    return true;
                }
                if (this.state === FromBTCLNAutoSwapState.CLAIM_COMMITED) {
                    //Broadcast the secret over the provided messenger channel
                    if (this.broadcastTickCounter === 0)
                        await this._broadcastSecret(true).catch(e => {
                            this.logger.warn("_tick(): Error when broadcasting swap secret: ", e);
                        });
                    this.broadcastTickCounter = (this.broadcastTickCounter + 1) % 3; //Broadcast every 3rd tick
                }
                break;
        }
    }
}
exports.FromBTCLNAutoSwap = FromBTCLNAutoSwap;
