import { BitcoinRpc, BtcTx, RelaySynchronizer, SpvVaultContract, SpvVaultTokenData, SpvWithdrawalState, SpvWithdrawalTransactionData, TransactionConfirmationOptions } from "@atomiqlabs/base";
import { Buffer } from "buffer";
import { StarknetTx } from "../chain/modules/StarknetTransactions";
import { StarknetContractBase } from "../contract/StarknetContractBase";
import { StarknetChainInterface } from "../chain/StarknetChainInterface";
import { StarknetBtcRelay } from "../btcrelay/StarknetBtcRelay";
import { StarknetAction } from "../chain/StarknetAction";
import { SpvVaultContractAbi } from "./SpvVaultContractAbi";
import { StarknetSigner } from "../wallet/StarknetSigner";
import { StarknetSpvVaultData } from "./StarknetSpvVaultData";
import { StarknetSpvWithdrawalData } from "./StarknetSpvWithdrawalData";
import { StarknetBtcStoredHeader } from "../btcrelay/headers/StarknetBtcStoredHeader";
export declare class StarknetSpvVaultContract extends StarknetContractBase<typeof SpvVaultContractAbi> implements SpvVaultContract<StarknetTx, StarknetSigner, "STARKNET", StarknetSpvVaultData, StarknetSpvWithdrawalData> {
    private static readonly GasCosts;
    readonly chainId = "STARKNET";
    readonly btcRelay: StarknetBtcRelay<any>;
    readonly bitcoinRpc: BitcoinRpc<any>;
    readonly claimTimeout: number;
    readonly maxClaimsPerTx: number;
    readonly logger: import("../../utils/Utils").LoggerType;
    constructor(chainInterface: StarknetChainInterface, btcRelay: StarknetBtcRelay<any>, bitcoinRpc: BitcoinRpc<any>, contractAddress?: string);
    protected Open(signer: string, vault: StarknetSpvVaultData): StarknetAction;
    protected Deposit(signer: string, vault: StarknetSpvVaultData, rawAmounts: bigint[]): StarknetAction;
    protected Front(signer: string, vault: StarknetSpvVaultData, data: StarknetSpvWithdrawalData, withdrawalSequence: number): StarknetAction;
    protected Claim(signer: string, vault: StarknetSpvVaultData, data: StarknetSpvWithdrawalData, blockheader: StarknetBtcStoredHeader, merkle: Buffer[], position: number): StarknetAction;
    checkWithdrawalTx(tx: SpvWithdrawalTransactionData): Promise<void>;
    createVaultData(owner: string, vaultId: bigint, utxo: string, confirmations: number, tokenData: SpvVaultTokenData[]): Promise<StarknetSpvVaultData>;
    getVaultData(owner: string, vaultId: bigint): Promise<StarknetSpvVaultData>;
    getMultipleVaultData(vaults: {
        owner: string;
        vaultId: bigint;
    }[]): Promise<{
        [owner: string]: {
            [vaultId: string]: StarknetSpvVaultData;
        };
    }>;
    getVaultLatestUtxo(owner: string, vaultId: bigint): Promise<string | null>;
    getVaultLatestUtxos(vaults: {
        owner: string;
        vaultId: bigint;
    }[]): Promise<{
        [owner: string]: {
            [vaultId: string]: string | null;
        };
    }>;
    getAllVaults(owner?: string): Promise<StarknetSpvVaultData[]>;
    getFronterAddress(owner: string, vaultId: bigint, withdrawal: StarknetSpvWithdrawalData): Promise<string | null>;
    getFronterAddresses(withdrawals: {
        owner: string;
        vaultId: bigint;
        withdrawal: StarknetSpvWithdrawalData;
    }[]): Promise<{
        [btcTxId: string]: string | null;
    }>;
    private parseWithdrawalEvent;
    getWithdrawalStates(withdrawalTxs: {
        withdrawal: StarknetSpvWithdrawalData;
        scStartBlockheight?: number;
    }[]): Promise<{
        [btcTxId: string]: SpvWithdrawalState;
    }>;
    getWithdrawalState(withdrawalTx: StarknetSpvWithdrawalData, scStartBlockheight?: number): Promise<SpvWithdrawalState>;
    getWithdrawalData(btcTx: BtcTx): Promise<StarknetSpvWithdrawalData>;
    fromOpReturnData(data: Buffer): {
        recipient: string;
        rawAmounts: bigint[];
        executionHash: string;
    };
    static fromOpReturnData(data: Buffer): {
        recipient: string;
        rawAmounts: bigint[];
        executionHash: string;
    };
    toOpReturnData(recipient: string, rawAmounts: bigint[], executionHash?: string): Buffer;
    static toOpReturnData(recipient: string, rawAmounts: bigint[], executionHash?: string): Buffer;
    claim(signer: StarknetSigner, vault: StarknetSpvVaultData, txs: {
        tx: StarknetSpvWithdrawalData;
        storedHeader?: StarknetBtcStoredHeader;
    }[], synchronizer?: RelaySynchronizer<any, any, any>, initAta?: boolean, txOptions?: TransactionConfirmationOptions): Promise<string>;
    deposit(signer: StarknetSigner, vault: StarknetSpvVaultData, rawAmounts: bigint[], txOptions?: TransactionConfirmationOptions): Promise<string>;
    frontLiquidity(signer: StarknetSigner, vault: StarknetSpvVaultData, realWithdrawalTx: StarknetSpvWithdrawalData, withdrawSequence: number, txOptions?: TransactionConfirmationOptions): Promise<string>;
    open(signer: StarknetSigner, vault: StarknetSpvVaultData, txOptions?: TransactionConfirmationOptions): Promise<string>;
    txsClaim(signer: string, vault: StarknetSpvVaultData, txs: {
        tx: StarknetSpvWithdrawalData;
        storedHeader?: StarknetBtcStoredHeader;
    }[], synchronizer?: RelaySynchronizer<any, any, any>, initAta?: boolean, feeRate?: string): Promise<StarknetTx[]>;
    txsDeposit(signer: string, vault: StarknetSpvVaultData, rawAmounts: bigint[], feeRate?: string): Promise<StarknetTx[]>;
    txsFrontLiquidity(signer: string, vault: StarknetSpvVaultData, realWithdrawalTx: StarknetSpvWithdrawalData, withdrawSequence: number, feeRate?: string): Promise<StarknetTx[]>;
    txsOpen(signer: string, vault: StarknetSpvVaultData, feeRate?: string): Promise<StarknetTx[]>;
    getClaimFee(signer: string, vault: StarknetSpvVaultData, withdrawalData: StarknetSpvWithdrawalData, feeRate?: string): Promise<bigint>;
    getFrontFee(signer: string, vault: StarknetSpvVaultData, withdrawalData: StarknetSpvWithdrawalData, feeRate?: string): Promise<bigint>;
}
