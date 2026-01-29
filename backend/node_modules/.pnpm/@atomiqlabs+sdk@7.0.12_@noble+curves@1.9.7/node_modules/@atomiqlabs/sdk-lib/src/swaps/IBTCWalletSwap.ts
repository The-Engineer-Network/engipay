import {IBitcoinWallet} from "../btc/wallet/IBitcoinWallet";
import {BtcToken, TokenAmount} from "../Tokens";
import {Transaction} from "@scure/btc-signer";
import {
    MinimalBitcoinWalletInterface,
    MinimalBitcoinWalletInterfaceWithSigner
} from "../btc/wallet/MinimalBitcoinWalletInterface";

export interface IBTCWalletSwap {

    /**
     * Returns the PSBT that is already funded with wallet's UTXOs (runs a coin-selection algorithm to choose UTXOs to use),
     *  also returns inputs indices that need to be signed by the wallet before submitting the PSBT back to the SDK with
     *  `swap.submitPsbt()`
     *
     * @param _bitcoinWallet Sender's bitcoin wallet
     * @param feeRate Optional fee rate for the transaction, needs to be at least as big as {minimumBtcFeeRate} field
     * @param additionalOutputs additional outputs to add to the PSBT - can be used to collect fees from users
     */
    getFundedPsbt(
        _bitcoinWallet: IBitcoinWallet | MinimalBitcoinWalletInterface,
        feeRate?: number,
        additionalOutputs?: ({amount: bigint, outputScript: Uint8Array} | {amount: bigint, address: string})[]
    ): Promise<{psbt: Transaction, psbtHex: string, psbtBase64: string, signInputs: number[]}>;

    /**
     * Submits a PSBT signed by the wallet back to the SDK
     *
     * @param psbt A psbt - either a Transaction object or a hex or base64 encoded PSBT string
     */
    submitPsbt(psbt: Transaction | string): Promise<string>;


    estimateBitcoinFee(wallet: IBitcoinWallet | MinimalBitcoinWalletInterface, feeRate?: number): Promise<TokenAmount<any, BtcToken<false>>>;


    sendBitcoinTransaction(
        wallet: IBitcoinWallet | MinimalBitcoinWalletInterfaceWithSigner,
        feeRate?: number
    ): Promise<string>;

    /**
     * Waits till the bitcoin transaction confirms
     *
     * @param updateCallback Callback called when txId is found, and also called with subsequent confirmations
     * @param checkIntervalSeconds How often to check the bitcoin transaction
     * @param abortSignal Abort signal
     * @throws {Error} if in invalid state (must be CLAIM_COMMITED)
     */
    waitForBitcoinTransaction(
        updateCallback?: (txId: string, confirmations: number, targetConfirmations: number, txEtaMs: number) => void,
        checkIntervalSeconds?: number,
        abortSignal?: AbortSignal,
    ): Promise<string>;

    getRequiredConfirmationsCount(): number;

}