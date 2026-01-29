"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IBitcoinClaimHandler = void 0;
const base_1 = require("@atomiqlabs/base");
const starknet_1 = require("starknet");
const StarknetBtcRelay_1 = require("../../../../btcrelay/StarknetBtcRelay");
const Utils_1 = require("../../../../../utils/Utils");
const logger = (0, Utils_1.getLogger)("IBitcoinClaimHandler: ");
class IBitcoinClaimHandler {
    constructor(address) {
        this.address = address;
    }
    serializeCommitment(data) {
        return [
            data.confirmations,
            data.btcRelay.contract.address
        ];
    }
    getCommitment(data) {
        return starknet_1.hash.computePoseidonHashOnElements(this.serializeCommitment(data));
    }
    async _getWitness(signer, swapData, { tx, btcRelay, commitedHeader, synchronizer, requiredConfirmations }, commitment, feeRate) {
        const serializedData = this.serializeCommitment({
            ...commitment,
            btcRelay,
            confirmations: requiredConfirmations
        });
        const commitmentHash = starknet_1.hash.computePoseidonHashOnElements(serializedData);
        if (!swapData.isClaimData(commitmentHash))
            throw new Error("Invalid commit data");
        const merkleProof = await btcRelay.bitcoinRpc.getMerkleProof(tx.txid, tx.blockhash);
        logger.debug("getWitness(): merkle proof computed: ", merkleProof);
        const txs = [];
        if (commitedHeader == null) {
            const headers = await StarknetBtcRelay_1.StarknetBtcRelay.getCommitedHeadersAndSynchronize(signer, btcRelay, [{ blockheight: tx.height, requiredConfirmations, blockhash: tx.blockhash }], txs, synchronizer, feeRate);
            if (headers == null)
                throw new Error("Cannot fetch committed header!");
            commitedHeader = headers[tx.blockhash];
        }
        serializedData.push(...commitedHeader.serialize());
        serializedData.push(merkleProof.merkle.length, ...merkleProof.merkle.map(Utils_1.bufferToU32Array).flat());
        serializedData.push(merkleProof.pos);
        return { initialTxns: txs, witness: serializedData };
    }
    parseWitnessResult(result) {
        return (0, Utils_1.u32ArrayToBuffer)(result).toString("hex");
    }
}
exports.IBitcoinClaimHandler = IBitcoinClaimHandler;
IBitcoinClaimHandler.address = "";
IBitcoinClaimHandler.type = base_1.ChainSwapType.CHAIN_TXID;
IBitcoinClaimHandler.gas = { l1DataGas: 0, l2Gas: 10000 * 40000, l1Gas: 0 };
