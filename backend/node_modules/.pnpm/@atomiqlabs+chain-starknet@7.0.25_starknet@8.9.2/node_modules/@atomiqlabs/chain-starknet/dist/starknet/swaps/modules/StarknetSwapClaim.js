"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetSwapClaim = void 0;
const base_1 = require("@atomiqlabs/base");
const Utils_1 = require("../../../utils/Utils");
const StarknetSwapModule_1 = require("../StarknetSwapModule");
const StarknetAction_1 = require("../../chain/StarknetAction");
const StarknetFees_1 = require("../../chain/modules/StarknetFees");
class StarknetSwapClaim extends StarknetSwapModule_1.StarknetSwapModule {
    /**
     * Claim action which uses the provided witness for claiming the swap
     *
     * @param signer
     * @param swapData
     * @param witness
     * @param claimHandlerGas
     * @constructor
     * @private
     */
    Claim(signer, swapData, witness, claimHandlerGas) {
        return new StarknetAction_1.StarknetAction(signer, this.root, this.swapContract.populateTransaction.claim(swapData.toEscrowStruct(), witness), (0, StarknetFees_1.starknetGasAdd)(swapData.payOut ? StarknetSwapClaim.GasCosts.CLAIM_PAY_OUT : StarknetSwapClaim.GasCosts.CLAIM, claimHandlerGas));
    }
    /**
     * Creates transactions claiming the swap using a secret (for HTLC swaps)
     *
     * @param signer
     * @param swapData swap to claim
     * @param secret hex encoded secret pre-image to the HTLC hash
     * @param checkExpiry whether to check if the swap is already expired (trying to claim an expired swap with a secret
     *  is dangerous because we might end up revealing the secret to the counterparty without being able to claim the swap)
     * @param feeRate fee rate to use for the transaction
     */
    async txsClaimWithSecret(signer, swapData, secret, checkExpiry, feeRate) {
        //We need to be sure that this transaction confirms in time, otherwise we reveal the secret to the counterparty
        // and won't claim the funds
        if (checkExpiry && await this.contract.isExpired(swapData.claimer.toString(), swapData)) {
            throw new base_1.SwapDataVerificationError("Not enough time to reliably pay the invoice");
        }
        const claimHandler = this.contract.claimHandlersByAddress[(0, Utils_1.toHex)(swapData.claimHandler)];
        if (claimHandler == null)
            throw new base_1.SwapDataVerificationError("Unknown claim handler!");
        if (claimHandler.getType() !== base_1.ChainSwapType.HTLC)
            throw new base_1.SwapDataVerificationError("Invalid claim handler!");
        feeRate ?? (feeRate = await this.root.Fees.getFeeRate());
        const { initialTxns, witness } = await claimHandler.getWitness(signer, swapData, secret, feeRate);
        const action = this.Claim(signer, swapData, witness, claimHandler.getGas(swapData));
        await action.addToTxs(initialTxns, feeRate);
        this.logger.debug("txsClaimWithSecret(): creating claim transaction, swap: " + swapData.getClaimHash() + " witness: ", witness.map(Utils_1.toHex));
        return initialTxns;
    }
    /**
     * Creates transaction claiming the swap using a confirmed transaction data (for BTC on-chain swaps)
     *
     * @param signer
     * @param swapData swap to claim
     * @param tx bitcoin transaction that satisfies the swap condition
     * @param requiredConfirmations
     * @param vout vout of the bitcoin transaction that satisfies the swap condition
     * @param commitedHeader commited header data from btc relay (fetched internally if null)
     * @param synchronizer optional synchronizer to use in case we need to sync up the btc relay ourselves
     * @param feeRate fee rate to be used for the transactions
     */
    async txsClaimWithTxData(signer, swapData, tx, requiredConfirmations, vout, commitedHeader, synchronizer, feeRate) {
        const claimHandler = this.contract.claimHandlersByAddress[(0, Utils_1.toHex)(swapData.claimHandler)];
        if (claimHandler == null)
            throw new base_1.SwapDataVerificationError("Unknown claim handler!");
        if (claimHandler.getType() !== base_1.ChainSwapType.CHAIN_NONCED &&
            claimHandler.getType() !== base_1.ChainSwapType.CHAIN_TXID &&
            claimHandler.getType() !== base_1.ChainSwapType.CHAIN)
            throw new base_1.SwapDataVerificationError("Invalid claim handler!");
        feeRate ?? (feeRate = await this.root.Fees.getFeeRate());
        const { initialTxns, witness } = await claimHandler.getWitness(signer, swapData, {
            tx,
            vout,
            requiredConfirmations,
            commitedHeader,
            btcRelay: this.contract.btcRelay,
            synchronizer,
        }, feeRate);
        const action = this.Claim(signer, swapData, witness, claimHandler.getGas(swapData));
        await action.addToTxs(initialTxns, feeRate);
        return initialTxns;
    }
    /**
     * Get the estimated starknet transaction fee of the claim transaction
     */
    async getClaimFee(swapData, feeRate) {
        feeRate ?? (feeRate = await this.root.Fees.getFeeRate());
        let gasRequired = swapData.payOut ? StarknetSwapClaim.GasCosts.CLAIM_PAY_OUT : StarknetSwapClaim.GasCosts.CLAIM;
        const claimHandler = this.contract.claimHandlersByAddress[(0, Utils_1.toHex)(swapData.claimHandler)];
        if (claimHandler != null)
            gasRequired = (0, StarknetFees_1.starknetGasAdd)(gasRequired, claimHandler.getGas(swapData));
        return StarknetFees_1.StarknetFees.getGasFee(gasRequired, feeRate);
    }
}
exports.StarknetSwapClaim = StarknetSwapClaim;
StarknetSwapClaim.GasCosts = {
    CLAIM: { l1DataGas: 750, l2Gas: 4000000, l1Gas: 0 },
    CLAIM_PAY_OUT: { l1DataGas: 900, l2Gas: 6000000, l1Gas: 0 }
};
