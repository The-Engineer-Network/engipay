import { AbstractSigner } from "@atomiqlabs/base";
import { Account, DeployAccountContractPayload, Invocation, DeployAccountContractTransaction } from "starknet";
import { StarknetTx, StarknetTxDeployAccount, StarknetTxInvoke } from "../chain/modules/StarknetTransactions";
export declare class StarknetSigner implements AbstractSigner {
    type: "AtomiqAbstractSigner";
    readonly isManagingNoncesInternally: boolean;
    account: Account;
    isDeployed: boolean;
    constructor(account: Account, isManagingNoncesInternally?: boolean);
    getAddress(): string;
    protected _signTransaction(tx: StarknetTx): Promise<StarknetTx>;
    signTransaction?(tx: StarknetTx): Promise<StarknetTx>;
    protected signInvoke(tx: StarknetTxInvoke): Promise<Invocation>;
    protected signDeployAccount(tx: StarknetTxDeployAccount): Promise<DeployAccountContractTransaction>;
    sendTransaction(tx: StarknetTx, onBeforePublish?: (txId: string, rawTx: string) => Promise<void>): Promise<string>;
    protected sendInvoke(tx: StarknetTxInvoke): Promise<string>;
    protected sendDeployAccount(tx: StarknetTxDeployAccount): Promise<string>;
    getDeployPayload(): Promise<DeployAccountContractPayload | null>;
}
