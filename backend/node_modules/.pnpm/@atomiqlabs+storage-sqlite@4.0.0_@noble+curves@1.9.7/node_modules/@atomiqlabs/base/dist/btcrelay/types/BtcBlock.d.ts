/// <reference types="node" />
import { Buffer } from "buffer";
export interface BtcBlock {
    getVersion(): number;
    getPrevBlockhash(): string;
    getMerkleRoot(): string;
    getTimestamp(): number;
    getNbits(): number;
    getNonce(): number;
    getHash(): string;
    getHeight(): number;
    getChainWork(): Buffer;
}
