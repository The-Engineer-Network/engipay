import {SwapData} from "./SwapData";
import {BtcStoredHeader} from "../btcrelay/types/BtcStoredHeader";
import {ChainSwapType} from "./ChainSwapType";
import {RelaySynchronizer} from "../btcrelay/synchronizer/RelaySynchronizer";
import {Buffer} from "buffer";
import {AbstractSigner, TransactionConfirmationOptions} from "../chains/ChainInterface";
import {SwapCommitState} from "./SwapCommitState";

export type IntermediaryReputationType = {
    [key in ChainSwapType]: {
        successVolume: bigint,
        successCount: bigint,
        failVolume: bigint,
        failCount: bigint,
        coopCloseVolume: bigint,
        coopCloseCount: bigint
    }
};

export type SignatureData = {
    prefix: string,
    timeout: string,
    signature: string
};

export type BitcoinTransactionData = {
    blockhash: string,
    confirmations: number,
    txid: string,
    hex: string,
    height: number
};

export interface SwapContract<
    T extends SwapData = SwapData,
    TX = any,
    PreFetchData = any,
    PreFetchVerification = any,
    Signer extends AbstractSigner = AbstractSigner,
    ChainId extends string = string
> {

    readonly chainId: ChainId;
    readonly claimWithSecretTimeout: number;
    readonly claimWithTxDataTimeout: number;
    readonly refundTimeout: number;
    readonly supportsInitWithoutClaimer?: boolean;

    /**
     * Initializes the swap contract
     */
    start(): Promise<void>;

    /**
     * Signs & sends transactions for initializing a non-payIn swap (BTC -> SC)
     *
     * @param signer Signer to use for the transaction (must match claimer in swap data)
     * @param swapData Swap to init
     * @param signature Signature data from the offerer
     * @param skipChecks Whether to skip verification of the signature & checking if the swap is already committed
     * @param txOptions Transaction options
     */
    init(signer: Signer, swapData: T, signature: SignatureData, skipChecks?: boolean, txOptions?: TransactionConfirmationOptions): Promise<string>;

    /**
     * Returns the unsigned transactions required for initializing a non-payIn swap (BTC -> SC)
     *
     * @param sender Transaction sender address, must be either offerer or claimer
     * @param swapData Swap to init
     * @param signature Signature data from the offerer
     * @param skipChecks Whether to skip verification of the signature & checking if the swap is already committed
     * @param feeRate Fee rate to use for the transaction
     */
    txsInit(sender: string, swapData: T, signature: SignatureData, skipChecks?: boolean, feeRate?: string): Promise<TX[]>;

    /**
     * Signs & sends transactions required for claiming an HTLC swap
     *
     * @param signer Signer for which the transaction should be created (doesn't need to match the claimer)
     * @param swapData Swap to claim
     * @param secret Secret pre-image that hashes to the swap hash
     * @param checkExpiry Whether to check expiration of the swap before executing transactions
     * @param initAta Whether to initialize a token account if it doesn't exist (applies to e.g. Solana, with token specific ATAs)
     * @param txOptions Transaction options
     */
    claimWithSecret(signer: Signer, swapData: T, secret: string, checkExpiry?: boolean, initAta?: boolean, txOptions?: TransactionConfirmationOptions): Promise<string>;

    /**
     * Returns the unsigned transactions required for claiming an HTLC swap
     *
     * @param signer Signer for which the transaction should be created (doesn't need to match the claimer)
     * @param swapData Swap to claim
     * @param secret Secret pre-image that hashes to the swap hash
     * @param checkExpiry Whether to check expiration of the swap before returning the transactions
     * @param initAta Whether to initialize a token account if it doesn't exist (applies to e.g. Solana, with token specific ATAs)
     * @param feeRate Fee rate to use for the transactions
     * @param skipAtaCheck Whether to skip checking if token account exists
     */
    txsClaimWithSecret(signer: string | Signer, swapData: T, secret: string, checkExpiry?: boolean, initAta?: boolean, feeRate?: string, skipAtaCheck?: boolean): Promise<TX[]>;

    /**
     * Signs & sends transactions required for claiming an on-chain PTLC (proof-time locked contract) swap
     *
     * @param signer Signer for which the transaction should be created (doesn't need to match the claimer)
     * @param swapData Swap to claim
     * @param tx Bitcoin transaction containing the required output
     * @param requiredConfirmations Required confirmations for the escrow to be claimed
     * @param vout Bitcoin tx's output index of the required output
     * @param storedHeader Optional already retrieved stored header to use for proving
     * @param synchronizer Optiona synchronizer to be used if BTC relay contract is not synced up to the required blockheight
     * @param initAta Whether to initialize a token account if it doesn't exist (applies to e.g. Solana, with token specific ATAs)
     * @param txOptions Transaction options
     */
    claimWithTxData(
        signer: Signer,
        swapData: T,
        tx: BitcoinTransactionData,
        requiredConfirmations: number,
        vout: number,
        storedHeader?: BtcStoredHeader<any>,
        synchronizer?: RelaySynchronizer<any, TX, any>,
        initAta?: boolean,
        txOptions?: TransactionConfirmationOptions
    ): Promise<string>;

    /**
     * Returns the unsigned transactions required for claiming an on-chain PTLC (proof-time locked contract) swap
     *
     * @param signer Signer for which the transaction should be created (doesn't need to match the claimer)
     * @param swapData Swap to claim
     * @param tx Bitcoin transaction containing the required output
     * @param requiredConfirmations Required confirmations for the escrow to be claimed
     * @param vout Bitcoin tx's output index of the required output
     * @param storedHeader Optional already retrieved stored header to use for proving
     * @param synchronizer Optiona synchronizer to be used if BTC relay contract is not synced up to the required blockheight
     * @param initAta Whether to initialize a token account if it doesn't exist (applies to e.g. Solana, with token specific ATAs)
     * @param feeRate Fee rate to use for the transactions
     */
    txsClaimWithTxData(
        signer: string | Signer,
        swapData: T,
        tx: BitcoinTransactionData,
        requiredConfirmations: number,
        vout: number,
        storedHeader?: BtcStoredHeader<any>,
        synchronizer?: RelaySynchronizer<any, TX, any>,
        initAta?: boolean,
        feeRate?: string
    ): Promise<TX[]>;

    /**
     * Signs & sends transactions for refunding a timed out swap
     *
     * @param signer Signer to use for the transaction (must match offerer in swap data)
     * @param swapData Swap to refund
     * @param check Whether to check if the swap contract still exists on-chain
     * @param initAta Whether to initialize a token account if it doesn't exist (applies to e.g. Solana, with token specific ATAs)
     * @param txOptions Transaction options
     */
    refund(signer: Signer, swapData: T, check?: boolean, initAta?: boolean, txOptions?: TransactionConfirmationOptions): Promise<string>;

    /**
     * Returns the transactions for refunding a timed out swap
     *
     * @param signer Signer of the refund transaction
     * @param swapData Swap to refund
     * @param check Whether to check if the swap contract still exists on-chain
     * @param initAta Whether to initialize a token account if it doesn't exist (applies to e.g. Solana, with token specific ATAs)
     * @param feeRate Fee rate to use for the transactions
     */
    txsRefund(signer: string, swapData: T, check?: boolean, initAta?: boolean, feeRate?: string): Promise<TX[]>;

    /**
     * Signs & sends transactions for refunding a swap with a valid refund signature from the claimer
     *
     * @param signer Signer to use for the transaction (must match offerer in swap data)
     * @param swapData Swap to refund
     * @param signature Refund signature received from the claimer
     * @param check Whether to check if the swap contract still exists on-chain
     * @param initAta Whether to initialize a token account if it doesn't exist (applies to e.g. Solana, with token specific ATAs)
     * @param txOptions Transaction options
     */
    refundWithAuthorization(signer: Signer, swapData: T, signature: SignatureData, check?: boolean, initAta?: boolean, txOptions?: TransactionConfirmationOptions): Promise<string>;

    /**
     * Returns the transactions for refunding a swap with a valid refund signature from the claimer
     *
     * @param signer Signer of the refund transaction
     * @param swapData Swap to refund
     * @param signature Refund signature received from the claimer
     * @param check Whether to check if the swap contract still exists on-chain
     * @param initAta Whether to initialize a token account if it doesn't exist (applies to e.g. Solana, with token specific ATAs)
     * @param feeRate Fee rate to use for the transactions
     */
    txsRefundWithAuthorization(signer: string, swapData: T, signature: SignatureData, check?: boolean, initAta?: boolean, feeRate?: string): Promise<TX[]>;

    /**
     * Signs & sends transactions for initializing and instantly (upon init confirmation) claiming the HTLC, used for BTC-LN -> SC swaps
     *
     * @param signer Signer to use for the transaction (must match claimer in swap data)
     * @param swapData Swap to process
     * @param signature Signature data from the offerer
     * @param secret Secret pre-image that hashes to the swap hash
     * @param skipChecks Whether to skip verification of the signature & checking if the swap is already committed
     * @param txOptions Transaction options
     */
    initAndClaimWithSecret?(signer: Signer, swapData: T, signature: SignatureData, secret: string, skipChecks?: boolean, txOptions?: TransactionConfirmationOptions): Promise<string[]>;

    /**
     * Checks whether a swap is already expired, swap expires a bit sooner for the claimer & a bit later for offerer, this
     *  is used to account for possible on-chain time skew
     *
     * @param signer Signer to use for checking the expiry
     * @param swapData Swap to check
     */
    isExpired(signer: string, swapData: T): Promise<boolean>;

    /**
     * Checks whether a swap is claimable for the signer, i.e. it is not expired yet and is committed on-chain
     *
     * @param signer
     * @param swapData
     */
    isClaimable(signer: string, swapData: T): Promise<boolean>;

    /**
     * Checks whether a given swap is committed on chain (initialized)
     *
     * @param swapData
     */
    isCommited(swapData: T): Promise<boolean>;

    /**
     * Returns the full status of the swap, expiry is handled by the isExpired function so also requires a signer/sender
     *
     * @param signer
     * @param swapData
     */
    getCommitStatus(signer: string, swapData: T): Promise<SwapCommitState>;

    /**
     * Returns the full status of the passed swaps, expiry is handled by the isExpired function so also requires a signer/sender
     *
     * @param request
     */
    getCommitStatuses(request: {signer: string, swapData: T}[]): Promise<{[escrowHash: string]: SwapCommitState}>;

    /**
     * Returns the full history as fetched from the chain for a specific signer
     *
     * @param signer
     * @param startBlockheight
     */
    getHistoricalSwaps?(signer: string, startBlockheight?: number): Promise<{
        swaps: {
            [escrowHash: string]: {
                init?: {
                    data: T,
                    getInitTxId: () => Promise<string>,
                    getTxBlock: () => Promise<{
                        blockTime: number,
                        blockHeight: number
                    }>
                },
                state: SwapCommitState
            }
        },
        latestBlockheight: number
    }>;

    /**
     * Checks whether a given swap is refundable by us, i.e. it is already expired, we are offerer & swap is committed on-chain
     *
     * @param signer
     * @param swapData
     */
    isRequestRefundable(signer: string, swapData: T): Promise<boolean>;

    /**
     * Pre-fetches data required for creating init signature
     */
    preFetchBlockDataForSignatures?(): Promise<PreFetchData>;

    /**
     * Pre-fetches data required for init signature verification
     * @param data
     */
    preFetchForInitSignatureVerification?(data: PreFetchData): Promise<PreFetchVerification>;

    /**
     * Generates the initialization signature
     *
     * @param signer Signer to use for signing the message
     * @param swapData Swap to sign
     * @param authorizationTimeout Timeout of the authorization
     * @param preFetchedBlockData Optional pre-fetched data required for creating the signature
     * @param feeRate Optional fee rate to use for the authorization
     */
    getInitSignature(signer: Signer, swapData: T, authorizationTimeout: number, preFetchedBlockData?: PreFetchData, feeRate?: string): Promise<SignatureData>;

    /**
     * Checks whether a signature is a valid initialization signature for a given swap
     *
     * @param sender Address of the sender of the transaction (must be either offerer or claimer)
     * @param swapData Swap to initialize
     * @param signature Signature data
     * @param feeRate Fee rate used for the authorization
     * @param preFetchedVerificationData Optional pre-fetched data required for signature validation
     * @returns {Buffer | null} The message being signed if valid or null if invalid signature
     */
    isValidInitAuthorization(sender: string, swapData: T, signature: SignatureData, feeRate?: string, preFetchedVerificationData?: PreFetchVerification): Promise<Buffer | null>;

    /**
     * Returns the expiry timestamp (UNIX milliseconds) of the authorization
     *
     * @param swapData Swap
     * @param signature Signature data
     * @param preFetchedVerificationData Optional pre-fetched data required for signature validation
     */
    getInitAuthorizationExpiry(swapData: T, signature: SignatureData, preFetchedVerificationData?: PreFetchVerification): Promise<number>;

    /**
     * Checks whether a given init signature is already expired
     *
     * @param swapData Swap
     * @param signature Signature data
     */
    isInitAuthorizationExpired(swapData: T, signature: SignatureData): Promise<boolean>;

    /**
     * Generates the refund signature for a given swap allowing the offerer to refund before expiration
     *
     * @param signer Signer to use for signing the message (must be the same as offerer in swap data)
     * @param swapData Swap to refund
     * @param authorizationTimeout Timeout of the provided refund authorization
     */
    getRefundSignature(signer: Signer, swapData: T, authorizationTimeout: number): Promise<SignatureData>;

    /**
     * Checks whether a given refund signature is valid
     *
     * @param swapData Swap to refund
     * @param signature Signature received from the claimer
     */
    isValidRefundAuthorization(swapData: T, signature: SignatureData): Promise<Buffer | null>;

    /**
     * Signs the given data with the provided signer
     *
     * @param signer Signer to sign the message
     * @param data Data to sign
     */
    getDataSignature(signer: Signer, data: Buffer): Promise<string>;

    /**
     * Checks whether a provided data is signature is valid
     *
     * @param data Data to sign
     * @param signature Signature
     * @param publicKey Public key of the signer
     */
    isValidDataSignature(data: Buffer, signature: string, publicKey: string): Promise<boolean>;

    /**
     * Returns the token balance of a given signer's address
     *
     * @param signer Address to check the balance of
     * @param token Token
     * @param inContract Whether we are checking the liquidity deposited into the LP vault or just on-chain balance
     */
    getBalance(signer: string, token: string, inContract: boolean): Promise<bigint>;

    /**
     * Create a swap data for this given chain
     *
     * @param type Type of the swap
     * @param offerer Offerer address
     * @param claimer Claimer addres
     * @param token Token to use for the swap
     * @param amount Amount of tokens for the swap
     * @param paymentHash Payment hash identifying the swap
     * @param sequence Swap sequence uniquelly defining this swap
     * @param expiry Expiration of the swap
     * @param payIn Whether the swap is payIn (offerer paying to the contract, or not payIn offerer using funds in his LP vault)
     * @param payOut Whether the swap is payOut (claimer getting the funds to his on-chain address, or no payOut claimer
     *  getting his funds into his LP vault)
     * @param securityDeposit Security deposit for the swap paid by the claimer (options premium)
     * @param claimerBounty Bounty for the claimer of the swap (used for watchtowers)
     * @param depositToken Token to be used for security deposit and claimer bounty
     */
    createSwapData(
        type: ChainSwapType,
        offerer: string,
        claimer: string,
        token: string,
        amount: bigint,
        paymentHash: string,
        sequence: bigint,
        expiry: bigint,
        payIn: boolean,
        payOut: boolean,
        securityDeposit: bigint,
        claimerBounty: bigint,
        depositToken?: string
    ): Promise<T>;

    /**
     * Returns intermediary's reputation for a given token swaps
     *
     * @param address
     * @param token
     */
    getIntermediaryReputation(address: string, token: string): Promise<IntermediaryReputationType>;

    /**
     * Returns the fee in native token base units to commit (initiate) the swap
     *
     * @param signer
     * @param swapData Swap to initiate
     * @param feeRate Optional fee rate (fetched on-demand if not provided)
     */
    getCommitFee(signer: string, swapData: T, feeRate?: string): Promise<bigint>;

    /**
     * Returns raw fee (not including any account deposits we might need) for initiating the swap
     *
     * @param signer
     * @param swapData Swap to initiate
     * @param feeRate Optional fee rate (fetched on-demand if not provided)
     */
    getRawCommitFee?(signer: string, swapData: T, feeRate?: string): Promise<bigint>;

    /**
     * Returns the fee in native token base units to claim the swap
     *
     * @param signer Signer claiming the swap
     * @param swapData Swap to claim
     * @param feeRate Optional fee rate (fetched on-demand if not provided)
     */
    getClaimFee(signer: string, swapData: T, feeRate?: string): Promise<bigint>;

    /**
     * Returns raw fee (not including any refunds we might get that would make the getClaimFee negative) for claiming the swap
     *
     * @param signer Signer claiming the swap
     * @param swapData Swap to claim
     * @param feeRate Optional fee rate (fetched on-demand if not provided)
     */
    getRawClaimFee?(signer: string, swapData: T, feeRate?: string): Promise<bigint>;

    /**
     * Returns the fee in native token base units to refund the swap
     *
     * @param signer
     * @param swapData Swap to refund
     * @param feeRate Optional fee rate (fetched on-demand if not provided)
     */
    getRefundFee(signer: string, swapData: T, feeRate?: string): Promise<bigint>;

    /**
     * Returns raw fee (not including any refunds we might get that would make the getRefundFee negative) for claiming the swap
     *
     * @param signer
     * @param swapData Swap to claim
     * @param feeRate Optional fee rate (fetched on-demand if not provided)
     */
    getRawRefundFee?(signer: string, swapData: T, feeRate?: string): Promise<bigint>;

    /**
     * Returns the fee rate for committing (initializing) a payIn swap
     *
     * @param offerer Offerer of the swap
     * @param claimer Claimer of the swap
     * @param token Token to be swapped
     * @param paymentHash Optional payment hash
     */
    getInitPayInFeeRate(offerer: string, claimer: string, token: string, paymentHash?: string): Promise<string>;

    /**
     * Returns the fee rate for committing (initializing) a non-payIn swap
     *
     * @param offerer Offerer of the swap
     * @param claimer Claimer of the swap
     * @param token Token to be swapped
     * @param paymentHash Optional payment hash
     */
    getInitFeeRate(offerer: string, claimer: string, token: string, paymentHash?: string): Promise<string>;

    /**
     * Returns the fee rate for refunding a swap
     *
     * @param swapData Swap to refund
     */
    getRefundFeeRate(swapData: T): Promise<string>;

    /**
     * Returns the fee rate for claiming a swap as a specific signer
     *
     * @param signer Signer claiming the swap
     * @param swapData Swap to claim
     */
    getClaimFeeRate(signer: string, swapData: T): Promise<string>;

    getExtraData(outputScript: Buffer, amount: bigint, confirmations: number, nonce?: bigint): Buffer;

    /**
     * Compute the claim hash for a given transaction output, either nonced or just output locked
     *
     * @param outputScript Bitcoin output locking script
     * @param amount Amount of sats in the output
     * @param confirmations Required number of confirmations for the swap to be claimable
     * @param nonce Nonce to be used as replay protection
     */
    getHashForOnchain(outputScript: Buffer, amount: bigint, confirmations: number, nonce?: bigint): Buffer;

    /**
     * Compute the claim hash for a given transaction id
     *
     * @param txId Bitcoin transaction ID
     * @param confirmations Required number of confirmations for the swap to be claimable
     */
    getHashForTxId(txId: string, confirmations: number): Buffer;

    /**
     * Compute the claim hash for an HTLC swap with a given swap hash
     *
     * @param swapHash
     */
    getHashForHtlc(swapHash: Buffer): Buffer;

    /**
     * Withdraws funds from the trading LP vault
     *
     * @param signer Signer to sign the withdrawal with
     * @param token Token to withdraw
     * @param amount Amount of the token to withdraw
     * @param txOptions Transaction options
     */
    withdraw(signer: Signer, token: string, amount: bigint, txOptions?: TransactionConfirmationOptions): Promise<string>;

    /**
     * Returns transactions required for signer to withdraw funds from the trading LP vault
     *
     * @param signer Owner of the funds
     * @param token Token to withdraw
     * @param amount Amount of the token to withdraw
     * @param feeRate Optional fee rate to use for the transaction (fetched on-demand if not provided)
     */
    txsWithdraw(signer: string, token: string, amount: bigint, feeRate?: string): Promise<TX[]>;

    /**
     * Deposits funds to the trading LP vault
     *
     * @param signer Signer to sign the deposit with
     * @param token Token to deposit
     * @param amount Amount of the token to deposit
     * @param txOptions Transaction options
     */
    deposit(signer: Signer, token: string, amount: bigint, txOptions?: TransactionConfirmationOptions): Promise<string>;

    /**
     * Returns transactions required for signer to deposit funds to the trading LP vault
     *
     * @param signer Owner of the funds
     * @param token Token to deposit
     * @param amount Amount of the token to deposit
     * @param feeRate Optional fee rate to use for the transaction (fetched on-demand if not provided)
     */
    txsDeposit(signer: string, token: string, amount: bigint, feeRate?: string): Promise<TX[]>;

    /**
     * Returns the amount of deposits (in native token) that we can claim back (this is useful for SVM chains with the PDAs
     *  requiring you to put some deposit in order to store data)
     *
     * @param signer Signer to check the claimable deposits for
     */
    getClaimableDeposits?(signer: string): Promise<{count: number, totalValue: bigint}>;

    /**
     * Claims the funds from claimable deposits
     *
     * @param signer Owner of the deposits, transaction signer
     * @param txOptions Transaction options
     */
    claimDeposits?(signer: Signer, txOptions: TransactionConfirmationOptions): Promise<{txIds: string[], count: number, totalValue: bigint}>;

}
