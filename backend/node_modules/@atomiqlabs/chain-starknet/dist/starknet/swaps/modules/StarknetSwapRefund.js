"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetSwapRefund = void 0;
const base_1 = require("@atomiqlabs/base");
const Utils_1 = require("../../../utils/Utils");
const StarknetSwapModule_1 = require("../StarknetSwapModule");
const StarknetAction_1 = require("../../chain/StarknetAction");
const StarknetFees_1 = require("../../chain/modules/StarknetFees");
const Refund = [
    { name: 'Swap hash', type: 'felt' },
    { name: 'Timeout', type: 'timestamp' }
];
class StarknetSwapRefund extends StarknetSwapModule_1.StarknetSwapModule {
    /**
     * Action for generic Refund instruction
     *
     * @param signer
     * @param swapData
     * @param witness
     * @param handlerGas
     * @constructor
     * @private
     */
    Refund(signer, swapData, witness, handlerGas) {
        return new StarknetAction_1.StarknetAction(signer, this.root, this.swapContract.populateTransaction.refund(swapData.toEscrowStruct(), witness), (0, StarknetFees_1.starknetGasAdd)(swapData.payIn ? StarknetSwapRefund.GasCosts.REFUND_PAY_OUT : StarknetSwapRefund.GasCosts.REFUND, handlerGas));
    }
    /**
     * Action for cooperative refunding with signature
     *
     * @param sender
     * @param swapData
     * @param timeout
     * @param signature
     * @constructor
     * @private
     */
    RefundWithSignature(sender, swapData, timeout, signature) {
        return new StarknetAction_1.StarknetAction(sender, this.root, this.swapContract.populateTransaction.cooperative_refund(swapData.toEscrowStruct(), signature, BigInt(timeout)), swapData.payIn ? StarknetSwapRefund.GasCosts.REFUND_PAY_OUT : StarknetSwapRefund.GasCosts.REFUND);
    }
    async signSwapRefund(signer, swapData, authorizationTimeout) {
        const authPrefix = "refund";
        const authTimeout = Math.floor(Date.now() / 1000) + authorizationTimeout;
        const signature = await this.root.Signatures.signTypedMessage(signer, Refund, "Refund", {
            "Swap hash": "0x" + swapData.getEscrowHash(),
            "Timeout": (0, Utils_1.toHex)(authTimeout)
        });
        return {
            prefix: authPrefix,
            timeout: authTimeout.toString(10),
            signature: signature
        };
    }
    async isSignatureValid(swapData, timeout, prefix, signature) {
        if (prefix !== "refund")
            throw new base_1.SignatureVerificationError("Invalid prefix");
        const expiryTimestamp = BigInt(timeout);
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const isExpired = (expiryTimestamp - currentTimestamp) < BigInt(this.contract.authGracePeriod);
        if (isExpired)
            throw new base_1.SignatureVerificationError("Authorization expired!");
        const valid = await this.root.Signatures.isValidSignature(signature, swapData.claimer, Refund, "Refund", {
            "Swap hash": "0x" + swapData.getEscrowHash(),
            "Timeout": (0, Utils_1.toHex)(expiryTimestamp)
        });
        if (!valid) {
            throw new base_1.SignatureVerificationError("Invalid signature!");
        }
        return null;
    }
    /**
     * Creates transactions required for refunding timed out swap
     *
     * @param signer
     * @param swapData swap data to refund
     * @param check whether to check if swap is already expired and refundable
     * @param feeRate fee rate to be used for the transactions
     * @param witnessData
     */
    async txsRefund(signer, swapData, check, feeRate, witnessData) {
        const refundHandler = this.contract.refundHandlersByAddress[swapData.refundHandler.toLowerCase()];
        if (refundHandler == null)
            throw new Error("Invalid refund handler");
        if (check && !await (0, Utils_1.tryWithRetries)(() => this.contract.isRequestRefundable(swapData.offerer.toString(), swapData), this.retryPolicy)) {
            throw new base_1.SwapDataVerificationError("Not refundable yet!");
        }
        feeRate ?? (feeRate = await this.root.Fees.getFeeRate());
        const { initialTxns, witness } = await refundHandler.getWitness(signer, swapData, witnessData, feeRate);
        const action = this.Refund(signer, swapData, witness, refundHandler.getGas(swapData));
        await action.addToTxs(initialTxns, feeRate);
        this.logger.debug("txsRefund(): creating refund transaction, swap: " + swapData.getClaimHash());
        return initialTxns;
    }
    /**
     * Creates transactions required for refunding the swap with authorization signature, also unwraps WSOL to SOL
     *
     * @param signer
     * @param swapData swap data to refund
     * @param timeout signature timeout
     * @param prefix signature prefix of the counterparty
     * @param signature signature of the counterparty
     * @param check whether to check if swap is committed before attempting refund
     * @param feeRate fee rate to be used for the transactions
     */
    async txsRefundWithAuthorization(signer, swapData, timeout, prefix, signature, check, feeRate) {
        if (check && !await (0, Utils_1.tryWithRetries)(() => this.contract.isCommited(swapData), this.retryPolicy)) {
            throw new base_1.SwapDataVerificationError("Not correctly committed");
        }
        await (0, Utils_1.tryWithRetries)(() => this.isSignatureValid(swapData, timeout, prefix, signature), this.retryPolicy, (e) => e instanceof base_1.SignatureVerificationError);
        const action = this.RefundWithSignature(signer, swapData, timeout, JSON.parse(signature));
        feeRate ?? (feeRate = await this.root.Fees.getFeeRate());
        this.logger.debug("txsRefundWithAuthorization(): creating refund transaction, swap: " + swapData.getClaimHash() +
            " auth expiry: " + timeout + " signature: " + signature);
        return [await action.tx(feeRate)];
    }
    /**
     * Get the estimated solana transaction fee of the refund transaction, in the worst case scenario in case where the
     *  ATA needs to be initialized again (i.e. adding the ATA rent exempt lamports to the fee)
     */
    async getRefundFee(swapData, feeRate) {
        feeRate ?? (feeRate = await this.root.Fees.getFeeRate());
        return StarknetFees_1.StarknetFees.getGasFee(swapData.payIn ? StarknetSwapRefund.GasCosts.REFUND_PAY_OUT : StarknetSwapRefund.GasCosts.REFUND, feeRate);
    }
}
exports.StarknetSwapRefund = StarknetSwapRefund;
StarknetSwapRefund.GasCosts = {
    REFUND: { l1DataGas: 750, l2Gas: 4000000, l1Gas: 0 },
    REFUND_PAY_OUT: { l1DataGas: 900, l2Gas: 6000000, l1Gas: 0 }
};
