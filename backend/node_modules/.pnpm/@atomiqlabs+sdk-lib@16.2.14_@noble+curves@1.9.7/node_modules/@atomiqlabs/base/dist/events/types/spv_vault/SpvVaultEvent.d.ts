import { ChainEvent } from "../ChainEvent";
import { SwapData } from "../../../swaps/SwapData";
export declare enum SpvVaultEventType {
    OPEN = 0,
    DEPOSIT = 1,
    CLAIM = 2,
    CLOSE = 3,
    FRONT = 4
}
export declare class SpvVaultEvent<C extends SpvVaultEventType = SpvVaultEventType> extends ChainEvent<SwapData> {
    readonly eventType: C;
    owner: string;
    vaultId: bigint;
    constructor(owner: string, vaultId: bigint);
}
