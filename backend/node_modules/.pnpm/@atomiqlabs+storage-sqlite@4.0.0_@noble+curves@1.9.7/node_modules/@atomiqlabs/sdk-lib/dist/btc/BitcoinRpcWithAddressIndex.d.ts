/// <reference types="node" />
/// <reference types="node" />
import { BitcoinRpc, BtcBlock, BtcTx } from "@atomiqlabs/base";
import { Buffer } from "buffer";
export type BtcTxWithBlockheight = BtcTx & {
    blockheight?: number;
};
export type BtcAddressUtxo = {
    txid: string;
    vout: number;
    confirmed: boolean;
    block_height: number;
    block_hash: string;
    block_time: number;
    value: bigint;
};
export interface BitcoinRpcWithAddressIndex<T extends BtcBlock> extends BitcoinRpc<T> {
    getFeeRate(): Promise<number>;
    getAddressBalances(address: string): Promise<{
        confirmedBalance: bigint;
        unconfirmedBalance: bigint;
    }>;
    getAddressUTXOs(address: string): Promise<BtcAddressUtxo[]>;
    getCPFPData(txId: string): Promise<{
        effectiveFeePerVsize: number;
        adjustedVsize: number;
    }>;
    getTransaction(txId: string): Promise<BtcTxWithBlockheight>;
    waitForTransaction(txId: string, requiredConfirmations: number, stateUpdateCbk: (confirmations: number, txId: string, txEtaMS: number) => void, abortSignal?: AbortSignal, intervalSeconds?: number): Promise<BtcTxWithBlockheight>;
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
     * Checks if an address received the transaction with the required txoHash, returns info about that
     *  specific transaction if found, or null if not found
     *
     * @param address Address that should receive the transaction
     * @param txoHash Required output txoHash
     */
    checkAddressTxos(address: string, txoHash: Buffer): Promise<{
        tx: BtcTxWithBlockheight;
        vout: number;
    } | null>;
    /**
     * Waits till the address receives a transaction containing a specific txoHash
     *
     * @param address Address that should receive the transaction
     * @param txoHash Required output txoHash
     * @param requiredConfirmations Required confirmations of the transaction
     * @param stateUpdateCbk Callback for transaction state updates
     * @param abortSignal Abort signal
     * @param intervalSeconds How often to check new transaction
     */
    waitForAddressTxo(address: string, txoHash: Buffer, requiredConfirmations: number, stateUpdateCbk: (confirmations: number, txId: string, vout: number, txEtaMS: number) => void, abortSignal?: AbortSignal, intervalSeconds?: number): Promise<{
        tx: BtcTxWithBlockheight;
        vout: number;
    }>;
}
