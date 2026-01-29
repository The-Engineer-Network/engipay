/// <reference types="node" />
import { Buffer } from "buffer";
export interface BtcHeader {
    getVersion(): number;
    getReversedPrevBlockhash(): Buffer;
    getMerkleRoot(): Buffer;
    getTimestamp(): number;
    getNbits(): number;
    getNonce(): number;
}
