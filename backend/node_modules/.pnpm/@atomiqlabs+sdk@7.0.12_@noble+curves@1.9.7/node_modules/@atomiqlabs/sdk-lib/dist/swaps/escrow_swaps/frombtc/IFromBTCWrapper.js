"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IFromBTCWrapper = void 0;
const IntermediaryError_1 = require("../../../errors/IntermediaryError");
const Utils_1 = require("../../../utils/Utils");
const base_1 = require("@atomiqlabs/base");
const IEscrowSwapWrapper_1 = require("../IEscrowSwapWrapper");
class IFromBTCWrapper extends IEscrowSwapWrapper_1.IEscrowSwapWrapper {
    /**
     * Returns a random sequence to be used for swaps
     *
     * @protected
     * @returns Random 64-bit sequence number
     */
    getRandomSequence() {
        return base_1.BigIntBufferUtils.fromBuffer((0, Utils_1.randomBytes)(8));
    }
    /**
     * Pre-fetches feeRate for a given swap
     *
     * @param signer Address initiating the swap
     * @param amountData
     * @param claimHash optional claim hash of the swap or null
     * @param abortController
     * @protected
     * @returns Fee rate
     */
    preFetchFeeRate(signer, amountData, claimHash, abortController) {
        return (0, Utils_1.tryWithRetries)(() => this.contract.getInitFeeRate(null, signer, amountData.token, claimHash), null, null, abortController.signal).catch(e => {
            this.logger.warn("preFetchFeeRate(): Error: ", e);
            abortController.abort(e);
            return null;
        });
    }
    /**
     * Pre-fetches intermediary's available SC on-chain liquidity
     * @param amountData
     * @param lp Intermediary
     * @param abortController
     * @protected
     * @returns Intermediary's liquidity balance
     */
    preFetchIntermediaryLiquidity(amountData, lp, abortController) {
        return lp.getLiquidity(this.chainIdentifier, this.contract, amountData.token.toString(), abortController.signal).catch(e => {
            this.logger.warn("preFetchIntermediaryLiquidity(): Error: ", e);
            abortController.abort(e);
            return null;
        });
    }
    /**
     * Verifies whether the intermediary has enough available liquidity such that we can initiate the swap
     *
     * @param amount Swap amount that we should receive
     * @param liquidityPromise pre-fetched liquidity promise as obtained from preFetchIntermediaryLiquidity()
     * @protected
     * @throws {IntermediaryError} if intermediary's liquidity is lower than what's required for the swap
     */
    async verifyIntermediaryLiquidity(amount, liquidityPromise) {
        const liquidity = await liquidityPromise;
        if (liquidity < amount)
            throw new IntermediaryError_1.IntermediaryError("Intermediary doesn't have enough liquidity");
    }
}
exports.IFromBTCWrapper = IFromBTCWrapper;
