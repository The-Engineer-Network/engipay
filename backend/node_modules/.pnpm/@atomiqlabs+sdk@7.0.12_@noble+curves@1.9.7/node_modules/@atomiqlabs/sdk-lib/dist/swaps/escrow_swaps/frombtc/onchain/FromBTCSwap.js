"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBTCSwap = exports.isFromBTCSwapInit = exports.FromBTCSwapState = void 0;
const IFromBTCSwap_1 = require("../IFromBTCSwap");
const SwapType_1 = require("../../../enums/SwapType");
const base_1 = require("@atomiqlabs/base");
const buffer_1 = require("buffer");
const Tokens_1 = require("../../../../Tokens");
const Utils_1 = require("../../../../utils/Utils");
const BitcoinUtils_1 = require("../../../../utils/BitcoinUtils");
const BitcoinHelpers_1 = require("../../../../utils/BitcoinHelpers");
const IBitcoinWallet_1 = require("../../../../btc/wallet/IBitcoinWallet");
const btc_signer_1 = require("@scure/btc-signer");
const SingleAddressBitcoinWallet_1 = require("../../../../btc/wallet/SingleAddressBitcoinWallet");
const IEscrowSelfInitSwap_1 = require("../../IEscrowSelfInitSwap");
var FromBTCSwapState;
(function (FromBTCSwapState) {
    FromBTCSwapState[FromBTCSwapState["FAILED"] = -4] = "FAILED";
    FromBTCSwapState[FromBTCSwapState["EXPIRED"] = -3] = "EXPIRED";
    FromBTCSwapState[FromBTCSwapState["QUOTE_EXPIRED"] = -2] = "QUOTE_EXPIRED";
    FromBTCSwapState[FromBTCSwapState["QUOTE_SOFT_EXPIRED"] = -1] = "QUOTE_SOFT_EXPIRED";
    FromBTCSwapState[FromBTCSwapState["PR_CREATED"] = 0] = "PR_CREATED";
    FromBTCSwapState[FromBTCSwapState["CLAIM_COMMITED"] = 1] = "CLAIM_COMMITED";
    FromBTCSwapState[FromBTCSwapState["BTC_TX_CONFIRMED"] = 2] = "BTC_TX_CONFIRMED";
    FromBTCSwapState[FromBTCSwapState["CLAIM_CLAIMED"] = 3] = "CLAIM_CLAIMED";
})(FromBTCSwapState = exports.FromBTCSwapState || (exports.FromBTCSwapState = {}));
function isFromBTCSwapInit(obj) {
    return typeof (obj.address) === "string" &&
        typeof (obj.amount) === "bigint" &&
        (0, IEscrowSelfInitSwap_1.isIEscrowSelfInitSwapInit)(obj);
}
exports.isFromBTCSwapInit = isFromBTCSwapInit;
class FromBTCSwap extends IFromBTCSwap_1.IFromBTCSwap {
    constructor(wrapper, initOrObject) {
        if (isFromBTCSwapInit(initOrObject))
            initOrObject.url += "/frombtc";
        super(wrapper, initOrObject);
        this.inputToken = Tokens_1.BitcoinTokens.BTC;
        this.TYPE = SwapType_1.SwapType.FROM_BTC;
        if (isFromBTCSwapInit(initOrObject)) {
            this.state = FromBTCSwapState.PR_CREATED;
        }
        else {
            this.address = initOrObject.address;
            this.amount = BigInt(initOrObject.amount);
            this.txId = initOrObject.txId;
            this.vout = initOrObject.vout;
            this.requiredConfirmations = initOrObject.requiredConfirmations ?? this.data.getConfirmationsHint();
        }
        this.tryRecomputeSwapPrice();
        this.logger = (0, Utils_1.getLogger)("FromBTC(" + this.getIdentifierHashString() + "): ");
    }
    upgradeVersion() {
        if (this.version == null) {
            switch (this.state) {
                case -2:
                    this.state = FromBTCSwapState.FAILED;
                    break;
                case -1:
                    this.state = FromBTCSwapState.QUOTE_EXPIRED;
                    break;
                case 0:
                    this.state = FromBTCSwapState.PR_CREATED;
                    break;
                case 1:
                    this.state = FromBTCSwapState.CLAIM_COMMITED;
                    break;
                case 2:
                    this.state = FromBTCSwapState.BTC_TX_CONFIRMED;
                    break;
                case 3:
                    this.state = FromBTCSwapState.CLAIM_CLAIMED;
                    break;
            }
            this.version = 1;
        }
    }
    //////////////////////////////
    //// Getters & utils
    /**
     * Returns bitcoin address where the on-chain BTC should be sent to
     */
    getAddress() {
        if (this.state === FromBTCSwapState.PR_CREATED)
            return null;
        return this.address;
    }
    getHyperlink() {
        if (this.state === FromBTCSwapState.PR_CREATED)
            return null;
        return "bitcoin:" + this.address + "?amount=" + encodeURIComponent((Number(this.amount) / 100000000).toString(10));
    }
    getInputTxId() {
        return this.txId;
    }
    /**
     * Returns timeout time (in UNIX milliseconds) when the on-chain address will expire and no funds should be sent
     *  to that address anymore
     */
    getTimeoutTime() {
        return Number(this.wrapper.getOnchainSendTimeout(this.data, this.requiredConfirmations)) * 1000;
    }
    requiresAction() {
        return this.isClaimable() || (this.state === FromBTCSwapState.CLAIM_COMMITED && this.getTimeoutTime() > Date.now());
    }
    isFinished() {
        return this.state === FromBTCSwapState.CLAIM_CLAIMED || this.state === FromBTCSwapState.QUOTE_EXPIRED || this.state === FromBTCSwapState.FAILED;
    }
    isClaimable() {
        return this.state === FromBTCSwapState.BTC_TX_CONFIRMED;
    }
    isSuccessful() {
        return this.state === FromBTCSwapState.CLAIM_CLAIMED;
    }
    isFailed() {
        return this.state === FromBTCSwapState.FAILED || (this.state === FromBTCSwapState.EXPIRED && this.txId != null);
    }
    isQuoteExpired() {
        return this.state === FromBTCSwapState.QUOTE_EXPIRED;
    }
    isQuoteSoftExpired() {
        return this.state === FromBTCSwapState.QUOTE_EXPIRED || this.state === FromBTCSwapState.QUOTE_SOFT_EXPIRED;
    }
    canCommit() {
        if (this.state !== FromBTCSwapState.PR_CREATED)
            return false;
        const expiry = this.wrapper.getOnchainSendTimeout(this.data, this.requiredConfirmations);
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        return (expiry - currentTimestamp) >= this.wrapper.options.minSendWindow;
    }
    //////////////////////////////
    //// Amounts & fees
    getInput() {
        return (0, Tokens_1.toTokenAmount)(this.amount, this.inputToken, this.wrapper.prices);
    }
    /**
     * Returns claimer bounty, acting as a reward for watchtowers to claim the swap automatically
     */
    getClaimerBounty() {
        return (0, Tokens_1.toTokenAmount)(this.data.getClaimerBounty(), this.wrapper.tokens[this.data.getDepositToken()], this.wrapper.prices);
    }
    //////////////////////////////
    //// Bitcoin tx
    getRequiredConfirmationsCount() {
        return this.requiredConfirmations;
    }
    /**
     * Checks whether a bitcoin payment was already made, returns the payment or null when no payment has been made.
     */
    async getBitcoinPayment() {
        const result = await this.wrapper.btcRpc.checkAddressTxos(this.address, buffer_1.Buffer.from(this.data.getTxoHashHint(), "hex"));
        if (result == null)
            return null;
        return {
            txId: result.tx.txid,
            vout: result.vout,
            confirmations: result.tx.confirmations,
            targetConfirmations: this.requiredConfirmations
        };
    }
    /**
     * Waits till the bitcoin transaction confirms and swap becomes claimable
     *
     * @param updateCallback Callback called when txId is found, and also called with subsequent confirmations
     * @param checkIntervalSeconds How often to check the bitcoin transaction
     * @param abortSignal Abort signal
     * @throws {Error} if in invalid state (must be CLAIM_COMMITED)
     */
    async waitForBitcoinTransaction(updateCallback, checkIntervalSeconds, abortSignal) {
        if (this.state !== FromBTCSwapState.CLAIM_COMMITED && this.state !== FromBTCSwapState.EXPIRED)
            throw new Error("Must be in COMMITED state!");
        const result = await this.wrapper.btcRpc.waitForAddressTxo(this.address, buffer_1.Buffer.from(this.data.getTxoHashHint(), "hex"), this.requiredConfirmations, (confirmations, txId, vout, txEtaMs) => {
            if (updateCallback != null)
                updateCallback(txId, confirmations, this.requiredConfirmations, txEtaMs);
        }, abortSignal, checkIntervalSeconds);
        if (abortSignal != null)
            abortSignal.throwIfAborted();
        this.txId = result.tx.txid;
        this.vout = result.vout;
        if (this.state !== FromBTCSwapState.CLAIM_CLAIMED &&
            this.state !== FromBTCSwapState.FAILED) {
            this.state = FromBTCSwapState.BTC_TX_CONFIRMED;
        }
        await this._saveAndEmit();
        return result.tx.txid;
    }
    /**
     * Returns the PSBT that is already funded with wallet's UTXOs (runs a coin-selection algorithm to choose UTXOs to use),
     *  also returns inputs indices that need to be signed by the wallet before submitting the PSBT back to the SDK with
     *  `swap.submitPsbt()`
     *
     * @param _bitcoinWallet Sender's bitcoin wallet
     * @param feeRate Optional fee rate for the transaction, needs to be at least as big as {minimumBtcFeeRate} field
     * @param additionalOutputs additional outputs to add to the PSBT - can be used to collect fees from users
     */
    async getFundedPsbt(_bitcoinWallet, feeRate, additionalOutputs) {
        if (this.state !== FromBTCSwapState.CLAIM_COMMITED)
            throw new Error("Swap not committed yet, please initiate the swap first with commit() call!");
        let bitcoinWallet;
        if ((0, IBitcoinWallet_1.isIBitcoinWallet)(_bitcoinWallet)) {
            bitcoinWallet = _bitcoinWallet;
        }
        else {
            bitcoinWallet = new SingleAddressBitcoinWallet_1.SingleAddressBitcoinWallet(this.wrapper.btcRpc, this.wrapper.options.bitcoinNetwork, _bitcoinWallet);
        }
        //TODO: Maybe re-introduce fee rate check here if passed from the user
        if (feeRate == null) {
            feeRate = await bitcoinWallet.getFeeRate();
        }
        const basePsbt = new btc_signer_1.Transaction({
            allowUnknownOutputs: true,
            allowLegacyWitnessUtxo: true
        });
        basePsbt.addOutput({
            amount: this.amount,
            script: (0, BitcoinUtils_1.toOutputScript)(this.wrapper.options.bitcoinNetwork, this.address)
        });
        if (additionalOutputs != null)
            additionalOutputs.forEach(output => {
                basePsbt.addOutput({
                    amount: output.amount,
                    script: output.outputScript ?? (0, BitcoinUtils_1.toOutputScript)(this.wrapper.options.bitcoinNetwork, output.address)
                });
            });
        const psbt = await bitcoinWallet.fundPsbt(basePsbt, feeRate);
        //Sign every input
        const signInputs = [];
        for (let i = 0; i < psbt.inputsLength; i++) {
            signInputs.push(i);
        }
        const serializedPsbt = buffer_1.Buffer.from(psbt.toPSBT());
        return {
            psbt,
            psbtHex: serializedPsbt.toString("hex"),
            psbtBase64: serializedPsbt.toString("base64"),
            signInputs
        };
    }
    /**
     * Submits a PSBT signed by the wallet back to the SDK
     *
     * @param _psbt A psbt - either a Transaction object or a hex or base64 encoded PSBT string
     */
    async submitPsbt(_psbt) {
        const psbt = (0, BitcoinHelpers_1.parsePsbtTransaction)(_psbt);
        if (this.state !== FromBTCSwapState.CLAIM_COMMITED)
            throw new Error("Swap not committed yet, please initiate the swap first with commit() call!");
        //Ensure not expired
        if (this.getTimeoutTime() < Date.now()) {
            throw new Error("Swap address expired!");
        }
        const output0 = psbt.getOutput(0);
        if (output0.amount !== this.amount)
            throw new Error("PSBT output amount invalid, expected: " + this.amount + " got: " + output0.amount);
        const expectedOutputScript = (0, BitcoinUtils_1.toOutputScript)(this.wrapper.options.bitcoinNetwork, this.address);
        if (!expectedOutputScript.equals(output0.script))
            throw new Error("PSBT output script invalid!");
        if (!psbt.isFinal)
            psbt.finalize();
        return await this.wrapper.btcRpc.sendRawTransaction(buffer_1.Buffer.from(psbt.toBytes(true, true)).toString("hex"));
    }
    async estimateBitcoinFee(_bitcoinWallet, feeRate) {
        const bitcoinWallet = (0, BitcoinHelpers_1.toBitcoinWallet)(_bitcoinWallet, this.wrapper.btcRpc, this.wrapper.options.bitcoinNetwork);
        const txFee = await bitcoinWallet.getTransactionFee(this.address, this.amount, feeRate);
        return (0, Tokens_1.toTokenAmount)(txFee == null ? null : BigInt(txFee), Tokens_1.BitcoinTokens.BTC, this.wrapper.prices);
    }
    async sendBitcoinTransaction(wallet, feeRate) {
        if (this.state !== FromBTCSwapState.CLAIM_COMMITED)
            throw new Error("Swap not committed yet, please initiate the swap first with commit() call!");
        //Ensure not expired
        if (this.getTimeoutTime() < Date.now()) {
            throw new Error("Swap address expired!");
        }
        if ((0, IBitcoinWallet_1.isIBitcoinWallet)(wallet)) {
            return await wallet.sendTransaction(this.address, this.amount, feeRate);
        }
        else {
            const { psbt, psbtHex, psbtBase64, signInputs } = await this.getFundedPsbt(wallet, feeRate);
            const signedPsbt = await wallet.signPsbt({
                psbt, psbtHex, psbtBase64
            }, signInputs);
            return await this.submitPsbt(signedPsbt);
        }
    }
    //////////////////////////////
    //// Execution
    /**
     * Executes the swap with the provided bitcoin wallet,
     *
     * @param dstSigner Signer on the destination network, needs to have the same address as the one specified when
     *  quote was created, this is required for legacy swaps because the destination wallet needs to actively open
     *  a bitcoin swap address to which the BTC is then sent, this means that the address also needs to have enough
     *  native tokens to pay for gas on the destination network
     * @param wallet Bitcoin wallet to use to sign the bitcoin transaction, can also be null - then the execution waits
     *  till a transaction is received from an external wallet
     * @param callbacks Callbacks to track the progress of the swap
     * @param options Optional options for the swap like feeRate, AbortSignal, and timeouts/intervals
     *
     * @returns {boolean} Whether a swap was settled automatically by swap watchtowers or requires manual claim by the
     *  user, in case `false` is returned the user should call `swap.claim()` to settle the swap on the destination manually
     */
    async execute(dstSigner, wallet, callbacks, options) {
        if (this.state === FromBTCSwapState.FAILED)
            throw new Error("Swap failed!");
        if (this.state === FromBTCSwapState.EXPIRED)
            throw new Error("Swap address expired!");
        if (this.state === FromBTCSwapState.QUOTE_EXPIRED || this.state === FromBTCSwapState.QUOTE_SOFT_EXPIRED)
            throw new Error("Swap quote expired!");
        if (this.state === FromBTCSwapState.CLAIM_CLAIMED)
            throw new Error("Swap already settled!");
        if (this.state === FromBTCSwapState.PR_CREATED) {
            await this.commit(dstSigner, options?.abortSignal, undefined, callbacks?.onDestinationCommitSent);
        }
        if (this.state === FromBTCSwapState.CLAIM_COMMITED) {
            if (wallet != null) {
                const bitcoinPaymentSent = await this.getBitcoinPayment();
                if (bitcoinPaymentSent == null) {
                    //Send btc tx
                    const txId = await this.sendBitcoinTransaction(wallet, options?.feeRate);
                    if (callbacks?.onSourceTransactionSent != null)
                        callbacks.onSourceTransactionSent(txId);
                }
            }
            const txId = await this.waitForBitcoinTransaction(callbacks?.onSourceTransactionConfirmationStatus, options?.btcTxCheckIntervalSeconds, options?.abortSignal);
            if (callbacks?.onSourceTransactionConfirmed != null)
                callbacks.onSourceTransactionConfirmed(txId);
        }
        // @ts-ignore
        if (this.state === FromBTCSwapState.CLAIM_CLAIMED)
            return true;
        if (this.state === FromBTCSwapState.BTC_TX_CONFIRMED) {
            const success = await this.waitTillClaimed(options?.maxWaitTillAutomaticSettlementSeconds ?? 60, options?.abortSignal);
            if (success && callbacks?.onSwapSettled != null)
                callbacks.onSwapSettled(this.getOutputTxId());
            return success;
        }
    }
    //////////////////////////////
    //// Commit
    /**
     * Commits the swap on-chain, locking the tokens from the intermediary in a PTLC
     *
     * @param _signer Signer to sign the transactions with, must be the same as used in the initialization
     * @param abortSignal Abort signal to stop waiting for the transaction confirmation and abort
     * @param skipChecks Skip checks like making sure init signature is still valid and swap wasn't commited yet
     *  (this is handled when swap is created (quoted), if you commit right after quoting, you can use skipChecks=true)
     * @param onBeforeTxSent
     * @throws {Error} If invalid signer is provided that doesn't match the swap data
     */
    async commit(_signer, abortSignal, skipChecks, onBeforeTxSent) {
        const signer = (0, base_1.isAbstractSigner)(_signer) ? _signer : await this.wrapper.chain.wrapSigner(_signer);
        this.checkSigner(signer);
        let txCount = 0;
        const txs = await this.txsCommit(skipChecks);
        const result = await this.wrapper.chain.sendAndConfirm(signer, txs, true, abortSignal, undefined, (txId) => {
            txCount++;
            if (onBeforeTxSent != null && txCount === txs.length)
                onBeforeTxSent(txId);
            return Promise.resolve();
        });
        this.commitTxId = result[result.length - 1];
        if (this.state === FromBTCSwapState.PR_CREATED || this.state === FromBTCSwapState.QUOTE_SOFT_EXPIRED) {
            await this._saveAndEmit(FromBTCSwapState.CLAIM_COMMITED);
        }
        return this.commitTxId;
    }
    async waitTillCommited(abortSignal) {
        if (this.state === FromBTCSwapState.CLAIM_COMMITED || this.state === FromBTCSwapState.CLAIM_CLAIMED)
            return Promise.resolve();
        if (this.state !== FromBTCSwapState.PR_CREATED && this.state !== FromBTCSwapState.QUOTE_SOFT_EXPIRED)
            throw new Error("Invalid state");
        const abortController = (0, Utils_1.extendAbortController)(abortSignal);
        const result = await Promise.race([
            this.watchdogWaitTillCommited(undefined, abortController.signal),
            this.waitTillState(FromBTCSwapState.CLAIM_COMMITED, "gte", abortController.signal).then(() => 0)
        ]);
        abortController.abort();
        if (result === 0)
            this.logger.debug("waitTillCommited(): Resolved from state changed");
        if (result === true)
            this.logger.debug("waitTillCommited(): Resolved from watchdog - commited");
        if (result === false) {
            this.logger.debug("waitTillCommited(): Resolved from watchdog - signature expired");
            if (this.state === FromBTCSwapState.PR_CREATED || this.state === FromBTCSwapState.QUOTE_SOFT_EXPIRED) {
                await this._saveAndEmit(FromBTCSwapState.QUOTE_EXPIRED);
            }
            return;
        }
        if (this.state === FromBTCSwapState.PR_CREATED || this.state === FromBTCSwapState.QUOTE_SOFT_EXPIRED) {
            await this._saveAndEmit(FromBTCSwapState.CLAIM_COMMITED);
        }
    }
    //////////////////////////////
    //// Claim
    /**
     * Returns transactions required to claim the swap on-chain (and possibly also sync the bitcoin light client)
     *  after a bitcoin transaction was sent and confirmed
     *
     * @throws {Error} If the swap is in invalid state (must be BTC_TX_CONFIRMED)
     */
    async txsClaim(_signer) {
        let signer;
        if (_signer != null) {
            if (typeof (_signer) === "string") {
                signer = _signer;
            }
            else if ((0, base_1.isAbstractSigner)(_signer)) {
                signer = _signer;
            }
            else {
                signer = await this.wrapper.chain.wrapSigner(_signer);
            }
        }
        if (this.state !== FromBTCSwapState.BTC_TX_CONFIRMED)
            throw new Error("Must be in BTC_TX_CONFIRMED state!");
        const tx = await this.wrapper.btcRpc.getTransaction(this.txId);
        return await this.wrapper.contract.txsClaimWithTxData(signer ?? this._getInitiator(), this.data, {
            blockhash: tx.blockhash,
            confirmations: tx.confirmations,
            txid: tx.txid,
            hex: tx.hex,
            height: tx.blockheight
        }, this.requiredConfirmations, this.vout, null, this.wrapper.synchronizer, true);
    }
    /**
     * Claims and finishes the swap
     *
     * @param _signer Signer to sign the transactions with, can also be different to the initializer
     * @param abortSignal Abort signal to stop waiting for transaction confirmation
     * @param onBeforeTxSent
     */
    async claim(_signer, abortSignal, onBeforeTxSent) {
        const signer = (0, base_1.isAbstractSigner)(_signer) ? _signer : await this.wrapper.chain.wrapSigner(_signer);
        let txIds;
        try {
            let txCount = 0;
            const txs = await this.txsClaim(signer);
            txIds = await this.wrapper.chain.sendAndConfirm(signer, txs, true, abortSignal, undefined, (txId) => {
                txCount++;
                if (onBeforeTxSent != null && txCount === txs.length)
                    onBeforeTxSent(txId);
                return Promise.resolve();
            });
        }
        catch (e) {
            this.logger.info("claim(): Failed to claim ourselves, checking swap claim state...");
            if (this.state === FromBTCSwapState.CLAIM_CLAIMED) {
                this.logger.info("claim(): Transaction state is CLAIM_CLAIMED, swap was successfully claimed by the watchtower");
                return this.claimTxId;
            }
            const status = await this.wrapper.contract.getCommitStatus(this._getInitiator(), this.data);
            if (status?.type === base_1.SwapCommitStateType.PAID) {
                this.logger.info("claim(): Transaction commit status is PAID, swap was successfully claimed by the watchtower");
                if (this.claimTxId == null)
                    this.claimTxId = await status.getClaimTxId();
                await this._saveAndEmit(FromBTCSwapState.CLAIM_CLAIMED);
                return this.claimTxId;
            }
            throw e;
        }
        this.claimTxId = txIds[txIds.length - 1];
        if (this.state === FromBTCSwapState.CLAIM_COMMITED || this.state === FromBTCSwapState.BTC_TX_CONFIRMED ||
            this.state === FromBTCSwapState.EXPIRED || this.state === FromBTCSwapState.FAILED) {
            await this._saveAndEmit(FromBTCSwapState.CLAIM_CLAIMED);
        }
        return txIds[txIds.length - 1];
    }
    /**
     * Waits till the swap is successfully claimed
     *
     * @param maxWaitTimeSeconds Maximum time in seconds to wait for the swap to be settled
     * @param abortSignal AbortSignal
     * @throws {Error} If swap is in invalid state (must be BTC_TX_CONFIRMED)
     * @throws {Error} If the LP refunded sooner than we were able to claim
     * @returns {boolean} whether the swap was claimed in time or not
     */
    async waitTillClaimed(maxWaitTimeSeconds, abortSignal) {
        if (this.state === FromBTCSwapState.CLAIM_CLAIMED)
            return Promise.resolve(true);
        if (this.state !== FromBTCSwapState.BTC_TX_CONFIRMED)
            throw new Error("Invalid state (not BTC_TX_CONFIRMED)");
        const abortController = (0, Utils_1.extendAbortController)(abortSignal);
        let timedOut = false;
        if (maxWaitTimeSeconds != null) {
            const timeout = setTimeout(() => {
                timedOut = true;
                abortController.abort();
            }, maxWaitTimeSeconds * 1000);
            abortController.signal.addEventListener("abort", () => clearTimeout(timeout));
        }
        let res;
        try {
            res = await Promise.race([
                this.watchdogWaitTillResult(undefined, abortController.signal),
                this.waitTillState(FromBTCSwapState.CLAIM_CLAIMED, "eq", abortController.signal).then(() => 0),
                this.waitTillState(FromBTCSwapState.FAILED, "eq", abortController.signal).then(() => 1),
            ]);
            abortController.abort();
        }
        catch (e) {
            abortController.abort();
            if (timedOut)
                return false;
            throw e;
        }
        if (res === 0) {
            this.logger.debug("waitTillClaimed(): Resolved from state change (CLAIM_CLAIMED)");
            return true;
        }
        if (res === 1) {
            this.logger.debug("waitTillClaimed(): Resolved from state change (FAILED)");
            throw new Error("Offerer refunded during claiming");
        }
        this.logger.debug("waitTillClaimed(): Resolved from watchdog");
        if (res?.type === base_1.SwapCommitStateType.PAID) {
            if (this.state !== FromBTCSwapState.CLAIM_CLAIMED) {
                this.claimTxId = await res.getClaimTxId();
                await this._saveAndEmit(FromBTCSwapState.CLAIM_CLAIMED);
            }
        }
        if (res?.type === base_1.SwapCommitStateType.NOT_COMMITED || res?.type === base_1.SwapCommitStateType.EXPIRED) {
            if (this.state !== FromBTCSwapState.CLAIM_CLAIMED &&
                this.state !== FromBTCSwapState.FAILED) {
                this.refundTxId = res.getRefundTxId == null ? null : await res.getRefundTxId();
                await this._saveAndEmit(FromBTCSwapState.FAILED);
            }
            throw new Error("Swap expired while waiting for claim!");
        }
        return true;
    }
    //////////////////////////////
    //// Storage
    serialize() {
        return {
            ...super.serialize(),
            address: this.address,
            amount: this.amount.toString(10),
            requiredConfirmations: this.requiredConfirmations,
            txId: this.txId,
            vout: this.vout
        };
    }
    //////////////////////////////
    //// Swap ticks & sync
    /**
     * Checks the swap's state on-chain and compares it to its internal state, updates/changes it according to on-chain
     *  data
     *
     * @private
     */
    async syncStateFromChain(quoteDefinitelyExpired, commitStatus) {
        if (this.state === FromBTCSwapState.PR_CREATED || this.state === FromBTCSwapState.QUOTE_SOFT_EXPIRED) {
            const quoteExpired = quoteDefinitelyExpired ?? await this._verifyQuoteDefinitelyExpired(); //Make sure we check for expiry here, to prevent race conditions
            const status = commitStatus ?? await (0, Utils_1.tryWithRetries)(() => this.wrapper.contract.getCommitStatus(this._getInitiator(), this.data));
            switch (status?.type) {
                case base_1.SwapCommitStateType.COMMITED:
                    this.state = FromBTCSwapState.CLAIM_COMMITED;
                    return true;
                case base_1.SwapCommitStateType.EXPIRED:
                    if (this.refundTxId == null && status.getRefundTxId)
                        this.refundTxId = await status.getRefundTxId();
                    this.state = FromBTCSwapState.QUOTE_EXPIRED;
                    return true;
                case base_1.SwapCommitStateType.PAID:
                    if (this.claimTxId == null)
                        this.claimTxId = await status.getClaimTxId();
                    this.state = FromBTCSwapState.CLAIM_CLAIMED;
                    return true;
            }
            if (quoteExpired) {
                this.state = FromBTCSwapState.QUOTE_EXPIRED;
                return true;
            }
            return false;
        }
        if (this.state === FromBTCSwapState.CLAIM_COMMITED || this.state === FromBTCSwapState.BTC_TX_CONFIRMED || this.state === FromBTCSwapState.EXPIRED) {
            const status = commitStatus ?? await (0, Utils_1.tryWithRetries)(() => this.wrapper.contract.getCommitStatus(this._getInitiator(), this.data));
            switch (status?.type) {
                case base_1.SwapCommitStateType.PAID:
                    if (this.claimTxId == null)
                        this.claimTxId = await status.getClaimTxId();
                    this.state = FromBTCSwapState.CLAIM_CLAIMED;
                    return true;
                case base_1.SwapCommitStateType.NOT_COMMITED:
                case base_1.SwapCommitStateType.EXPIRED:
                    if (this.refundTxId == null && status.getRefundTxId)
                        this.refundTxId = await status.getRefundTxId();
                    this.state = FromBTCSwapState.FAILED;
                    return true;
                case base_1.SwapCommitStateType.COMMITED:
                    const res = await this.getBitcoinPayment();
                    if (res != null && res.confirmations >= this.requiredConfirmations) {
                        this.txId = res.txId;
                        this.vout = res.vout;
                        this.state = FromBTCSwapState.BTC_TX_CONFIRMED;
                        return true;
                    }
                    break;
            }
        }
    }
    _shouldFetchCommitStatus() {
        return this.state === FromBTCSwapState.PR_CREATED || this.state === FromBTCSwapState.QUOTE_SOFT_EXPIRED ||
            this.state === FromBTCSwapState.CLAIM_COMMITED || this.state === FromBTCSwapState.BTC_TX_CONFIRMED ||
            this.state === FromBTCSwapState.EXPIRED;
    }
    _shouldFetchExpiryStatus() {
        return this.state === FromBTCSwapState.PR_CREATED || this.state === FromBTCSwapState.QUOTE_SOFT_EXPIRED;
    }
    async _sync(save, quoteDefinitelyExpired, commitStatus) {
        const changed = await this.syncStateFromChain(quoteDefinitelyExpired, commitStatus);
        if (changed && save)
            await this._saveAndEmit();
        return changed;
    }
    async _tick(save) {
        switch (this.state) {
            case FromBTCSwapState.PR_CREATED:
                if (this.expiry < Date.now()) {
                    this.state = FromBTCSwapState.QUOTE_SOFT_EXPIRED;
                    if (save)
                        await this._saveAndEmit();
                    return true;
                }
                break;
            case FromBTCSwapState.CLAIM_COMMITED:
                if (this.getTimeoutTime() < Date.now()) {
                    this.state = FromBTCSwapState.EXPIRED;
                    if (save)
                        await this._saveAndEmit();
                    return true;
                }
            case FromBTCSwapState.EXPIRED:
                //Check if bitcoin payment was received every 2 minutes
                if (Math.floor(Date.now() / 1000) % 120 === 0) {
                    try {
                        const res = await this.getBitcoinPayment();
                        if (res != null && res.confirmations >= this.requiredConfirmations) {
                            this.txId = res.txId;
                            this.vout = res.vout;
                            this.state = FromBTCSwapState.BTC_TX_CONFIRMED;
                            if (save)
                                await this._saveAndEmit();
                            return true;
                        }
                    }
                    catch (e) {
                        this.logger.warn("tickSwap(" + this.getIdentifierHashString() + "): ", e);
                    }
                }
                break;
        }
    }
}
exports.FromBTCSwap = FromBTCSwap;
