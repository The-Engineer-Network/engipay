import {BtcStoredHeader, StatePredictorUtils} from "@atomiqlabs/base";
import {StarknetBtcHeader, StarknetBtcHeaderType} from "./StarknetBtcHeader";
import {Buffer} from "buffer";
import {BigNumberish, cairo, Uint256} from "starknet";
import {bigNumberishToBuffer, bufferToU32Array, u32ArrayToBuffer, isUint256, toHex} from "../../../utils/Utils";

export type StarknetBtcStoredHeaderType = {
    blockheader: StarknetBtcHeader | StarknetBtcHeaderType,
    block_hash: BigNumberish[],
    chain_work: BigNumberish | Uint256,
    block_height: BigNumberish,
    last_diff_adjustment: BigNumberish,
    prev_block_timestamps: BigNumberish[]
}

export class StarknetBtcStoredHeader implements BtcStoredHeader<StarknetBtcHeader> {

    blockheader: StarknetBtcHeader;
    block_hash: number[];
    chain_work: Uint256;
    block_height: number;
    last_diff_adjustment: number;
    prev_block_timestamps: number[];

    constructor(obj: StarknetBtcStoredHeaderType) {
        this.blockheader = obj.blockheader instanceof StarknetBtcHeader ? obj.blockheader : new StarknetBtcHeader(obj.blockheader);
        this.block_hash = obj.block_hash.map(val => Number(val));
        this.chain_work = isUint256(obj.chain_work) ? obj.chain_work : cairo.uint256(obj.chain_work);
        this.block_height = Number(obj.block_height);
        this.last_diff_adjustment = Number(obj.last_diff_adjustment);
        this.prev_block_timestamps = obj.prev_block_timestamps.map(val => Number(val));
    }

    getBlockheight(): number {
        return this.block_height;
    }

    getChainWork(): Buffer {
        return bigNumberishToBuffer(this.chain_work, 32);
    }

    getHeader(): StarknetBtcHeader {
        return this.blockheader;
    }

    getLastDiffAdjustment(): number {
        return this.last_diff_adjustment;
    }

    getPrevBlockTimestamps(): number[] {
        return this.prev_block_timestamps;
    }

    getBlockHash(): Buffer {
        return u32ArrayToBuffer(this.block_hash).reverse();
    }

    /**
     * Computes prevBlockTimestamps for a next block, shifting the old block timestamps to the left & appending
     *  this block's timestamp to the end
     *
     * @private
     */
    private computeNextBlockTimestamps(): number[] {
        const prevBlockTimestamps = [...this.prev_block_timestamps];
        for(let i=1;i<10;i++) {
            prevBlockTimestamps[i-1] = prevBlockTimestamps[i];
        }
        prevBlockTimestamps[9] = this.blockheader.getTimestamp();
        return prevBlockTimestamps;
    }

    /**
     * Computes total chain work after a new header with "nbits" is added to the chain
     *
     * @param nbits
     * @private
     */
    private computeNextChainWork(nbits: number): Buffer {
        const chainWork = [...this.getChainWork()];
        StatePredictorUtils.addInPlace(chainWork, [...StatePredictorUtils.getChainwork(nbits)]);
        return Buffer.from(chainWork);
    }

    /**
     * Computes lastDiffAdjustment, this changes only once every DIFF_ADJUSTMENT_PERIOD blocks
     *
     * @param headerTimestamp
     * @private
     */
    private computeNextLastDiffAdjustment(headerTimestamp: number) {
        const blockheight = this.block_height+1;

        let lastDiffAdjustment = this.last_diff_adjustment;
        if(blockheight % StatePredictorUtils.DIFF_ADJUSTMENT_PERIOD === 0) {
            lastDiffAdjustment = headerTimestamp;
        }

        return lastDiffAdjustment;
    }

    computeNext(header: StarknetBtcHeader): StarknetBtcStoredHeader {
        return new StarknetBtcStoredHeader({
            chain_work: "0x"+this.computeNextChainWork(header.getNbits()).toString("hex"),
            prev_block_timestamps: this.computeNextBlockTimestamps(),
            block_height: this.block_height+1,
            last_diff_adjustment: this.computeNextLastDiffAdjustment(header.getTimestamp()),
            block_hash: bufferToU32Array(header.getHash()),
            blockheader: header
        });
    }

    serialize(): BigNumberish[] {
        return [
            ...this.blockheader.serialize(),
            ...this.block_hash,
            this.chain_work.low,
            this.chain_work.high,
            this.block_height,
            this.last_diff_adjustment,
            ...this.prev_block_timestamps
        ]
    }

    static fromSerializedFeltArray(span: BigNumberish[]): StarknetBtcStoredHeader {
        const blockheader = StarknetBtcHeader.fromSerializedFeltArray(span);
        const block_hash = span.splice(0, 8).map(toHex);
        const chain_work = {low: span.shift(), high: span.shift()};
        const block_height = toHex(span.shift());
        const last_diff_adjustment = toHex(span.shift());
        const prev_block_timestamps = span.splice(0, 10).map(toHex);
        return new StarknetBtcStoredHeader({
            blockheader,
            block_hash,
            chain_work,
            block_height,
            last_diff_adjustment,
            prev_block_timestamps
        });
    }

}