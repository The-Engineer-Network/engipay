/// <reference types="node" />
/// <reference types="node" />
import { BtcBlockWithTxs, BtcSyncInfo, BtcTx } from "@atomiqlabs/base";
import { MempoolBitcoinBlock } from "./MempoolBitcoinBlock";
import { MempoolApi } from "./MempoolApi";
import { Buffer } from "buffer";
import { BitcoinRpcWithAddressIndex, BtcTxWithBlockheight } from "../BitcoinRpcWithAddressIndex";
import { LightningNetworkApi, LNNodeLiquidity } from "../LightningNetworkApi";
export declare class MempoolBitcoinRpc implements BitcoinRpcWithAddressIndex<MempoolBitcoinBlock>, LightningNetworkApi {
    api: MempoolApi;
    constructor(urlOrMempoolApi: MempoolApi | string | string[]);
    /**
     * Returns a txo hash for a specific transaction vout
     *
     * @param vout
     * @private
     */
    private static getTxoHash;
    /**
     * Returns delay in milliseconds till an unconfirmed transaction is expected to confirm, returns -1
     *  if the transaction won't confirm any time soon
     *
     * @param feeRate
     * @private
     */
    private getTimeTillConfirmation;
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
    getConfirmationDelay(tx: BtcTx, requiredConfirmations: number): Promise<number | null>;
    /**
     * Converts mempool API's transaction to BtcTx object
     * @param tx Transaction to convert
     * @param getRaw If the raw transaction field should be filled (requires one more network request)
     * @private
     */
    private toBtcTx;
    getTipHeight(): Promise<number>;
    getBlockHeader(blockhash: string): Promise<MempoolBitcoinBlock>;
    getMerkleProof(txId: string, blockhash: string): Promise<{
        reversedTxId: Buffer;
        pos: number;
        merkle: Buffer[];
        blockheight: number;
    }>;
    getTransaction(txId: string): Promise<BtcTxWithBlockheight>;
    isInMainChain(blockhash: string): Promise<boolean>;
    getBlockhash(height: number): Promise<string>;
    getBlockWithTransactions(blockhash: string): Promise<BtcBlockWithTxs>;
    getSyncInfo(): Promise<BtcSyncInfo>;
    getPast15Blocks(height: number): Promise<MempoolBitcoinBlock[]>;
    checkAddressTxos(address: string, txoHash: Buffer): Promise<{
        tx: BtcTxWithBlockheight;
        vout: number;
    } | null>;
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
    waitForAddressTxo(address: string, txoHash: Buffer, requiredConfirmations: number, stateUpdateCbk: (confirmations: number, txId: string, vout: number, txEtaMS: number) => void, abortSignal?: AbortSignal, intervalSeconds?: number): Promise<{
        tx: BtcTxWithBlockheight;
        vout: number;
    }>;
    waitForTransaction(txId: string, requiredConfirmations: number, stateUpdateCbk: (confirmations: number, txId: string, txEtaMS: number) => void, abortSignal?: AbortSignal, intervalSeconds?: number): Promise<BtcTxWithBlockheight>;
    getLNNodeLiquidity(pubkey: string): Promise<LNNodeLiquidity>;
    sendRawTransaction(rawTx: string): Promise<string>;
    sendRawPackage(rawTx: string[]): Promise<string[]>;
    isSpent(utxo: string, confirmed?: boolean): Promise<boolean>;
    parseTransaction(rawTx: string): Promise<BtcTx>;
    getEffectiveFeeRate(btcTx: BtcTx): Promise<{
        vsize: number;
        fee: number;
        feeRate: number;
    }>;
    getFeeRate(): Promise<number>;
    getAddressBalances(address: string): Promise<{
        confirmedBalance: bigint;
        unconfirmedBalance: bigint;
    }>;
    getAddressUTXOs(address: string): Promise<{
        txid: string;
        vout: number;
        confirmed: boolean;
        block_height: number;
        block_hash: string;
        block_time: number;
        value: bigint;
    }[]>;
    getCPFPData(txId: string): Promise<{
        effectiveFeePerVsize: number;
        adjustedVsize: number;
    }>;
}
