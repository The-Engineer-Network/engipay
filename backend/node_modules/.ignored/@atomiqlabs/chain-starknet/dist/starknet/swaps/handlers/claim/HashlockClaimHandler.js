"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HashlockClaimHandler = void 0;
const Utils_1 = require("../../../../utils/Utils");
const starknet_1 = require("starknet");
const base_1 = require("@atomiqlabs/base");
const buffer_1 = require("buffer");
const sha2_1 = require("@noble/hashes/sha2");
class HashlockClaimHandler {
    constructor(address) {
        this.address = address;
    }
    getCommitment(data) {
        if (data.length !== 32)
            throw new Error("Invalid swap hash");
        return starknet_1.hash.computePoseidonHashOnElements((0, Utils_1.bufferToU32Array)(data));
    }
    getWitness(signer, data, witnessData) {
        if (!data.isClaimHandler(this.address))
            throw new Error("Invalid claim handler");
        if (witnessData.length !== 64)
            throw new Error("Invalid hash secret: string length");
        const buffer = buffer_1.Buffer.from(witnessData, "hex");
        if (buffer.length !== 32)
            throw new Error("Invalid hash secret: buff length");
        const witnessSha256 = buffer_1.Buffer.from((0, sha2_1.sha256)(buffer));
        if (!data.isClaimData((0, Utils_1.toHex)(this.getCommitment(witnessSha256))))
            throw new Error("Invalid hash secret: poseidon hash doesn't match");
        const witnessArray = (0, Utils_1.bufferToU32Array)(buffer);
        return Promise.resolve({ initialTxns: [], witness: witnessArray });
    }
    getGas() {
        return HashlockClaimHandler.gas;
    }
    getType() {
        return HashlockClaimHandler.type;
    }
    parseWitnessResult(result) {
        return (0, Utils_1.u32ArrayToBuffer)(result).toString("hex");
    }
}
exports.HashlockClaimHandler = HashlockClaimHandler;
HashlockClaimHandler.type = base_1.ChainSwapType.HTLC;
HashlockClaimHandler.gas = { l1DataGas: 0, l2Gas: 16000000, l1Gas: 0 };
