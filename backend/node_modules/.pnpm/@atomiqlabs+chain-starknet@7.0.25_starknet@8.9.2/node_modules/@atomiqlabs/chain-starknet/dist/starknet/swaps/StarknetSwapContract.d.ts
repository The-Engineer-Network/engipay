import { ChainSwapType, IntermediaryReputationType, RelaySynchronizer, SignatureData, SwapCommitState, SwapContract, TransactionConfirmationOptions } from "@atomiqlabs/base";
import { Buffer } from "buffer";
import { EscrowManagerAbi } from "./EscrowManagerAbi";
import { StarknetContractBase } from "../contract/StarknetContractBase";
import { StarknetTx } from "../chain/modules/StarknetTransactions";
import { StarknetSigner } from "../wallet/StarknetSigner";
import { StarknetChainInterface } from "../chain/StarknetChainInterface";
import { StarknetBtcRelay } from "../btcrelay/StarknetBtcRelay";
import { StarknetSwapData } from "./StarknetSwapData";
import { StarknetLpVault } from "./modules/StarknetLpVault";
import { StarknetPreFetchVerification, StarknetSwapInit } from "./modules/StarknetSwapInit";
import { StarknetSwapRefund } from "./modules/StarknetSwapRefund";
import { IClaimHandler } from "./handlers/claim/ClaimHandlers";
import { StarknetSwapClaim } from "./modules/StarknetSwapClaim";
import { IHandler } from "./handlers/IHandler";
import { StarknetBtcStoredHeader } from "../btcrelay/headers/StarknetBtcStoredHeader";
export declare class StarknetSwapContract extends StarknetContractBase<typeof EscrowManagerAbi> implements SwapContract<StarknetSwapData, StarknetTx, never, StarknetPreFetchVerification, StarknetSigner, "STARKNET"> {
    readonly supportsInitWithoutClaimer = true;
    readonly chainId: "STARKNET";
    readonly claimWithSecretTimeout: number;
    readonly claimWithTxDataTimeout: number;
    readonly refundTimeout: number;
    readonly claimGracePeriod: number;
    readonly refundGracePeriod: number;
    readonly authGracePeriod: number;
    readonly Init: StarknetSwapInit;
    readonly Refund: StarknetSwapRefund;
    readonly Claim: StarknetSwapClaim;
    readonly LpVault: StarknetLpVault;
    readonly claimHandlersByAddress: {
        [address: string]: IClaimHandler<any, any>;
    };
    readonly claimHandlersBySwapType: {
        [type in ChainSwapType]?: IClaimHandler<any, any>;
    };
    readonly refundHandlersByAddress: {
        [address: string]: IHandler<any, any>;
    };
    readonly timelockRefundHandler: IHandler<any, any>;
    readonly btcRelay: StarknetBtcRelay<any>;
    constructor(chainInterface: StarknetChainInterface, btcRelay: StarknetBtcRelay<any>, contractAddress?: string, handlerAddresses?: {
        refund?: {
            timelock?: string;
        };
        claim?: {
            [type in ChainSwapType]?: string;
        };
    });
    start(): Promise<void>;
    preFetchForInitSignatureVerification(): Promise<StarknetPreFetchVerification>;
    getInitSignature(signer: StarknetSigner, swapData: StarknetSwapData, authorizationTimeout: number, preFetchedBlockData?: never, feeRate?: string): Promise<SignatureData>;
    isValidInitAuthorization(sender: string, swapData: StarknetSwapData, { timeout, prefix, signature }: {
        timeout: any;
        prefix: any;
        signature: any;
    }, feeRate?: string, preFetchedData?: StarknetPreFetchVerification): Promise<Buffer>;
    getInitAuthorizationExpiry(swapData: StarknetSwapData, { timeout, prefix, signature }: {
        timeout: any;
        prefix: any;
        signature: any;
    }, preFetchedData?: StarknetPreFetchVerification): Promise<number>;
    isInitAuthorizationExpired(swapData: StarknetSwapData, { timeout, prefix, signature }: {
        timeout: any;
        prefix: any;
        signature: any;
    }): Promise<boolean>;
    getRefundSignature(signer: StarknetSigner, swapData: StarknetSwapData, authorizationTimeout: number): Promise<SignatureData>;
    isValidRefundAuthorization(swapData: StarknetSwapData, { timeout, prefix, signature }: {
        timeout: any;
        prefix: any;
        signature: any;
    }): Promise<Buffer>;
    getDataSignature(signer: StarknetSigner, data: Buffer): Promise<string>;
    isValidDataSignature(data: Buffer, signature: string, publicKey: string): Promise<boolean>;
    /**
     * Checks whether the claim is claimable by us, that means not expired, we are claimer & the swap is commited
     *
     * @param signer
     * @param data
     */
    isClaimable(signer: string, data: StarknetSwapData): Promise<boolean>;
    /**
     * Checks whether a swap is commited, i.e. the swap still exists on-chain and was not claimed nor refunded
     *
     * @param swapData
     */
    isCommited(swapData: StarknetSwapData): Promise<boolean>;
    /**
     * Checks whether the swap is expired, takes into consideration possible on-chain time skew, therefore for claimer
     *  the swap expires a bit sooner than it should've & for the offerer it expires a bit later
     *
     * @param signer
     * @param data
     */
    isExpired(signer: string, data: StarknetSwapData): Promise<boolean>;
    /**
     * Checks if the swap is refundable by us, checks if we are offerer, if the swap is already expired & if the swap
     *  is still commited
     *
     * @param signer
     * @param data
     */
    isRequestRefundable(signer: string, data: StarknetSwapData): Promise<boolean>;
    getHashForTxId(txId: string, confirmations: number): Buffer<ArrayBufferLike>;
    /**
     * Get the swap payment hash to be used for an on-chain swap, uses poseidon hash of the value
     *
     * @param outputScript output script required to claim the swap
     * @param amount sats sent required to claim the swap
     * @param confirmations
     * @param nonce swap nonce uniquely identifying the transaction to prevent replay attacks
     */
    getHashForOnchain(outputScript: Buffer, amount: bigint, confirmations: number, nonce?: bigint): Buffer;
    /**
     * Get the swap payment hash to be used for a lightning htlc swap, uses poseidon hash of the sha256 hash of the preimage
     *
     * @param paymentHash payment hash of the HTLC
     */
    getHashForHtlc(paymentHash: Buffer): Buffer;
    getExtraData(outputScript: Buffer, amount: bigint, confirmations: number, nonce?: bigint): Buffer;
    /**
     * Gets the status of the specific swap, this also checks if we are offerer/claimer & checks for expiry (to see
     *  if swap is refundable)
     *
     * @param signer
     * @param data
     */
    getCommitStatus(signer: string, data: StarknetSwapData): Promise<SwapCommitState>;
    getCommitStatuses(request: {
        signer: string;
        swapData: StarknetSwapData;
    }[]): Promise<{
        [p: string]: SwapCommitState;
    }>;
    /**
     * Returns the data committed for a specific payment hash, or null if no data is currently commited for
     *  the specific swap
     *
     * @param paymentHashHex
     */
    getCommitedData(paymentHashHex: string): Promise<StarknetSwapData>;
    createSwapData(type: ChainSwapType, offerer: string, claimer: string, token: string, amount: bigint, paymentHash: string, sequence: bigint, expiry: bigint, payIn: boolean, payOut: boolean, securityDeposit: bigint, claimerBounty: bigint, depositToken?: string): Promise<StarknetSwapData>;
    getBalance(signer: string, tokenAddress: string, inContract?: boolean): Promise<bigint>;
    getIntermediaryData(address: string, token: string): Promise<{
        balance: bigint;
        reputation: IntermediaryReputationType;
    }>;
    getIntermediaryReputation(address: string, token: string): Promise<IntermediaryReputationType>;
    getIntermediaryBalance(address: string, token: string): Promise<bigint>;
    txsClaimWithSecret(signer: string | StarknetSigner, swapData: StarknetSwapData, secret: string, checkExpiry?: boolean, initAta?: boolean, feeRate?: string, skipAtaCheck?: boolean): Promise<StarknetTx[]>;
    txsClaimWithTxData(signer: string | StarknetSigner, swapData: StarknetSwapData, tx: {
        blockhash: string;
        confirmations: number;
        txid: string;
        hex: string;
        height: number;
    }, requiredConfirmations: number, vout: number, commitedHeader?: StarknetBtcStoredHeader, synchronizer?: RelaySynchronizer<StarknetBtcStoredHeader, StarknetTx, any>, initAta?: boolean, feeRate?: string): Promise<StarknetTx[]>;
    txsRefund(signer: string, swapData: StarknetSwapData, check?: boolean, initAta?: boolean, feeRate?: string): Promise<StarknetTx[]>;
    txsRefundWithAuthorization(signer: string, swapData: StarknetSwapData, { timeout, prefix, signature }: {
        timeout: any;
        prefix: any;
        signature: any;
    }, check?: boolean, initAta?: boolean, feeRate?: string): Promise<StarknetTx[]>;
    txsInit(sender: string, swapData: StarknetSwapData, { timeout, prefix, signature }: {
        timeout: any;
        prefix: any;
        signature: any;
    }, skipChecks?: boolean, feeRate?: string): Promise<StarknetTx[]>;
    txsWithdraw(signer: string, token: string, amount: bigint, feeRate?: string): Promise<StarknetTx[]>;
    txsDeposit(signer: string, token: string, amount: bigint, feeRate?: string): Promise<StarknetTx[]>;
    claimWithSecret(signer: StarknetSigner, swapData: StarknetSwapData, secret: string, checkExpiry?: boolean, initAta?: boolean, txOptions?: TransactionConfirmationOptions): Promise<string>;
    claimWithTxData(signer: StarknetSigner, swapData: StarknetSwapData, tx: {
        blockhash: string;
        confirmations: number;
        txid: string;
        hex: string;
        height: number;
    }, requiredConfirmations: number, vout: number, commitedHeader?: StarknetBtcStoredHeader, synchronizer?: RelaySynchronizer<StarknetBtcStoredHeader, StarknetTx, any>, initAta?: boolean, txOptions?: TransactionConfirmationOptions): Promise<string>;
    refund(signer: StarknetSigner, swapData: StarknetSwapData, check?: boolean, initAta?: boolean, txOptions?: TransactionConfirmationOptions): Promise<string>;
    refundWithAuthorization(signer: StarknetSigner, swapData: StarknetSwapData, signature: SignatureData, check?: boolean, initAta?: boolean, txOptions?: TransactionConfirmationOptions): Promise<string>;
    init(signer: StarknetSigner, swapData: StarknetSwapData, signature: SignatureData, skipChecks?: boolean, txOptions?: TransactionConfirmationOptions): Promise<string>;
    withdraw(signer: StarknetSigner, token: string, amount: bigint, txOptions?: TransactionConfirmationOptions): Promise<string>;
    deposit(signer: StarknetSigner, token: string, amount: bigint, txOptions?: TransactionConfirmationOptions): Promise<string>;
    getInitPayInFeeRate(offerer?: string, claimer?: string, token?: string, paymentHash?: string): Promise<string>;
    getInitFeeRate(offerer?: string, claimer?: string, token?: string, paymentHash?: string): Promise<string>;
    getRefundFeeRate(swapData: StarknetSwapData): Promise<string>;
    getClaimFeeRate(signer: string, swapData: StarknetSwapData): Promise<string>;
    getClaimFee(signer: string, swapData: StarknetSwapData, feeRate?: string): Promise<bigint>;
    /**
     * Get the estimated solana fee of the commit transaction
     */
    getCommitFee(signer: string, swapData: StarknetSwapData, feeRate?: string): Promise<bigint>;
    /**
     * Get the estimated solana transaction fee of the refund transaction
     */
    getRefundFee(signer: string, swapData: StarknetSwapData, feeRate?: string): Promise<bigint>;
}
