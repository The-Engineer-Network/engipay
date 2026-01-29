"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToBTCSwapState = exports.IToBTCSwap = exports.isIToBTCSwapInit = void 0;
const base_1 = require("@atomiqlabs/base");
const IntermediaryAPI_1 = require("../../../intermediaries/IntermediaryAPI");
const IntermediaryError_1 = require("../../../errors/IntermediaryError");
const Utils_1 = require("../../../utils/Utils");
const Tokens_1 = require("../../../Tokens");
const Fee_1 = require("../../fee/Fee");
const ISwap_1 = require("../../ISwap");
const IEscrowSelfInitSwap_1 = require("../IEscrowSelfInitSwap");
function isIToBTCSwapInit(obj) {
    return typeof (obj.networkFee) === "bigint" &&
        (obj.networkFeeBtc == null || typeof (obj.networkFeeBtc) === "bigint") &&
        (0, IEscrowSelfInitSwap_1.isIEscrowSelfInitSwapInit)(obj);
}
exports.isIToBTCSwapInit = isIToBTCSwapInit;
class IToBTCSwap extends IEscrowSelfInitSwap_1.IEscrowSelfInitSwap {
    constructor(wrapper, initOrObject) {
        super(wrapper, initOrObject);
        if (isIToBTCSwapInit(initOrObject)) {
            this.state = ToBTCSwapState.CREATED;
        }
        else {
            this.networkFee = initOrObject.networkFee == null ? null : BigInt(initOrObject.networkFee);
            this.networkFeeBtc = initOrObject.networkFeeBtc == null ? null : BigInt(initOrObject.networkFeeBtc);
        }
    }
    upgradeVersion() {
        if (this.version == null) {
            switch (this.state) {
                case -2:
                    this.state = ToBTCSwapState.REFUNDED;
                    break;
                case -1:
                    this.state = ToBTCSwapState.QUOTE_EXPIRED;
                    break;
                case 0:
                    this.state = ToBTCSwapState.CREATED;
                    break;
                case 1:
                    this.state = ToBTCSwapState.COMMITED;
                    break;
                case 2:
                    this.state = ToBTCSwapState.CLAIMED;
                    break;
                case 3:
                    this.state = ToBTCSwapState.REFUNDABLE;
                    break;
            }
            this.version = 1;
        }
    }
    /**
     * In case swapFee in BTC is not supplied it recalculates it based on swap price
     * @protected
     */
    tryRecomputeSwapPrice() {
        if (this.swapFeeBtc == null) {
            this.swapFeeBtc = this.swapFee * this.getOutput().rawAmount / this.getInputWithoutFee().rawAmount;
        }
        if (this.networkFeeBtc == null) {
            this.networkFeeBtc = this.networkFee * this.getOutput().rawAmount / this.getInputWithoutFee().rawAmount;
        }
        super.tryRecomputeSwapPrice();
    }
    /**
     * Returns the payment hash identifier to be sent to the LP for getStatus and getRefund
     * @protected
     */
    getLpIdentifier() {
        return this.getClaimHash();
    }
    //////////////////////////////
    //// Getters & utils
    getInputTxId() {
        return this.commitTxId;
    }
    requiresAction() {
        return this.isRefundable();
    }
    /**
     * Returns whether the swap is finished and in its terminal state (this can mean successful, refunded or failed)
     */
    isFinished() {
        return this.state === ToBTCSwapState.CLAIMED || this.state === ToBTCSwapState.REFUNDED || this.state === ToBTCSwapState.QUOTE_EXPIRED;
    }
    isRefundable() {
        return this.state === ToBTCSwapState.REFUNDABLE;
    }
    isQuoteExpired() {
        return this.state === ToBTCSwapState.QUOTE_EXPIRED;
    }
    isQuoteSoftExpired() {
        return this.state === ToBTCSwapState.QUOTE_EXPIRED || this.state === ToBTCSwapState.QUOTE_SOFT_EXPIRED;
    }
    isSuccessful() {
        return this.state === ToBTCSwapState.CLAIMED;
    }
    isFailed() {
        return this.state === ToBTCSwapState.REFUNDED;
    }
    _getInitiator() {
        return this.data.getOfferer();
    }
    //////////////////////////////
    //// Amounts & fees
    getSwapFee() {
        const feeWithoutBaseFee = this.swapFeeBtc - this.pricingInfo.satsBaseFee;
        const output = this.getOutput();
        const swapFeePPM = output.rawAmount == null ? 0n : feeWithoutBaseFee * 1000000n / output.rawAmount;
        return {
            amountInSrcToken: (0, Tokens_1.toTokenAmount)(this.swapFee, this.wrapper.tokens[this.data.getToken()], this.wrapper.prices),
            amountInDstToken: (0, Tokens_1.toTokenAmount)(this.swapFeeBtc, this.outputToken, this.wrapper.prices),
            usdValue: (abortSignal, preFetchedUsdPrice) => this.wrapper.prices.getBtcUsdValue(this.swapFeeBtc, abortSignal, preFetchedUsdPrice),
            composition: {
                base: (0, Tokens_1.toTokenAmount)(this.pricingInfo.satsBaseFee, this.outputToken, this.wrapper.prices),
                percentage: (0, ISwap_1.ppmToPercentage)(swapFeePPM)
            }
        };
    }
    /**
     * Returns network fee for the swap, the fee is represented in source currency & destination currency, but is
     *  paid only once
     */
    getNetworkFee() {
        return {
            amountInSrcToken: (0, Tokens_1.toTokenAmount)(this.networkFee, this.wrapper.tokens[this.data.getToken()], this.wrapper.prices),
            amountInDstToken: (0, Tokens_1.toTokenAmount)(this.networkFeeBtc, this.outputToken, this.wrapper.prices),
            usdValue: (abortSignal, preFetchedUsdPrice) => this.wrapper.prices.getBtcUsdValue(this.networkFeeBtc, abortSignal, preFetchedUsdPrice)
        };
    }
    getFee() {
        return {
            amountInSrcToken: (0, Tokens_1.toTokenAmount)(this.swapFee + this.networkFee, this.wrapper.tokens[this.data.getToken()], this.wrapper.prices),
            amountInDstToken: (0, Tokens_1.toTokenAmount)(this.swapFeeBtc + this.networkFeeBtc, this.outputToken, this.wrapper.prices),
            usdValue: (abortSignal, preFetchedUsdPrice) => this.wrapper.prices.getBtcUsdValue(this.swapFeeBtc + this.networkFeeBtc, abortSignal, preFetchedUsdPrice)
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
                fee: this.getNetworkFee()
            }
        ];
    }
    getInput() {
        return (0, Tokens_1.toTokenAmount)(this.data.getAmount(), this.wrapper.tokens[this.data.getToken()], this.wrapper.prices);
    }
    getInputWithoutFee() {
        return (0, Tokens_1.toTokenAmount)(this.data.getAmount() - (this.swapFee + this.networkFee), this.wrapper.tokens[this.data.getToken()], this.wrapper.prices);
    }
    /**
     * Checks if the intiator/sender has enough balance to go through with the swap
     */
    async hasEnoughBalance() {
        const [balance, commitFee] = await Promise.all([
            this.wrapper.contract.getBalance(this._getInitiator(), this.data.getToken(), false),
            this.data.getToken() === this.wrapper.chain.getNativeCurrencyAddress() ? this.getCommitFee() : Promise.resolve(null)
        ]);
        let required = this.data.getAmount();
        if (commitFee != null)
            required = required + commitFee;
        return {
            enoughBalance: balance >= required,
            balance: (0, Tokens_1.toTokenAmount)(balance, this.wrapper.tokens[this.data.getToken()], this.wrapper.prices),
            required: (0, Tokens_1.toTokenAmount)(required, this.wrapper.tokens[this.data.getToken()], this.wrapper.prices)
        };
    }
    /**
     * Check if the initiator/sender has enough balance to cover the transaction fee for processing the swap
     */
    async hasEnoughForTxFees() {
        const [balance, commitFee] = await Promise.all([
            this.wrapper.contract.getBalance(this._getInitiator(), this.wrapper.chain.getNativeCurrencyAddress(), false),
            this.getCommitFee()
        ]);
        return {
            enoughBalance: balance >= commitFee,
            balance: (0, Tokens_1.toTokenAmount)(balance, this.wrapper.getNativeToken(), this.wrapper.prices),
            required: (0, Tokens_1.toTokenAmount)(commitFee, this.wrapper.getNativeToken(), this.wrapper.prices)
        };
    }
    //////////////////////////////
    //// Execution
    /**
     * Executes the swap with the provided smart chain wallet/signer
     *
     * @param signer Smart chain wallet/signer to use to sign the transaction on the source chain
     * @param callbacks Callbacks to track the progress of the swap
     * @param options Optional options for the swap like feeRate, AbortSignal, and timeouts/intervals
     *
     * @returns {boolean} Whether the swap was successfully processed by the LP, in case `false` is returned
     *  the user can refund their funds back on the source chain by calling `swap.refund()`
     */
    async execute(signer, callbacks, options) {
        if (this.state === ToBTCSwapState.QUOTE_EXPIRED || this.state === ToBTCSwapState.QUOTE_SOFT_EXPIRED)
            throw new Error("Quote expired");
        if (this.state === ToBTCSwapState.REFUNDED)
            throw new Error("Swap already refunded");
        if (this.state === ToBTCSwapState.REFUNDABLE)
            throw new Error("Swap refundable, refund with swap.refund()");
        if (this.state === ToBTCSwapState.SOFT_CLAIMED || this.state === ToBTCSwapState.CLAIMED)
            throw new Error("Swap already settled!");
        if (this.state === ToBTCSwapState.CREATED) {
            const txId = await this.commit(signer, options?.abortSignal, false, callbacks?.onSourceTransactionSent);
            if (callbacks?.onSourceTransactionConfirmed != null)
                callbacks.onSourceTransactionConfirmed(txId);
        }
        // @ts-ignore
        if (this.state === ToBTCSwapState.CLAIMED || this.state === ToBTCSwapState.SOFT_CLAIMED)
            return true;
        if (this.state === ToBTCSwapState.COMMITED) {
            const success = await this.waitForPayment(options?.maxWaitTillSwapProcessedSeconds ?? 120, options?.paymentCheckIntervalSeconds, options?.abortSignal);
            if (success) {
                if (callbacks?.onSwapSettled != null)
                    callbacks.onSwapSettled(this.getOutputTxId());
                return true;
            }
            else {
                return false;
            }
        }
    }
    //////////////////////////////
    //// Commit
    /**
     * Returns transactions for committing the swap on-chain, initiating the swap
     *
     * @param skipChecks Skip checks like making sure init signature is still valid and swap wasn't commited yet
     *  (this is handled on swap creation, if you commit right after quoting, you can use skipChecks=true)
     *
     * @throws {Error} When in invalid state (not PR_CREATED)
     */
    async txsCommit(skipChecks) {
        if (this.state !== ToBTCSwapState.CREATED)
            throw new Error("Must be in CREATED state!");
        if (!this.initiated) {
            this.initiated = true;
            await this._saveAndEmit();
        }
        return await this.wrapper.contract.txsInit(this._getInitiator(), this.data, this.signatureData, skipChecks, this.feeRate).catch(e => Promise.reject(e instanceof base_1.SignatureVerificationError ? new Error("Request timed out") : e));
    }
    /**
     * Commits the swap on-chain, initiating the swap
     *
     * @param _signer Signer to sign the transactions with, must be the same as used in the initialization
     * @param abortSignal Abort signal
     * @param skipChecks Skip checks like making sure init signature is still valid and swap wasn't commited yet
     *  (this is handled on swap creation, if you commit right after quoting, you can skipChecks)`
     * @param onBeforeTxSent
     * @throws {Error} If invalid signer is provided that doesn't match the swap data
     */
    async commit(_signer, abortSignal, skipChecks, onBeforeTxSent) {
        const signer = (0, base_1.isAbstractSigner)(_signer) ? _signer : await this.wrapper.chain.wrapSigner(_signer);
        this.checkSigner(signer);
        const txs = await this.txsCommit(skipChecks);
        let txCount = 0;
        const result = await this.wrapper.chain.sendAndConfirm(signer, txs, true, abortSignal, false, (txId, rawTx) => {
            txCount++;
            if (onBeforeTxSent != null && txCount === txs.length)
                onBeforeTxSent(txId);
            return Promise.resolve();
        });
        this.commitTxId = result[result.length - 1];
        if (this.state === ToBTCSwapState.CREATED || this.state === ToBTCSwapState.QUOTE_SOFT_EXPIRED || this.state === ToBTCSwapState.QUOTE_EXPIRED) {
            await this._saveAndEmit(ToBTCSwapState.COMMITED);
        }
        return this.commitTxId;
    }
    /**
     * Waits till a swap is committed, should be called after sending the commit transactions manually
     *
     * @param abortSignal   AbortSignal
     * @throws {Error} If swap is not in the correct state (must be CREATED)
     */
    async waitTillCommited(abortSignal) {
        if (this.state === ToBTCSwapState.COMMITED || this.state === ToBTCSwapState.CLAIMED)
            return Promise.resolve();
        if (this.state !== ToBTCSwapState.CREATED && this.state !== ToBTCSwapState.QUOTE_SOFT_EXPIRED)
            throw new Error("Invalid state (not CREATED)");
        const abortController = (0, Utils_1.extendAbortController)(abortSignal);
        let result;
        try {
            result = await Promise.race([
                this.watchdogWaitTillCommited(undefined, abortController.signal),
                this.waitTillState(ToBTCSwapState.COMMITED, "gte", abortController.signal).then(() => 0)
            ]);
            abortController.abort();
        }
        catch (e) {
            abortController.abort();
            throw e;
        }
        if (result === 0)
            this.logger.debug("waitTillCommited(): Resolved from state change");
        if (result === true)
            this.logger.debug("waitTillCommited(): Resolved from watchdog - commited");
        if (result === false) {
            this.logger.debug("waitTillCommited(): Resolved from watchdog - signature expiry");
            if (this.state === ToBTCSwapState.QUOTE_SOFT_EXPIRED || this.state === ToBTCSwapState.CREATED) {
                await this._saveAndEmit(ToBTCSwapState.QUOTE_EXPIRED);
            }
            throw new Error("Quote expired while waiting for transaction confirmation!");
        }
        if (this.state === ToBTCSwapState.QUOTE_SOFT_EXPIRED || this.state === ToBTCSwapState.CREATED || this.state === ToBTCSwapState.QUOTE_EXPIRED) {
            await this._saveAndEmit(ToBTCSwapState.COMMITED);
        }
    }
    //////////////////////////////
    //// Payment
    async waitTillIntermediarySwapProcessed(checkIntervalSeconds, abortSignal) {
        if (this.url == null)
            throw new Error("LP URL not specified!");
        checkIntervalSeconds ??= 5;
        let resp = { code: IntermediaryAPI_1.RefundAuthorizationResponseCodes.PENDING, msg: "" };
        while (!abortSignal.aborted && (resp.code === IntermediaryAPI_1.RefundAuthorizationResponseCodes.PENDING || resp.code === IntermediaryAPI_1.RefundAuthorizationResponseCodes.NOT_FOUND)) {
            resp = await IntermediaryAPI_1.IntermediaryAPI.getRefundAuthorization(this.url, this.getLpIdentifier(), this.data.getSequence());
            if (resp.code === IntermediaryAPI_1.RefundAuthorizationResponseCodes.PAID) {
                const validResponse = await this._setPaymentResult(resp.data, true);
                if (validResponse) {
                    if (this.state === ToBTCSwapState.COMMITED || this.state === ToBTCSwapState.REFUNDABLE) {
                        await this._saveAndEmit(ToBTCSwapState.SOFT_CLAIMED);
                    }
                }
                else {
                    resp = { code: IntermediaryAPI_1.RefundAuthorizationResponseCodes.PENDING, msg: "" };
                }
            }
            if (resp.code === IntermediaryAPI_1.RefundAuthorizationResponseCodes.PENDING ||
                resp.code === IntermediaryAPI_1.RefundAuthorizationResponseCodes.NOT_FOUND)
                await (0, Utils_1.timeoutPromise)(checkIntervalSeconds * 1000, abortSignal);
        }
        return resp;
    }
    /**
     * Checks whether the swap was already processed by the LP and is either successful (requires proof which is
     *  either a HTLC pre-image for LN swaps or valid txId for on-chain swap) or failed and we can cooperatively
     *  refund.
     *
     * @param save whether to save the data
     * @returns true if swap is processed, false if the swap is still ongoing
     * @private
     */
    async checkIntermediarySwapProcessed(save = true) {
        if (this.state === ToBTCSwapState.CREATED || this.state == ToBTCSwapState.QUOTE_EXPIRED || this.url == null)
            return false;
        if (this.isFinished() || this.isRefundable())
            return true;
        //Check if that maybe already concluded according to the LP
        const resp = await IntermediaryAPI_1.IntermediaryAPI.getRefundAuthorization(this.url, this.getLpIdentifier(), this.data.getSequence());
        switch (resp.code) {
            case IntermediaryAPI_1.RefundAuthorizationResponseCodes.PAID:
                const processed = await this._setPaymentResult(resp.data, true);
                if (processed) {
                    this.state = ToBTCSwapState.SOFT_CLAIMED;
                    if (save)
                        await this._saveAndEmit();
                }
                return processed;
            case IntermediaryAPI_1.RefundAuthorizationResponseCodes.REFUND_DATA:
                await (0, Utils_1.tryWithRetries)(() => this.wrapper.contract.isValidRefundAuthorization(this.data, resp.data), null, base_1.SignatureVerificationError);
                this.state = ToBTCSwapState.REFUNDABLE;
                if (save)
                    await this._saveAndEmit();
                return true;
            default:
                return false;
        }
    }
    /**
     * A blocking promise resolving when swap was concluded by the intermediary,
     *  rejecting in case of failure
     *
     * @param maxWaitTimeSeconds Maximum time in seconds to wait for the swap to be settled, an error is thrown if the
     *  swap is taking too long to claim
     * @param checkIntervalSeconds  How often to poll the intermediary for answer
     * @param abortSignal           Abort signal
     * @returns {Promise<boolean>}  Was the payment successful? If not we can refund.
     * @throws {IntermediaryError} If a swap is determined expired by the intermediary, but it is actually still valid
     * @throws {SignatureVerificationError} If the swap should be cooperatively refundable but the intermediary returned
     *  invalid refund signature
     * @throws {Error} When swap expires or if the swap has invalid state (must be COMMITED)
     */
    async waitForPayment(maxWaitTimeSeconds, checkIntervalSeconds, abortSignal) {
        if (this.state === ToBTCSwapState.CLAIMED)
            return Promise.resolve(true);
        if (this.state !== ToBTCSwapState.COMMITED && this.state !== ToBTCSwapState.SOFT_CLAIMED)
            throw new Error("Invalid state (not COMMITED)");
        const abortController = (0, Utils_1.extendAbortController)(abortSignal);
        let timedOut = false;
        if (maxWaitTimeSeconds != null) {
            const timeout = setTimeout(() => {
                timedOut = true;
                abortController.abort();
            }, maxWaitTimeSeconds * 1000);
            abortController.signal.addEventListener("abort", () => clearTimeout(timeout));
        }
        let result;
        try {
            result = await Promise.race([
                this.waitTillState(ToBTCSwapState.CLAIMED, "gte", abortController.signal),
                this.waitTillIntermediarySwapProcessed(checkIntervalSeconds, abortController.signal)
            ]);
            abortController.abort();
        }
        catch (e) {
            abortController.abort();
            if (timedOut) {
                throw new Error("Timed out while waiting for LP to process the swap, the LP might be unresponsive or offline!" +
                    ` Please check later or wait till ${new Date(Number(this.data.getExpiry()) * 1000).toLocaleString()} to refund unilaterally!`);
            }
            throw e;
        }
        if (typeof result !== "object") {
            if (this.state === ToBTCSwapState.REFUNDABLE)
                throw new Error("Swap expired");
            this.logger.debug("waitTillRefunded(): Resolved from state change");
            return true;
        }
        this.logger.debug("waitTillRefunded(): Resolved from intermediary response");
        switch (result.code) {
            case IntermediaryAPI_1.RefundAuthorizationResponseCodes.PAID:
                return true;
            case IntermediaryAPI_1.RefundAuthorizationResponseCodes.REFUND_DATA:
                const resultData = result.data;
                await (0, Utils_1.tryWithRetries)(() => this.wrapper.contract.isValidRefundAuthorization(this.data, resultData), null, base_1.SignatureVerificationError, abortSignal);
                await this._saveAndEmit(ToBTCSwapState.REFUNDABLE);
                return false;
            case IntermediaryAPI_1.RefundAuthorizationResponseCodes.EXPIRED:
                if (await this.wrapper.contract.isExpired(this._getInitiator(), this.data))
                    throw new Error("Swap expired");
                throw new IntermediaryError_1.IntermediaryError("Swap expired");
            case IntermediaryAPI_1.RefundAuthorizationResponseCodes.NOT_FOUND:
                if (this.state === ToBTCSwapState.CLAIMED)
                    return true;
                throw new Error("Intermediary swap not found");
        }
    }
    //////////////////////////////
    //// Refund
    /**
     * Get the estimated smart chain transaction fee of the refund transaction
     */
    getRefundFee() {
        return this.wrapper.contract.getRefundFee(this._getInitiator(), this.data);
    }
    /**
     * Returns transactions for refunding the swap if the swap is in refundable state, you can check so with isRefundable()
     *
     * @throws {IntermediaryError} If intermediary returns invalid response in case cooperative refund should be used
     * @throws {SignatureVerificationError} If intermediary returned invalid cooperative refund signature
     * @throws {Error} When state is not refundable
     */
    async txsRefund(signer) {
        if (!this.isRefundable())
            throw new Error("Must be in REFUNDABLE state or expired!");
        signer ??= this._getInitiator();
        if (await this.wrapper.contract.isExpired(this._getInitiator(), this.data)) {
            return await this.wrapper.contract.txsRefund(signer, this.data, true, true);
        }
        else {
            const res = await IntermediaryAPI_1.IntermediaryAPI.getRefundAuthorization(this.url, this.getLpIdentifier(), this.data.getSequence());
            if (res.code === IntermediaryAPI_1.RefundAuthorizationResponseCodes.REFUND_DATA) {
                return await this.wrapper.contract.txsRefundWithAuthorization(signer, this.data, res.data, true, true);
            }
            throw new IntermediaryError_1.IntermediaryError("Invalid intermediary cooperative message returned");
        }
    }
    /**
     * Refunds the swap if the swap is in refundable state, you can check so with isRefundable()
     *
     * @param _signer Signer to sign the transactions with, must be the same as used in the initialization
     * @param abortSignal               Abort signal
     * @throws {Error} If invalid signer is provided that doesn't match the swap data
     */
    async refund(_signer, abortSignal) {
        const signer = (0, base_1.isAbstractSigner)(_signer) ? _signer : await this.wrapper.chain.wrapSigner(_signer);
        const result = await this.wrapper.chain.sendAndConfirm(signer, await this.txsRefund(signer.getAddress()), true, abortSignal);
        this.refundTxId = result[0];
        if (this.state === ToBTCSwapState.COMMITED || this.state === ToBTCSwapState.REFUNDABLE || this.state === ToBTCSwapState.SOFT_CLAIMED) {
            await this._saveAndEmit(ToBTCSwapState.REFUNDED);
        }
        return result[0];
    }
    /**
     * Waits till a swap is refunded, should be called after sending the refund transactions manually
     *
     * @param abortSignal   AbortSignal
     * @throws {Error} When swap is not in a valid state (must be COMMITED)
     * @throws {Error} If we tried to refund but claimer was able to claim first
     */
    async waitTillRefunded(abortSignal) {
        if (this.state === ToBTCSwapState.REFUNDED)
            return Promise.resolve();
        if (this.state !== ToBTCSwapState.COMMITED && this.state !== ToBTCSwapState.SOFT_CLAIMED)
            throw new Error("Invalid state (not COMMITED)");
        const abortController = new AbortController();
        if (abortSignal != null)
            abortSignal.addEventListener("abort", () => abortController.abort(abortSignal.reason));
        const res = await Promise.race([
            this.watchdogWaitTillResult(undefined, abortController.signal),
            this.waitTillState(ToBTCSwapState.REFUNDED, "eq", abortController.signal).then(() => 0),
            this.waitTillState(ToBTCSwapState.CLAIMED, "eq", abortController.signal).then(() => 1),
        ]);
        abortController.abort();
        if (res === 0) {
            this.logger.debug("waitTillRefunded(): Resolved from state change (REFUNDED)");
            return;
        }
        if (res === 1) {
            this.logger.debug("waitTillRefunded(): Resolved from state change (CLAIMED)");
            throw new Error("Tried to refund swap, but claimer claimed it in the meantime!");
        }
        this.logger.debug("waitTillRefunded(): Resolved from watchdog");
        if (res?.type === base_1.SwapCommitStateType.PAID) {
            if (this.claimTxId == null)
                this.claimTxId = await res.getClaimTxId();
            await this._saveAndEmit(ToBTCSwapState.CLAIMED);
            throw new Error("Tried to refund swap, but claimer claimed it in the meantime!");
        }
        if (res?.type === base_1.SwapCommitStateType.NOT_COMMITED) {
            if (this.refundTxId == null && res.getRefundTxId != null)
                this.refundTxId = await res.getRefundTxId();
            await this._saveAndEmit(ToBTCSwapState.REFUNDED);
        }
    }
    //////////////////////////////
    //// Storage
    serialize() {
        const obj = super.serialize();
        return {
            ...obj,
            networkFee: this.networkFee == null ? null : this.networkFee.toString(10),
            networkFeeBtc: this.networkFeeBtc == null ? null : this.networkFeeBtc.toString(10)
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
        if (this.state === ToBTCSwapState.CREATED ||
            this.state === ToBTCSwapState.QUOTE_SOFT_EXPIRED ||
            this.state === ToBTCSwapState.COMMITED ||
            this.state === ToBTCSwapState.SOFT_CLAIMED ||
            this.state === ToBTCSwapState.REFUNDABLE) {
            let quoteExpired = false;
            if (this.state === ToBTCSwapState.CREATED || this.state === ToBTCSwapState.QUOTE_SOFT_EXPIRED) {
                //Check if quote is still valid
                quoteExpired = quoteDefinitelyExpired ?? await this._verifyQuoteDefinitelyExpired();
            }
            commitStatus ??= await (0, Utils_1.tryWithRetries)(() => this.wrapper.contract.getCommitStatus(this._getInitiator(), this.data));
            switch (commitStatus?.type) {
                case base_1.SwapCommitStateType.PAID:
                    if (this.claimTxId == null && commitStatus.getClaimTxId)
                        this.claimTxId = await commitStatus.getClaimTxId();
                    const eventResult = await commitStatus.getClaimResult();
                    try {
                        await this._setPaymentResult({ secret: eventResult, txId: Buffer.from(eventResult, "hex").reverse().toString("hex") });
                    }
                    catch (e) {
                        this.logger.error(`Failed to set payment result ${eventResult} on the swap!`);
                    }
                    this.state = ToBTCSwapState.CLAIMED;
                    return true;
                case base_1.SwapCommitStateType.REFUNDABLE:
                    this.state = ToBTCSwapState.REFUNDABLE;
                    return true;
                case base_1.SwapCommitStateType.EXPIRED:
                    if (this.refundTxId == null && commitStatus.getRefundTxId)
                        this.refundTxId = await commitStatus.getRefundTxId();
                    this.state = ToBTCSwapState.QUOTE_EXPIRED;
                    return true;
                case base_1.SwapCommitStateType.NOT_COMMITED:
                    if (this.refundTxId == null && commitStatus.getRefundTxId)
                        this.refundTxId = await commitStatus.getRefundTxId();
                    if (this.state === ToBTCSwapState.COMMITED || this.state === ToBTCSwapState.REFUNDABLE) {
                        this.state = ToBTCSwapState.REFUNDED;
                        return true;
                    }
                    break;
                case base_1.SwapCommitStateType.COMMITED:
                    if (this.state !== ToBTCSwapState.COMMITED && this.state !== ToBTCSwapState.REFUNDABLE) {
                        this.state = ToBTCSwapState.COMMITED;
                        return true;
                    }
                    break;
            }
            if ((this.state === ToBTCSwapState.CREATED || this.state === ToBTCSwapState.QUOTE_SOFT_EXPIRED)) {
                if (quoteExpired) {
                    this.state = ToBTCSwapState.QUOTE_EXPIRED;
                    return true;
                }
            }
        }
    }
    _shouldFetchCommitStatus() {
        return this.state === ToBTCSwapState.CREATED ||
            this.state === ToBTCSwapState.QUOTE_SOFT_EXPIRED ||
            this.state === ToBTCSwapState.COMMITED ||
            this.state === ToBTCSwapState.SOFT_CLAIMED ||
            this.state === ToBTCSwapState.REFUNDABLE;
    }
    _shouldFetchExpiryStatus() {
        return this.state === ToBTCSwapState.CREATED || this.state === ToBTCSwapState.QUOTE_SOFT_EXPIRED;
    }
    async _sync(save, quoteDefinitelyExpired, commitStatus) {
        let changed = await this.syncStateFromChain(quoteDefinitelyExpired, commitStatus);
        if (this.state === ToBTCSwapState.COMMITED || this.state === ToBTCSwapState.SOFT_CLAIMED) {
            //Check if that maybe already concluded
            try {
                if (await this.checkIntermediarySwapProcessed(false))
                    changed = true;
            }
            catch (e) {
                this.logger.error("_sync(): Failed to synchronize swap, error: ", e);
            }
        }
        if (save && changed)
            await this._saveAndEmit();
        return changed;
    }
    async _tick(save) {
        switch (this.state) {
            case ToBTCSwapState.CREATED:
                if (this.expiry < Date.now()) {
                    this.state = ToBTCSwapState.QUOTE_SOFT_EXPIRED;
                    if (save)
                        await this._saveAndEmit();
                    return true;
                }
                break;
            case ToBTCSwapState.COMMITED:
            case ToBTCSwapState.SOFT_CLAIMED:
                const expired = await this.wrapper.contract.isExpired(this._getInitiator(), this.data);
                if (expired) {
                    this.state = ToBTCSwapState.REFUNDABLE;
                    if (save)
                        await this._saveAndEmit();
                    return true;
                }
                break;
        }
        return false;
    }
}
exports.IToBTCSwap = IToBTCSwap;
var ToBTCSwapState;
(function (ToBTCSwapState) {
    ToBTCSwapState[ToBTCSwapState["REFUNDED"] = -3] = "REFUNDED";
    ToBTCSwapState[ToBTCSwapState["QUOTE_EXPIRED"] = -2] = "QUOTE_EXPIRED";
    ToBTCSwapState[ToBTCSwapState["QUOTE_SOFT_EXPIRED"] = -1] = "QUOTE_SOFT_EXPIRED";
    ToBTCSwapState[ToBTCSwapState["CREATED"] = 0] = "CREATED";
    ToBTCSwapState[ToBTCSwapState["COMMITED"] = 1] = "COMMITED";
    ToBTCSwapState[ToBTCSwapState["SOFT_CLAIMED"] = 2] = "SOFT_CLAIMED";
    ToBTCSwapState[ToBTCSwapState["CLAIMED"] = 3] = "CLAIMED";
    ToBTCSwapState[ToBTCSwapState["REFUNDABLE"] = 4] = "REFUNDABLE";
})(ToBTCSwapState = exports.ToBTCSwapState || (exports.ToBTCSwapState = {}));
