"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetEvents = void 0;
const StarknetModule_1 = require("../StarknetModule");
class StarknetEvents extends StarknetModule_1.StarknetModule {
    constructor() {
        super(...arguments);
        this.EVENTS_LIMIT = 100;
        this.FORWARD_BLOCK_RANGE = 2000;
    }
    /**
     * Returns the all the events occuring in a block range as identified by the contract and keys
     *
     * @param contract
     * @param keys
     * @param startBlock
     * @param endBlock
     * @param abortSignal
     */
    async getBlockEvents(contract, keys, startBlock, endBlock = startBlock, abortSignal) {
        const events = [];
        let result = null;
        while (result == null || result?.continuation_token != null) {
            result = await this.root.provider.getEvents({
                address: contract,
                from_block: startBlock == null ? "latest" : { block_number: startBlock },
                to_block: endBlock == null ? "latest" : { block_number: endBlock },
                keys,
                chunk_size: this.EVENTS_LIMIT,
                continuation_token: result?.continuation_token
            });
            if (abortSignal != null)
                abortSignal.throwIfAborted();
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
    async findInEvents(contract, keys, processor, abortSignal) {
        const latestBlockNumber = await this.provider.getBlockNumber();
        for (let blockNumber = latestBlockNumber; blockNumber >= 0; blockNumber -= this.FORWARD_BLOCK_RANGE) {
            const eventsResult = await this.getBlockEvents(contract, keys, Math.max(blockNumber - this.FORWARD_BLOCK_RANGE, 0), blockNumber === latestBlockNumber ? null : blockNumber, abortSignal);
            const result = await processor(eventsResult.reverse());
            if (result != null)
                return result;
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
    async findInEventsForward(contract, keys, processor, startHeight, abortSignal, logFetchLimit) {
        if (logFetchLimit == null || logFetchLimit > this.EVENTS_LIMIT)
            logFetchLimit = this.EVENTS_LIMIT;
        let eventsResult = null;
        while (eventsResult == null || eventsResult?.continuation_token != null) {
            eventsResult = await this.root.provider.getEvents({
                address: contract,
                from_block: startHeight == null ? undefined : { block_number: startHeight },
                to_block: "latest",
                keys,
                chunk_size: logFetchLimit ?? this.EVENTS_LIMIT,
                continuation_token: eventsResult?.continuation_token
            });
            if (abortSignal != null)
                abortSignal.throwIfAborted();
            const result = await processor(eventsResult.events);
            if (result != null)
                return result;
        }
        return null;
    }
}
exports.StarknetEvents = StarknetEvents;
