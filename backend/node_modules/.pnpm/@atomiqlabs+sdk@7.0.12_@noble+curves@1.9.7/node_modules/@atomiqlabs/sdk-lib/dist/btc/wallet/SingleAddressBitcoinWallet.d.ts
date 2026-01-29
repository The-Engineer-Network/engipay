import { CoinselectAddressTypes } from "../coinselect2";
import { BTC_NETWORK } from "@scure/btc-signer/utils";
import { Transaction } from "@scure/btc-signer";
import { BitcoinWallet } from "./BitcoinWallet";
import { BitcoinRpcWithAddressIndex } from "../BitcoinRpcWithAddressIndex";
export declare class SingleAddressBitcoinWallet extends BitcoinWallet {
    readonly privKey: Uint8Array;
    readonly pubkey: Uint8Array;
    readonly address: string;
    readonly addressType: CoinselectAddressTypes;
    constructor(mempoolApi: BitcoinRpcWithAddressIndex<any>, network: BTC_NETWORK, addressDataOrWIF: string | {
        address: string;
        publicKey: string;
    }, feeMultiplier?: number, feeOverride?: number);
    protected toBitcoinWalletAccounts(): {
        pubkey: string;
        address: string;
        addressType: CoinselectAddressTypes;
    }[];
    sendTransaction(address: string, amount: bigint, feeRate?: number): Promise<string>;
    fundPsbt(inputPsbt: Transaction, feeRate?: number): Promise<Transaction>;
    signPsbt(psbt: Transaction, signInputs: number[]): Promise<Transaction>;
    getTransactionFee(address: string, amount: bigint, feeRate?: number): Promise<number>;
    getFundedPsbtFee(basePsbt: Transaction, feeRate?: number): Promise<number>;
    getReceiveAddress(): string;
    getBalance(): Promise<{
        confirmedBalance: bigint;
        unconfirmedBalance: bigint;
    }>;
    getSpendableBalance(psbt?: Transaction, feeRate?: number): Promise<{
        balance: bigint;
        feeRate: number;
        totalFee: number;
    }>;
    static generateRandomPrivateKey(network?: BTC_NETWORK): string;
}
