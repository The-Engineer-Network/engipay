"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToBTCSwap = exports.isToBTCSwapInit = void 0;
const IToBTCSwap_1 = require("../IToBTCSwap");
const SwapType_1 = require("../../../enums/SwapType");
const buffer_1 = require("buffer");
const IntermediaryError_1 = require("../../../../errors/IntermediaryError");
const Tokens_1 = require("../../../../Tokens");
const Utils_1 = require("../../../../utils/Utils");
function isToBTCSwapInit(obj) {
    return typeof (obj.address) === "string" &&
        typeof (obj.amount) === "bigint" &&
        typeof (obj.confirmationTarget) === "number" &&
        typeof (obj.satsPerVByte) === "number" &&
        (0, IToBTCSwap_1.isIToBTCSwapInit)(obj);
}
exports.isToBTCSwapInit = isToBTCSwapInit;
class ToBTCSwap extends IToBTCSwap_1.IToBTCSwap {
    constructor(wrapper, initOrObject) {
        if (isToBTCSwapInit(initOrObject))
            initOrObject.url += "/tobtc";
        super(wrapper, initOrObject);
        this.outputToken = Tokens_1.BitcoinTokens.BTC;
        this.TYPE = SwapType_1.SwapType.TO_BTC;
        if (!isToBTCSwapInit(initOrObject)) {
            this.address = initOrObject.address;
            this.amount = BigInt(initOrObject.amount);
            this.confirmationTarget = initOrObject.confirmationTarget;
            this.satsPerVByte = initOrObject.satsPerVByte;
            this.txId = initOrObject.txId;
            this.requiredConfirmations = initOrObject.requiredConfirmations ?? this.data.getConfirmationsHint();
            this.nonce = (initOrObject.nonce == null ? null : BigInt(initOrObject.nonce)) ?? this.data.getNonceHint();
        }
        this.logger = (0, Utils_1.getLogger)("ToBTC(" + this.getIdentifierHashString() + "): ");
        this.tryRecomputeSwapPrice();
    }
    async _setPaymentResult(result, check = false) {
        if (result == null)
            return false;
        if (result.txId == null)
            throw new IntermediaryError_1.IntermediaryError("No btc txId returned!");
        if (check) {
            const btcTx = await this.wrapper.btcRpc.getTransaction(result.txId);
            if (btcTx == null)
                return false;
            const foundVout = btcTx.outs.find(vout => this.data.getClaimHash() === this.wrapper.contract.getHashForOnchain(buffer_1.Buffer.from(vout.scriptPubKey.hex, "hex"), BigInt(vout.value), this.requiredConfirmations, this.nonce).toString("hex"));
            if (foundVout == null)
                throw new IntermediaryError_1.IntermediaryError("Invalid btc txId returned");
        }
        this.txId = result.txId;
        return true;
    }
    //////////////////////////////
    //// Amounts & fees
    getOutput() {
        return (0, Tokens_1.toTokenAmount)(this.amount, this.outputToken, this.wrapper.prices);
    }
    //////////////////////////////
    //// Getters & utils
    /**
     * Returns the bitcoin address where the BTC will be sent to
     */
    getOutputAddress() {
        return this.address;
    }
    getOutputTxId() {
        return this.txId;
    }
    /**
     * Returns fee rate of the bitcoin transaction in sats/vB
     */
    getBitcoinFeeRate() {
        return this.satsPerVByte;
    }
    //////////////////////////////
    //// Storage
    serialize() {
        return {
            ...super.serialize(),
            address: this.address,
            amount: this.amount.toString(10),
            confirmationTarget: this.confirmationTarget,
            satsPerVByte: this.satsPerVByte,
            nonce: this.nonce == null ? null : this.nonce.toString(10),
            requiredConfirmations: this.requiredConfirmations,
            txId: this.txId
        };
    }
}
exports.ToBTCSwap = ToBTCSwap;
