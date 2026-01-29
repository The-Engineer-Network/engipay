import { StarknetModule } from "../StarknetModule";
import { Call, DeployAccountContractPayload, DeployAccountContractTransaction, Invocation, InvocationsSignerDetails, BigNumberish, BlockTag } from "starknet";
import { StarknetSigner } from "../../wallet/StarknetSigner";
export type StarknetTxBase = {
    details: InvocationsSignerDetails & {
        maxFee?: BigNumberish;
    };
    txId?: string;
};
export type StarknetTxInvoke = StarknetTxBase & {
    type: "INVOKE";
    tx: Array<Call>;
    signed?: Invocation;
};
export declare function isStarknetTxInvoke(obj: any): obj is StarknetTxInvoke;
export type StarknetTxDeployAccount = StarknetTxBase & {
    type: "DEPLOY_ACCOUNT";
    tx: DeployAccountContractPayload;
    signed?: DeployAccountContractTransaction;
};
export declare function isStarknetTxDeployAccount(obj: any): obj is StarknetTxDeployAccount;
export type StarknetTx = StarknetTxInvoke | StarknetTxDeployAccount;
export declare class StarknetTransactions extends StarknetModule {
    private readonly latestConfirmedNonces;
    private readonly latestPendingNonces;
    private readonly latestSignedNonces;
    readonly _cbksBeforeTxReplace: ((oldTx: string, oldTxId: string, newTx: string, newTxId: string) => Promise<void>)[];
    private readonly cbksBeforeTxSigned;
    readonly _knownTxSet: Set<string>;
    sendTransaction(tx: StarknetTx): Promise<string>;
    /**
     * Returns the nonce of the account or 0, if the account is not deployed yet
     *
     * @param address
     * @param blockTag
     */
    getNonce(address: string, blockTag?: BlockTag): Promise<bigint>;
    private confirmTransactionWs;
    private confirmTransactionPolling;
    /**
     * Waits for transaction confirmation using WS subscription and occasional HTTP polling, also re-sends
     *  the transaction at regular interval
     *
     * @param tx starknet transaction to wait for confirmation for & keep re-sending until it confirms
     * @param abortSignal signal to abort waiting for tx confirmation
     * @private
     */
    private confirmTransaction;
    /**
     * Prepares starknet transactions, checks if the account is deployed, assigns nonces if needed & calls beforeTxSigned callback
     *
     * @param signer
     * @param txs
     * @private
     */
    private prepareTransactions;
    /**
     * Sends out a signed transaction to the RPC
     *
     * @param tx Starknet tx to send
     * @param onBeforePublish a callback called before every transaction is published
     * @private
     */
    private sendSignedTransaction;
    /**
     * Prepares, signs , sends (in parallel or sequentially) & optionally waits for confirmation
     *  of a batch of starknet transactions
     *
     * @param signer
     * @param _txs transactions to send
     * @param waitForConfirmation whether to wait for transaction confirmations (this also makes sure the transactions
     *  are re-sent at regular intervals)
     * @param abortSignal abort signal to abort waiting for transaction confirmations
     * @param parallel whether the send all the transaction at once in parallel or sequentially (such that transactions
     *  are executed in order)
     * @param onBeforePublish a callback called before every transaction is published
     */
    sendAndConfirm(signer: StarknetSigner, _txs: StarknetTx[], waitForConfirmation?: boolean, abortSignal?: AbortSignal, parallel?: boolean, onBeforePublish?: (txId: string, rawTx: string) => Promise<void>): Promise<string[]>;
    /**
     * Serializes the starknet transaction, saves the transaction, signers & last valid blockheight
     *
     * @param tx
     */
    static serializeTx(tx: StarknetTx): string;
    /**
     * Deserializes saved starknet transaction, extracting the transaction, signers & last valid blockheight
     *
     * @param txData
     */
    static deserializeTx(txData: string): StarknetTx;
    /**
     * Gets the status of the raw starknet transaction
     *
     * @param tx
     */
    getTxStatus(tx: string): Promise<"pending" | "success" | "not_found" | "reverted">;
    /**
     * Gets the status of the starknet transaction with a specific txId
     *
     * @param txId
     */
    _getTxIdStatus(txId: string): Promise<"pending" | "success" | "not_found" | "reverted" | "rejected">;
    /**
     * Gets the status of the starknet transaction with a specific txId
     *
     * @param txId
     */
    getTxIdStatus(txId: string): Promise<"pending" | "success" | "not_found" | "reverted">;
    onBeforeTxReplace(callback: (oldTx: string, oldTxId: string, newTx: string, newTxId: string) => Promise<void>): void;
    offBeforeTxReplace(callback: (oldTx: string, oldTxId: string, newTx: string, newTxId: string) => Promise<void>): boolean;
    onBeforeTxSigned(callback: (tx: StarknetTx) => Promise<void>): void;
    offBeforeTxSigned(callback: (tx: StarknetTx) => Promise<void>): boolean;
}
