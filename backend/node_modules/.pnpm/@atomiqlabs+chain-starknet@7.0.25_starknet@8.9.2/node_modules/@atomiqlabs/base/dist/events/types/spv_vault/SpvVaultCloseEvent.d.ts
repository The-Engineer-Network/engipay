import { SpvVaultEvent, SpvVaultEventType } from "./SpvVaultEvent";
export declare class SpvVaultCloseEvent extends SpvVaultEvent<SpvVaultEventType.CLOSE> {
    readonly eventType = SpvVaultEventType.CLOSE;
    btcTxId: string;
    error: string;
    constructor(owner: string, vaultId: bigint, btcTxId: string, error: string);
}
