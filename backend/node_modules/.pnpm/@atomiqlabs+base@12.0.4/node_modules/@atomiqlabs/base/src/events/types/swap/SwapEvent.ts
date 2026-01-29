import {SwapData} from "../../../swaps/SwapData";
import {ChainEvent} from "../ChainEvent";

export enum SwapEventType {
    INITIALIZE = 0,
    REFUND = 1,
    CLAIM = 2
}

export class SwapEvent<T extends SwapData, C extends SwapEventType = SwapEventType> extends ChainEvent<T> {

    readonly eventType: C;

    escrowHash: string;

    constructor(escrowHash: string) {
        super();
        this.escrowHash = escrowHash;
    }

}
