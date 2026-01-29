import {BtcBlock} from "../../btcrelay/types/BtcBlock";
import {Buffer} from "buffer";


export type BtcVout = {
    value: number,
    n: number,
    scriptPubKey: {
        asm?: string,
        hex: string
    }
};

export type BtcVin = {
    txid: string,
    vout: number,
    scriptSig: {
        asm?: string,
        hex: string
    },
    sequence: number,
    txinwitness: string[]
};

export type BtcTx = {
    blockhash: string,
    confirmations: number,
    vsize: number,
    txid: string,
    hex: string,
    raw: string,
    locktime: number,
    version: number,

    outs: BtcVout[],
    ins: BtcVin[]
};

export type BtcBlockWithTxs = {
    height: number,
    hash: string,
    tx: BtcTx[]
};

export type BtcSyncInfo = {
    ibd: boolean,
    headers: number,
    blocks: number,
    verificationProgress: number
}

export interface BitcoinRpc<T extends BtcBlock> {

    isInMainChain(blockhash: string): Promise<boolean>;
    getBlockHeader(blockhash: string): Promise<T>;
    getMerkleProof(txId: string, blockhash: string): Promise<{
        reversedTxId: Buffer,
        pos: number,
        merkle: Buffer[],
        blockheight: number
    }>;
    getTransaction(txId: string): Promise<BtcTx>;
    getBlockhash(height: number): Promise<string>;
    getBlockWithTransactions(blockhash: string): Promise<BtcBlockWithTxs>;

    sendRawTransaction(rawTx: string): Promise<string>;
    sendRawPackage(rawTx: string[]): Promise<string[]>;

    getTipHeight(): Promise<number>;

    getSyncInfo(): Promise<BtcSyncInfo>;

    parseTransaction(rawTx: string): Promise<BtcTx>;
    isSpent(utxo: string, confirmed?: boolean): Promise<boolean>;

    getEffectiveFeeRate(btcTx: BtcTx): Promise<{vsize: number, fee: number, feeRate: number}>;

}