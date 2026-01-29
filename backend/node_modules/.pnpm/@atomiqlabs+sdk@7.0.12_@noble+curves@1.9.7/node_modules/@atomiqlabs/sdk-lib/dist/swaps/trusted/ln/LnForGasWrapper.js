"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LnForGasWrapper = void 0;
const LnForGasSwap_1 = require("./LnForGasSwap");
const ISwapWrapper_1 = require("../../ISwapWrapper");
const TrustedIntermediaryAPI_1 = require("../../../intermediaries/TrustedIntermediaryAPI");
const bolt11_1 = require("@atomiqlabs/bolt11");
const IntermediaryError_1 = require("../../../errors/IntermediaryError");
const SwapType_1 = require("../../enums/SwapType");
class LnForGasWrapper extends ISwapWrapper_1.ISwapWrapper {
    constructor() {
        super(...arguments);
        this.TYPE = SwapType_1.SwapType.TRUSTED_FROM_BTCLN;
        this.swapDeserializer = LnForGasSwap_1.LnForGasSwap;
        this.pendingSwapStates = [LnForGasSwap_1.LnForGasSwapState.PR_CREATED];
        this.tickSwapState = null;
        this.processEvent = null;
    }
    /**
     * Returns a newly created swap, receiving 'amount' on lightning network
     *
     * @param signer
     * @param amount            Amount you wish to receive in base units (satoshis)
     * @param lpOrUrl           Intermediary/Counterparty swap service Intermediary object or raw url
     */
    async create(signer, amount, lpOrUrl) {
        if (!this.isInitialized)
            throw new Error("Not initialized, call init() first!");
        const lpUrl = typeof (lpOrUrl) === "string" ? lpOrUrl : lpOrUrl.url;
        const token = this.chain.getNativeCurrencyAddress();
        const resp = await TrustedIntermediaryAPI_1.TrustedIntermediaryAPI.initTrustedFromBTCLN(this.chainIdentifier, lpUrl, {
            address: signer,
            amount,
            token
        }, this.options.getRequestTimeout);
        const decodedPr = (0, bolt11_1.decode)(resp.pr);
        const amountIn = (BigInt(decodedPr.millisatoshis) + 999n) / 1000n;
        if (resp.total !== amount)
            throw new IntermediaryError_1.IntermediaryError("Invalid total returned");
        const pricingInfo = await this.verifyReturnedPrice(typeof (lpOrUrl) === "string" ?
            { swapFeePPM: 10000, swapBaseFee: 10 } :
            lpOrUrl.services[SwapType_1.SwapType.TRUSTED_FROM_BTCLN], false, amountIn, amount, token, {});
        const quote = new LnForGasSwap_1.LnForGasSwap(this, {
            pr: resp.pr,
            outputAmount: resp.total,
            recipient: signer,
            pricingInfo,
            url: lpUrl,
            expiry: decodedPr.timeExpireDate * 1000,
            swapFee: resp.swapFee,
            token,
            exactIn: false
        });
        await quote._save();
        return quote;
    }
}
exports.LnForGasWrapper = LnForGasWrapper;
