import { SpvWithdrawalTransactionData } from "@atomiqlabs/base";
import { Buffer } from "buffer";
import { BigNumberish } from "starknet";
export declare class StarknetSpvWithdrawalData extends SpvWithdrawalTransactionData {
    protected fromOpReturnData(data: Buffer): {
        recipient: string;
        rawAmounts: bigint[];
        executionHash: string;
    };
    isRecipient(address: string): boolean;
    getTxHash(): bigint;
    getFrontingAmount(): bigint[];
    serialize(): any;
    serializeToStruct(): {
        recipient: string;
        amount: Record<number, boolean | object | BigNumberish>;
        caller_fee: Record<number, boolean | object | BigNumberish>;
        fronting_fee: Record<number, boolean | object | BigNumberish>;
        execution_handler_fee_amount_0: bigint;
        execution_hash: bigint;
        execution_expiry: bigint;
    };
    serializeToFelts(): BigNumberish[];
    getFrontingId(): string;
}
