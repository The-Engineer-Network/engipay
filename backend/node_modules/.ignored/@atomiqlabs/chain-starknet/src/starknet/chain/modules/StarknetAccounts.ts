import {StarknetModule} from "../StarknetModule";
import {StarknetTx} from "./StarknetTransactions";
import {DeployAccountContractPayload} from "starknet";


export class StarknetAccounts extends StarknetModule {

    public async getAccountDeployTransaction(deploymentData: DeployAccountContractPayload): Promise<StarknetTx> {
        const feeDetails = this.root.Fees.getFeeDetails({l1DataGas: 1000, l2Gas: 5_000*40_000, l1Gas: 0}, await this.root.Fees.getFeeRate());
        const details = {
            ...feeDetails,
            walletAddress: deploymentData.contractAddress,
            cairoVersion: "1" as const,
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