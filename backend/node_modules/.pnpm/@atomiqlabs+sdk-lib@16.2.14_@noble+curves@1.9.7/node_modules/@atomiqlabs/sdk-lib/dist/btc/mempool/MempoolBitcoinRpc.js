"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MempoolBitcoinRpc = void 0;
const base_1 = require("@atomiqlabs/base");
const MempoolBitcoinBlock_1 = require("./MempoolBitcoinBlock");
const MempoolApi_1 = require("./MempoolApi");
const buffer_1 = require("buffer");
const Utils_1 = require("../../utils/Utils");
const btc_signer_1 = require("@scure/btc-signer");
const sha2_1 = require("@noble/hashes/sha2");
const BITCOIN_BLOCKTIME = 600 * 1000;
const BITCOIN_BLOCKSIZE = 1024 * 1024;
function bitcoinTxToBtcTx(btcTx) {
    return {
        locktime: btcTx.lockTime,
        version: btcTx.version,
        blockhash: null,
        confirmations: 0,
        txid: buffer_1.Buffer.from((0, sha2_1.sha256)((0, sha2_1.sha256)(btcTx.toBytes(true, false)))).reverse().toString("hex"),
        hex: buffer_1.Buffer.from(btcTx.toBytes(true, false)).toString("hex"),
        raw: buffer_1.Buffer.from(btcTx.toBytes(true, true)).toString("hex"),
        vsize: btcTx.isFinal ? btcTx.vsize : null,
        outs: Array.from({ length: btcTx.outputsLength }, (_, i) => i).map((index) => {
            const output = btcTx.getOutput(index);
            return {
                value: Number(output.amount),
                n: index,
                scriptPubKey: {
                    asm: btc_signer_1.Script.decode(output.script).map(val => typeof (val) === "object" ? buffer_1.Buffer.from(val).toString("hex") : val.toString()).join(" "),
                    hex: buffer_1.Buffer.from(output.script).toString("hex")
                }
            };
        }),
        ins: Array.from({ length: btcTx.inputsLength }, (_, i) => i).map(index => {
            const input = btcTx.getInput(index);
            return {
                txid: buffer_1.Buffer.from(input.txid).toString("hex"),
                vout: input.index,
                scriptSig: {
                    asm: btc_signer_1.Script.decode(input.finalScriptSig).map(val => typeof (val) === "object" ? buffer_1.Buffer.from(val).toString("hex") : val.toString()).join(" "),
                    hex: buffer_1.Buffer.from(input.finalScriptSig).toString("hex")
                },
                sequence: input.sequence,
                txinwitness: input.finalScriptWitness == null ? [] : input.finalScriptWitness.map(witness => buffer_1.Buffer.from(witness).toString("hex"))
            };
        })
    };
}
class MempoolBitcoinRpc {
    constructor(urlOrMempoolApi) {
        this.api = urlOrMempoolApi instanceof MempoolApi_1.MempoolApi ? urlOrMempoolApi : new MempoolApi_1.MempoolApi(urlOrMempoolApi);
    }
    /**
     * Returns a txo hash for a specific transaction vout
     *
     * @param vout
     * @private
     */
    static getTxoHash(vout) {
        return buffer_1.Buffer.from((0, sha2_1.sha256)(buffer_1.Buffer.concat([
            base_1.BigIntBufferUtils.toBuffer(BigInt(vout.value), "le", 8),
            buffer_1.Buffer.from(vout.scriptpubkey, "hex")
        ])));
    }
    /**
     * Returns delay in milliseconds till an unconfirmed transaction is expected to confirm, returns -1
     *  if the transaction won't confirm any time soon
     *
     * @param feeRate
     * @private
     */
    async getTimeTillConfirmation(feeRate) {
        const mempoolBlocks = await this.api.getPendingBlocks();
        const mempoolBlockIndex = mempoolBlocks.findIndex(block => block.feeRange[0] <= feeRate);
        if (mempoolBlockIndex === -1)
            return -1;
        //Last returned block is usually an aggregate (or a stack) of multiple btc blocks, if tx falls in this block
        // and the last returned block really is an aggregate one (size bigger than BITCOIN_BLOCKSIZE) we return -1
        if (mempoolBlockIndex + 1 === mempoolBlocks.length &&
            mempoolBlocks[mempoolBlocks.length - 1].blockVSize > BITCOIN_BLOCKSIZE)
            return -1;
        return (mempoolBlockIndex + 1) * BITCOIN_BLOCKTIME;
    }
    /**
     * Returns an estimate after which time the tx will confirm with the required amount of confirmations,
     *  confirmationDelay of -1 means the transaction won't confirm in the near future
     *
     * @param tx
     * @param requiredConfirmations
     * @private
     *
     * @returns estimated confirmation delay, -1 if the transaction won't confirm in the near future, null if the
     *  transaction was replaced or was confirmed in the meantime
     */
    async getConfirmationDelay(tx, requiredConfirmations) {
        if (tx.confirmations > requiredConfirmations)
            return 0;
        if (tx.confirmations === 0) {
            //Get CPFP data
            const cpfpData = await this.api.getCPFPData(tx.txid);
            if (cpfpData.effectiveFeePerVsize == null) {
                //Transaction is either confirmed in the meantime, or replaced
                return null;
            }
            let confirmationDelay = (await this.getTimeTillConfirmation(cpfpData.effectiveFeePerVsize));
            if (confirmationDelay !== -1)
                confirmationDelay += (requiredConfirmations - 1) * BITCOIN_BLOCKTIME;
            return confirmationDelay;
        }
        return ((requiredConfirmations - tx.confirmations) * BITCOIN_BLOCKTIME);
    }
    /**
     * Converts mempool API's transaction to BtcTx object
     * @param tx Transaction to convert
     * @param getRaw If the raw transaction field should be filled (requires one more network request)
     * @private
     */
    async toBtcTx(tx, getRaw = true) {
        const rawTx = !getRaw ? null : await this.api.getRawTransaction(tx.txid);
        let confirmations = 0;
        if (tx.status != null && tx.status.confirmed) {
            const blockheight = await this.api.getTipBlockHeight();
            confirmations = blockheight - tx.status.block_height + 1;
        }
        let strippedRawTx;
        if (rawTx != null) {
            //Strip witness data
            const btcTx = btc_signer_1.Transaction.fromRaw(rawTx, {
                allowLegacyWitnessUtxo: true,
                allowUnknownInputs: true,
                allowUnknownOutputs: true,
                disableScriptCheck: true
            });
            strippedRawTx = buffer_1.Buffer.from(btcTx.toBytes(true, false)).toString("hex");
        }
        return {
            locktime: tx.locktime,
            version: tx.version,
            blockheight: tx.status?.block_height,
            blockhash: tx.status?.block_hash,
            confirmations,
            txid: tx.txid,
            vsize: tx.weight / 4,
            hex: strippedRawTx,
            raw: rawTx == null ? null : rawTx.toString("hex"),
            outs: tx.vout.map((e, index) => {
                return {
                    value: e.value,
                    n: index,
                    scriptPubKey: {
                        hex: e.scriptpubkey,
                        asm: e.scriptpubkey_asm
                    }
                };
            }),
            ins: tx.vin.map(e => {
                return {
                    txid: e.txid,
                    vout: e.vout,
                    scriptSig: {
                        hex: e.scriptsig,
                        asm: e.scriptsig_asm
                    },
                    sequence: e.sequence,
                    txinwitness: e.witness
                };
            }),
        };
    }
    getTipHeight() {
        return this.api.getTipBlockHeight();
    }
    async getBlockHeader(blockhash) {
        return new MempoolBitcoinBlock_1.MempoolBitcoinBlock(await this.api.getBlockHeader(blockhash));
    }
    async getMerkleProof(txId, blockhash) {
        const proof = await this.api.getTransactionProof(txId);
        return {
            reversedTxId: buffer_1.Buffer.from(txId, "hex").reverse(),
            pos: proof.pos,
            merkle: proof.merkle.map(e => buffer_1.Buffer.from(e, "hex").reverse()),
            blockheight: proof.block_height
        };
    }
    async getTransaction(txId) {
        const tx = await this.api.getTransaction(txId);
        if (tx == null)
            return null;
        return await this.toBtcTx(tx);
    }
    async isInMainChain(blockhash) {
        const blockStatus = await this.api.getBlockStatus(blockhash);
        return blockStatus.in_best_chain;
    }
    getBlockhash(height) {
        return this.api.getBlockHash(height);
    }
    getBlockWithTransactions(blockhash) {
        throw new Error("Unsupported.");
    }
    async getSyncInfo() {
        const tipHeight = await this.api.getTipBlockHeight();
        return {
            verificationProgress: 1,
            blocks: tipHeight,
            headers: tipHeight,
            ibd: false
        };
    }
    async getPast15Blocks(height) {
        return (await this.api.getPast15BlockHeaders(height)).map(blockHeader => new MempoolBitcoinBlock_1.MempoolBitcoinBlock(blockHeader));
    }
    async checkAddressTxos(address, txoHash) {
        const allTxs = await this.api.getAddressTransactions(address);
        const relevantTxs = allTxs
            .map(tx => {
            return {
                tx,
                vout: tx.vout.findIndex(vout => MempoolBitcoinRpc.getTxoHash(vout).equals(txoHash))
            };
        })
            .filter(obj => obj.vout >= 0)
            .sort((a, b) => {
            if (a.tx.status.confirmed && !b.tx.status.confirmed)
                return -1;
            if (!a.tx.status.confirmed && b.tx.status.confirmed)
                return 1;
            if (a.tx.status.confirmed && b.tx.status.confirmed)
                return a.tx.status.block_height - b.tx.status.block_height;
            return 0;
        });
        if (relevantTxs.length === 0)
            return null;
        return {
            tx: await this.toBtcTx(relevantTxs[0].tx, false),
            vout: relevantTxs[0].vout
        };
    }
    /**
     * Waits till the address receives a transaction containing a specific txoHash
     *
     * @param address
     * @param txoHash
     * @param requiredConfirmations
     * @param stateUpdateCbk
     * @param abortSignal
     * @param intervalSeconds
     */
    async waitForAddressTxo(address, txoHash, requiredConfirmations, stateUpdateCbk, abortSignal, intervalSeconds) {
        if (abortSignal != null)
            abortSignal.throwIfAborted();
        while (abortSignal == null || !abortSignal.aborted) {
            await (0, Utils_1.timeoutPromise)((intervalSeconds || 5) * 1000, abortSignal);
            const result = await this.checkAddressTxos(address, txoHash);
            if (result == null) {
                stateUpdateCbk(null, null, null, null);
                continue;
            }
            const confirmationDelay = await this.getConfirmationDelay(result.tx, requiredConfirmations);
            if (confirmationDelay == null)
                continue;
            if (stateUpdateCbk != null)
                stateUpdateCbk(result.tx.confirmations, result.tx.txid, result.vout, confirmationDelay);
            if (confirmationDelay === 0)
                return result;
        }
        abortSignal.throwIfAborted();
    }
    async waitForTransaction(txId, requiredConfirmations, stateUpdateCbk, abortSignal, intervalSeconds) {
        if (abortSignal != null)
            abortSignal.throwIfAborted();
        while (abortSignal == null || !abortSignal.aborted) {
            await (0, Utils_1.timeoutPromise)((intervalSeconds || 5) * 1000, abortSignal);
            const result = await this.getTransaction(txId);
            if (result == null) {
                stateUpdateCbk(null, null, null);
                continue;
            }
            const confirmationDelay = await this.getConfirmationDelay(result, requiredConfirmations);
            if (confirmationDelay == null)
                continue;
            if (stateUpdateCbk != null)
                stateUpdateCbk(result.confirmations, result.txid, confirmationDelay);
            if (confirmationDelay === 0)
                return result;
        }
        abortSignal.throwIfAborted();
    }
    async getLNNodeLiquidity(pubkey) {
        const nodeInfo = await this.api.getLNNodeInfo(pubkey);
        return {
            publicKey: nodeInfo.public_key,
            capacity: BigInt(nodeInfo.capacity),
            numChannels: nodeInfo.active_channel_count
        };
    }
    sendRawTransaction(rawTx) {
        return this.api.sendTransaction(rawTx);
    }
    sendRawPackage(rawTx) {
        throw new Error("Unsupported");
    }
    async isSpent(utxo, confirmed) {
        const [txId, voutStr] = utxo.split(":");
        const vout = parseInt(voutStr);
        const outspends = await this.api.getOutspends(txId);
        if (outspends[vout] == null)
            return true;
        if (confirmed) {
            return outspends[vout].spent && outspends[vout].status.confirmed;
        }
        return outspends[vout].spent;
    }
    parseTransaction(rawTx) {
        const btcTx = btc_signer_1.Transaction.fromRaw(buffer_1.Buffer.from(rawTx, "hex"), {
            allowLegacyWitnessUtxo: true,
            allowUnknownInputs: true,
            allowUnknownOutputs: true,
            disableScriptCheck: true
        });
        return Promise.resolve(bitcoinTxToBtcTx(btcTx));
    }
    getEffectiveFeeRate(btcTx) {
        throw new Error("Unsupported.");
    }
    async getFeeRate() {
        return (await this.api.getFees()).fastestFee;
    }
    getAddressBalances(address) {
        return this.api.getAddressBalances(address);
    }
    async getAddressUTXOs(address) {
        return (await this.api.getAddressUTXOs(address)).map(val => ({
            txid: val.txid,
            vout: val.vout,
            confirmed: val.status.confirmed,
            block_height: val.status.block_height,
            block_hash: val.status.block_hash,
            block_time: val.status.block_time,
            value: val.value
        }));
    }
    getCPFPData(txId) {
        return this.api.getCPFPData(txId);
    }
}
exports.MempoolBitcoinRpc = MempoolBitcoinRpc;
