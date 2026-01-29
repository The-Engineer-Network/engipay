import { SwapData } from "../../swaps/SwapData";
export declare class ChainEvent<T extends SwapData> {
    meta?: {
        blockTime: number;
        txId: string;
    };
}
