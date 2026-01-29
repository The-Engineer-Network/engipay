import {BigIntBufferUtils, BtcBlockWithTxs, BtcSyncInfo, BtcTx} from "@atomiqlabs/base";
import {MempoolBitcoinBlock} from "./MempoolBitcoinBlock";
import {BitcoinTransaction, MempoolApi, TxVout} from "./MempoolApi";
import {Buffer} from "buffer";
import {BitcoinRpcWithAddressIndex, BtcTxWithBlockheight} from "../BitcoinRpcWithAddressIndex";
import {LightningNetworkApi, LNNodeLiquidity} from "../LightningNetworkApi";
import {timeoutPromise} from "../../utils/Utils";
import {Script, Transaction} from "@scure/btc-signer";
import {sha256} from "@noble/hashes/sha2";

const BITCOIN_BLOCKTIME = 600 * 1000;
const BITCOIN_BLOCKSIZE = 1024*1024;

function bitcoinTxToBtcTx(btcTx: Transaction): BtcTx {
    return {
        locktime: btcTx.lockTime,
        version: btcTx.version,
        blockhash: null,
        confirmations: 0,
        txid: Buffer.from(sha256(sha256(btcTx.toBytes(true, false)))).reverse().toString("hex"),
        hex: Buffer.from(btcTx.toBytes(true, false)).toString("hex"),
        raw: Buffer.from(btcTx.toBytes(true, true)).toString("hex"),
        vsize: btcTx.isFinal ? btcTx.vsize : null,

        outs: Array.from({length: btcTx.outputsLength}, (_, i) => i).map((index) => {
            const output = btcTx.getOutput(index);
            return {
                value: Number(output.amount),
                n: index,
                scriptPubKey: {
                    asm: Script.decode(output.script).map(val => typeof(val)==="object" ? Buffer.from(val).toString("hex") : val.toString()).join(" "),
                    hex: Buffer.from(output.script).toString("hex")
                }
            }
        }),
        ins: Array.from({length: btcTx.inputsLength}, (_, i) => i).map(index => {
            const input = btcTx.getInput(index);
            return {
                txid: Buffer.from(input.txid).toString("hex"),
                vout: input.index,
                scriptSig: {
                    asm: Script.decode(input.finalScriptSig).map(val => typeof(val)==="object" ? Buffer.from(val).toString("hex") : val.toString()).join(" "),
                    hex: Buffer.from(input.finalScriptSig).toString("hex")
                },
                sequence: input.sequence,
                txinwitness: input.finalScriptWitness==null ? [] : input.finalScriptWitness.map(witness => Buffer.from(witness).toString("hex"))
            }
        })
    }
}

export class MempoolBitcoinRpc implements BitcoinRpcWithAddressIndex<MempoolBitcoinBlock>, LightningNetworkApi {

    api: MempoolApi;

    constructor(urlOrMempoolApi: MempoolApi | string | string[]) {
        this.api = urlOrMempoolApi instanceof MempoolApi ? urlOrMempoolApi : new MempoolApi(urlOrMempoolApi);
    }

    /**
     * Returns a txo hash for a specific transaction vout
     *
     * @param vout
     * @private
     */
    private static getTxoHash(vout: TxVout): Buffer {
        return Buffer.from(sha256(Buffer.concat([
            BigIntBufferUtils.toBuffer(BigInt(vout.value), "le", 8),
            Buffer.from(vout.scriptpubkey, "hex")
        ])));
    }

