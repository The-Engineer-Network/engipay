import { BtcHeader } from "@atomiqlabs/base";
import { Buffer } from "buffer";
import { BigNumberish } from "starknet";
export type StarknetBtcHeaderType = {
    reversed_version: BigNumberish;
    previous_blockhash: BigNumberish[];
    merkle_root: BigNumberish[];
    reversed_timestamp: BigNumberish;
    nbits: BigNumberish;
    nonce: BigNumberish;
    hash?: Buffer;
};
export declare class StarknetBtcHeader implements BtcHeader {
    reversed_version: number;
    previous_blockhash: number[];
    merkle_root: number[];
    reversed_timestamp: number;
    nbits: number;
    nonce: number;
    hash?: Buffer;
    constructor(obj: StarknetBtcHeaderType);
    getMerkleRoot(): Buffer;
    getNbits(): number;
    getNonce(): number;
    getReversedPrevBlockhash(): Buffer;
    getTimestamp(): number;
    getVersion(): number;
    getHash(): Buffer;
    serialize(): BigNumberish[];
    static fromSerializedFeltArray(span: BigNumberish[]): StarknetBtcHeader;
}
