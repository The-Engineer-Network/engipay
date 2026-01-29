import {SwapData} from "../../swaps/SwapData";
import {Message, MessageType} from "./Message";


export class SwapClaimWitnessMessage<T extends SwapData> extends Message {

    type = MessageType.SWAP_CLAIM_WITNESS;
    swapData: T;
    witness: string;

    constructor(swapData: T, witness: string) {
        super();
        this.swapData = swapData;
        this.witness = witness;
    }

    serialize() {
        return {
            ...super.serialize(),
            swapData: this.swapData.serialize(),
            witness: this.witness
        }
    }

    static deserialize(obj: any) {
        if(obj==null || typeof(obj.witness)!=="string" || typeof(obj.swapData)!=="object") {
            throw new Error("Invalid format!");
        }
        return new SwapClaimWitnessMessage(SwapData.deserialize(obj.swapData), obj.witness);
    }

}

Message.deserializers[MessageType.SWAP_CLAIM_WITNESS] = SwapClaimWitnessMessage.deserialize;
