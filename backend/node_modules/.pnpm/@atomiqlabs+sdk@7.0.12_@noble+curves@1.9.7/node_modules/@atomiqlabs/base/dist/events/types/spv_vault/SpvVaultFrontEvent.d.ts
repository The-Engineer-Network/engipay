import { SpvVaultEvent, SpvVaultEventType } from "./SpvVaultEvent";
export declare class SpvVaultFrontEvent extends SpvVaultEvent<SpvVaultEventType.FRONT> {
    readonly eventType = SpvVaultEventType.FRONT;
    btcTxId: string;
    recipient: string;
    executionHash: string;
    amounts: bigint[];
    frontingAddress: string;
    constructor(owner: string, vaultId: bigint, btcTxId: string, recipient: string, executionHash: string, amounts: bigint[], frontingAddress: string);
}
