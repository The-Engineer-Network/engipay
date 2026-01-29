"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BitcoinNoncedOutputClaimHandler = void 0;
const base_1 = require("@atomiqlabs/base");
const starknet_1 = require("starknet");
const Utils_1 = require("../../../../../utils/Utils");
const IBitcoinClaimHandler_1 = require("./IBitcoinClaimHandler");
const btc_signer_1 = require("@scure/btc-signer");
const buffer_1 = require("buffer");
const logger = (0, Utils_1.getLogger)("BitcoinNoncedOutputClaimHandler: ");
function getTransactionNonce(btcTx) {
    const locktimeSub500M = BigInt(btcTx.lockTime - 500000000);
    if (locktimeSub500M < 0n)
        throw new Error("Locktime too low!");
    const nSequence = BigInt(btcTx.getInput(0).sequence);
    return (locktimeSub500M << 24n) | (nSequence & 0x00ffffffn);
}
class BitcoinNoncedOutputClaimHandler extends IBitcoinClaimHandler_1.IBitcoinClaimHandler {
    serializeCommitment(data) {
        return [
            starknet_1.hash.computePoseidonHashOnElements([(0, Utils_1.toBigInt)(data.nonce), (0, Utils_1.toBigInt)(data.amount), (0, Utils_1.poseidonHashRange)(data.output)]),
            ...super.serializeCommitment(data)
        ];
    }
    async getWitness(signer, swapData, witnessData, feeRate) {
        if (!swapData.isClaimHandler(this.address))
            throw new Error("Invalid claim handler");
        const parsedBtcTx = btc_signer_1.Transaction.fromRaw(buffer_1.Buffer.from(witnessData.tx.hex, "hex"));
        const out = parsedBtcTx.getOutput(witnessData.vout);
        const { initialTxns, witness } = await this._getWitness(signer, swapData, witnessData, {
            output: buffer_1.Buffer.from(out.script),
            amount: out.amount,
            nonce: getTransactionNonce(parsedBtcTx)
        });
        witness.push(...(0, Utils_1.bufferToByteArray)(buffer_1.Buffer.from(witnessData.tx.hex, "hex")));
        witness.push(BigInt(witnessData.vout));
        return { initialTxns, witness };
    }
    getGas(data) {
        return BitcoinNoncedOutputClaimHandler.gas;
    }
    getType() {
        return BitcoinNoncedOutputClaimHandler.type;
    }
}
exports.BitcoinNoncedOutputClaimHandler = BitcoinNoncedOutputClaimHandler;
BitcoinNoncedOutputClaimHandler.type = base_1.ChainSwapType.CHAIN_NONCED;
BitcoinNoncedOutputClaimHandler.gas = { l1DataGas: 0, l2Gas: 10000 * 40000, l1Gas: 0 };
