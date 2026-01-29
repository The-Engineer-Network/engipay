/// <reference types="node" />
/// <reference types="node" />
import { BtcBlock } from "@atomiqlabs/base";
import { Buffer } from "buffer";
export type MempoolBitcoinBlockType = {
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
};
export declare class MempoolBitcoinBlock implements BtcBlock {
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
    constructor(obj: MempoolBitcoinBlockType);
    getHeight(): number;
    getHash(): string;
    getMerkleRoot(): string;
    getNbits(): number;
    getNonce(): number;
    getPrevBlockhash(): string;
    getTimestamp(): number;
    getVersion(): number;
    getChainWork(): Buffer;
}
