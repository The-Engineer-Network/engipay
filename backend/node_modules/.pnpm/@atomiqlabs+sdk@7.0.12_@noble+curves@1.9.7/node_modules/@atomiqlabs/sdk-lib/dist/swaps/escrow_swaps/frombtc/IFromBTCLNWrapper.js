"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IFromBTCLNWrapper = void 0;
const IFromBTCWrapper_1 = require("./IFromBTCWrapper");
const buffer_1 = require("buffer");
const Utils_1 = require("../../../utils/Utils");
const IntermediaryError_1 = require("../../../errors/IntermediaryError");
const LNURL_1 = require("../../../utils/LNURL");
const UserError_1 = require("../../../errors/UserError");
const sha256_1 = require("@noble/hashes/sha256");
class IFromBTCLNWrapper extends IFromBTCWrapper_1.IFromBTCWrapper {
    /**
     * @param chainIdentifier
     * @param unifiedStorage Storage interface for the current environment
     * @param unifiedChainEvents On-chain event listener
     * @param chain
     * @param contract Underlying contract handling the swaps
     * @param prices Swap pricing handler
     * @param tokens
     * @param swapDataDeserializer Deserializer for SwapData
     * @param lnApi
     * @param options
     * @param events Instance to use for emitting events
     */
    constructor(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, contract, prices, tokens, swapDataDeserializer, lnApi, options, events) {
        super(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, contract, prices, tokens, swapDataDeserializer, options, events);
        this.lnApi = lnApi;
    }
    /**
     * Returns the swap expiry, leaving enough time for the user to claim the HTLC
     *
     * @param data Parsed swap data
     */
    getHtlcTimeout(data) {
        return data.getExpiry() - 600n;
    }
    /**
     * Generates a new 32-byte secret to be used as pre-image for lightning network invoice & HTLC swap\
     *
     * @private
     * @returns Hash pre-image & payment hash
     */
    getSecretAndHash() {
        const secret = (0, Utils_1.randomBytes)(32);
        const paymentHash = buffer_1.Buffer.from((0, sha256_1.sha256)(secret));
        return { secret, paymentHash };
    }
    /**
     * Pre-fetches intermediary's LN node capacity, doesn't throw, instead returns null
     *
     * @param pubkeyPromise Promise that resolves when we receive "lnPublicKey" param from the intermediary thorugh
     *  streaming
     * @private
     * @returns LN Node liquidity
     */
    preFetchLnCapacity(pubkeyPromise) {
        return pubkeyPromise.then(pubkey => {
            if (pubkey == null)
                return null;
            return this.lnApi.getLNNodeLiquidity(pubkey);
        }).catch(e => {
            this.logger.warn("preFetchLnCapacity(): Error: ", e);
            return null;
        });
    }
    /**
     * Verifies whether the intermediary's lightning node has enough inbound capacity to receive the LN payment
     *
     * @param lp Intermediary
     * @param decodedPr Decoded bolt11 lightning network invoice
     * @param amountIn Amount to be paid for the swap in sats
     * @param lnCapacityPrefetchPromise Pre-fetch for LN node capacity, preFetchLnCapacity()
     * @param abortSignal
     * @private
     * @throws {IntermediaryError} if the lightning network node doesn't have enough inbound liquidity
     * @throws {Error} if the lightning network node's inbound liquidity might be enough, but the swap would
     *  deplete more than half of the liquidity
     */
    async verifyLnNodeCapacity(lp, decodedPr, lnCapacityPrefetchPromise, abortSignal) {
        let result = lnCapacityPrefetchPromise == null ? null : await lnCapacityPrefetchPromise;
        if (result == null)
            result = await this.lnApi.getLNNodeLiquidity(decodedPr.payeeNodeKey);
        if (abortSignal != null)
            abortSignal.throwIfAborted();
        if (result === null)
            throw new IntermediaryError_1.IntermediaryError("LP's lightning node not found in the lightning network graph!");
        lp.lnData = result;
        if (decodedPr.payeeNodeKey !== result.publicKey)
            throw new IntermediaryError_1.IntermediaryError("Invalid pr returned - payee pubkey");
        const amountIn = (BigInt(decodedPr.millisatoshis) + 999n) / 1000n;
        if (result.capacity < amountIn)
            throw new IntermediaryError_1.IntermediaryError("LP's lightning node doesn't have enough inbound capacity for the swap!");
        if ((result.capacity / 2n) < amountIn)
            throw new Error("LP's lightning node probably doesn't have enough inbound capacity for the swap!");
    }
    /**
     * Parses and fetches lnurl withdraw params from the specified lnurl
     *
     * @param lnurl LNURL to be parsed and fetched
     * @param abortSignal
     * @private
     * @throws {UserError} if the LNURL is invalid or if it's not a LNURL-withdraw
     */
    async getLNURLWithdraw(lnurl, abortSignal) {
        if (typeof (lnurl) !== "string")
            return lnurl;
        const res = await LNURL_1.LNURL.getLNURL(lnurl, true, this.options.getRequestTimeout, abortSignal);
        if (res == null)
            throw new UserError_1.UserError("Invalid LNURL");
        if (res.tag !== "withdrawRequest")
            throw new UserError_1.UserError("Not a LNURL-withdrawal");
        return res;
    }
}
exports.IFromBTCLNWrapper = IFromBTCLNWrapper;
