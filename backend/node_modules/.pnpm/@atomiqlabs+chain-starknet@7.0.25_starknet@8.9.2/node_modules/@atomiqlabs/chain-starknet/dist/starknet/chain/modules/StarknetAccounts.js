"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetAccounts = void 0;
const StarknetModule_1 = require("../StarknetModule");
class StarknetAccounts extends StarknetModule_1.StarknetModule {
    async getAccountDeployTransaction(deploymentData) {
        const feeDetails = this.root.Fees.getFeeDetails({ l1DataGas: 1000, l2Gas: 5000 * 40000, l1Gas: 0 }, await this.root.Fees.getFeeRate());
        const details = {
            ...feeDetails,
            walletAddress: deploymentData.contractAddress,
            cairoVersion: "1",
            chainId: this.root.starknetChainId,
            nonce: 0n,
            accountDeploymentData: [],
            skipValidate: false
        };
        return {
            type: "DEPLOY_ACCOUNT",
            tx: deploymentData,
            details
        };
    }
}
exports.StarknetAccounts = StarknetAccounts;
