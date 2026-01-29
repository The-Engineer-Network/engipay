import {Transaction} from "@scure/btc-signer";

export function isIBitcoinWallet(val: any): val is IBitcoinWallet {
    return val!==null &&
        typeof(val.sendTransaction)==="function" &&
        typeof(val.fundPsbt)==="function" &&
        typeof(val.signPsbt)==="function" &&
        typeof(val.getFeeRate)==="function" &&
        typeof(val.getTransactionFee)==="function" &&
        typeof(val.getFundedPsbtFee)==="function" &&
        typeof(val.getReceiveAddress)==="function" &&
        typeof(val.getBalance)==="function" &&
        typeof(val.getSpendableBalance)==="function";
}

export interface IBitcoinWallet {
    sendTransaction(address: string, amount: bigint, feeRate?: number): Promise<string>;
    fundPsbt(psbt: Transaction, feeRate?: number): Promise<Transaction>;
    signPsbt(psbt: Transaction, signInputs: number[]): Promise<Transaction>;

    getFeeRate(): Promise<number>;

    getTransactionFee(address: string, amount: bigint, feeRate?: number): Promise<number>;
    getFundedPsbtFee(psbt: Transaction, feeRate?: number): Promise<number>;

    getReceiveAddress(): string;
    getBalance(): Promise<{
        confirmedBalance: bigint,
        unconfirmedBalance: bigint
    }>;
    getSpendableBalance(psbt?: Transaction, feeRate?: number): Promise<{
        balance: bigint,
        feeRate: number,
        totalFee: number
    }>;
}