    /**
     * Returns delay in milliseconds till an unconfirmed transaction is expected to confirm, returns -1
     *  if the transaction won't confirm any time soon
     *
     * @param feeRate
     * @private
     */
    private async getTimeTillConfirmation(feeRate: number): Promise<number> {
        const mempoolBlocks = await this.api.getPendingBlocks();
        const mempoolBlockIndex = mempoolBlocks.findIndex(block => block.feeRange[0]<=feeRate);
        if(mempoolBlockIndex===-1) return -1;
        //Last returned block is usually an aggregate (or a stack) of multiple btc blocks, if tx falls in this block
        // and the last returned block really is an aggregate one (size bigger than BITCOIN_BLOCKSIZE) we return -1
        if(
            mempoolBlockIndex+1===mempoolBlocks.length &&
            mempoolBlocks[mempoolBlocks.length-1].blockVSize>BITCOIN_BLOCKSIZE
        ) return -1;
        return (mempoolBlockIndex+1) * BITCOIN_BLOCKTIME;
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
    async getConfirmationDelay(tx: BtcTx, requiredConfirmations: number): Promise<number | null> {
        if(tx.confirmations>requiredConfirmations) return 0;
        if(tx.confirmations===0) {
            //Get CPFP data
            const cpfpData = await this.api.getCPFPData(tx.txid);
            if(cpfpData.effectiveFeePerVsize==null) {
                //Transaction is either confirmed in the meantime, or replaced
                return null;
            }
            let confirmationDelay = (await this.getTimeTillConfirmation(cpfpData.effectiveFeePerVsize));
            if(confirmationDelay!==-1) confirmationDelay += (requiredConfirmations-1)*BITCOIN_BLOCKTIME;
            return confirmationDelay;
        }
        return ((requiredConfirmations-tx.confirmations)*BITCOIN_BLOCKTIME);
    }

    /**
     * Converts mempool API's transaction to BtcTx object
     * @param tx Transaction to convert
     * @param getRaw If the raw transaction field should be filled (requires one more network request)
     * @private
     */
    private async toBtcTx(tx: BitcoinTransaction, getRaw: boolean = true): Promise<BtcTxWithBlockheight> {
        const rawTx: Buffer = !getRaw ? null : await this.api.getRawTransaction(tx.txid);

        let confirmations: number = 0;
        if(tx.status!=null && tx.status.confirmed) {
            const blockheight = await this.api.getTipBlockHeight();
            confirmations = blockheight-tx.status.block_height+1;
        }

        let strippedRawTx: string;
        if(rawTx!=null) {
            //Strip witness data
            const btcTx = Transaction.fromRaw(rawTx, {
                allowLegacyWitnessUtxo: true,
                allowUnknownInputs: true,
                allowUnknownOutputs: true,
                disableScriptCheck: true
            });
            strippedRawTx = Buffer.from(btcTx.toBytes(true, false)).toString("hex");
        }

        return {
            locktime: tx.locktime,
            version: tx.version,
            blockheight: tx.status?.block_height,
            blockhash: tx.status?.block_hash,
            confirmations,
            txid: tx.txid,
            vsize: tx.weight/4,
            hex: strippedRawTx,
            raw: rawTx==null ? null : rawTx.toString("hex"),
            outs: tx.vout.map((e, index) => {
                return {
                    value: e.value,
                    n: index,
                    scriptPubKey: {
                        hex: e.scriptpubkey,
                        asm: e.scriptpubkey_asm
                    }
                }
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
                }
            }),
        };
    }

    getTipHeight(): Promise<number> {
        return this.api.getTipBlockHeight();
    }

    async getBlockHeader(blockhash: string): Promise<MempoolBitcoinBlock> {
        return new MempoolBitcoinBlock(await this.api.getBlockHeader(blockhash));
    }

    async getMerkleProof(txId: string, blockhash: string): Promise<{
        reversedTxId: Buffer;
        pos: number;
        merkle: Buffer[];
        blockheight: number
    }> {
        const proof = await this.api.getTransactionProof(txId);
        return {
            reversedTxId: Buffer.from(txId, "hex").reverse(),
            pos: proof.pos,
            merkle: proof.merkle.map(e => Buffer.from(e, "hex").reverse()),
            blockheight: proof.block_height
        };
    }

    async getTransaction(txId: string): Promise<BtcTxWithBlockheight> {
        const tx = await this.api.getTransaction(txId);
        if(tx==null) return null;
        return await this.toBtcTx(tx);
    }

    async isInMainChain(blockhash: string): Promise<boolean> {
        const blockStatus = await this.api.getBlockStatus(blockhash);
        return blockStatus.in_best_chain;
    }

    getBlockhash(height: number): Promise<string> {
        return this.api.getBlockHash(height);
    }

    getBlockWithTransactions(blockhash: string): Promise<BtcBlockWithTxs> {
        throw new Error("Unsupported.");
    }

    async getSyncInfo(): Promise<BtcSyncInfo> {
        const tipHeight = await this.api.getTipBlockHeight();
        return {
            verificationProgress: 1,
            blocks: tipHeight,
            headers: tipHeight,
            ibd: false
        };
    }

    async getPast15Blocks(height: number): Promise<MempoolBitcoinBlock[]> {
        return (await this.api.getPast15BlockHeaders(height)).map(blockHeader => new MempoolBitcoinBlock(blockHeader));
    }

