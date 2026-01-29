"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BitcoinTxIdClaimHandler = void 0;
const base_1 = require("@atomiqlabs/base");
const Utils_1 = require("../../../../../utils/Utils");
const IBitcoinClaimHandler_1 = require("./IBitcoinClaimHandler");
const buffer_1 = require("buffer");
const logger = (0, Utils_1.getLogger)("BitcoinTxIdClaimHandler: ");
class BitcoinTxIdClaimHandler extends IBitcoinClaimHandler_1.IBitcoinClaimHandler {
    serializeCommitment(data) {
        return [
            ...(0, Utils_1.bufferToU32Array)(buffer_1.Buffer.from(data.txId, "hex").reverse()),
            ...super.serializeCommitment(data)
        ];
    }
    getWitness(signer, swapData, witnessData, feeRate) {
        if (!swapData.isClaimHandler(this.address))
            throw new Error("Invalid claim handler");
        return this._getWitness(signer, swapData, witnessData, { txId: witnessData.tx.txid });
    }
    getGas(data) {
        return BitcoinTxIdClaimHandler.gas;
    }
    getType() {
        return BitcoinTxIdClaimHandler.type;
    }
}
exports.BitcoinTxIdClaimHandler = BitcoinTxIdClaimHandler;
BitcoinTxIdClaimHandler.type = base_1.ChainSwapType.CHAIN_TXID;
BitcoinTxIdClaimHandler.gas = { l1DataGas: 0, l2Gas: 10000 * 40000, l1Gas: 0 };
