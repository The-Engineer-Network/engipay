/// <reference types="node" />
import { AbstractSigner, TransactionConfirmationOptions } from "../chains/ChainInterface";
import { SpvVaultData, SpvVaultTokenData } from "./SpvVaultData";
import { SpvWithdrawalTransactionData } from "./SpvWithdrawalTransactionData";
import { BtcStoredHeader } from "../btcrelay/types/BtcStoredHeader";
import { RelaySynchronizer } from "../btcrelay/synchronizer/RelaySynchronizer";
import { SpvWithdrawalState } from "./SpvWithdrawalState";
import { Buffer } from "buffer";
import { BtcTx } from "../btc/rpc/BitcoinRpc";
export interface SpvVaultContract<TX = any, Signer extends AbstractSigner = AbstractSigner, ChainId extends string = string, Data extends SpvVaultData = SpvVaultData, WithdrawalTX extends SpvWithdrawalTransactionData = SpvWithdrawalTransactionData> {
    readonly chainId: ChainId;
    /**
     * Signs & sends transactions for opening a specific spv vault
     *
     * @param signer Signer to use for the transaction (must match owner in vault)
     * @param vault Vault to init
     * @param txOptions Transaction options
     */
    open(signer: Signer, vault: Data, txOptions?: TransactionConfirmationOptions): Promise<string>;
    /**
     * Returns the unsigned transactions for opening a specific spv vault
     *
     * @param signer Signer to use for the transaction (must match owner in vault)
     * @param vault Vault to init
     * @param feeRate Fee rate to use for the transaction
     */
    txsOpen(signer: string, vault: Data, feeRate?: string): Promise<TX[]>;
    /**
     * Signs & sends transactions for depositing funds to a specific spv vault
     *
     * @param signer Signer to use for the transaction (can be any)
     * @param vault Vault to deposit to
     * @param rawAmounts Raw amounts to deposit (these are unscaled)
     * @param txOptions Transaction options
     */
    deposit(signer: Signer, vault: Data, rawAmounts: bigint[], txOptions?: TransactionConfirmationOptions): Promise<string>;
    /**
     * Returns the unsigned transactions for depositing funds to a specific spv vault
     *
     * @param signer Signer to use for the transaction (can be any)
     * @param vault Vault to deposit to
     * @param rawAmounts Raw amounts to deposit (these are unscaled)
     * @param feeRate Fee rate to use for the transaction
     */
    txsDeposit(signer: string, vault: Data, rawAmounts: bigint[], feeRate?: string): Promise<TX[]>;
    /**
     * Signs & sends transactions for fronting liquidity for a specific withdrawal btc transaction
     *
     * @param signer Signer to use for the transaction (payer of the fronted liquidity)
     * @param vault Vault to deposit to
     * @param realWithdrawalTx Real withdrawal transaction data
     * @param withdrawSequence Sequence number of the withdrawal that is being fronted, this used as race condition
     *  prevention, such that fronting will not happen if the withdrawal tx is already used in claim()
     * @param txOptions Transaction options
     */
    frontLiquidity(signer: Signer, vault: Data, realWithdrawalTx: WithdrawalTX, withdrawSequence: number, txOptions?: TransactionConfirmationOptions): Promise<string>;
    /**
     * Returns the unsigned transactions for fronting liquidity for a specific withdrawal btc transaction
     *
     * @param signer Signer to use for the transaction (payer of the fronted liquidity)
     * @param vault Vault to deposit to
     * @param realWithdrawalTx Real withdrawal transaction data
     * @param withdrawSequence Sequence number of the withdrawal that is being fronted, this used as race condition
     *  prevention, such that fronting will not happen if the withdrawal tx is already used in claim()
     * @param feeRate Fee rate to use for the transaction
     */
    txsFrontLiquidity(signer: string, vault: Data, realWithdrawalTx: WithdrawalTX, withdrawSequence: number, feeRate?: string): Promise<TX[]>;
    /**
     * Signs & sends transactions for claiming the funds from a specific vault
     *
     * @param signer Signer to use for the transaction
     * @param vault Vault to claim from
     * @param txs
     * @param synchronizer Optiona synchronizer to be used if BTC relay contract is not synced up to the required blockheight
     * @param initAta Whether to initialize a token account if it doesn't exist (applies to e.g. Solana, with token specific ATAs)
     * @param txOptions Transaction options
     */
    claim(signer: Signer, vault: Data, txs: {
        tx: WithdrawalTX;
        storedHeader?: BtcStoredHeader<any>;
    }[], synchronizer?: RelaySynchronizer<any, TX, any>, initAta?: boolean, txOptions?: TransactionConfirmationOptions): Promise<string>;
    /**
     * Returns the unsigned transactions for claiming the funds from a specific vault
     *
     * @param signer Signer to use for the transaction
     * @param vault Vault to claim from
     * @param txs
     * @param synchronizer Optiona synchronizer to be used if BTC relay contract is not synced up to the required blockheight
     * @param initAta Whether to initialize a token account if it doesn't exist (applies to e.g. Solana, with token specific ATAs)
     * @param feeRate Fee rate to use for the transaction
     */
    txsClaim(signer: string, vault: Data, txs: {
        tx: WithdrawalTX;
        storedHeader?: BtcStoredHeader<any>;
    }[], synchronizer?: RelaySynchronizer<any, TX, any>, initAta?: boolean, feeRate?: string): Promise<TX[]>;
    /**
     * Creates vault data for a new vault
     *
     * @param owner Vault owner
     * @param vaultId Vault ID
     * @param utxo Utxo on which to assign the vault initially
     * @param confirmations Required number of bitcoin confirmations to be able to withdraw funds from the vault
     * @param tokenData Data about the tokens in the vault
     */
    createVaultData(owner: string, vaultId: bigint, utxo: string, confirmations: number, tokenData: SpvVaultTokenData[]): Promise<Data>;
    /**
     * Returns the party which currently fronted the withdrawal transaction
     *
     * @param owner Owner of the vault
     * @param vaultId Vault ID
     * @param withdrawal Withdrawal transaction to check the fronting for
     */
    getFronterAddress(owner: string, vaultId: bigint, withdrawal: WithdrawalTX): Promise<string | null>;
    /**
     * Returns the parties which currently fronted the withdrawal transactions
     *
     * @param withdrawals withdrawals to query
     */
    getFronterAddresses(withdrawals: {
        owner: string;
        vaultId: bigint;
        withdrawal: WithdrawalTX;
    }[]): Promise<{
        [btcTxId: string]: string | null;
    }>;
    /**
     * Returns current vault data
     *
     * @param owner Owner of the vault
     * @param vaultId Vault ID
     */
    getVaultData(owner: string, vaultId: bigint): Promise<Data>;
    /**
     * Returns current vault data for multiple vaults
     *
     * @param vaults Vault data to query
     */
    getMultipleVaultData(vaults: {
        owner: string;
        vaultId: bigint;
    }[]): Promise<{
        [owner: string]: {
            [vaultId: string]: Data;
        };
    }>;
    /**
     * Returns the latest utxo of a vault (or null if vault closed or not found)
     *
     * @param owner Owner of the vault
     * @param vaultId Vault ID
     */
    getVaultLatestUtxo(owner: string, vaultId: bigint): Promise<string | null>;
    /**
     * Returns the latest utxos of for multiple vaults (or null if vault closed or not found)
     *
     * @param vaults Vault data to query
     */
    getVaultLatestUtxos(vaults: {
        owner: string;
        vaultId: bigint;
    }[]): Promise<{
        [owner: string]: {
            [vaultId: string]: string | null;
        };
    }>;
    /**
     * Returns all currently opened vaults
     * NOTE: This will take a long time, since the implementation will have to go through all the prior events
     */
    getAllVaults(owner?: string): Promise<Data[]>;
    /**
     * Returns current state of the withdrawal, optionally
     *  only check withdrawals from the provided block height
     *
     * @param withdrawalTx
     * @param scStartBlockheight
     */
    getWithdrawalState(withdrawalTx: WithdrawalTX, scStartBlockheight?: number): Promise<SpvWithdrawalState>;
    /**
     * Returns current state of the withdrawals, optionally
     *  only check withdrawals from the provided block height
     *
     * @param withdrawalTxs Object with the withdrawal tx to check + an optional start blockheight
     */
    getWithdrawalStates(withdrawalTxs: {
        withdrawal: WithdrawalTX;
        scStartBlockheight?: number;
    }[]): Promise<{
        [btcTxId: string]: SpvWithdrawalState;
    }>;
    /**
     * Parses withdrawal data from the parsed bitcoin transaction
     *
     * @param btcTx
     */
    getWithdrawalData(btcTx: BtcTx): Promise<WithdrawalTX>;
    /**
     * Checks if given withdrawal tx is valid and correctly parses on-chain, throws error when there is any issue with
     *  the validation
     *
     * @param tx
     */
    checkWithdrawalTx(tx: WithdrawalTX): Promise<void>;
    /**
     * Serializes the withdrawal params to the OP_RETURN data
     *
     * @param recipient Recipient of the withdrawn tokens
     * @param rawAmounts Raw amount of tokens to withdraw
     * @param executionHash Optional execution hash of the actions to execute
     */
    toOpReturnData(recipient: string, rawAmounts: bigint[], executionHash?: string): Buffer;
    /**
     * Parses withdrawal params from OP_RETURN data
     *
     * @param data data as specified in the OP_RETURN output of the transaction
     */
    fromOpReturnData(data: Buffer): {
        recipient: string;
        rawAmounts: bigint[];
        executionHash: string;
    };
    /**
     * Returns the fee in native token base units to claim the swap
     *
     * @param signer Signer claiming the swap
     * @param vault
     * @param withdrawalData Withdrawal to claim
     * @param feeRate Optional fee rate (fetched on-demand if not provided)
     */
    getClaimFee(signer: string, vault: Data, withdrawalData: WithdrawalTX, feeRate?: string): Promise<bigint>;
    /**
     * Returns raw fee (not including any refunds we might get that would make the getClaimFee negative) for claiming the swap
     *
     * @param signer Signer claiming the swap
     * @param vault
     * @param withdrawalData Withdrawal to claim
     * @param feeRate Optional fee rate (fetched on-demand if not provided)
     */
    getRawClaimFee?(signer: string, vault: Data, withdrawalData: WithdrawalTX, feeRate?: string): Promise<bigint>;
    /**
     * Returns the fee in native token base units to claim the swap
     *
     * @param signer Signer claiming the swap
     * @param vault
     * @param withdrawalData Withdrawal to claim
     * @param feeRate Optional fee rate (fetched on-demand if not provided)
     */
    getFrontFee(signer: string, vault: Data, withdrawalData: WithdrawalTX, feeRate?: string): Promise<bigint>;
    /**
     * Returns raw fee (not including any refunds we might get that would make the getClaimFee negative) for claiming the swap
     *
     * @param signer Signer claiming the swap
     * @param vault
     * @param withdrawalData Withdrawal to claim
     * @param feeRate Optional fee rate (fetched on-demand if not provided)
     */
    getRawFrontFee?(signer: string, vault: Data, withdrawalData: WithdrawalTX, feeRate?: string): Promise<bigint>;
}
