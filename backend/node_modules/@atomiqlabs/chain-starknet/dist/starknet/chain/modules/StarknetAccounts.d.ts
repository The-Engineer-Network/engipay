import { StarknetModule } from "../StarknetModule";
import { StarknetTx } from "./StarknetTransactions";
import { DeployAccountContractPayload } from "starknet";
export declare class StarknetAccounts extends StarknetModule {
    getAccountDeployTransaction(deploymentData: DeployAccountContractPayload): Promise<StarknetTx>;
}
