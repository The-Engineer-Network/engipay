import {BtcHeader} from "@atomiqlabs/base";
import {Buffer} from "buffer";
import {BigNumberish} from "starknet";
import {toHex, u32ArrayToBuffer, u32ReverseEndianness} from "../../../utils/Utils";
import {sha256} from "@noble/hashes/sha2";

export type StarknetBtcHeaderType = {
    reversed_version: BigNumberish;
    previous_blockhash: BigNumberish[];
    merkle_root: BigNumberish[];
    reversed_timestamp: BigNumberish;
    nbits: BigNumberish;
    nonce: BigNumberish;
    hash?: Buffer
}

export class StarknetBtcHeader implements BtcHeader {

    reversed_version: number;
    previous_blockhash: number[];
    merkle_root: number[];
    reversed_timestamp: number;
    nbits: number;
    nonce: number;
    hash?: Buffer;

    constructor(obj: StarknetBtcHeaderType) {
        this.reversed_version = Number(obj.reversed_version);
        this.previous_blockhash = obj.previous_blockhash.map(val => Number(val));
        this.merkle_root = obj.merkle_root.map(val => Number(val));
        this.reversed_timestamp = Number(obj.reversed_timestamp);
        this.nbits = Number(obj.nbits);
        this.nonce = Number(obj.nonce);
        this.hash = obj.hash;
    }

    getMerkleRoot(): Buffer {
        return u32ArrayToBuffer(this.merkle_root);
    }

    getNbits(): number {
        return u32ReverseEndianness(this.nbits);
    }

    getNonce(): number {
        return u32ReverseEndianness(this.nonce);
    }

    getReversedPrevBlockhash(): Buffer {
        return u32ArrayToBuffer(this.previous_blockhash);
    }

    getTimestamp(): number {
        return u32ReverseEndianness(this.reversed_timestamp);
    }

    getVersion(): number {
        return u32ReverseEndianness(this.reversed_version);
    }

    getHash(): Buffer {
        if(this.hash!=null) return this.hash;
        const buffer = Buffer.alloc(80);
        buffer.writeUInt32BE(this.reversed_version, 0);
        u32ArrayToBuffer(this.previous_blockhash).copy(buffer, 4);
        u32ArrayToBuffer(this.merkle_root).copy(buffer, 36);
        buffer.writeUInt32BE(this.reversed_timestamp, 68);
        buffer.writeUInt32BE(this.nbits, 72);
        buffer.writeUInt32BE(this.nonce, 76);
        return Buffer.from(sha256(sha256(buffer)));
    }

    serialize(): BigNumberish[] {
        return [
            this.reversed_version,
            ...this.previous_blockhash,
            ...this.merkle_root,
            this.reversed_timestamp,
            this.nbits,
            this.nonce
        ];
    }

    static fromSerializedFeltArray(span: BigNumberish[]): StarknetBtcHeader {
        const reversed_version = toHex(span.shift());
        const previous_blockhash = span.splice(0, 8).map(toHex);
        const merkle_root = span.splice(0, 8).map(toHex);
        const reversed_timestamp = toHex(span.shift());
        const nbits = toHex(span.shift());
        const nonce = toHex(span.shift());
        return new StarknetBtcHeader({
            reversed_version,
            previous_blockhash,
            merkle_root,
            reversed_timestamp,
            nbits,
            nonce
        });
    }

}