    async checkAddressTxos(address: string, txoHash: Buffer): Promise<{
        tx: BtcTxWithBlockheight,
        vout: number
    } | null> {
        const allTxs = await this.api.getAddressTransactions(address);

        const relevantTxs = allTxs
            .map(tx => {
                return {
                    tx,
                    vout: tx.vout.findIndex(vout => MempoolBitcoinRpc.getTxoHash(vout).equals(txoHash))
                }
            })
            .filter(obj => obj.vout>=0)
            .sort((a, b) => {
                if(a.tx.status.confirmed && !b.tx.status.confirmed) return -1;
                if(!a.tx.status.confirmed && b.tx.status.confirmed) return 1;
                if(a.tx.status.confirmed && b.tx.status.confirmed) return a.tx.status.block_height-b.tx.status.block_height;
                return 0;
            });

        if(relevantTxs.length===0) return null;

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
    async waitForAddressTxo(
        address: string,
        txoHash: Buffer,
        requiredConfirmations: number,
        stateUpdateCbk:(confirmations: number, txId: string, vout: number, txEtaMS: number) => void,
        abortSignal?: AbortSignal,
        intervalSeconds?: number
    ): Promise<{
        tx: BtcTxWithBlockheight,
        vout: number
    }> {
        if(abortSignal!=null) abortSignal.throwIfAborted();

        while(abortSignal==null || !abortSignal.aborted) {
            await timeoutPromise((intervalSeconds || 5)*1000, abortSignal);

            const result = await this.checkAddressTxos(address, txoHash);
            if(result==null) {
                stateUpdateCbk(null, null, null, null);
                continue;
            }

            const confirmationDelay = await this.getConfirmationDelay(result.tx, requiredConfirmations);
            if(confirmationDelay==null) continue;

            if(stateUpdateCbk!=null) stateUpdateCbk(
                result.tx.confirmations,
                result.tx.txid,
                result.vout,
                confirmationDelay
            );

            if(confirmationDelay===0) return result;
        }

        abortSignal.throwIfAborted();
    }


    async waitForTransaction(
        txId: string, requiredConfirmations: number,
        stateUpdateCbk: (confirmations: number, txId: string, txEtaMS: number) => void,
        abortSignal?: AbortSignal, intervalSeconds?: number
    ): Promise<BtcTxWithBlockheight> {
        if(abortSignal!=null) abortSignal.throwIfAborted();

        while(abortSignal==null || !abortSignal.aborted) {
            await timeoutPromise((intervalSeconds || 5)*1000, abortSignal);

            const result = await this.getTransaction(txId);
            if(result==null) {
                stateUpdateCbk(null, null, null);
                continue;
            }

            const confirmationDelay = await this.getConfirmationDelay(result, requiredConfirmations);
            if(confirmationDelay==null) continue;

            if(stateUpdateCbk!=null) stateUpdateCbk(
                result.confirmations,
                result.txid,
                confirmationDelay
            );

            if(confirmationDelay===0) return result;
        }

        abortSignal.throwIfAborted();
    }

    async getLNNodeLiquidity(pubkey: string): Promise<LNNodeLiquidity> {
        const nodeInfo = await this.api.getLNNodeInfo(pubkey);
        return {
            publicKey: nodeInfo.public_key,
            capacity: BigInt(nodeInfo.capacity),
            numChannels: nodeInfo.active_channel_count
        }
    }

    sendRawTransaction(rawTx: string): Promise<string> {
        return this.api.sendTransaction(rawTx);
    }

    sendRawPackage(rawTx: string[]): Promise<string[]> {
        throw new Error("Unsupported");
    }

    async isSpent(utxo: string, confirmed?: boolean): Promise<boolean> {
        const [txId, voutStr] = utxo.split(":");
        const vout = parseInt(voutStr);
        const outspends = await this.api.getOutspends(txId);
        if(outspends[vout]==null) return true;
        if(confirmed) {
            return outspends[vout].spent && outspends[vout].status.confirmed;
        }
        return outspends[vout].spent;
    }

    parseTransaction(rawTx: string): Promise<BtcTx> {
        const btcTx = Transaction.fromRaw(Buffer.from(rawTx, "hex"), {
            allowLegacyWitnessUtxo: true,
            allowUnknownInputs: true,
            allowUnknownOutputs: true,
            disableScriptCheck: true
        });
        return Promise.resolve(bitcoinTxToBtcTx(btcTx));
    }

    getEffectiveFeeRate(btcTx: BtcTx): Promise<{ vsize: number; fee: number; feeRate: number }> {
        throw new Error("Unsupported.");
    }

    async getFeeRate(): Promise<number> {
        return (await this.api.getFees()).fastestFee;
    }

    getAddressBalances(address: string): Promise<{
        confirmedBalance: bigint,
        unconfirmedBalance: bigint
    }> {
        return this.api.getAddressBalances(address);
    }

    async getAddressUTXOs(address:string): Promise<{
        txid: string,
        vout: number,
        confirmed: boolean,
        block_height: number,
        block_hash: string,
        block_time: number
        value: bigint
    }[]> {
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

    getCPFPData(txId: string): Promise<{
        effectiveFeePerVsize: number,
        adjustedVsize: number
    }> {
        return this.api.getCPFPData(txId)
    }

}