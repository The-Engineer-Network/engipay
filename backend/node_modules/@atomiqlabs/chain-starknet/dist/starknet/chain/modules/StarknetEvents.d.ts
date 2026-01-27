import { StarknetModule } from "../StarknetModule";
export type StarknetEvent = {
    block_hash: string;
    block_number: number;
    transaction_hash: string;
    from_address: string;
    keys: string[];
    data: string[];
};
export declare class StarknetEvents extends StarknetModule {
    readonly EVENTS_LIMIT = 100;
    readonly FORWARD_BLOCK_RANGE = 2000;
    /**
     * Returns the all the events occuring in a block range as identified by the contract and keys
     *
     * @param contract
     * @param keys
     * @param startBlock
     * @param endBlock
     * @param abortSignal
     */
    getBlockEvents(contract: string, keys: string[][], startBlock?: number, endBlock?: number, abortSignal?: AbortSignal): Promise<StarknetEvent[]>;
    /**
     * Runs a search backwards in time, processing events from a specific contract and keys
     *
     * @param contract
     * @param keys
     * @param processor called for every batch of returned signatures, should return a value if the correct signature
     *  was found, or null if the search should continue
     * @param abortSignal
     */
    findInEvents<T>(contract: string, keys: string[][], processor: (signatures: StarknetEvent[]) => Promise<T>, abortSignal?: AbortSignal): Promise<T>;
    /**
     * Runs a search forwards in time, processing events from a specific contract and keys
     *
     * @param contract
     * @param keys
     * @param processor called for every batch of returned signatures, should return a value if the correct signature
     *  was found, or null if the search should continue
     * @param startHeight
     * @param abortSignal
     * @param logFetchLimit
     */
    findInEventsForward<T>(contract: string, keys: string[][], processor: (signatures: StarknetEvent[]) => Promise<T>, startHeight?: number, abortSignal?: AbortSignal, logFetchLimit?: number): Promise<T>;
}
