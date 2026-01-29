import { StarknetModule } from "../StarknetModule";
import { BlockWithTxHashes } from "starknet";
export type StarknetBlockTag = "pre_confirmed" | "latest" | "l1_accepted";
export declare class StarknetBlocks extends StarknetModule {
    private BLOCK_CACHE_TIME;
    private blockCache;
    /**
     * Initiates fetch of a given block & saves it to cache
     *
     * @private
     * @param blockTag
     */
    private fetchAndSaveBlockTime;
    private cleanupBlocks;
    /**
     * Gets the block for a given blocktag, with caching
     *
     * @param blockTag
     */
    getBlock(blockTag: StarknetBlockTag | number): Promise<BlockWithTxHashes>;
    /**
     * Gets the block for a given blocktag, with caching
     *
     * @param blockTag
     */
    getBlockTime(blockTag: StarknetBlockTag | number): Promise<number>;
}
