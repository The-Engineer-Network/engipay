import { SpvVaultEvent, SpvVaultEventType } from "./SpvVaultEvent";
export declare class SpvVaultDepositEvent extends SpvVaultEvent<SpvVaultEventType.DEPOSIT> {
    readonly eventType = SpvVaultEventType.DEPOSIT;
    amounts: bigint[];
    depositCount: number;
    constructor(owner: string, vaultId: bigint, amounts: bigint[], depositCount: number);
}
