"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnchainForGasSwap = exports.isOnchainForGasSwapInit = exports.OnchainForGasSwapState = void 0;
const SwapType_1 = require("../../enums/SwapType");
const PaymentAuthError_1 = require("../../../errors/PaymentAuthError");
const Utils_1 = require("../../../utils/Utils");
const BitcoinUtils_1 = require("../../../utils/BitcoinUtils");
const BitcoinHelpers_1 = require("../../../utils/BitcoinHelpers");
const ISwap_1 = require("../../ISwap");
const TrustedIntermediaryAPI_1 = require("../../../intermediaries/TrustedIntermediaryAPI");
const Tokens_1 = require("../../../Tokens");
const Fee_1 = require("../../fee/Fee");
const IBitcoinWallet_1 = require("../../../btc/wallet/IBitcoinWallet");
const btc_signer_1 = require("@scure/btc-signer");
const SingleAddressBitcoinWallet_1 = require("../../../btc/wallet/SingleAddressBitcoinWallet");
const buffer_1 = require("buffer");
var OnchainForGasSwapState;
(function (OnchainForGasSwapState) {
    OnchainForGasSwapState[OnchainForGasSwapState["EXPIRED"] = -3] = "EXPIRED";
    OnchainForGasSwapState[OnchainForGasSwapState["FAILED"] = -2] = "FAILED";
    OnchainForGasSwapState[OnchainForGasSwapState["REFUNDED"] = -1] = "REFUNDED";
    OnchainForGasSwapState[OnchainForGasSwapState["PR_CREATED"] = 0] = "PR_CREATED";
    OnchainForGasSwapState[OnchainForGasSwapState["FINISHED"] = 1] = "FINISHED";
    OnchainForGasSwapState[OnchainForGasSwapState["REFUNDABLE"] = 2] = "REFUNDABLE";
})(OnchainForGasSwapState = exports.OnchainForGasSwapState || (exports.OnchainForGasSwapState = {}));
function isOnchainForGasSwapInit(obj) {
    return typeof (obj.paymentHash) === "string" &&
        typeof (obj.sequence) === "bigint" &&
        typeof (obj.address) === "string" &&
        typeof (obj.inputAmount) === "bigint" &&
        typeof (obj.outputAmount) === "bigint" &&
        typeof (obj.recipient) === "string" &&
        typeof (obj.token) === "string" &&
        (obj.refundAddress == null || typeof (obj.refundAddress) === "string") &&
        (0, ISwap_1.isISwapInit)(obj);
}
exports.isOnchainForGasSwapInit = isOnchainForGasSwapInit;
class OnchainForGasSwap extends ISwap_1.ISwap {
    constructor(wrapper, initOrObj) {
        if (isOnchainForGasSwapInit(initOrObj))
            initOrObj.url += "/frombtc_trusted";
        super(wrapper, initOrObj);
        this.getSmartChainNetworkFee = null;
        this.TYPE = SwapType_1.SwapType.TRUSTED_FROM_BTC;
        if (isOnchainForGasSwapInit(initOrObj)) {
            this.state = OnchainForGasSwapState.PR_CREATED;
        }
        else {
            this.paymentHash = initOrObj.paymentHash;
            this.sequence = initOrObj.sequence == null ? null : BigInt(initOrObj.sequence);
            this.address = initOrObj.address;
            this.inputAmount = initOrObj.inputAmount == null ? null : BigInt(initOrObj.inputAmount);
            this.outputAmount = initOrObj.outputAmount == null ? null : BigInt(initOrObj.outputAmount);
            this.recipient = initOrObj.recipient;
            this.token = initOrObj.token;
            this.refundAddress = initOrObj.refundAddress;
            this.scTxId = initOrObj.scTxId;
            this.txId = initOrObj.txId;
            this.refundTxId = initOrObj.refundTxId;
        }
        this.logger = (0, Utils_1.getLogger)("OnchainForGas(" + this.getId() + "): ");
        this.tryRecomputeSwapPrice();
    }
    upgradeVersion() {
        if (this.version == null) {
            //Noop
            this.version = 1;
        }
    }
    /**
     * In case swapFee in BTC is not supplied it recalculates it based on swap price
     * @protected
     */
    tryRecomputeSwapPrice() {
        if (this.swapFeeBtc == null) {
            this.swapFeeBtc = this.swapFee * this.getInput().rawAmount / this.getOutAmountWithoutFee();
        }
        super.tryRecomputeSwapPrice();
    }
    //////////////////////////////
    //// Getters & utils
    _getEscrowHash() {
        return this.paymentHash;
    }
    getOutputAddress() {
        return this.recipient;
    }
    getInputTxId() {
        return this.txId;
    }
    getOutputTxId() {
        return this.scTxId;
    }
    getId() {
        return this.paymentHash;
    }
    getAddress() {
        return this.address;
    }
    getHyperlink() {
        return "bitcoin:" + this.address + "?amount=" + encodeURIComponent((Number(this.inputAmount) / 100000000).toString(10));
    }
    requiresAction() {
        return this.state === OnchainForGasSwapState.REFUNDABLE;
    }
    isFinished() {
        return this.state === OnchainForGasSwapState.FINISHED || this.state === OnchainForGasSwapState.FAILED || this.state === OnchainForGasSwapState.EXPIRED || this.state === OnchainForGasSwapState.REFUNDED;
    }
    isQuoteExpired() {
        return this.state === OnchainForGasSwapState.EXPIRED;
    }
    isQuoteSoftExpired() {
        return this.expiry < Date.now();
    }
    isFailed() {
        return this.state === OnchainForGasSwapState.FAILED;
    }
    isSuccessful() {
        return this.state === OnchainForGasSwapState.FINISHED;
    }
    verifyQuoteValid() {
        return Promise.resolve(this.expiry > Date.now());
    }
    //////////////////////////////
    //// Amounts & fees
    getOutAmountWithoutFee() {
        return this.outputAmount + this.swapFee;
    }
    getOutput() {
        return (0, Tokens_1.toTokenAmount)(this.outputAmount, this.wrapper.tokens[this.wrapper.chain.getNativeCurrencyAddress()], this.wrapper.prices);
    }
    getInput() {
        return (0, Tokens_1.toTokenAmount)(this.inputAmount, Tokens_1.BitcoinTokens.BTC, this.wrapper.prices);
    }
    getInputWithoutFee() {
        return (0, Tokens_1.toTokenAmount)(this.inputAmount - this.swapFeeBtc, Tokens_1.BitcoinTokens.BTC, this.wrapper.prices);
    }
    getSwapFee() {
        const feeWithoutBaseFee = this.swapFeeBtc - this.pricingInfo.satsBaseFee;
        const swapFeePPM = feeWithoutBaseFee * 1000000n / this.getInputWithoutFee().rawAmount;
        return {
            amountInSrcToken: (0, Tokens_1.toTokenAmount)(this.swapFeeBtc, Tokens_1.BitcoinTokens.BTC, this.wrapper.prices),
            amountInDstToken: (0, Tokens_1.toTokenAmount)(this.swapFee, this.wrapper.tokens[this.wrapper.chain.getNativeCurrencyAddress()], this.wrapper.prices),
            usdValue: (abortSignal, preFetchedUsdPrice) => this.wrapper.prices.getBtcUsdValue(this.swapFeeBtc, abortSignal, preFetchedUsdPrice),
            composition: {
                base: (0, Tokens_1.toTokenAmount)(this.pricingInfo.satsBaseFee, Tokens_1.BitcoinTokens.BTC, this.wrapper.prices),
                percentage: (0, ISwap_1.ppmToPercentage)(swapFeePPM)
            }
        };
    }
    getFee() {
        return this.getSwapFee();
    }
    getFeeBreakdown() {
        return [{
                type: Fee_1.FeeType.SWAP,
                fee: this.getSwapFee()
            }];
    }
    getRequiredConfirmationsCount() {
        return 1;
    }
    /**
     * Returns the PSBT that is already funded with wallet's UTXOs (runs a coin-selection algorithm to choose UTXOs to use),
     *  also returns inputs indices that need to be signed by the wallet before submitting the PSBT back to the SDK with
     *  `swap.submitPsbt()`
     *
     * @param _bitcoinWallet Sender's bitcoin wallet
     * @param feeRate Optional fee rate for the transaction, needs to be at least as big as {minimumBtcFeeRate} field
     * @param additionalOutputs additional outputs to add to the PSBT - can be used to collect fees from users
     */
    async getFundedPsbt(_bitcoinWallet, feeRate, additionalOutputs) {
        if (this.state !== OnchainForGasSwapState.PR_CREATED)
            throw new Error("Swap already paid for!");
        let bitcoinWallet;
        if ((0, IBitcoinWallet_1.isIBitcoinWallet)(_bitcoinWallet)) {
            bitcoinWallet = _bitcoinWallet;
        }
        else {
            bitcoinWallet = new SingleAddressBitcoinWallet_1.SingleAddressBitcoinWallet(this.wrapper.btcRpc, this.wrapper.options.bitcoinNetwork, _bitcoinWallet);
        }
        //TODO: Maybe re-introduce fee rate check here if passed from the user
        if (feeRate == null) {
            feeRate = await bitcoinWallet.getFeeRate();
        }
        const basePsbt = new btc_signer_1.Transaction({
            allowUnknownOutputs: true,
            allowLegacyWitnessUtxo: true
        });
        basePsbt.addOutput({
            amount: this.outputAmount,
            script: (0, BitcoinUtils_1.toOutputScript)(this.wrapper.options.bitcoinNetwork, this.address)
        });
        if (additionalOutputs != null)
            additionalOutputs.forEach(output => {
                basePsbt.addOutput({
                    amount: output.amount,
                    script: output.outputScript ?? (0, BitcoinUtils_1.toOutputScript)(this.wrapper.options.bitcoinNetwork, output.address)
                });
            });
        const psbt = await bitcoinWallet.fundPsbt(basePsbt, feeRate);
        //Sign every input
        const signInputs = [];
        for (let i = 0; i < psbt.inputsLength; i++) {
            signInputs.push(i);
        }
        const serializedPsbt = buffer_1.Buffer.from(psbt.toPSBT());
        return {
            psbt,
            psbtHex: serializedPsbt.toString("hex"),
            psbtBase64: serializedPsbt.toString("base64"),
            signInputs
        };
    }
    /**
     * Submits a PSBT signed by the wallet back to the SDK
     *
     * @param _psbt A psbt - either a Transaction object or a hex or base64 encoded PSBT string
     */
    async submitPsbt(_psbt) {
        const psbt = (0, BitcoinHelpers_1.parsePsbtTransaction)(_psbt);
        if (this.state !== OnchainForGasSwapState.PR_CREATED)
            throw new Error("Swap already paid for!");
        //Ensure not expired
        if (this.expiry < Date.now()) {
            throw new Error("Swap expired!");
        }
        const output0 = psbt.getOutput(0);
        if (output0.amount !== this.outputAmount)
            throw new Error("PSBT output amount invalid, expected: " + this.outputAmount + " got: " + output0.amount);
        const expectedOutputScript = (0, BitcoinUtils_1.toOutputScript)(this.wrapper.options.bitcoinNetwork, this.address);
        if (!expectedOutputScript.equals(output0.script))
            throw new Error("PSBT output script invalid!");
        if (!psbt.isFinal)
            psbt.finalize();
        return await this.wrapper.btcRpc.sendRawTransaction(buffer_1.Buffer.from(psbt.toBytes(true, true)).toString("hex"));
    }
    async estimateBitcoinFee(_bitcoinWallet, feeRate) {
        const bitcoinWallet = (0, BitcoinHelpers_1.toBitcoinWallet)(_bitcoinWallet, this.wrapper.btcRpc, this.wrapper.options.bitcoinNetwork);
        const txFee = await bitcoinWallet.getTransactionFee(this.address, this.inputAmount, feeRate);
        return (0, Tokens_1.toTokenAmount)(txFee == null ? null : BigInt(txFee), Tokens_1.BitcoinTokens.BTC, this.wrapper.prices);
    }
    async sendBitcoinTransaction(wallet, feeRate) {
        if (this.state !== OnchainForGasSwapState.PR_CREATED)
            throw new Error("Swap already paid for!");
        //Ensure not expired
        if (this.expiry < Date.now()) {
            throw new Error("Swap expired!");
        }
        if ((0, IBitcoinWallet_1.isIBitcoinWallet)(wallet)) {
            return await wallet.sendTransaction(this.address, this.inputAmount, feeRate);
        }
        else {
            const { psbt, psbtHex, psbtBase64, signInputs } = await this.getFundedPsbt(wallet, feeRate);
            const signedPsbt = await wallet.signPsbt({
                psbt, psbtHex, psbtBase64
            }, signInputs);
            return await this.submitPsbt(signedPsbt);
        }
    }
    //////////////////////////////
    //// Payment
    async checkAddress(save = true) {
        if (this.state === OnchainForGasSwapState.FAILED ||
            this.state === OnchainForGasSwapState.EXPIRED ||
            this.state === OnchainForGasSwapState.REFUNDED)
            return false;
        if (this.state === OnchainForGasSwapState.FINISHED)
            return false;
        const response = await TrustedIntermediaryAPI_1.TrustedIntermediaryAPI.getAddressStatus(this.url, this.paymentHash, this.sequence, this.wrapper.options.getRequestTimeout);
        switch (response.code) {
            case TrustedIntermediaryAPI_1.AddressStatusResponseCodes.AWAIT_PAYMENT:
                if (this.txId != null) {
                    this.txId = null;
                    if (save)
                        await this._save();
                    return true;
                }
                return false;
            case TrustedIntermediaryAPI_1.AddressStatusResponseCodes.AWAIT_CONFIRMATION:
            case TrustedIntermediaryAPI_1.AddressStatusResponseCodes.PENDING:
            case TrustedIntermediaryAPI_1.AddressStatusResponseCodes.TX_SENT:
                const inputAmount = BigInt(response.data.adjustedAmount);
                const outputAmount = BigInt(response.data.adjustedTotal);
                const adjustedFee = response.data.adjustedFee == null ? null : BigInt(response.data.adjustedFee);
                const adjustedFeeSats = response.data.adjustedFeeSats == null ? null : BigInt(response.data.adjustedFeeSats);
                const txId = response.data.txId;
                if (this.txId != txId ||
                    this.inputAmount !== inputAmount ||
                    this.outputAmount !== outputAmount) {
                    this.txId = txId;
                    this.inputAmount = inputAmount;
                    this.outputAmount = outputAmount;
                    if (adjustedFee != null)
                        this.swapFee = adjustedFee;
                    if (adjustedFeeSats != null)
                        this.swapFeeBtc = adjustedFeeSats;
                    if (save)
                        await this._save();
                    return true;
                }
                return false;
            case TrustedIntermediaryAPI_1.AddressStatusResponseCodes.PAID:
                const txStatus = await this.wrapper.chain.getTxIdStatus(response.data.txId);
                if (txStatus === "success") {
                    this.state = OnchainForGasSwapState.FINISHED;
                    this.scTxId = response.data.txId;
                    if (save)
                        await this._saveAndEmit();
                    return true;
                }
                return false;
            case TrustedIntermediaryAPI_1.AddressStatusResponseCodes.EXPIRED:
                this.state = OnchainForGasSwapState.EXPIRED;
                if (save)
                    await this._saveAndEmit();
                return true;
            case TrustedIntermediaryAPI_1.AddressStatusResponseCodes.REFUNDABLE:
                if (this.state === OnchainForGasSwapState.REFUNDABLE)
                    return null;
                this.state = OnchainForGasSwapState.REFUNDABLE;
                if (save)
                    await this._saveAndEmit();
                return true;
            case TrustedIntermediaryAPI_1.AddressStatusResponseCodes.REFUNDED:
                this.state = OnchainForGasSwapState.REFUNDED;
                this.refundTxId = response.data.txId;
                if (save)
                    await this._saveAndEmit();
                return true;
            default:
                this.state = OnchainForGasSwapState.FAILED;
                if (save)
                    await this._saveAndEmit();
                return true;
        }
    }
    async setRefundAddress(refundAddress) {
        if (this.refundAddress != null) {
            if (this.refundAddress !== refundAddress)
                throw new Error("Different refund address already set!");
            return;
        }
        await TrustedIntermediaryAPI_1.TrustedIntermediaryAPI.setRefundAddress(this.url, this.paymentHash, this.sequence, refundAddress, this.wrapper.options.getRequestTimeout);
        this.refundAddress = refundAddress;
    }
    /**
     * A blocking promise resolving when payment was received by the intermediary and client can continue
     * rejecting in case of failure
     *
     * @param abortSignal Abort signal
     * @param checkIntervalSeconds How often to poll the intermediary for answer
     * @param updateCallback Callback called when txId is found, and also called with subsequent confirmations
     * @throws {PaymentAuthError} If swap expired or failed
     * @throws {Error} When in invalid state (not PR_CREATED)
     */
    async waitForBitcoinTransaction(updateCallback, checkIntervalSeconds = 5, abortSignal) {
        if (this.state !== OnchainForGasSwapState.PR_CREATED)
            throw new Error("Must be in PR_CREATED state!");
        if (!this.initiated) {
            this.initiated = true;
            await this._saveAndEmit();
        }
        while (!abortSignal.aborted &&
            this.state === OnchainForGasSwapState.PR_CREATED) {
            await this.checkAddress(true);
            if (this.txId != null && updateCallback != null) {
                const res = await this.wrapper.btcRpc.getTransaction(this.txId);
                if (res == null) {
                    updateCallback(null, null, 1, null);
                }
                else if (res.confirmations > 0) {
                    updateCallback(res.txid, res.confirmations, 1, 0);
                }
                else {
                    const delay = await this.wrapper.btcRpc.getConfirmationDelay(res, 1);
                    updateCallback(res.txid, 0, 1, delay);
                }
            }
            if (this.state === OnchainForGasSwapState.PR_CREATED)
                await (0, Utils_1.timeoutPromise)(checkIntervalSeconds * 1000, abortSignal);
        }
        if (this.state === OnchainForGasSwapState.REFUNDABLE ||
            this.state === OnchainForGasSwapState.REFUNDED)
            return this.txId;
        if (this.isQuoteExpired())
            throw new PaymentAuthError_1.PaymentAuthError("Swap expired");
        if (this.isFailed())
            throw new PaymentAuthError_1.PaymentAuthError("Swap failed");
        return this.txId;
    }
    async waitTillRefunded(checkIntervalSeconds, abortSignal) {
        checkIntervalSeconds ??= 5;
        if (this.state === OnchainForGasSwapState.REFUNDED)
            return;
        if (this.state !== OnchainForGasSwapState.REFUNDABLE)
            throw new Error("Must be in REFUNDABLE state!");
        while (!abortSignal.aborted &&
            this.state === OnchainForGasSwapState.REFUNDABLE) {
            await this.checkAddress(true);
            if (this.state === OnchainForGasSwapState.REFUNDABLE)
                await (0, Utils_1.timeoutPromise)(checkIntervalSeconds * 1000, abortSignal);
        }
        if (this.isQuoteExpired())
            throw new PaymentAuthError_1.PaymentAuthError("Swap expired");
        if (this.isFailed())
            throw new PaymentAuthError_1.PaymentAuthError("Swap failed");
    }
    async requestRefund(refundAddress, abortSignal) {
        if (refundAddress != null)
            await this.setRefundAddress(refundAddress);
        await this.waitTillRefunded(undefined, abortSignal);
    }
    //////////////////////////////
    //// Storage
    serialize() {
        return {
            ...super.serialize(),
            paymentHash: this.paymentHash,
            sequence: this.sequence == null ? null : this.sequence.toString(10),
            address: this.address,
            inputAmount: this.inputAmount == null ? null : this.inputAmount.toString(10),
            outputAmount: this.outputAmount == null ? null : this.outputAmount.toString(10),
            recipient: this.recipient,
            token: this.token,
            refundAddress: this.refundAddress,
            scTxId: this.scTxId,
            txId: this.txId,
            refundTxId: this.refundTxId,
        };
    }
    _getInitiator() {
        return this.recipient;
    }
    //////////////////////////////
    //// Swap ticks & sync
    async _sync(save) {
        if (this.state === OnchainForGasSwapState.PR_CREATED) {
            //Check if it's maybe already paid
            const result = await this.checkAddress(false);
            if (result) {
                if (save)
                    await this._saveAndEmit();
                return true;
            }
        }
        return false;
    }
    _tick(save) {
        return Promise.resolve(false);
    }
}
exports.OnchainForGasSwap = OnchainForGasSwap;
