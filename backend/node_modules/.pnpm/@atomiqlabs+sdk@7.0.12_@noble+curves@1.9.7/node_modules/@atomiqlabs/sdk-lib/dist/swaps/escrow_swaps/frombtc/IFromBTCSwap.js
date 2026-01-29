"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IFromBTCSwap = void 0;
const ISwap_1 = require("../../ISwap");
const base_1 = require("@atomiqlabs/base");
const Tokens_1 = require("../../../Tokens");
const Fee_1 = require("../../fee/Fee");
const IEscrowSelfInitSwap_1 = require("../IEscrowSelfInitSwap");
class IFromBTCSwap extends IEscrowSelfInitSwap_1.IEscrowSelfInitSwap {
    constructor(wrapper, initOrObj) {
        super(wrapper, initOrObj);
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
    getSwapData() {
        return this.data;
    }
    _getInitiator() {
        return this.getSwapData().getClaimer();
    }
    getOutputTxId() {
        return this.claimTxId;
    }
    getOutputAddress() {
        return this._getInitiator();
    }
    requiresAction() {
        return this.isClaimable();
    }
    //////////////////////////////
    //// Amounts & fees
    getOutAmountWithoutFee() {
        return this.getSwapData().getAmount() + this.swapFee;
    }
    getSwapFee() {
        const feeWithoutBaseFee = this.swapFeeBtc - this.pricingInfo.satsBaseFee;
        const swapFeePPM = feeWithoutBaseFee * 1000000n / this.getInputWithoutFee().rawAmount;
        return {
            amountInSrcToken: (0, Tokens_1.toTokenAmount)(this.swapFeeBtc, this.inputToken, this.wrapper.prices),
            amountInDstToken: (0, Tokens_1.toTokenAmount)(this.swapFee, this.wrapper.tokens[this.getSwapData().getToken()], this.wrapper.prices),
            usdValue: (abortSignal, preFetchedUsdPrice) => this.wrapper.prices.getBtcUsdValue(this.swapFeeBtc, abortSignal, preFetchedUsdPrice),
            composition: {
                base: (0, Tokens_1.toTokenAmount)(this.pricingInfo.satsBaseFee, this.inputToken, this.wrapper.prices),
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
    getOutput() {
        return (0, Tokens_1.toTokenAmount)(this.getSwapData().getAmount(), this.wrapper.tokens[this.getSwapData().getToken()], this.wrapper.prices);
    }
    getInputWithoutFee() {
        return (0, Tokens_1.toTokenAmount)(this.getInput().rawAmount - this.swapFeeBtc, this.inputToken, this.wrapper.prices);
    }
    getSecurityDeposit() {
        return (0, Tokens_1.toTokenAmount)(this.getSwapData().getSecurityDeposit(), this.wrapper.getNativeToken(), this.wrapper.prices);
    }
    getTotalDeposit() {
        return (0, Tokens_1.toTokenAmount)(this.getSwapData().getTotalDeposit(), this.wrapper.getNativeToken(), this.wrapper.prices);
    }
    async hasEnoughForTxFees() {
        const [balance, commitFee] = await Promise.all([
            this.wrapper.contract.getBalance(this._getInitiator(), this.wrapper.chain.getNativeCurrencyAddress(), false),
            this.getCommitFee()
        ]);
        const totalFee = commitFee + this.getSwapData().getTotalDeposit();
        return {
            enoughBalance: balance >= totalFee,
            balance: (0, Tokens_1.toTokenAmount)(balance, this.wrapper.getNativeToken(), this.wrapper.prices),
            required: (0, Tokens_1.toTokenAmount)(totalFee, this.wrapper.getNativeToken(), this.wrapper.prices)
        };
    }
    //////////////////////////////
    //// Commit
    /**
     * Returns the transactions required for committing the swap on-chain, locking the tokens from the intermediary
     *  in an HTLC or PTLC
     *
     * @param skipChecks Skip checks like making sure init signature is still valid and swap wasn't commited yet
     *  (this is handled when swap is created (quoted), if you commit right after quoting, you can use skipChecks=true)
     * @throws {Error} When in invalid state to commit the swap
     */
    async txsCommit(skipChecks) {
        if (!this.canCommit())
            throw new Error("Must be in CREATED state!");
        if (!this.initiated) {
            this.initiated = true;
            await this._saveAndEmit();
        }
        return await this.wrapper.contract.txsInit(this._getInitiator(), this.data, this.signatureData, skipChecks, this.feeRate).catch(e => Promise.reject(e instanceof base_1.SignatureVerificationError ? new Error("Request timed out") : e));
    }
    //////////////////////////////
    //// Claim
    getClaimFee() {
        return this.wrapper.contract.getClaimFee(this._getInitiator(), this.getSwapData());
    }
}
exports.IFromBTCSwap = IFromBTCSwap;
