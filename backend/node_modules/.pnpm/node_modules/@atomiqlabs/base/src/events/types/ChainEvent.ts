import {SwapData} from "../../swaps/SwapData";

export class ChainEvent<T extends SwapData> {

    meta?: {
        blockTime: number,
        txId: string
    };

}
