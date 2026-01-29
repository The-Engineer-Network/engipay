import { Transaction } from "@scure/btc-signer";
import { IBitcoinWallet } from "../btc/wallet/IBitcoinWallet";
import { BitcoinRpcWithAddressIndex } from "../btc/BitcoinRpcWithAddressIndex";
import { BTC_NETWORK } from "@scure/btc-signer/utils";
/**
 * General parsers for PSBTs, can parse hex or base64 encoded PSBTs
 * @param _psbt
 */
export declare function parsePsbtTransaction(_psbt: Transaction | string): Transaction;
export declare function toBitcoinWallet(_bitcoinWallet: IBitcoinWallet | {
    address: string;
    publicKey: string;
}, btcRpc: BitcoinRpcWithAddressIndex<any>, bitcoinNetwork: BTC_NETWORK): IBitcoinWallet;
