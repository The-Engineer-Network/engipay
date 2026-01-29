"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ISwap = exports.ppmToPercentage = exports.isISwapInit = void 0;
const SwapType_1 = require("./enums/SwapType");
const events_1 = require("events");
const ISwapPrice_1 = require("../prices/abstract/ISwapPrice");
const Utils_1 = require("../utils/Utils");
const SwapDirection_1 = require("./enums/SwapDirection");
function isISwapInit(obj) {
    return typeof obj === 'object' &&
        obj != null &&
        (0, ISwapPrice_1.isPriceInfoType)(obj.pricingInfo) &&
        (obj.url == null || typeof obj.url === 'string') &&
        typeof obj.expiry === 'number' &&
        typeof (obj.swapFee) === "bigint" &&
        (obj.swapFeeBtc == null || typeof (obj.swapFeeBtc) === "bigint") &&
        (typeof obj.exactIn === 'boolean');
}
exports.isISwapInit = isISwapInit;
function ppmToPercentage(ppm) {
    if (ppm == null)
        return null;
    const percentage = Number(ppm) / 10000;
    return {
        ppm,
        decimal: Number(ppm) / 1000000,
        percentage: percentage,
        toString: (decimals) => (decimals != null ? percentage.toFixed(decimals) : percentage) + "%"
    };
}
exports.ppmToPercentage = ppmToPercentage;
class ISwap {
    constructor(wrapper, swapInitOrObj) {
        this.currentVersion = 1;
        this.initiated = false;
        /**
         * Event emitter emitting "swapState" event when swap's state changes
         */
        this.events = new events_1.EventEmitter();
        this.chainIdentifier = wrapper.chainIdentifier;
        this.wrapper = wrapper;
        if (isISwapInit(swapInitOrObj)) {
            Object.assign(this, swapInitOrObj);
            this.version = this.currentVersion;
            this.createdAt = Date.now();
            this.randomNonce = (0, Utils_1.randomBytes)(16).toString("hex");
        }
        else {
            this.expiry = swapInitOrObj.expiry;
            this.url = swapInitOrObj.url;
            this.state = swapInitOrObj.state;
            this.pricingInfo = {
                isValid: swapInitOrObj._isValid,
                differencePPM: swapInitOrObj._differencePPM == null ? null : BigInt(swapInitOrObj._differencePPM),
                satsBaseFee: swapInitOrObj._satsBaseFee == null ? null : BigInt(swapInitOrObj._satsBaseFee),
                feePPM: swapInitOrObj._feePPM == null ? null : BigInt(swapInitOrObj._feePPM),
                realPriceUSatPerToken: swapInitOrObj._realPriceUSatPerToken == null ? null : BigInt(swapInitOrObj._realPriceUSatPerToken),
                swapPriceUSatPerToken: swapInitOrObj._swapPriceUSatPerToken == null ? null : BigInt(swapInitOrObj._swapPriceUSatPerToken),
            };
            this.swapFee = swapInitOrObj.swapFee == null ? null : BigInt(swapInitOrObj.swapFee);
            this.swapFeeBtc = swapInitOrObj.swapFeeBtc == null ? null : BigInt(swapInitOrObj.swapFeeBtc);
            this.version = swapInitOrObj.version;
            this.initiated = swapInitOrObj.initiated;
            this.exactIn = swapInitOrObj.exactIn;
            this.createdAt = swapInitOrObj.createdAt ?? swapInitOrObj.expiry;
            this.randomNonce = swapInitOrObj.randomNonce;
        }
        if (this.version !== this.currentVersion) {
            this.upgradeVersion();
        }
        if (this.initiated == null)
            this.initiated = true;
    }
    /**
     * Waits till the swap reaches a specific state
     *
     * @param targetState The state to wait for
     * @param type Whether to wait for the state exactly or also to a state with a higher number
     * @param abortSignal
     * @protected
     */
    waitTillState(targetState, type = "eq", abortSignal) {
        return new Promise((resolve, reject) => {
            let listener;
            listener = (swap) => {
                if (type === "eq" ? swap.state === targetState : type === "gte" ? swap.state >= targetState : swap.state != targetState) {
                    resolve();
                    this.events.removeListener("swapState", listener);
                }
            };
            this.events.on("swapState", listener);
            if (abortSignal != null)
                abortSignal.addEventListener("abort", () => {
                    this.events.removeListener("swapState", listener);
                    reject(abortSignal.reason);
                });
        });
    }
    //////////////////////////////
    //// Pricing
    tryRecomputeSwapPrice() {
        if (this.pricingInfo.swapPriceUSatPerToken == null) {
            if (this.getDirection() === SwapDirection_1.SwapDirection.TO_BTC) {
                const input = this.getInput();
                this.pricingInfo = this.wrapper.prices.recomputePriceInfoSend(this.chainIdentifier, this.getOutput().rawAmount, this.pricingInfo.satsBaseFee, this.pricingInfo.feePPM, input.rawAmount, input.token.address);
            }
            else {
                const output = this.getOutput();
                this.pricingInfo = this.wrapper.prices.recomputePriceInfoReceive(this.chainIdentifier, this.getInput().rawAmount, this.pricingInfo.satsBaseFee, this.pricingInfo.feePPM, output.rawAmount, output.token.address);
            }
        }
    }
    /**
     * Re-fetches & revalidates the price data
     */
    async refreshPriceData() {
        if (this.pricingInfo == null)
            return null;
        if (this.getDirection() === SwapDirection_1.SwapDirection.TO_BTC) {
            const input = this.getInput();
            this.pricingInfo = await this.wrapper.prices.isValidAmountSend(this.chainIdentifier, this.getOutput().rawAmount, this.pricingInfo.satsBaseFee, this.pricingInfo.feePPM, input.rawAmount, input.token.address);
        }
        else {
            const output = this.getOutput();
            this.pricingInfo = await this.wrapper.prices.isValidAmountReceive(this.chainIdentifier, this.getInput().rawAmount, this.pricingInfo.satsBaseFee, this.pricingInfo.feePPM, output.rawAmount, output.token.address);
        }
    }
    /**
     * Checks if the pricing for the swap is valid, according to max allowed price difference set in the ISwapPrice
     */
    hasValidPrice() {
        return this.pricingInfo == null ? null : this.pricingInfo.isValid;
    }
    /**
     * Returns pricing info about the swap
     */
    getPriceInfo() {
        const swapPrice = this.getDirection() === SwapDirection_1.SwapDirection.TO_BTC ?
            100000000000000 / Number(this.pricingInfo.swapPriceUSatPerToken) :
            Number(this.pricingInfo.swapPriceUSatPerToken) / 100000000000000;
        const marketPrice = this.getDirection() === SwapDirection_1.SwapDirection.TO_BTC ?
            100000000000000 / Number(this.pricingInfo.realPriceUSatPerToken) :
            Number(this.pricingInfo.realPriceUSatPerToken) / 100000000000000;
        return {
            marketPrice,
            swapPrice,
            difference: ppmToPercentage(this.pricingInfo.differencePPM)
        };
    }
    /**
     * @param signer Signer to check with this swap's initiator
     * @throws {Error} When signer's address doesn't match with the swap's initiator one
     */
    checkSigner(signer) {
        if ((typeof (signer) === "string" ? signer : signer.getAddress()) !== this._getInitiator())
            throw new Error("Invalid signer provided!");
    }
    isInitiated() {
        return this.initiated;
    }
    _setInitiated() {
        this.initiated = true;
    }
    /**
     * Returns quote expiry in UNIX millis
     */
    getQuoteExpiry() {
        return this.expiry;
    }
    /**
     * Returns the type of the swap
     */
    getType() {
        return this.TYPE;
    }
    /**
     * Returns the direction of the swap
     */
    getDirection() {
        return this.TYPE === SwapType_1.SwapType.TO_BTC || this.TYPE === SwapType_1.SwapType.TO_BTCLN ? SwapDirection_1.SwapDirection.TO_BTC : SwapDirection_1.SwapDirection.FROM_BTC;
    }
    /**
     * Returns the current state of the swap
     */
    getState() {
        return this.state;
    }
    //////////////////////////////
    //// Storage
    serialize() {
        if (this.pricingInfo == null)
            return {};
        return {
            id: this.getId(),
            type: this.getType(),
            escrowHash: this._getEscrowHash(),
            initiator: this._getInitiator(),
            _isValid: this.pricingInfo.isValid,
            _differencePPM: this.pricingInfo.differencePPM == null ? null : this.pricingInfo.differencePPM.toString(10),
            _satsBaseFee: this.pricingInfo.satsBaseFee == null ? null : this.pricingInfo.satsBaseFee.toString(10),
            _feePPM: this.pricingInfo.feePPM == null ? null : this.pricingInfo.feePPM.toString(10),
            _realPriceUSatPerToken: this.pricingInfo.realPriceUSatPerToken == null ? null : this.pricingInfo.realPriceUSatPerToken.toString(10),
            _swapPriceUSatPerToken: this.pricingInfo.swapPriceUSatPerToken == null ? null : this.pricingInfo.swapPriceUSatPerToken.toString(10),
            state: this.state,
            url: this.url,
            swapFee: this.swapFee == null ? null : this.swapFee.toString(10),
            swapFeeBtc: this.swapFeeBtc == null ? null : this.swapFeeBtc.toString(10),
            expiry: this.expiry,
            version: this.version,
            initiated: this.initiated,
            exactIn: this.exactIn,
            createdAt: this.createdAt,
            randomNonce: this.randomNonce
        };
    }
    _save() {
        if (this.isQuoteExpired()) {
            return this.wrapper.removeSwapData(this);
        }
        else {
            return this.wrapper.saveSwapData(this);
        }
    }
    async _saveAndEmit(state) {
        if (state != null)
            this.state = state;
        await this._save();
        this._emitEvent();
    }
    //////////////////////////////
    //// Events
    _emitEvent() {
        this.wrapper.events.emit("swapState", this);
        this.events.emit("swapState", this);
    }
}
exports.ISwap = ISwap;
