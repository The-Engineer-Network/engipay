/// <reference types="node" />
import { BtcTx } from "../btc/rpc/BitcoinRpc";
import { Buffer } from "buffer";
import { StorageObject } from "../storage/StorageObject";
export type ExecutionData = {
    executionHash: string;
    executionExpiry: number;
};
export declare abstract class SpvWithdrawalTransactionData implements StorageObject {
    static deserializers: {
        [type: string]: new (serialized: any) => any;
    };
    static deserialize<T extends SpvWithdrawalTransactionData>(data: any): T;
    protected abstract fromOpReturnData(data: Buffer): {
        recipient: string;
        rawAmounts: bigint[];
        executionHash: string;
    };
    readonly recipient: string;
    readonly rawAmounts: bigint[];
    readonly callerFeeRate: bigint;
    readonly executionFeeRate: bigint;
    readonly frontingFeeRate: bigint;
    readonly executionHash: string;
    readonly executionExpiry: number;
    readonly btcTx: BtcTx;
    constructor(btcTx: BtcTx);
    serialize(): any;
    getRecipient(): string;
    abstract isRecipient(address: string): boolean;
    abstract getFrontingId(): string;
    getOutputWithoutFees(): bigint[];
    getCallerFee(): bigint[];
    getFrontingFee(): bigint[];
    getExecutionFee(): bigint[];
    getTotalOutput(): bigint[];
    getExecutionData(): ExecutionData | null;
    getTxId(): string;
    getSpentVaultUtxo(): string;
    getCreatedVaultUtxo(): string;
    getNewVaultScript(): Buffer;
    getNewVaultBtcAmount(): number;
}
