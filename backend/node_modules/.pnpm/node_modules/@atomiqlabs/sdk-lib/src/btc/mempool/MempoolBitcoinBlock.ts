import {BtcBlock} from "@atomiqlabs/base";
import {Buffer} from "buffer";

export type MempoolBitcoinBlockType = {
    id: string,
    height: number,
    version: number,
    timestamp: number,
    tx_count: number,
    size: number,
    weight: number,
    merkle_root: string,
    previousblockhash: string,
    mediantime: number,
    nonce: number,
    bits: number,
    difficulty: number
}

export class MempoolBitcoinBlock implements BtcBlock {

    id: string;
    height: number;
    version: number;
    timestamp: number;
    tx_count: number;
    size: number;
    weight: number;
    merkle_root: string;
    previousblockhash: string;
    mediantime: number;
    nonce: number;
    bits: number;
    difficulty: number;

    constructor(obj: MempoolBitcoinBlockType) {
        this.id = obj.id;
        this.height = obj.height;
        this.version = obj.version;
        this.timestamp = obj.timestamp;
        this.tx_count = obj.tx_count;
        this.size = obj.size;
        this.weight = obj.weight;
        this.merkle_root = obj.merkle_root;
        this.previousblockhash = obj.previousblockhash;
        this.mediantime = obj.mediantime;
        this.nonce = obj.nonce;
        this.bits = obj.bits;
        this.difficulty = obj.difficulty;
    }

    getHeight(): number {
        return this.height;
    }

    getHash(): string {
        return this.id;
    }

    getMerkleRoot(): string {
        return this.merkle_root;
    }

    getNbits(): number {
        return this.bits;
    }

    getNonce(): number {
        return this.nonce;
    }

    getPrevBlockhash(): string {
        return this.previousblockhash;
    }

    getTimestamp(): number {
        return this.timestamp;
    }

    getVersion(): number {
        return this.version;
    }

    getChainWork(): Buffer {
        throw new Error("Unsupported");
    }

}