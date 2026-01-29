import {SpvVaultEvent, SpvVaultEventType} from "./SpvVaultEvent";


export class SpvVaultOpenEvent extends SpvVaultEvent<SpvVaultEventType.OPEN> {

    readonly eventType = SpvVaultEventType.OPEN;

    btcTxId: string;
    vout: number;

    constructor(owner: string, vaultId: bigint, btcTxId: string, vout: number) {
        super(owner, vaultId);
        this.btcTxId = btcTxId;
        this.vout = vout;
    }

}