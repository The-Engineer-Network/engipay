import {
    BigIntBufferUtils,
    ChainSwapType,
    IntermediaryReputationType,
    RelaySynchronizer,
    SignatureData,
    SwapCommitState,
    SwapCommitStateType,
    SwapContract,
    TransactionConfirmationOptions
} from "@atomiqlabs/base";
import {Buffer} from "buffer";
import {EscrowManagerAbi} from "./EscrowManagerAbi";
import {StarknetContractBase} from "../contract/StarknetContractBase";
import {StarknetTx} from "../chain/modules/StarknetTransactions";
import {StarknetSigner} from "../wallet/StarknetSigner";
import {BigNumberish, constants, logger} from "starknet";
import {StarknetChainInterface} from "../chain/StarknetChainInterface";
import {StarknetBtcRelay} from "../btcrelay/StarknetBtcRelay";
import {StarknetSwapData} from "./StarknetSwapData";
import {bigNumberishToBuffer, toHex} from "../../utils/Utils";
import {TimelockRefundHandler} from "./handlers/refund/TimelockRefundHandler";
import {StarknetLpVault} from "./modules/StarknetLpVault";
import {StarknetPreFetchVerification, StarknetSwapInit} from "./modules/StarknetSwapInit";
import {StarknetSwapRefund} from "./modules/StarknetSwapRefund";
import {claimHandlersList, IClaimHandler} from "./handlers/claim/ClaimHandlers";
import {StarknetSwapClaim} from "./modules/StarknetSwapClaim";
import {IHandler} from "./handlers/IHandler";
import {StarknetBtcStoredHeader} from "../btcrelay/headers/StarknetBtcStoredHeader";
import {sha256} from "@noble/hashes/sha2";

const ESCROW_STATE_COMMITTED = 1;
const ESCROW_STATE_CLAIMED = 2;
const ESCROW_STATE_REFUNDED = 3;

const swapContractAddreses = {
    [constants.StarknetChainId.SN_SEPOLIA]: "0x017bf50dd28b6d823a231355bb25813d4396c8e19d2df03026038714a22f0413",
    [constants.StarknetChainId.SN_MAIN]: "0x04f278e1f19e495c3b1dd35ef307c4f7510768ed95481958fbae588bd173f79a"
};

const defaultClaimAddresses = {
    [constants.StarknetChainId.SN_SEPOLIA]: {
        [ChainSwapType.HTLC]: "0x04a57ea54d4637c352aad1bbee046868926a11702216a0aaf7eeec1568be2d7b",
        [ChainSwapType.CHAIN_TXID]: "0x04c7cde88359e14b6f6f779f8b9d8310cee37e91a6f143f855ae29fab33c396e",
        [ChainSwapType.CHAIN]: "0x051bef6f5fd12e2832a7d38653bdfc8eb84ba7eb7a4aada5b87ef38a9999cf17",
        [ChainSwapType.CHAIN_NONCED]: "0x050e50eacd16da414f2c3a7c3570fd5e248974c6fe757d41acbf72d2836fa0a1"
    },
    [constants.StarknetChainId.SN_MAIN]: {
        [ChainSwapType.HTLC]: "0x07b74b50a883ebee262b6db0e3c0c697670c6f30e3d610e75faf33a89c46aa2a",
        [ChainSwapType.CHAIN_TXID]: "0x016c2db2b03f39cf4fd7f871035000f66b62307d9983056e33a38315da8a44dc",
        [ChainSwapType.CHAIN]: "0x02c45a81c4a48d0645a0a199e620061e8a55dcc9c2b5946d050eaeeddba64e9a",
        [ChainSwapType.CHAIN_NONCED]: "0x0019b5480dd7ed8ded10a09437b0a7a30b8997b4ef139deb24ff8c86f995d84f"
    }
}

