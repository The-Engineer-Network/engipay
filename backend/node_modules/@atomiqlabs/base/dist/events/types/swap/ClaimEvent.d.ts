import { SwapEvent, SwapEventType } from "./SwapEvent";
import { SwapData } from "../../../swaps/SwapData";
export declare class ClaimEvent<T extends SwapData> extends SwapEvent<T, SwapEventType.CLAIM> {
    readonly eventType: SwapEventType.CLAIM;
    result: string;
    constructor(escrowHash: string, result: string);
}
