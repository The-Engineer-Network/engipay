"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBTCLNWrapper = void 0;
const FromBTCLNSwap_1 = require("./FromBTCLNSwap");
const bolt11_1 = require("@atomiqlabs/bolt11");
const base_1 = require("@atomiqlabs/base");
const buffer_1 = require("buffer");
const UserError_1 = require("../../../../errors/UserError");
const IntermediaryError_1 = require("../../../../errors/IntermediaryError");
const SwapType_1 = require("../../../enums/SwapType");
const Utils_1 = require("../../../../utils/Utils");
const IntermediaryAPI_1 = require("../../../../intermediaries/IntermediaryAPI");
const RequestError_1 = require("../../../../errors/RequestError");
const IFromBTCLNWrapper_1 = require("../IFromBTCLNWrapper");
class FromBTCLNWrapper extends IFromBTCLNWrapper_1.IFromBTCLNWrapper {
    /**
     * @param chainIdentifier
     * @param unifiedStorage Storage interface for the current environment
     * @param unifiedChainEvents On-chain event listener
     * @param chain
     * @param contract Underlying contract handling the swaps
     * @param prices Swap pricing handler
     * @param tokens
     * @param swapDataDeserializer Deserializer for SwapData
     * @param lnApi
     * @param options
     * @param events Instance to use for emitting events
     */
    constructor(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, contract, prices, tokens, swapDataDeserializer, lnApi, options, events) {
        options.safetyFactor ??= 2;
        options.bitcoinBlocktime ??= 10 * 60;
        super(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, contract, prices, tokens, swapDataDeserializer, lnApi, options, events);
        this.claimableSwapStates = [FromBTCLNSwap_1.FromBTCLNSwapState.CLAIM_COMMITED];
        this.TYPE = SwapType_1.SwapType.FROM_BTCLN;
        this.swapDeserializer = FromBTCLNSwap_1.FromBTCLNSwap;
        this.pendingSwapStates = [
            FromBTCLNSwap_1.FromBTCLNSwapState.PR_CREATED,
            FromBTCLNSwap_1.FromBTCLNSwapState.QUOTE_SOFT_EXPIRED,
            FromBTCLNSwap_1.FromBTCLNSwapState.PR_PAID,
            FromBTCLNSwap_1.FromBTCLNSwapState.CLAIM_COMMITED,
            FromBTCLNSwap_1.FromBTCLNSwapState.EXPIRED
        ];
        this.tickSwapState = [
            FromBTCLNSwap_1.FromBTCLNSwapState.PR_CREATED,
            FromBTCLNSwap_1.FromBTCLNSwapState.PR_PAID,
            FromBTCLNSwap_1.FromBTCLNSwapState.CLAIM_COMMITED
        ];
    }
    processEventInitialize(swap, event) {
        if (swap.state === FromBTCLNSwap_1.FromBTCLNSwapState.PR_PAID || swap.state === FromBTCLNSwap_1.FromBTCLNSwapState.QUOTE_SOFT_EXPIRED) {
            swap.state = FromBTCLNSwap_1.FromBTCLNSwapState.CLAIM_COMMITED;
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }
    processEventClaim(swap, event) {
        if (swap.state !== FromBTCLNSwap_1.FromBTCLNSwapState.FAILED && swap.state !== FromBTCLNSwap_1.FromBTCLNSwapState.CLAIM_CLAIMED) {
            swap.state = FromBTCLNSwap_1.FromBTCLNSwapState.CLAIM_CLAIMED;
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }
    processEventRefund(swap, event) {
        if (swap.state !== FromBTCLNSwap_1.FromBTCLNSwapState.CLAIM_CLAIMED && swap.state !== FromBTCLNSwap_1.FromBTCLNSwapState.FAILED) {
            swap.state = FromBTCLNSwap_1.FromBTCLNSwapState.FAILED;
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }
    /**
     * Verifies response returned from intermediary
     *
     * @param resp Response as returned by the intermediary
     * @param amountData
     * @param lp Intermediary
     * @param options Options as passed to the swap creation function
     * @param decodedPr Decoded bolt11 lightning network invoice
     * @param paymentHash Expected payment hash of the bolt11 lightning network invoice
     * @private
     * @throws {IntermediaryError} in case the response is invalid
     */
    verifyReturnedData(resp, amountData, lp, options, decodedPr, paymentHash) {
        if (lp.getAddress(this.chainIdentifier) !== resp.intermediaryKey)
            throw new IntermediaryError_1.IntermediaryError("Invalid intermediary address/pubkey");
        if (options.descriptionHash != null && decodedPr.tagsObject.purpose_commit_hash !== options.descriptionHash.toString("hex"))
            throw new IntermediaryError_1.IntermediaryError("Invalid pr returned - description hash");
        if (!buffer_1.Buffer.from(decodedPr.tagsObject.payment_hash, "hex").equals(paymentHash))
            throw new IntermediaryError_1.IntermediaryError("Invalid pr returned - payment hash");
        if (!amountData.exactIn) {
            if (resp.total != amountData.amount)
                throw new IntermediaryError_1.IntermediaryError("Invalid amount returned");
        }
        else {
            const amountIn = (BigInt(decodedPr.millisatoshis) + 999n) / 1000n;
            if (amountIn !== amountData.amount)
                throw new IntermediaryError_1.IntermediaryError("Invalid payment request returned, amount mismatch");
        }
    }
    /**
     * Returns a newly created swap, receiving 'amount' on lightning network
     *
     * @param signer                Smart chain signer's address intiating the swap
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers) to get the quotes from
     * @param options               Quote options
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     * @param preFetches
     */
    create(signer, amountData, lps, options, additionalParams, abortSignal, preFetches) {
        if (options == null)
            options = {};
        options.unsafeSkipLnNodeCheck ??= this.options.unsafeSkipLnNodeCheck;
        if (preFetches == null)
            preFetches = {};
        if (options.descriptionHash != null && options.descriptionHash.length !== 32)
            throw new UserError_1.UserError("Invalid description hash length");
        const { secret, paymentHash } = this.getSecretAndHash();
        const claimHash = this.contract.getHashForHtlc(paymentHash);
        const _abortController = (0, Utils_1.extendAbortController)(abortSignal);
        preFetches.pricePrefetchPromise ??= this.preFetchPrice(amountData, _abortController.signal);
        const nativeTokenAddress = this.chain.getNativeCurrencyAddress();
        preFetches.feeRatePromise ??= this.preFetchFeeRate(signer, amountData, claimHash.toString("hex"), _abortController);
        return lps.map(lp => {
            return {
                intermediary: lp,
                quote: (async () => {
                    const abortController = (0, Utils_1.extendAbortController)(_abortController.signal);
                    const liquidityPromise = this.preFetchIntermediaryLiquidity(amountData, lp, abortController);
                    const { lnCapacityPromise, resp } = await (0, Utils_1.tryWithRetries)(async (retryCount) => {
                        const { lnPublicKey, response } = IntermediaryAPI_1.IntermediaryAPI.initFromBTCLN(this.chainIdentifier, lp.url, nativeTokenAddress, {
                            paymentHash,
                            amount: amountData.amount,
                            claimer: signer,
                            token: amountData.token.toString(),
                            descriptionHash: options.descriptionHash,
                            exactOut: !amountData.exactIn,
                            feeRate: preFetches.feeRatePromise,
                            additionalParams
                        }, this.options.postRequestTimeout, abortController.signal, retryCount > 0 ? false : null);
                        return {
                            lnCapacityPromise: options.unsafeSkipLnNodeCheck ? null : this.preFetchLnCapacity(lnPublicKey),
                            resp: await response
                        };
                    }, null, RequestError_1.RequestError, abortController.signal);
                    const decodedPr = (0, bolt11_1.decode)(resp.pr);
                    const amountIn = (BigInt(decodedPr.millisatoshis) + 999n) / 1000n;
                    try {
                        this.verifyReturnedData(resp, amountData, lp, options, decodedPr, paymentHash);
                        const [pricingInfo] = await Promise.all([
                            this.verifyReturnedPrice(lp.services[SwapType_1.SwapType.FROM_BTCLN], false, amountIn, resp.total, amountData.token, {}, preFetches.pricePrefetchPromise, abortController.signal),
                            this.verifyIntermediaryLiquidity(resp.total, liquidityPromise),
                            options.unsafeSkipLnNodeCheck ? Promise.resolve() : this.verifyLnNodeCapacity(lp, decodedPr, lnCapacityPromise, abortController.signal)
                        ]);
                        const quote = new FromBTCLNSwap_1.FromBTCLNSwap(this, {
                            pricingInfo,
                            url: lp.url,
                            expiry: decodedPr.timeExpireDate * 1000,
                            swapFee: resp.swapFee,
                            feeRate: await preFetches.feeRatePromise,
                            initialSwapData: await this.contract.createSwapData(base_1.ChainSwapType.HTLC, lp.getAddress(this.chainIdentifier), signer, amountData.token, resp.total, claimHash.toString("hex"), this.getRandomSequence(), BigInt(Math.floor(Date.now() / 1000)), false, true, resp.securityDeposit, 0n, nativeTokenAddress),
                            pr: resp.pr,
                            secret: secret.toString("hex"),
                            exactIn: amountData.exactIn ?? true
                        });
                        await quote._save();
                        return quote;
                    }
                    catch (e) {
                        abortController.abort(e);
                        throw e;
                    }
                })()
            };
        });
    }
    /**
     * Returns a newly created swap, receiving 'amount' from the lnurl-withdraw
     *
     * @param signer                Smart chains signer's address intiating the swap
     * @param lnurl                 LNURL-withdraw to withdraw funds from
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers) to get the quotes from
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     */
    async createViaLNURL(signer, lnurl, amountData, lps, additionalParams, abortSignal) {
        if (!this.isInitialized)
            throw new Error("Not initialized, call init() first!");
        const abortController = (0, Utils_1.extendAbortController)(abortSignal);
        const preFetches = {
            pricePrefetchPromise: this.preFetchPrice(amountData, abortController.signal),
            feeRatePromise: this.preFetchFeeRate(signer, amountData, null, abortController)
        };
        try {
            const exactOutAmountPromise = !amountData.exactIn ? preFetches.pricePrefetchPromise.then(price => this.prices.getToBtcSwapAmount(this.chainIdentifier, amountData.amount, amountData.token, abortController.signal, price)).catch(e => {
                abortController.abort(e);
                return null;
            }) : null;
            const withdrawRequest = await this.getLNURLWithdraw(lnurl, abortController.signal);
            const min = BigInt(withdrawRequest.minWithdrawable) / 1000n;
            const max = BigInt(withdrawRequest.maxWithdrawable) / 1000n;
            if (amountData.exactIn) {
                if (amountData.amount < min)
                    throw new UserError_1.UserError("Amount less than LNURL-withdraw minimum");
                if (amountData.amount > max)
                    throw new UserError_1.UserError("Amount more than LNURL-withdraw maximum");
            }
            else {
                const amount = await exactOutAmountPromise;
                abortController.signal.throwIfAborted();
                if ((amount * 95n / 100n) < min)
                    throw new UserError_1.UserError("Amount less than LNURL-withdraw minimum");
                if ((amount * 105n / 100n) > max)
                    throw new UserError_1.UserError("Amount more than LNURL-withdraw maximum");
            }
            return this.create(signer, amountData, lps, null, additionalParams, abortSignal, preFetches).map(data => {
                return {
                    quote: data.quote.then(quote => {
                        quote.lnurl = withdrawRequest.url;
                        quote.lnurlK1 = withdrawRequest.k1;
                        quote.lnurlCallback = withdrawRequest.callback;
                        const amountIn = quote.getInput().rawAmount;
                        if (amountIn < min)
                            throw new UserError_1.UserError("Amount less than LNURL-withdraw minimum");
                        if (amountIn > max)
                            throw new UserError_1.UserError("Amount more than LNURL-withdraw maximum");
                        return quote;
                    }),
                    intermediary: data.intermediary
                };
            });
        }
        catch (e) {
            abortController.abort(e);
            throw e;
        }
    }
    async _checkPastSwaps(pastSwaps) {
        const changedSwapSet = new Set();
        const swapExpiredStatus = {};
        const checkStatusSwaps = [];
        await Promise.all(pastSwaps.map(async (pastSwap) => {
            if (pastSwap._shouldCheckIntermediary()) {
                try {
                    const result = await pastSwap._checkIntermediaryPaymentReceived(false);
                    if (result != null) {
                        changedSwapSet.add(pastSwap);
                    }
                }
                catch (e) {
                    this.logger.error(`_checkPastSwaps(): Failed to contact LP regarding swap ${pastSwap.getId()}, error: `, e);
                }
            }
            if (pastSwap._shouldFetchExpiryStatus()) {
                //Check expiry
                swapExpiredStatus[pastSwap.getEscrowHash()] = await pastSwap._verifyQuoteDefinitelyExpired();
            }
            if (pastSwap._shouldFetchCommitStatus()) {
                //Add to swaps for which status should be checked
                checkStatusSwaps.push(pastSwap);
            }
        }));
        const swapStatuses = await this.contract.getCommitStatuses(checkStatusSwaps.map(val => ({ signer: val._getInitiator(), swapData: val.data })));
        for (let pastSwap of checkStatusSwaps) {
            const escrowHash = pastSwap.getEscrowHash();
            const shouldSave = await pastSwap._sync(false, swapExpiredStatus[escrowHash], swapStatuses[escrowHash], true);
            if (shouldSave) {
                changedSwapSet.add(pastSwap);
            }
        }
        const changedSwaps = [];
        const removeSwaps = [];
        changedSwapSet.forEach(val => {
            if (val.isQuoteExpired()) {
                removeSwaps.push(val);
            }
            else {
                changedSwaps.push(val);
            }
        });
        return {
            changedSwaps,
            removeSwaps
        };
    }
}
exports.FromBTCLNWrapper = FromBTCLNWrapper;
