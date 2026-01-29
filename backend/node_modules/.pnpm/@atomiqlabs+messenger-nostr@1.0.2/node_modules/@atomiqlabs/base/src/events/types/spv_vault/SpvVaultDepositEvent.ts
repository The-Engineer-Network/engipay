import {SpvVaultEvent, SpvVaultEventType} from "./SpvVaultEvent";


export class SpvVaultDepositEvent extends SpvVaultEvent<SpvVaultEventType.DEPOSIT> {

    readonly eventType = SpvVaultEventType.DEPOSIT;

    amounts: bigint[];
    depositCount: number;

    constructor(owner: string, vaultId: bigint, amounts: bigint[], depositCount: number) {
        super(owner, vaultId);
        this.amounts = amounts;
        this.depositCount = depositCount;
    }

}
