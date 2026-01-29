import { StorageObject } from "../storage/StorageObject";
import { SpvWithdrawalTransactionData } from "./SpvWithdrawalTransactionData";
import { SpvVaultClaimEvent } from "../events/types/spv_vault/SpvVaultClaimEvent";
import { SpvVaultCloseEvent } from "../events/types/spv_vault/SpvVaultCloseEvent";
import { SpvVaultOpenEvent } from "../events/types/spv_vault/SpvVaultOpenEvent";
import { SpvVaultDepositEvent } from "../events/types/spv_vault/SpvVaultDepositEvent";
export type SpvVaultTokenBalance = SpvVaultTokenData & {
    rawAmount: bigint;
    scaledAmount: bigint;
};
export type SpvVaultTokenData = {
    token: string;
    multiplier: bigint;
};
export declare abstract class SpvVaultData<T extends SpvWithdrawalTransactionData = SpvWithdrawalTransactionData> implements StorageObject {
    static deserializers: {
        [type: string]: new (serialized: any) => any;
    };
    static deserialize<T extends SpvVaultData>(data: any): T;
    abstract serialize(): any;
    abstract getOwner(): string;
    abstract getVaultId(): bigint;
    abstract getTokenData(): SpvVaultTokenData[];
    abstract getBalances(): SpvVaultTokenBalance[];
    abstract getUtxo(): string;
    abstract getConfirmations(): number;
    abstract getWithdrawalCount(): number;
    abstract getDepositCount(): number;
    abstract isOpened(): boolean;
    abstract updateState(withdrawalTxOrEvent: T | SpvVaultClaimEvent | SpvVaultCloseEvent | SpvVaultOpenEvent | SpvVaultDepositEvent): void;
    calculateStateAfter(priorWithdrawalTxs: T[]): {
        withdrawalCount: number;
        balances: SpvVaultTokenBalance[];
    };
}
