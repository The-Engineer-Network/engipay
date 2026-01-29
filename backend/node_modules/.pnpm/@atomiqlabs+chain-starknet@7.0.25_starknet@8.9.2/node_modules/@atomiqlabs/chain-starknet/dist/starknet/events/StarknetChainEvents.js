"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetChainEvents = void 0;
const StarknetChainEventsBrowser_1 = require("./StarknetChainEventsBrowser");
//@ts-ignore
const fs = require("fs/promises");
const BLOCKHEIGHT_FILENAME = "/strk-blockheight.txt";
class StarknetChainEvents extends StarknetChainEventsBrowser_1.StarknetChainEventsBrowser {
    constructor(directory, chainInterface, starknetSwapContract, starknetSpvVaultContract, pollIntervalSeconds) {
        super(chainInterface, starknetSwapContract, starknetSpvVaultContract, pollIntervalSeconds);
        this.directory = directory;
    }
    /**
     * Retrieves last signature & slot from filesystem
     *
     * @private
     */
    async getLastEventData() {
        try {
            const txt = (await fs.readFile(this.directory + BLOCKHEIGHT_FILENAME)).toString();
            const arr = txt.split(",");
            if (arr.length < 2) {
                const blockNumber = parseInt(arr[0].split(";")[0]);
                if (isNaN(blockNumber))
                    throw new Error("Cannot parse the integer, is NaN!");
                return [
                    { lastBlockNumber: blockNumber, lastTxHash: null },
                    { lastBlockNumber: blockNumber, lastTxHash: null }
                ];
            }
            return arr.map(arrValue => {
                const subArray = arrValue.split(";");
                const lastBlockNumber = parseInt(subArray[0]);
                if (isNaN(lastBlockNumber))
                    throw new Error("Cannot parse the integer, is NaN!");
                return { lastBlockNumber, lastTxHash: subArray[1] };
            });
        }
        catch (e) {
            return [];
        }
    }
    /**
     * Saves last signature & slot to the filesystem
     *
     * @private
     */
    saveLastEventData(newState) {
        return fs.writeFile(this.directory + BLOCKHEIGHT_FILENAME, newState.map(value => value.lastTxHash == null ? value.lastBlockNumber.toString(10) : value.lastBlockNumber.toString(10) + ";" + value.lastTxHash).join(","));
    }
    async init() {
        const lastEventsState = await this.getLastEventData();
        if (this.wsChannel != null)
            await this.setupWebsocket();
        await this.setupPoll(lastEventsState, (newState) => this.saveLastEventData(newState));
    }
}
exports.StarknetChainEvents = StarknetChainEvents;
