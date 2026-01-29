import {SpvVaultEvent, SpvVaultEventType} from "./SpvVaultEvent";


export class SpvVaultFrontEvent extends SpvVaultEvent<SpvVaultEventType.FRONT> {

    readonly eventType = SpvVaultEventType.FRONT;

    btcTxId: string;
    recipient: string;
    executionHash: string;
    amounts: bigint[];
    frontingAddress: string

    constructor(
        owner: string, vaultId: bigint,
        btcTxId: string, recipient: string, executionHash: string, amounts: bigint[],
        frontingAddress: string
    ) {
        super(owner, vaultId);
        this.btcTxId = btcTxId;
        this.recipient = recipient;
        this.executionHash = executionHash;
        this.amounts = amounts;
        this.frontingAddress = frontingAddress;
    }

}
