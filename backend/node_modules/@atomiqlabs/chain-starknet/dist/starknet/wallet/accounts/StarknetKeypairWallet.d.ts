import { Account, DeployAccountContractPayload, Provider } from "starknet";
export declare class StarknetKeypairWallet extends Account {
    readonly publicKey: string;
    constructor(provider: Provider, privateKey: string);
    getDeploymentData(): DeployAccountContractPayload;
    static generateRandomPrivateKey(): string;
}
