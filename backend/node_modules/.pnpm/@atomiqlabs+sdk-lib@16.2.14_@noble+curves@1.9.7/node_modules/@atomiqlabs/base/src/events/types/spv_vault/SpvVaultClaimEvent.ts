import {SpvVaultEvent, SpvVaultEventType} from "./SpvVaultEvent";


export class SpvVaultClaimEvent extends SpvVaultEvent<SpvVaultEventType.CLAIM> {

    readonly eventType = SpvVaultEventType.CLAIM;

    btcTxId: string;
    recipient: string;
    executionHash: string;
    amounts: bigint[];
    caller: string;
    frontingAddress: string;
    withdrawCount: number;

    constructor(
        owner: string, vaultId: bigint,
        btcTxId: string, recipient: string, executionHash: string, amounts: bigint[],
        caller: string, frontingAddress: string, withdrawCount: number
    ) {
        super(owner, vaultId);
        this.btcTxId = btcTxId;
        this.recipient = recipient;
        this.executionHash = executionHash;
        this.amounts = amounts;
        this.caller = caller;
        this.frontingAddress = frontingAddress;
        this.withdrawCount = withdrawCount;
    }

}
