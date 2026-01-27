import { SwapData } from "../../swaps/SwapData";
import { Message, MessageType } from "./Message";
export declare class SwapClaimWitnessMessage<T extends SwapData> extends Message {
    type: MessageType;
    swapData: T;
    witness: string;
    constructor(swapData: T, witness: string);
    serialize(): any;
    static deserialize(obj: any): SwapClaimWitnessMessage<SwapData>;
}
