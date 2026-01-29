import { Transaction } from "@scure/btc-signer";
/**
 * A type with minimum possible required data about a bitcoin wallet to be able to estimate fees and produce unsigned
 *  PSBTs
 */
export type MinimalBitcoinWalletInterface = {
    address: string;
    publicKey: string;
};
/**
 * A type with minimum possible required data about a bitcoin wallet to be able to estimate fees and sign PSBTs
 */
export type MinimalBitcoinWalletInterfaceWithSigner = MinimalBitcoinWalletInterface & {
    signPsbt: (psbtToSign: {
        psbt: Transaction;
        psbtHex: string;
        psbtBase64: string;
    }, signInputs: number[]) => Promise<Transaction | string>;
};
