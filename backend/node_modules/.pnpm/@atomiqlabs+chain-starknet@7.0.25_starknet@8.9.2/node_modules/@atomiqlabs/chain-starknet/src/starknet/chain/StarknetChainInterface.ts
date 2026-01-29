import {Provider, constants, stark, ec, Account, provider, wallet, WebSocketChannel} from "starknet";
import {getLogger, toHex} from "../../utils/Utils";
import {StarknetTransactions, StarknetTx} from "./modules/StarknetTransactions";
import {StarknetFees} from "./modules/StarknetFees";
import {StarknetAddresses} from "./modules/StarknetAddresses";
import {StarknetTokens} from "./modules/StarknetTokens";
import {StarknetEvents} from "./modules/StarknetEvents";
import {StarknetSignatures} from "./modules/StarknetSignatures";
import {StarknetAccounts} from "./modules/StarknetAccounts";
import {StarknetBlocks} from "./modules/StarknetBlocks";
import {ChainInterface, TransactionConfirmationOptions} from "@atomiqlabs/base";
import {StarknetSigner} from "../wallet/StarknetSigner";
import {Buffer} from "buffer";
import {StarknetKeypairWallet} from "../wallet/accounts/StarknetKeypairWallet";
import {StarknetBrowserSigner} from "../wallet/StarknetBrowserSigner";

export type StarknetRetryPolicy = {
    maxRetries?: number,
    delay?: number,
    exponential?: boolean
}

export type StarknetConfig = {
    getLogChunkSize?: number, //100
    getLogForwardBlockRange?: number, //2000
    maxGetLogKeys?: number, //64

    maxParallelCalls?: number, //10
};

export class StarknetChainInterface implements ChainInterface<StarknetTx, StarknetSigner, "STARKNET", Account> {

    readonly chainId = "STARKNET";

    readonly wsChannel?: WebSocketChannel;
    readonly provider: Provider;
    readonly retryPolicy: StarknetRetryPolicy;

    public readonly starknetChainId: constants.StarknetChainId;

    public Fees: StarknetFees;
    public readonly Tokens: StarknetTokens;
    public readonly Transactions: StarknetTransactions;
    public readonly Signatures: StarknetSignatures;
    public readonly Events: StarknetEvents;
    public readonly Accounts: StarknetAccounts;
    public readonly Blocks: StarknetBlocks;

    protected readonly logger = getLogger("StarknetChainInterface: ");

    public readonly config: StarknetConfig;

    constructor(
        chainId: constants.StarknetChainId,
        provider: Provider,
        wsChannel?: WebSocketChannel,
        retryPolicy?: StarknetRetryPolicy,
        feeEstimator: StarknetFees = new StarknetFees(provider),
        options?: StarknetConfig
    ) {
        this.starknetChainId = chainId;
        this.provider = provider;
        this.retryPolicy = retryPolicy;
        this.config = options ?? {};
        this.config.getLogForwardBlockRange ??= 2000;
        this.config.getLogChunkSize ??= 100;
        this.config.maxGetLogKeys ??= 64;
        this.config.maxParallelCalls ??= 10;
        this.wsChannel = wsChannel;

        this.Fees = feeEstimator;
        this.Tokens = new StarknetTokens(this);
        this.Transactions = new StarknetTransactions(this);

        this.Signatures = new StarknetSignatures(this);
        this.Events = new StarknetEvents(this);
        this.Accounts = new StarknetAccounts(this);
        this.Blocks = new StarknetBlocks(this);
    }

    async getBalance(signer: string, tokenAddress: string): Promise<bigint> {
        //TODO: For native token we should discount the cost of deploying an account if it is not deployed yet
        return await this.Tokens.getTokenBalance(signer, tokenAddress);
    }

    getNativeCurrencyAddress(): string {
        return this.Tokens.getNativeCurrencyAddress();
    }

    isValidToken(tokenIdentifier: string): boolean {
        return this.Tokens.isValidToken(tokenIdentifier);
    }

    isValidAddress(address: string, lenient?: boolean): boolean {
        return StarknetAddresses.isValidAddress(address, lenient);
    }

    normalizeAddress(address: string): string {
        return toHex(address);
    }

    ///////////////////////////////////
    //// Callbacks & handlers
    offBeforeTxReplace(callback: (oldTx: string, oldTxId: string, newTx: string, newTxId: string) => Promise<void>): boolean {
        return true;
    }

    onBeforeTxReplace(callback: (oldTx: string, oldTxId: string, newTx: string, newTxId: string) => Promise<void>): void {}

    onBeforeTxSigned(callback: (tx: StarknetTx) => Promise<void>): void {
        this.Transactions.onBeforeTxSigned(callback);
    }

    offBeforeTxSigned(callback: (tx: StarknetTx) => Promise<void>): boolean {
        return this.Transactions.offBeforeTxSigned(callback);
    }

    randomAddress(): string {
        return toHex(stark.randomAddress());
    }

    randomSigner(): StarknetSigner {
        const privateKey = "0x"+Buffer.from(ec.starkCurve.utils.randomPrivateKey()).toString("hex");
        const wallet = new StarknetKeypairWallet(this.provider, privateKey);
        return new StarknetSigner(wallet);
    }

    ////////////////////////////////////////////
    //// Transactions
    sendAndConfirm(
        signer: StarknetSigner,
        txs: StarknetTx[],
        waitForConfirmation?: boolean,
        abortSignal?: AbortSignal,
        parallel?: boolean,
        onBeforePublish?: (txId: string, rawTx: string) => Promise<void>
    ): Promise<string[]> {
        return this.Transactions.sendAndConfirm(signer, txs, waitForConfirmation, abortSignal, parallel, onBeforePublish);
    }

    serializeTx(tx: StarknetTx): Promise<string> {
        return Promise.resolve(StarknetTransactions.serializeTx(tx));
    }

    deserializeTx(txData: string): Promise<StarknetTx> {
        return Promise.resolve(StarknetTransactions.deserializeTx(txData));
    }

    getTxIdStatus(txId: string): Promise<"not_found" | "pending" | "success" | "reverted"> {
        return this.Transactions.getTxIdStatus(txId);
    }

    getTxStatus(tx: string): Promise<"not_found" | "pending" | "success" | "reverted"> {
        return this.Transactions.getTxStatus(tx);
    }

    async getFinalizedBlock(): Promise<{ height: number; blockHash: string }> {
        const block = await this.Blocks.getBlock("l1_accepted");
        return {
            height: block.block_number as number,
            blockHash: block.block_hash as string
        }
    }

    txsTransfer(signer: string, token: string, amount: bigint, dstAddress: string, feeRate?: string): Promise<StarknetTx[]> {
        return this.Tokens.txsTransfer(signer, token, amount, dstAddress, feeRate);
    }

    async transfer(
        signer: StarknetSigner,
        token: string,
        amount: bigint,
        dstAddress: string,
        txOptions?: TransactionConfirmationOptions
    ): Promise<string> {
        const txs = await this.Tokens.txsTransfer(signer.getAddress(), token, amount, dstAddress, txOptions?.feeRate);
        const [txId] = await this.Transactions.sendAndConfirm(signer, txs, txOptions?.waitForConfirmation, txOptions?.abortSignal, false);
        return txId;
    }

    wrapSigner(signer: Account): Promise<StarknetSigner> {
        if((signer as any).walletProvider!=null) {
            return Promise.resolve(new StarknetBrowserSigner(signer));
        } else {
            return Promise.resolve(new StarknetSigner(signer));
        }
    }

}
