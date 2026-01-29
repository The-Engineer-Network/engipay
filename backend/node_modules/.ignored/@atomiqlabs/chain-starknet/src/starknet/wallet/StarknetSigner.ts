import {AbstractSigner} from "@atomiqlabs/base";
import {Account, DeployAccountContractPayload, BlockTag, Invocation, DeployAccountContractTransaction} from "starknet";
import {calculateHash, toHex} from "../../utils/Utils";
import {
    isStarknetTxDeployAccount,
    isStarknetTxInvoke, StarknetTransactions,
    StarknetTx,
    StarknetTxDeployAccount,
    StarknetTxInvoke
} from "../chain/modules/StarknetTransactions";

export class StarknetSigner implements AbstractSigner {
    type = "AtomiqAbstractSigner" as const;

    public readonly isManagingNoncesInternally: boolean;

    account: Account;

    isDeployed: boolean = null;

    constructor(account: Account, isManagingNoncesInternally: boolean = false) {
        this.account = account;
        this.isManagingNoncesInternally = isManagingNoncesInternally;
    }

    getAddress(): string {
        return toHex(this.account.address);
    }

    protected async _signTransaction(tx: StarknetTx): Promise<StarknetTx> {
        if(isStarknetTxInvoke(tx)) {
            tx.signed = await this.signInvoke(tx);
        } else if(isStarknetTxDeployAccount(tx)) {
            tx.signed = await this.signDeployAccount(tx);
        } else {
            throw new Error("Unsupported transaction type!");
        }
        calculateHash(tx);
        return tx;
    }

    signTransaction?(tx: StarknetTx): Promise<StarknetTx> {
        return this._signTransaction(tx);
    }

    protected signInvoke(tx: StarknetTxInvoke): Promise<Invocation> {
        return this.account.buildInvocation(tx.tx, tx.details);
    }

    protected signDeployAccount(tx: StarknetTxDeployAccount): Promise<DeployAccountContractTransaction> {
        return this.account.buildAccountDeployPayload(tx.tx, tx.details);
    }

    async sendTransaction(tx: StarknetTx, onBeforePublish?: (txId: string, rawTx: string) => Promise<void>): Promise<string> {
        if(isStarknetTxInvoke(tx)) {
            tx.txId = await this.sendInvoke(tx);
        } else if(isStarknetTxDeployAccount(tx)) {
            tx.txId = await this.sendDeployAccount(tx);
        } else {
            throw new Error("Unsupported transaction type!");
        }
        if(onBeforePublish!=null) await onBeforePublish(tx.txId, StarknetTransactions.serializeTx(tx));
        return tx.txId;
    }

    protected async sendInvoke(tx: StarknetTxInvoke): Promise<string> {
        const result = await this.account.execute(tx.tx, tx.details);
        return result.transaction_hash;
    }

    protected async sendDeployAccount(tx: StarknetTxDeployAccount): Promise<string> {
        const result = await this.account.deployAccount(tx.tx, tx.details);
        return result.transaction_hash;
    }

    // isWalletAccount() {
    //     return (this.account as any).walletProvider!=null;
    // }

    async getDeployPayload(): Promise<DeployAccountContractPayload | null> {
        const _account: Account & {getDeploymentData?: () => DeployAccountContractPayload} = this.account;
        if(_account.getDeploymentData==null) return null;
        return _account.getDeploymentData();
    }

}
