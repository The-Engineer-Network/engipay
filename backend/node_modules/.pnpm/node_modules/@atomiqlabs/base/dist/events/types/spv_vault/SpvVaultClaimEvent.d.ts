import { SpvVaultEvent, SpvVaultEventType } from "./SpvVaultEvent";
export declare class SpvVaultClaimEvent extends SpvVaultEvent<SpvVaultEventType.CLAIM> {
    readonly eventType = SpvVaultEventType.CLAIM;
    btcTxId: string;
    recipient: string;
    executionHash: string;
    amounts: bigint[];
    caller: string;
    frontingAddress: string;
    withdrawCount: number;
    constructor(owner: string, vaultId: bigint, btcTxId: string, recipient: string, executionHash: string, amounts: bigint[], caller: string, frontingAddress: string, withdrawCount: number);
}
