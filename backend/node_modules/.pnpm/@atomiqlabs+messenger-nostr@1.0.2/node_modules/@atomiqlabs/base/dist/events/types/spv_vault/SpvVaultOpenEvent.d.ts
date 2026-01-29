import { SpvVaultEvent, SpvVaultEventType } from "./SpvVaultEvent";
export declare class SpvVaultOpenEvent extends SpvVaultEvent<SpvVaultEventType.OPEN> {
    readonly eventType = SpvVaultEventType.OPEN;
    btcTxId: string;
    vout: number;
    constructor(owner: string, vaultId: bigint, btcTxId: string, vout: number);
}
