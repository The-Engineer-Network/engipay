import { BtcStoredHeader } from "@atomiqlabs/base";
import { StarknetBtcHeader, StarknetBtcHeaderType } from "./StarknetBtcHeader";
import { Buffer } from "buffer";
import { BigNumberish, Uint256 } from "starknet";
export type StarknetBtcStoredHeaderType = {
    blockheader: StarknetBtcHeader | StarknetBtcHeaderType;
    block_hash: BigNumberish[];
    chain_work: BigNumberish | Uint256;
    block_height: BigNumberish;
    last_diff_adjustment: BigNumberish;
    prev_block_timestamps: BigNumberish[];
};
export declare class StarknetBtcStoredHeader implements BtcStoredHeader<StarknetBtcHeader> {
    blockheader: StarknetBtcHeader;
    block_hash: number[];
    chain_work: Uint256;
    block_height: number;
    last_diff_adjustment: number;
    prev_block_timestamps: number[];
    constructor(obj: StarknetBtcStoredHeaderType);
    getBlockheight(): number;
    getChainWork(): Buffer;
    getHeader(): StarknetBtcHeader;
    getLastDiffAdjustment(): number;
    getPrevBlockTimestamps(): number[];
    getBlockHash(): Buffer;
    /**
     * Computes prevBlockTimestamps for a next block, shifting the old block timestamps to the left & appending
     *  this block's timestamp to the end
     *
     * @private
     */
    private computeNextBlockTimestamps;
    /**
     * Computes total chain work after a new header with "nbits" is added to the chain
     *
     * @param nbits
     * @private
     */
    private computeNextChainWork;
    /**
     * Computes lastDiffAdjustment, this changes only once every DIFF_ADJUSTMENT_PERIOD blocks
     *
     * @param headerTimestamp
     * @private
     */
    private computeNextLastDiffAdjustment;
    computeNext(header: StarknetBtcHeader): StarknetBtcStoredHeader;
    serialize(): BigNumberish[];
    static fromSerializedFeltArray(span: BigNumberish[]): StarknetBtcStoredHeader;
}
