import { SpvVaultClaimEvent, SpvVaultCloseEvent, SpvVaultData, SpvVaultDepositEvent, SpvVaultOpenEvent, SpvVaultTokenBalance, SpvVaultTokenData } from "@atomiqlabs/base";
import { BigNumberish } from "starknet";
import { StarknetSpvWithdrawalData } from "./StarknetSpvWithdrawalData";
export type StarknetSpvVaultDataType = {
    relay_contract: BigNumberish;
    token_0: BigNumberish;
    token_1: BigNumberish;
    token_0_multiplier: BigNumberish;
    token_1_multiplier: BigNumberish;
    utxo: Record<number, boolean | object | BigNumberish>;
    confirmations: BigNumberish;
    withdraw_count: BigNumberish;
    deposit_count: BigNumberish;
    token_0_amount: BigNumberish;
    token_1_amount: BigNumberish;
};
export declare class StarknetSpvVaultData extends SpvVaultData<StarknetSpvWithdrawalData> {
    readonly owner: string;
    readonly vaultId: bigint;
    readonly relayContract: string;
    readonly token0: {
        token: string;
        multiplier: bigint;
        rawAmount: bigint;
    };
    readonly token1: {
        token: string;
        multiplier: bigint;
        rawAmount: bigint;
    };
    readonly initialUtxo: string;
    utxo: string;
    readonly confirmations: number;
    withdrawCount: number;
    depositCount: number;
    constructor(owner: string, vaultId: bigint, struct: StarknetSpvVaultDataType, initialUtxo?: string);
    constructor(serializedObj: any);
    getBalances(): SpvVaultTokenBalance[];
    getConfirmations(): number;
    getOwner(): string;
    getTokenData(): SpvVaultTokenData[];
    getUtxo(): string;
    getVaultId(): bigint;
    getWithdrawalCount(): number;
    isOpened(): boolean;
    serialize(): any;
    updateState(withdrawalTxOrEvent: SpvVaultClaimEvent | SpvVaultCloseEvent | SpvVaultOpenEvent | SpvVaultDepositEvent | StarknetSpvWithdrawalData): void;
    getDepositCount(): number;
}
