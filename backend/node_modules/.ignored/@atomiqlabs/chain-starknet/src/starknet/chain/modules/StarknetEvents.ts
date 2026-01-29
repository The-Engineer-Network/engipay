import {StarknetModule} from "../StarknetModule";

export type StarknetEvent = {
    block_hash: string;
    block_number: number;
    transaction_hash: string;
    from_address: string;
    keys: string[];
    data: string[];
}

export class StarknetEvents extends StarknetModule {

    public readonly EVENTS_LIMIT = 100;
    public readonly FORWARD_BLOCK_RANGE = 2000;

    /**
     * Returns the all the events occuring in a block range as identified by the contract and keys
     *
     * @param contract
     * @param keys
     * @param startBlock
     * @param endBlock
     * @param abortSignal
     */
    public async getBlockEvents(contract: string, keys: string[][], startBlock?: number, endBlock: number = startBlock, abortSignal?: AbortSignal): Promise<StarknetEvent[]> {
        const events: StarknetEvent[] = [];
        let result = null;
        while(result==null || result?.continuation_token!=null) {
            result = await this.root.provider.getEvents({
                address: contract,
                from_block: startBlock==null ? "latest" : {block_number: startBlock},
                to_block: endBlock==null ? "latest" : {block_number: endBlock},
                keys,
                chunk_size: this.EVENTS_LIMIT,
                continuation_token: result?.continuation_token
            });
            if(abortSignal!=null) abortSignal.throwIfAborted();
            events.push(...result.events);
        }
        return events;
    }

    /**
     * Runs a search backwards in time, processing events from a specific contract and keys
     *
     * @param contract
     * @param keys
     * @param processor called for every batch of returned signatures, should return a value if the correct signature
     *  was found, or null if the search should continue
     * @param abortSignal
     */
    public async findInEvents<T>(
        contract: string, keys: string[][],
        processor: (signatures: StarknetEvent[]) => Promise<T>,
        abortSignal?: AbortSignal
    ): Promise<T> {
        const latestBlockNumber = await this.provider.getBlockNumber();

        for(let blockNumber = latestBlockNumber; blockNumber >= 0; blockNumber-=this.FORWARD_BLOCK_RANGE) {
            const eventsResult = await this.getBlockEvents(
                contract, keys,
                Math.max(blockNumber-this.FORWARD_BLOCK_RANGE, 0), blockNumber===latestBlockNumber ? null : blockNumber,
                abortSignal
            );
            const result: T = await processor(eventsResult.reverse());
            if(result!=null) return result;
        }
        return null;
    }

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
    public async findInEventsForward<T>(
        contract: string, keys: string[][],
        processor: (signatures: StarknetEvent[]) => Promise<T>,
        startHeight?: number,
        abortSignal?: AbortSignal,
        logFetchLimit?: number
    ): Promise<T> {
        if(logFetchLimit==null || logFetchLimit>this.EVENTS_LIMIT) logFetchLimit = this.EVENTS_LIMIT;
        let eventsResult = null;
        while(eventsResult==null || eventsResult?.continuation_token!=null) {
            eventsResult = await this.root.provider.getEvents({
                address: contract,
                from_block: startHeight==null ? undefined : {block_number: startHeight},
                to_block: "latest",
                keys,
                chunk_size: logFetchLimit ?? this.EVENTS_LIMIT,
                continuation_token: eventsResult?.continuation_token
            });
            if(abortSignal!=null) abortSignal.throwIfAborted();
            const result: T = await processor(eventsResult.events);
            if(result!=null) return result;
        }
        return null;
    }

}