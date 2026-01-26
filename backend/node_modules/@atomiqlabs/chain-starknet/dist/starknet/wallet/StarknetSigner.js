"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetSigner = void 0;
const Utils_1 = require("../../utils/Utils");
const StarknetTransactions_1 = require("../chain/modules/StarknetTransactions");
class StarknetSigner {
    constructor(account, isManagingNoncesInternally = false) {
        this.type = "AtomiqAbstractSigner";
        this.isDeployed = null;
        this.account = account;
        this.isManagingNoncesInternally = isManagingNoncesInternally;
    }
    getAddress() {
        return (0, Utils_1.toHex)(this.account.address);
    }
    async _signTransaction(tx) {
        if ((0, StarknetTransactions_1.isStarknetTxInvoke)(tx)) {
            tx.signed = await this.signInvoke(tx);
        }
        else if ((0, StarknetTransactions_1.isStarknetTxDeployAccount)(tx)) {
            tx.signed = await this.signDeployAccount(tx);
        }
        else {
            throw new Error("Unsupported transaction type!");
        }
        (0, Utils_1.calculateHash)(tx);
        return tx;
    }
    signTransaction(tx) {
        return this._signTransaction(tx);
    }
    signInvoke(tx) {
        return this.account.buildInvocation(tx.tx, tx.details);
    }
    signDeployAccount(tx) {
        return this.account.buildAccountDeployPayload(tx.tx, tx.details);
    }
    async sendTransaction(tx, onBeforePublish) {
        if ((0, StarknetTransactions_1.isStarknetTxInvoke)(tx)) {
            tx.txId = await this.sendInvoke(tx);
        }
        else if ((0, StarknetTransactions_1.isStarknetTxDeployAccount)(tx)) {
            tx.txId = await this.sendDeployAccount(tx);
        }
        else {
            throw new Error("Unsupported transaction type!");
        }
        if (onBeforePublish != null)
            await onBeforePublish(tx.txId, StarknetTransactions_1.StarknetTransactions.serializeTx(tx));
        return tx.txId;
    }
    async sendInvoke(tx) {
        const result = await this.account.execute(tx.tx, tx.details);
        return result.transaction_hash;
    }
    async sendDeployAccount(tx) {
        const result = await this.account.deployAccount(tx.tx, tx.details);
        return result.transaction_hash;
    }
    // isWalletAccount() {
    //     return (this.account as any).walletProvider!=null;
    // }
    async getDeployPayload() {
        const _account = this.account;
        if (_account.getDeploymentData == null)
            return null;
        return _account.getDeploymentData();
    }
}
exports.StarknetSigner = StarknetSigner;
