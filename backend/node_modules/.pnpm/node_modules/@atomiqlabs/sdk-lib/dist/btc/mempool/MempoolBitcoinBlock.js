"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MempoolBitcoinBlock = void 0;
class MempoolBitcoinBlock {
    constructor(obj) {
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
    getHeight() {
        return this.height;
    }
    getHash() {
        return this.id;
    }
    getMerkleRoot() {
        return this.merkle_root;
    }
    getNbits() {
        return this.bits;
    }
    getNonce() {
        return this.nonce;
    }
    getPrevBlockhash() {
        return this.previousblockhash;
    }
    getTimestamp() {
        return this.timestamp;
    }
    getVersion() {
        return this.version;
    }
    getChainWork() {
        throw new Error("Unsupported");
    }
}
exports.MempoolBitcoinBlock = MempoolBitcoinBlock;
