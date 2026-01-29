import {SpvVaultEvent, SpvVaultEventType} from "./SpvVaultEvent";


export class SpvVaultCloseEvent extends SpvVaultEvent<SpvVaultEventType.CLOSE> {

    readonly eventType = SpvVaultEventType.CLOSE;

    btcTxId: string;
    error: string;

    constructor(owner: string, vaultId: bigint, btcTxId: string, error: string) {
        super(owner, vaultId);
        this.btcTxId = btcTxId;
        this.error = error;
    }

}
