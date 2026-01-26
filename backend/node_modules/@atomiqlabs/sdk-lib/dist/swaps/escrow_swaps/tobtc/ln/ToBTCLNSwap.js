"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToBTCLNSwap = exports.isToBTCLNSwapInit = void 0;
const bolt11_1 = require("@atomiqlabs/bolt11");
const IToBTCSwap_1 = require("../IToBTCSwap");
const SwapType_1 = require("../../../enums/SwapType");
const buffer_1 = require("buffer");
const sha2_1 = require("@noble/hashes/sha2");
const IntermediaryError_1 = require("../../../../errors/IntermediaryError");
const LNURL_1 = require("../../../../utils/LNURL");
const Tokens_1 = require("../../../../Tokens");
const Utils_1 = require("../../../../utils/Utils");
function isToBTCLNSwapInit(obj) {
    return typeof (obj.confidence) === "number" &&
        (obj.pr == null || typeof (obj.pr) === "string") &&
        (obj.lnurl == null || typeof (obj.lnurl) === "string") &&
        (obj.successAction == null || (0, LNURL_1.isLNURLPaySuccessAction)(obj.successAction)) &&
        (0, IToBTCSwap_1.isIToBTCSwapInit)(obj);
}
exports.isToBTCLNSwapInit = isToBTCLNSwapInit;
//Set of nodes which disallow probing, resulting in 0 confidence reported by the LP
const SNOWFLAKE_LIST = new Set([
    "038f8f113c580048d847d6949371726653e02b928196bad310e3eda39ff61723f6",
    "03a6ce61fcaacd38d31d4e3ce2d506602818e3856b4b44faff1dde9642ba705976"
]);
class ToBTCLNSwap extends IToBTCSwap_1.IToBTCSwap {
    constructor(wrapper, initOrObj) {
        if (isToBTCLNSwapInit(initOrObj))
            initOrObj.url += "/tobtcln";
        super(wrapper, initOrObj);
        this.outputToken = Tokens_1.BitcoinTokens.BTCLN;
        this.TYPE = SwapType_1.SwapType.TO_BTCLN;
        if (!isToBTCLNSwapInit(initOrObj)) {
            this.confidence = initOrObj.confidence;
            this.pr = initOrObj.pr;
            this.lnurl = initOrObj.lnurl;
            this.successAction = initOrObj.successAction;
            this.secret = initOrObj.secret;
        }
        this.paymentHash = this.getPaymentHash().toString("hex");
        this.logger = (0, Utils_1.getLogger)("ToBTCLN(" + this.getIdentifierHashString() + "): ");
        this.tryRecomputeSwapPrice();
    }
    _setPaymentResult(result, check = false) {
        if (result == null)
            return Promise.resolve(false);
        if (result.secret == null)
            throw new IntermediaryError_1.IntermediaryError("No payment secret returned!");
        if (check) {
            const secretBuffer = buffer_1.Buffer.from(result.secret, "hex");
            const hash = buffer_1.Buffer.from((0, sha2_1.sha256)(secretBuffer));
            if (!hash.equals(this.getPaymentHash()))
                throw new IntermediaryError_1.IntermediaryError("Invalid payment secret returned");
        }
        this.secret = result.secret;
        return Promise.resolve(true);
    }
    //////////////////////////////
    //// Amounts & fees
    getOutput() {
        if (this.pr == null || !this.pr.startsWith("ln"))
            return (0, Tokens_1.toTokenAmount)(null, this.outputToken, this.wrapper.prices);
        const parsedPR = (0, bolt11_1.decode)(this.pr);
        const amount = (BigInt(parsedPR.millisatoshis) + 999n) / 1000n;
        return (0, Tokens_1.toTokenAmount)(amount, this.outputToken, this.wrapper.prices);
    }
    //////////////////////////////
    //// Getters & utils
    getOutputTxId() {
        return this.getLpIdentifier();
    }
    /**
     * Returns the lightning BOLT11 invoice where the BTC will be sent to
     */
    getOutputAddress() {
        return this.lnurl ?? this.pr;
    }
    /**
     * Returns payment secret (pre-image) as a proof of payment
     */
    getSecret() {
        return this.secret;
    }
    /**
     * Returns the confidence of the intermediary that this payment will succeed
     * Value between 0 and 1, where 0 is not likely and 1 is very likely
     */
    getConfidence() {
        return this.confidence;
    }
    /**
     * Checks whether a swap is likely to fail, based on the confidence as reported by the LP
     */
    willLikelyFail() {
        if (this.pr == null || !this.pr.startsWith("ln"))
            return false;
        const parsedRequest = (0, bolt11_1.decode)(this.pr);
        if (parsedRequest.tagsObject.routing_info != null) {
            for (let route of parsedRequest.tagsObject.routing_info) {
                if (SNOWFLAKE_LIST.has(route.pubkey)) {
                    return false;
                }
            }
        }
        return this.confidence === 0;
    }
    /**
     * Tries to detect if the target lightning invoice is a non-custodial mobile wallet, care must be taken
     *  for such a wallet to be online when attempting to make a swap
     */
    isPayingToNonCustodialWallet() {
        if (this.pr == null || !this.pr.startsWith("ln"))
            return false;
        const parsedRequest = (0, bolt11_1.decode)(this.pr);
        if (parsedRequest.tagsObject.routing_info != null) {
            return parsedRequest.tagsObject.routing_info.length > 0;
        }
        return false;
    }
    getIdentifierHash() {
        const paymentHashBuffer = this.getPaymentHash();
        if (this.randomNonce == null)
            return paymentHashBuffer;
        return buffer_1.Buffer.concat([paymentHashBuffer, buffer_1.Buffer.from(this.randomNonce, "hex")]);
    }
    getPaymentHash() {
        if (this.pr == null)
            return null;
        if (this.pr.startsWith("ln")) {
            const parsed = (0, bolt11_1.decode)(this.pr);
            return buffer_1.Buffer.from(parsed.tagsObject.payment_hash, "hex");
        }
        return buffer_1.Buffer.from(this.pr, "hex");
    }
    getLpIdentifier() {
        if (this.pr == null)
            return this.data.getEscrowHash();
        if (this.pr.startsWith("ln")) {
            const parsed = (0, bolt11_1.decode)(this.pr);
            return parsed.tagsObject.payment_hash;
        }
        return this.pr;
    }
    //////////////////////////////
    //// LNURL-pay
    /**
     * Is this an LNURL-pay swap?
     */
    isLNURL() {
        return this.lnurl != null;
    }
    /**
     * Gets the used LNURL or null if this is not an LNURL-pay swap
     */
    getLNURL() {
        return this.lnurl;
    }
    /**
     * Checks whether this LNURL payment contains a success message
     */
    hasSuccessAction() {
        return this.successAction != null;
    }
    /**
     * Returns the success action after a successful payment, else null
     */
    getSuccessAction() {
        return LNURL_1.LNURL.decodeSuccessAction(this.successAction, this.secret);
    }
    //////////////////////////////
    //// Storage
    serialize() {
        return {
            ...super.serialize(),
            paymentHash: this.getPaymentHash().toString("hex"),
            pr: this.pr,
            confidence: this.confidence,
            secret: this.secret,
            lnurl: this.lnurl,
            successAction: this.successAction
        };
    }
}
exports.ToBTCLNSwap = ToBTCLNSwap;
