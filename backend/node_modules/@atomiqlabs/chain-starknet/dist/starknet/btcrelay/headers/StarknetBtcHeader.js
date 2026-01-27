"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetBtcHeader = void 0;
const buffer_1 = require("buffer");
const Utils_1 = require("../../../utils/Utils");
const sha2_1 = require("@noble/hashes/sha2");
class StarknetBtcHeader {
    constructor(obj) {
        this.reversed_version = Number(obj.reversed_version);
        this.previous_blockhash = obj.previous_blockhash.map(val => Number(val));
        this.merkle_root = obj.merkle_root.map(val => Number(val));
        this.reversed_timestamp = Number(obj.reversed_timestamp);
        this.nbits = Number(obj.nbits);
        this.nonce = Number(obj.nonce);
        this.hash = obj.hash;
    }
    getMerkleRoot() {
        return (0, Utils_1.u32ArrayToBuffer)(this.merkle_root);
    }
    getNbits() {
        return (0, Utils_1.u32ReverseEndianness)(this.nbits);
    }
    getNonce() {
        return (0, Utils_1.u32ReverseEndianness)(this.nonce);
    }
    getReversedPrevBlockhash() {
        return (0, Utils_1.u32ArrayToBuffer)(this.previous_blockhash);
    }
    getTimestamp() {
        return (0, Utils_1.u32ReverseEndianness)(this.reversed_timestamp);
    }
    getVersion() {
        return (0, Utils_1.u32ReverseEndianness)(this.reversed_version);
    }
    getHash() {
        if (this.hash != null)
            return this.hash;
        const buffer = buffer_1.Buffer.alloc(80);
        buffer.writeUInt32BE(this.reversed_version, 0);
        (0, Utils_1.u32ArrayToBuffer)(this.previous_blockhash).copy(buffer, 4);
        (0, Utils_1.u32ArrayToBuffer)(this.merkle_root).copy(buffer, 36);
        buffer.writeUInt32BE(this.reversed_timestamp, 68);
        buffer.writeUInt32BE(this.nbits, 72);
        buffer.writeUInt32BE(this.nonce, 76);
        return buffer_1.Buffer.from((0, sha2_1.sha256)((0, sha2_1.sha256)(buffer)));
    }
    serialize() {
        return [
            this.reversed_version,
            ...this.previous_blockhash,
            ...this.merkle_root,
            this.reversed_timestamp,
            this.nbits,
            this.nonce
        ];
    }
    static fromSerializedFeltArray(span) {
        const reversed_version = (0, Utils_1.toHex)(span.shift());
        const previous_blockhash = span.splice(0, 8).map(Utils_1.toHex);
        const merkle_root = span.splice(0, 8).map(Utils_1.toHex);
        const reversed_timestamp = (0, Utils_1.toHex)(span.shift());
        const nbits = (0, Utils_1.toHex)(span.shift());
        const nonce = (0, Utils_1.toHex)(span.shift());
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
exports.StarknetBtcHeader = StarknetBtcHeader;