const defaultRefundAddresses = {
    [constants.StarknetChainId.SN_SEPOLIA]: {
        timelock: "0x034b8f28b3ca979036cb2849cfa3af7f67207459224b6ca5ce2474aa398ec3e7"
    },
    [constants.StarknetChainId.SN_MAIN]: {
        timelock: "0x06a59659990c2aefbf7239f6d911617b3ae60b79cb3364f3bd242a6ca8f4f4f7"
    }
}

export class StarknetSwapContract
    extends StarknetContractBase<typeof EscrowManagerAbi>
    implements SwapContract<
        StarknetSwapData,
        StarknetTx,
        never,
        StarknetPreFetchVerification,
        StarknetSigner,
        "STARKNET"
    > {

    readonly supportsInitWithoutClaimer = true;

    ////////////////////////
    //// Constants
    readonly chainId: "STARKNET" = "STARKNET";

    ////////////////////////
    //// Timeouts
    readonly claimWithSecretTimeout: number = 180;
    readonly claimWithTxDataTimeout: number = 180;
    readonly refundTimeout: number = 180;
    readonly claimGracePeriod: number = 10*60;
    readonly refundGracePeriod: number = 10*60;
    readonly authGracePeriod: number = 30;

    ////////////////////////
    //// Services
    readonly Init: StarknetSwapInit;
    readonly Refund: StarknetSwapRefund;
    readonly Claim: StarknetSwapClaim;
    readonly LpVault: StarknetLpVault;

    ////////////////////////
    //// Handlers
    readonly claimHandlersByAddress: {[address: string]: IClaimHandler<any, any>} = {};
    readonly claimHandlersBySwapType: {[type in ChainSwapType]?: IClaimHandler<any, any>} = {};

    readonly refundHandlersByAddress: {[address: string]: IHandler<any, any>} = {};
    readonly timelockRefundHandler: IHandler<any, any>;

    readonly btcRelay: StarknetBtcRelay<any>;

    constructor(
        chainInterface: StarknetChainInterface,
        btcRelay: StarknetBtcRelay<any>,
        contractAddress: string = swapContractAddreses[chainInterface.starknetChainId],
        handlerAddresses?: {
            refund?: {
                timelock?: string
            },
            claim?: {
                [type in ChainSwapType]?: string
            }
        }
    ) {
        super(chainInterface, contractAddress, EscrowManagerAbi);
        this.Init = new StarknetSwapInit(chainInterface, this);
        this.Refund = new StarknetSwapRefund(chainInterface, this);
        this.Claim = new StarknetSwapClaim(chainInterface, this);
        this.LpVault = new StarknetLpVault(chainInterface, this);

        this.btcRelay = btcRelay;

        handlerAddresses ??= {};
        handlerAddresses.refund ??= {};
        handlerAddresses.refund = {...defaultRefundAddresses[chainInterface.starknetChainId], ...handlerAddresses.refund};
        handlerAddresses.claim ??= {};
        handlerAddresses.claim = {...defaultClaimAddresses[chainInterface.starknetChainId], ...handlerAddresses.claim};

        claimHandlersList.forEach(handlerCtor => {
            const handler = new handlerCtor(handlerAddresses.claim[handlerCtor.type]);
            this.claimHandlersByAddress[toHex(handler.address)] = handler;
            this.claimHandlersBySwapType[handlerCtor.type] = handler;
        });

        this.timelockRefundHandler = new TimelockRefundHandler(handlerAddresses.refund.timelock);
        this.refundHandlersByAddress[this.timelockRefundHandler.address] = this.timelockRefundHandler;
    }

    async start(): Promise<void> {
    }

    ////////////////////////////////////////////
    //// Signatures
    preFetchForInitSignatureVerification(): Promise<StarknetPreFetchVerification> {
        return this.Init.preFetchForInitSignatureVerification();
    }

    getInitSignature(signer: StarknetSigner, swapData: StarknetSwapData, authorizationTimeout: number, preFetchedBlockData?: never, feeRate?: string): Promise<SignatureData> {
        return this.Init.signSwapInitialization(signer, swapData, authorizationTimeout);
    }

    isValidInitAuthorization(sender: string, swapData: StarknetSwapData, {timeout, prefix, signature}, feeRate?: string, preFetchedData?: StarknetPreFetchVerification): Promise<Buffer> {
        return this.Init.isSignatureValid(sender, swapData, timeout, prefix, signature, preFetchedData);
    }

    getInitAuthorizationExpiry(swapData: StarknetSwapData, {timeout, prefix, signature}, preFetchedData?: StarknetPreFetchVerification): Promise<number> {
        return this.Init.getSignatureExpiry(timeout);
    }

    isInitAuthorizationExpired(swapData: StarknetSwapData, {timeout, prefix, signature}): Promise<boolean> {
        return this.Init.isSignatureExpired(timeout);
    }

    getRefundSignature(signer: StarknetSigner, swapData: StarknetSwapData, authorizationTimeout: number): Promise<SignatureData> {
        return this.Refund.signSwapRefund(signer, swapData, authorizationTimeout);
    }

    isValidRefundAuthorization(swapData: StarknetSwapData, {timeout, prefix, signature}): Promise<Buffer> {
        return this.Refund.isSignatureValid(swapData, timeout, prefix, signature);
    }

    getDataSignature(signer: StarknetSigner, data: Buffer): Promise<string> {
        return this.Chain.Signatures.getDataSignature(signer, data);
    }

    isValidDataSignature(data: Buffer, signature: string, publicKey: string): Promise<boolean> {
        return this.Chain.Signatures.isValidDataSignature(data, signature, publicKey);
    }

    ////////////////////////////////////////////
    //// Swap data utils
    /**
     * Checks whether the claim is claimable by us, that means not expired, we are claimer & the swap is commited
     *
     * @param signer
     * @param data
     */
    async isClaimable(signer: string, data: StarknetSwapData): Promise<boolean> {
        if(!data.isClaimer(signer)) return false;
        if(await this.isExpired(signer, data)) return false;
        return await this.isCommited(data);
    }

    /**
     * Checks whether a swap is commited, i.e. the swap still exists on-chain and was not claimed nor refunded
     *
     * @param swapData
     */
    async isCommited(swapData: StarknetSwapData): Promise<boolean> {
        const data = await this.contract.get_hash_state("0x"+swapData.getEscrowHash());
        return Number(data.state)===ESCROW_STATE_COMMITTED;
    }

    /**
     * Checks whether the swap is expired, takes into consideration possible on-chain time skew, therefore for claimer
     *  the swap expires a bit sooner than it should've & for the offerer it expires a bit later
     *
     * @param signer
     * @param data
     */
    isExpired(signer: string, data: StarknetSwapData): Promise<boolean> {
        let currentTimestamp: bigint = BigInt(Math.floor(Date.now()/1000));
        if(data.isClaimer(signer)) currentTimestamp = currentTimestamp + BigInt(this.claimGracePeriod);
        if(data.isOfferer(signer)) currentTimestamp = currentTimestamp - BigInt(this.refundGracePeriod);
        return Promise.resolve(data.getExpiry() < currentTimestamp);
    }

    /**
     * Checks if the swap is refundable by us, checks if we are offerer, if the swap is already expired & if the swap
     *  is still commited
     *
     * @param signer
     * @param data
     */
    async isRequestRefundable(signer: string, data: StarknetSwapData): Promise<boolean> {
        //Swap can only be refunded by the offerer
        if(!data.isOfferer(signer)) return false;
        if(!(await this.isExpired(signer, data))) return false;
        return await this.isCommited(data);
    }

    getHashForTxId(txId: string, confirmations: number) {
        return bigNumberishToBuffer(this.claimHandlersBySwapType[ChainSwapType.CHAIN_TXID].getCommitment({
            txId,
            confirmations,
            btcRelay: this.btcRelay
        }), 32);
    }

    /**
     * Get the swap payment hash to be used for an on-chain swap, uses poseidon hash of the value
     *
     * @param outputScript output script required to claim the swap
     * @param amount sats sent required to claim the swap
     * @param confirmations
     * @param nonce swap nonce uniquely identifying the transaction to prevent replay attacks
     */
    getHashForOnchain(outputScript: Buffer, amount: bigint, confirmations: number, nonce?: bigint): Buffer {
        let result: BigNumberish;
        if(nonce==null || nonce === 0n) {
            result = this.claimHandlersBySwapType[ChainSwapType.CHAIN].getCommitment({
                output: outputScript,
                amount,
                confirmations,
                btcRelay: this.btcRelay
            });
        } else {
            result = this.claimHandlersBySwapType[ChainSwapType.CHAIN_NONCED].getCommitment({
                output: outputScript,
                amount,
                nonce,
                confirmations,
                btcRelay: this.btcRelay
            });
        }
        return bigNumberishToBuffer(result, 32);
    }

    /**
     * Get the swap payment hash to be used for a lightning htlc swap, uses poseidon hash of the sha256 hash of the preimage
     *
     * @param paymentHash payment hash of the HTLC
     */
    getHashForHtlc(paymentHash: Buffer): Buffer {
        return bigNumberishToBuffer(this.claimHandlersBySwapType[ChainSwapType.HTLC].getCommitment(paymentHash), 32);
    }

    getExtraData(outputScript: Buffer, amount: bigint, confirmations: number, nonce?: bigint): Buffer {
        if(nonce==null) nonce = 0n;
        const txoHash = Buffer.from(sha256(Buffer.concat([
            BigIntBufferUtils.toBuffer(amount, "le", 8),
            outputScript
        ])));
        return Buffer.concat([
            txoHash,
            BigIntBufferUtils.toBuffer(nonce, "be", 8),
            BigIntBufferUtils.toBuffer(BigInt(confirmations), "be", 2)
        ]);
    }


    ////////////////////////////////////////////
    //// Swap data getters
    /**
     * Gets the status of the specific swap, this also checks if we are offerer/claimer & checks for expiry (to see
     *  if swap is refundable)
     *
     * @param signer
     * @param data
     */
    async getCommitStatus(signer: string, data: StarknetSwapData): Promise<SwapCommitState> {
        const escrowHash = data.getEscrowHash();
        const stateData = await this.contract.get_hash_state("0x"+escrowHash);
        const state = Number(stateData.state);
        const blockHeight = Number(stateData.finish_blockheight);
        switch(state) {
            case ESCROW_STATE_COMMITTED:
                if(data.isOfferer(signer) && await this.isExpired(signer,data)) return {type: SwapCommitStateType.REFUNDABLE};
                return {type: SwapCommitStateType.COMMITED};
            case ESCROW_STATE_CLAIMED:
                return {
                    type: SwapCommitStateType.PAID,
                    getTxBlock: async () => {
                        return {
                            blockTime: await this.Chain.Blocks.getBlockTime(blockHeight),
                            blockHeight: blockHeight
                        };
                    },
                    getClaimTxId: async () => {
                        const events = await this.Events.getContractBlockEvents(
                            ["escrow_manager::events::Claim"],
                            [null, null, null, "0x"+escrowHash],
                            blockHeight, blockHeight
                        );
                        return events.length===0 ? null : events[0].txHash;
                    },
                    getClaimResult: async () => {
                        const events = await this.Events.getContractBlockEvents(
                            ["escrow_manager::events::Claim"],
                            [null, null, null, "0x"+escrowHash],
                            blockHeight, blockHeight
                        );
                        if(events.length===0) return null;
                        const event = events[0];
                        const claimHandlerHex = toHex(event.params.claim_handler);
                        const claimHandler = this.claimHandlersByAddress[claimHandlerHex];
                        if(claimHandler==null) {
                            logger.warn("getCommitStatus(): getClaimResult("+escrowHash+"): Unknown claim handler with claim: "+claimHandlerHex);
                            return null;
                        }
                        const witnessResult = claimHandler.parseWitnessResult(event.params.witness_result);
                        return witnessResult;
                    }
                };
            default:
                return {
                    type: await this.isExpired(signer, data) ? SwapCommitStateType.EXPIRED : SwapCommitStateType.NOT_COMMITED,
                    getTxBlock: async () => {
                        return {
                            blockTime: await this.Chain.Blocks.getBlockTime(blockHeight),
                            blockHeight: blockHeight
                        };
                    },
                    getClaimTxId: async () => {
                        const events = await this.Events.getContractBlockEvents(
                            ["escrow_manager::events::Refund"],
                            [null, null, null, "0x"+escrowHash],
                            blockHeight, blockHeight
                        );
                        return events.length===0 ? null : events[0].txHash;
                    }
                };
        }
    }

    async getCommitStatuses(request: { signer: string; swapData: StarknetSwapData }[]): Promise<{
        [p: string]: SwapCommitState
    }> {
        const result: {
            [p: string]: SwapCommitState
        } = {};
        let promises: Promise<void>[] = [];
        //TODO: We can upgrade this to use multicall
        for(let {signer, swapData} of request) {
            promises.push(this.getCommitStatus(signer, swapData).then(val => {
                result[swapData.getEscrowHash()] = val;
            }));
            if(promises.length>=this.Chain.config.maxParallelCalls) {
                await Promise.all(promises);
                promises = [];
            }
        }
        await Promise.all(promises);
        return result;
    }

    /**
     * Returns the data committed for a specific payment hash, or null if no data is currently commited for
     *  the specific swap
     *
     * @param paymentHashHex
     */
    async getCommitedData(paymentHashHex: string): Promise<StarknetSwapData> {
        //TODO: Noop
        return null;
    }

    ////////////////////////////////////////////
    //// Swap data initializer
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
        depositToken: string = this.Chain.Tokens.getNativeCurrencyAddress()
    ): Promise<StarknetSwapData> {
        return Promise.resolve(new StarknetSwapData(
            offerer,
            claimer,
            token,
            this.timelockRefundHandler.address,
            this.claimHandlersBySwapType?.[type]?.address,
            payOut,
            payIn,
            payIn, //For now track reputation for all payIn swaps
            sequence,
            "0x"+paymentHash,
            toHex(expiry),
            amount,
            depositToken,
            securityDeposit,
            claimerBounty,
            type,
            null
        ));
    }

    ////////////////////////////////////////////
    //// Utils
    async getBalance(signer: string, tokenAddress: string, inContract?: boolean): Promise<bigint> {
        if(inContract) return await this.getIntermediaryBalance(signer, tokenAddress);

        //TODO: For native token we should discount the cost of deploying an account if it is not deployed yet
        return await this.Chain.getBalance(signer, tokenAddress);
    }

    getIntermediaryData(address: string, token: string): Promise<{
        balance: bigint,
        reputation: IntermediaryReputationType
    }> {
        return this.LpVault.getIntermediaryData(address, token);
    }

    getIntermediaryReputation(address: string, token: string): Promise<IntermediaryReputationType> {
        return this.LpVault.getIntermediaryReputation(address, token);
    }

    getIntermediaryBalance(address: string, token: string): Promise<bigint> {
        return this.LpVault.getIntermediaryBalance(address, token);
    }

    ////////////////////////////////////////////
    //// Transaction initializers
    async txsClaimWithSecret(
        signer: string | StarknetSigner,
        swapData: StarknetSwapData,
        secret: string,
        checkExpiry?: boolean,
        initAta?: boolean,
        feeRate?: string,
        skipAtaCheck?: boolean
    ): Promise<StarknetTx[]> {
        return this.Claim.txsClaimWithSecret(typeof(signer)==="string" ? signer : signer.getAddress(), swapData, secret, checkExpiry, feeRate)
    }

    async txsClaimWithTxData(
        signer: string | StarknetSigner,
        swapData: StarknetSwapData,
        tx: { blockhash: string, confirmations: number, txid: string, hex: string, height: number },
        requiredConfirmations: number,
        vout: number,
        commitedHeader?: StarknetBtcStoredHeader,
        synchronizer?: RelaySynchronizer<StarknetBtcStoredHeader, StarknetTx, any>,
        initAta?: boolean,
        feeRate?: string
    ): Promise<StarknetTx[]> {
        return this.Claim.txsClaimWithTxData(
            typeof(signer)==="string" ? signer : signer.getAddress(),
            swapData,
            tx,
            requiredConfirmations,
            vout,
            commitedHeader,
            synchronizer,
            feeRate
        );
    }

    txsRefund(signer: string, swapData: StarknetSwapData, check?: boolean, initAta?: boolean, feeRate?: string): Promise<StarknetTx[]> {
        return this.Refund.txsRefund(signer, swapData, check, feeRate);
    }

    txsRefundWithAuthorization(signer: string, swapData: StarknetSwapData, {timeout, prefix, signature}, check?: boolean, initAta?: boolean, feeRate?: string): Promise<StarknetTx[]> {
        return this.Refund.txsRefundWithAuthorization(signer, swapData, timeout, prefix,signature, check, feeRate);
    }

    txsInit(sender: string, swapData: StarknetSwapData, {timeout, prefix, signature}, skipChecks?: boolean, feeRate?: string): Promise<StarknetTx[]> {
        return this.Init.txsInit(sender, swapData, timeout, prefix, signature, skipChecks, feeRate);
    }

    txsWithdraw(signer: string, token: string, amount: bigint, feeRate?: string): Promise<StarknetTx[]> {
        return this.LpVault.txsWithdraw(signer, token, amount, feeRate);
    }

    txsDeposit(signer: string, token: string, amount: bigint, feeRate?: string): Promise<StarknetTx[]> {
        return this.LpVault.txsDeposit(signer, token, amount, feeRate);
    }

    ////////////////////////////////////////////
    //// Executors
    async claimWithSecret(
        signer: StarknetSigner,
        swapData: StarknetSwapData,
        secret: string,
        checkExpiry?: boolean,
        initAta?: boolean,
        txOptions?: TransactionConfirmationOptions
    ): Promise<string> {
        const result = await this.Claim.txsClaimWithSecret(signer.getAddress(), swapData, secret, checkExpiry, txOptions?.feeRate);
        const [signature] = await this.Chain.sendAndConfirm(signer, result, txOptions?.waitForConfirmation, txOptions?.abortSignal);
        return signature;
    }

    async claimWithTxData(
        signer: StarknetSigner,
        swapData: StarknetSwapData,
        tx: { blockhash: string, confirmations: number, txid: string, hex: string, height: number },
        requiredConfirmations: number,
        vout: number,
        commitedHeader?: StarknetBtcStoredHeader,
        synchronizer?: RelaySynchronizer<StarknetBtcStoredHeader, StarknetTx, any>,
        initAta?: boolean,
        txOptions?: TransactionConfirmationOptions
    ): Promise<string> {
        const txs = await this.Claim.txsClaimWithTxData(
            signer.getAddress(), swapData, tx, requiredConfirmations, vout,
            commitedHeader, synchronizer, txOptions?.feeRate
        );
        if(txs===null) throw new Error("Btc relay not synchronized to required blockheight!");

        //TODO: This doesn't return proper tx signature
        const [signature] = await this.Chain.sendAndConfirm(signer, txs, txOptions?.waitForConfirmation, txOptions?.abortSignal);

        return signature;
    }

    async refund(
        signer: StarknetSigner,
        swapData: StarknetSwapData,
        check?: boolean,
        initAta?: boolean,
        txOptions?: TransactionConfirmationOptions
    ): Promise<string> {
        let result = await this.txsRefund(signer.getAddress(), swapData, check, initAta, txOptions?.feeRate);

        const [signature] = await this.Chain.sendAndConfirm(signer, result, txOptions?.waitForConfirmation, txOptions?.abortSignal);

        return signature;
    }

    async refundWithAuthorization(
        signer: StarknetSigner,
        swapData: StarknetSwapData,
        signature: SignatureData,
        check?: boolean,
        initAta?: boolean,
        txOptions?: TransactionConfirmationOptions
    ): Promise<string> {
        let result = await this.txsRefundWithAuthorization(signer.getAddress(), swapData, signature, check, initAta, txOptions?.feeRate);

        const [txSignature] = await this.Chain.sendAndConfirm(signer, result, txOptions?.waitForConfirmation, txOptions?.abortSignal);

        return txSignature;
    }

    async init(
        signer: StarknetSigner,
        swapData: StarknetSwapData,
        signature: SignatureData,
        skipChecks?: boolean,
        txOptions?: TransactionConfirmationOptions
    ): Promise<string> {
        if(swapData.isPayIn()) {
            if(!swapData.isOfferer(signer.getAddress())) throw new Error("Invalid signer provided!");
        } else {
            if(!swapData.isClaimer(signer.getAddress())) throw new Error("Invalid signer provided!");
        }

        let result = await this.txsInit(signer.getAddress(), swapData, signature, skipChecks, txOptions?.feeRate);

        const [txSignature] = await this.Chain.sendAndConfirm(signer, result, txOptions?.waitForConfirmation, txOptions?.abortSignal);

        return txSignature;
    }

    async withdraw(
        signer: StarknetSigner,
        token: string,
        amount: bigint,
        txOptions?: TransactionConfirmationOptions
    ): Promise<string> {
        const txs = await this.LpVault.txsWithdraw(signer.getAddress(), token, amount, txOptions?.feeRate);
        const [txId] = await this.Chain.sendAndConfirm(signer, txs, txOptions?.waitForConfirmation, txOptions?.abortSignal, false);
        return txId;
    }

    async deposit(
        signer: StarknetSigner,
        token: string,
        amount: bigint,
        txOptions?: TransactionConfirmationOptions
    ): Promise<string> {
        const txs = await this.LpVault.txsDeposit(signer.getAddress(), token, amount, txOptions?.feeRate);
        const [txId] = await this.Chain.sendAndConfirm(signer, txs, txOptions?.waitForConfirmation, txOptions?.abortSignal, false);
        return txId;
    }

    ////////////////////////////////////////////
    //// Fees
    getInitPayInFeeRate(offerer?: string, claimer?: string, token?: string, paymentHash?: string): Promise<string> {
        return this.Chain.Fees.getFeeRate();
    }

    getInitFeeRate(offerer?: string, claimer?: string, token?: string, paymentHash?: string): Promise<string> {
        return this.Chain.Fees.getFeeRate();
    }

    getRefundFeeRate(swapData: StarknetSwapData): Promise<string> {
        return this.Chain.Fees.getFeeRate();
    }

    getClaimFeeRate(signer: string, swapData: StarknetSwapData): Promise<string> {
        return this.Chain.Fees.getFeeRate();
    }

    getClaimFee(signer: string, swapData: StarknetSwapData, feeRate?: string): Promise<bigint> {
        return this.Claim.getClaimFee(swapData, feeRate);
    }

    /**
     * Get the estimated solana fee of the commit transaction
     */
    getCommitFee(signer: string, swapData: StarknetSwapData, feeRate?: string): Promise<bigint> {
        return this.Init.getInitFee(swapData, feeRate);
    }

    /**
     * Get the estimated solana transaction fee of the refund transaction
     */
    getRefundFee(signer: string, swapData: StarknetSwapData, feeRate?: string): Promise<bigint> {
        return this.Refund.getRefundFee(swapData, feeRate);
    }

}
