"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetAction = void 0;
const StarknetFees_1 = require("./modules/StarknetFees");
class StarknetAction {
    constructor(mainSigner, root, instructions = [], gasLimit, feeRate) {
        this.mainSigner = mainSigner;
        this.root = root;
        this.instructions = Array.isArray(instructions) ? instructions : [instructions];
        this.gas = {
            l1Gas: gasLimit?.l1Gas ?? 0,
            l2Gas: gasLimit?.l2Gas ?? 0,
            l1DataGas: gasLimit?.l1DataGas ?? 0,
        };
        this.feeRate = feeRate;
    }
    estimateFeeRate() {
        return this.root.Fees.getFeeRate();
    }
    addIx(instruction, gasLimit) {
        this.instructions.push(instruction);
        this.gas = (0, StarknetFees_1.starknetGasAdd)(this.gas, gasLimit);
    }
    add(action) {
        return this.addAction(action);
    }
    addAction(action, index = this.instructions.length) {
        if (action.mainSigner !== this.mainSigner)
            throw new Error("Actions need to have the same signer!");
        if (this.gas.l1Gas == null && action.gas.l1Gas != null)
            this.gas.l1Gas = action.gas.l1Gas;
        if (this.gas.l2Gas == null && action.gas.l2Gas != null)
            this.gas.l2Gas = action.gas.l2Gas;
        if (this.gas.l1DataGas == null && action.gas.l1DataGas != null)
            this.gas.l1DataGas = action.gas.l1DataGas;
        if (this.gas.l1Gas != null && action.gas.l1Gas != null)
            this.gas.l1Gas += action.gas.l1Gas;
        if (this.gas.l2Gas != null && action.gas.l2Gas != null)
            this.gas.l2Gas += action.gas.l2Gas;
        if (this.gas.l1DataGas != null && action.gas.l1DataGas != null)
            this.gas.l1DataGas += action.gas.l1DataGas;
        this.instructions.splice(index, 0, ...action.instructions);
        if (this.feeRate == null)
            this.feeRate = action.feeRate;
        return this;
    }
    async tx(feeRate) {
        if (feeRate == null)
            feeRate = this.feeRate;
        if (feeRate == null)
            feeRate = await this.estimateFeeRate();
        return {
            type: "INVOKE",
            tx: this.instructions,
            details: {
                ...this.root.Fees.getFeeDetails(this.gas, feeRate),
                walletAddress: this.mainSigner,
                cairoVersion: "1",
                chainId: this.root.starknetChainId,
                nonce: null,
                accountDeploymentData: [],
                skipValidate: false
            }
        };
    }
    async addToTxs(txs, feeRate) {
        txs.push(await this.tx(feeRate));
    }
    ixsLength() {
        return this.instructions.length;
    }
}
exports.StarknetAction = StarknetAction;
