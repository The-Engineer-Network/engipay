"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetChainInterface = void 0;
const starknet_1 = require("starknet");
const Utils_1 = require("../../utils/Utils");
const StarknetTransactions_1 = require("./modules/StarknetTransactions");
const StarknetFees_1 = require("./modules/StarknetFees");
const StarknetAddresses_1 = require("./modules/StarknetAddresses");
const StarknetTokens_1 = require("./modules/StarknetTokens");
const StarknetEvents_1 = require("./modules/StarknetEvents");
const StarknetSignatures_1 = require("./modules/StarknetSignatures");
const StarknetAccounts_1 = require("./modules/StarknetAccounts");
const StarknetBlocks_1 = require("./modules/StarknetBlocks");
const StarknetSigner_1 = require("../wallet/StarknetSigner");
const buffer_1 = require("buffer");
const StarknetKeypairWallet_1 = require("../wallet/accounts/StarknetKeypairWallet");
const StarknetBrowserSigner_1 = require("../wallet/StarknetBrowserSigner");
class StarknetChainInterface {
    constructor(chainId, provider, wsChannel, retryPolicy, feeEstimator = new StarknetFees_1.StarknetFees(provider), options) {
        var _a, _b, _c, _d;
        this.chainId = "STARKNET";
        this.logger = (0, Utils_1.getLogger)("StarknetChainInterface: ");
        this.starknetChainId = chainId;
        this.provider = provider;
        this.retryPolicy = retryPolicy;
        this.config = options ?? {};
        (_a = this.config).getLogForwardBlockRange ?? (_a.getLogForwardBlockRange = 2000);
        (_b = this.config).getLogChunkSize ?? (_b.getLogChunkSize = 100);
        (_c = this.config).maxGetLogKeys ?? (_c.maxGetLogKeys = 64);
        (_d = this.config).maxParallelCalls ?? (_d.maxParallelCalls = 10);
        this.wsChannel = wsChannel;
        this.Fees = feeEstimator;
        this.Tokens = new StarknetTokens_1.StarknetTokens(this);
        this.Transactions = new StarknetTransactions_1.StarknetTransactions(this);
        this.Signatures = new StarknetSignatures_1.StarknetSignatures(this);
        this.Events = new StarknetEvents_1.StarknetEvents(this);
        this.Accounts = new StarknetAccounts_1.StarknetAccounts(this);
        this.Blocks = new StarknetBlocks_1.StarknetBlocks(this);
    }
    async getBalance(signer, tokenAddress) {
        //TODO: For native token we should discount the cost of deploying an account if it is not deployed yet
        return await this.Tokens.getTokenBalance(signer, tokenAddress);
    }
    getNativeCurrencyAddress() {
        return this.Tokens.getNativeCurrencyAddress();
    }
    isValidToken(tokenIdentifier) {
        return this.Tokens.isValidToken(tokenIdentifier);
    }
    isValidAddress(address, lenient) {
        return StarknetAddresses_1.StarknetAddresses.isValidAddress(address, lenient);
    }
    normalizeAddress(address) {
        return (0, Utils_1.toHex)(address);
    }
    ///////////////////////////////////
    //// Callbacks & handlers
    offBeforeTxReplace(callback) {
        return true;
    }
    onBeforeTxReplace(callback) { }
    onBeforeTxSigned(callback) {
        this.Transactions.onBeforeTxSigned(callback);
    }
    offBeforeTxSigned(callback) {
        return this.Transactions.offBeforeTxSigned(callback);
    }
    randomAddress() {
        return (0, Utils_1.toHex)(starknet_1.stark.randomAddress());
    }
    randomSigner() {
        const privateKey = "0x" + buffer_1.Buffer.from(starknet_1.ec.starkCurve.utils.randomPrivateKey()).toString("hex");
        const wallet = new StarknetKeypairWallet_1.StarknetKeypairWallet(this.provider, privateKey);
        return new StarknetSigner_1.StarknetSigner(wallet);
    }
    ////////////////////////////////////////////
    //// Transactions
    sendAndConfirm(signer, txs, waitForConfirmation, abortSignal, parallel, onBeforePublish) {
        return this.Transactions.sendAndConfirm(signer, txs, waitForConfirmation, abortSignal, parallel, onBeforePublish);
    }
    serializeTx(tx) {
        return Promise.resolve(StarknetTransactions_1.StarknetTransactions.serializeTx(tx));
    }
    deserializeTx(txData) {
        return Promise.resolve(StarknetTransactions_1.StarknetTransactions.deserializeTx(txData));
    }
    getTxIdStatus(txId) {
        return this.Transactions.getTxIdStatus(txId);
    }
    getTxStatus(tx) {
        return this.Transactions.getTxStatus(tx);
    }
    async getFinalizedBlock() {
        const block = await this.Blocks.getBlock("l1_accepted");
        return {
            height: block.block_number,
            blockHash: block.block_hash
        };
    }
    txsTransfer(signer, token, amount, dstAddress, feeRate) {
        return this.Tokens.txsTransfer(signer, token, amount, dstAddress, feeRate);
    }
    async transfer(signer, token, amount, dstAddress, txOptions) {
        const txs = await this.Tokens.txsTransfer(signer.getAddress(), token, amount, dstAddress, txOptions?.feeRate);
        const [txId] = await this.Transactions.sendAndConfirm(signer, txs, txOptions?.waitForConfirmation, txOptions?.abortSignal, false);
        return txId;
    }
    wrapSigner(signer) {
        if (signer.walletProvider != null) {
            return Promise.resolve(new StarknetBrowserSigner_1.StarknetBrowserSigner(signer));
        }
        else {
            return Promise.resolve(new StarknetSigner_1.StarknetSigner(signer));
        }
    }
}
exports.StarknetChainInterface = StarknetChainInterface;
