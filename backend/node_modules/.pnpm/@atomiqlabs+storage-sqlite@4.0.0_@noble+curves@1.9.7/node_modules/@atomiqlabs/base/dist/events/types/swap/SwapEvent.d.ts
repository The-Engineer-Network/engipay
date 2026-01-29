import { SwapData } from "../../../swaps/SwapData";
import { ChainEvent } from "../ChainEvent";
export declare enum SwapEventType {
    INITIALIZE = 0,
    REFUND = 1,
    CLAIM = 2
}
export declare class SwapEvent<T extends SwapData, C extends SwapEventType = SwapEventType> extends ChainEvent<T> {
    readonly eventType: C;
    escrowHash: string;
    constructor(escrowHash: string);
}
