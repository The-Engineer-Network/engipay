"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IEscrowSwap = exports.isIEscrowSwapInit = void 0;
const ISwap_1 = require("../ISwap");
const base_1 = require("@atomiqlabs/base");
const Utils_1 = require("../../utils/Utils");
const buffer_1 = require("buffer");
function isIEscrowSwapInit(obj) {
    return typeof obj === 'object' &&
        (obj.data == null || typeof obj.data === 'object') &&
        (0, ISwap_1.isISwapInit)(obj);
}
exports.isIEscrowSwapInit = isIEscrowSwapInit;
class IEscrowSwap extends ISwap_1.ISwap {
    constructor(wrapper, swapInitOrObj) {
        super(wrapper, swapInitOrObj);
        if (!isIEscrowSwapInit(swapInitOrObj)) {
            this.data = swapInitOrObj.data != null ? new wrapper.swapDataDeserializer(swapInitOrObj.data) : null;
            this.commitTxId = swapInitOrObj.commitTxId;
            this.claimTxId = swapInitOrObj.claimTxId;
            this.refundTxId = swapInitOrObj.refundTxId;
        }
    }
    //////////////////////////////
    //// Identifiers
    /**
     * Returns the identification hash of the swap, usually claim data hash, but can be overriden, e.g. for
     *  lightning swaps the identifier hash is used instead of claim data hash
     */
    getIdentifierHash() {
        const claimHashBuffer = buffer_1.Buffer.from(this.getClaimHash(), "hex");
        if (this.randomNonce == null)
            return claimHashBuffer;
        return buffer_1.Buffer.concat([claimHashBuffer, buffer_1.Buffer.from(this.randomNonce, "hex")]);
    }
    /**
     * Returns the identification hash of the swap, usually claim data hash, but can be overriden, e.g. for
     *  lightning swaps the identifier hash is used instead of claim data hash
     */
    getIdentifierHashString() {
        const identifierHash = this.getIdentifierHash();
        if (identifierHash == null)
            return null;
        return identifierHash.toString("hex");
    }
    _getEscrowHash() {
        return this.data?.getEscrowHash();
    }
    /**
     * Returns the escrow hash - i.e. hash of the escrow data
     */
    getEscrowHash() {
        return this._getEscrowHash();
    }
    /**
     * Returns the claim data hash - i.e. hash passed to the claim handler
     */
    getClaimHash() {
        return this.data?.getClaimHash();
    }
    getId() {
        return this.getIdentifierHashString();
    }
    //////////////////////////////
    //// Watchdogs
    /**
     * Periodically checks the chain to see whether the swap is committed
     *
     * @param intervalSeconds How often to check (in seconds), default to 5s
     * @param abortSignal
     * @protected
     */
    async watchdogWaitTillCommited(intervalSeconds, abortSignal) {
        intervalSeconds ??= 5;
        let status = { type: base_1.SwapCommitStateType.NOT_COMMITED };
        while (status?.type === base_1.SwapCommitStateType.NOT_COMMITED) {
            await (0, Utils_1.timeoutPromise)(intervalSeconds * 1000, abortSignal);
            try {
                status = await this.wrapper.contract.getCommitStatus(this._getInitiator(), this.data);
                if (status?.type === base_1.SwapCommitStateType.NOT_COMMITED &&
                    await this._verifyQuoteDefinitelyExpired())
                    return false;
            }
            catch (e) {
                this.logger.error("watchdogWaitTillCommited(): Error when fetching commit status or signature expiry: ", e);
            }
        }
        if (abortSignal != null)
            abortSignal.throwIfAborted();
        return status?.type !== base_1.SwapCommitStateType.EXPIRED;
    }
    /**
     * Periodically checks the chain to see whether the swap was finished (claimed or refunded)
     *
     * @param intervalSeconds How often to check (in seconds), default to 5s
     * @param abortSignal
     * @protected
     */
    async watchdogWaitTillResult(intervalSeconds, abortSignal) {
        intervalSeconds ??= 5;
        let status = { type: base_1.SwapCommitStateType.COMMITED };
        while (status?.type === base_1.SwapCommitStateType.COMMITED || status?.type === base_1.SwapCommitStateType.REFUNDABLE) {
            await (0, Utils_1.timeoutPromise)(intervalSeconds * 1000, abortSignal);
            try {
                status = await this.wrapper.contract.getCommitStatus(this._getInitiator(), this.data);
            }
            catch (e) {
                this.logger.error("watchdogWaitTillResult(): Error when fetching commit status: ", e);
            }
        }
        if (abortSignal != null)
            abortSignal.throwIfAborted();
        return status;
    }
    serialize() {
        return {
            ...super.serialize(),
            data: this.data != null ? this.data.serialize() : null,
            commitTxId: this.commitTxId,
            claimTxId: this.claimTxId,
            refundTxId: this.refundTxId
        };
    }
    ;
}
exports.IEscrowSwap = IEscrowSwap;
