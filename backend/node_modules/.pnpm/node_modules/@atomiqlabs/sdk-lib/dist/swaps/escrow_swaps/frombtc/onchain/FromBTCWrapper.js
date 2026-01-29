"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBTCWrapper = void 0;
const IFromBTCWrapper_1 = require("../IFromBTCWrapper");
const FromBTCSwap_1 = require("./FromBTCSwap");
const base_1 = require("@atomiqlabs/base");
const buffer_1 = require("buffer");
const IntermediaryError_1 = require("../../../../errors/IntermediaryError");
const SwapType_1 = require("../../../enums/SwapType");
const Utils_1 = require("../../../../utils/Utils");
const BitcoinUtils_1 = require("../../../../utils/BitcoinUtils");
const IntermediaryAPI_1 = require("../../../../intermediaries/IntermediaryAPI");
const RequestError_1 = require("../../../../errors/RequestError");
const utils_1 = require("@scure/btc-signer/utils");
class FromBTCWrapper extends IFromBTCWrapper_1.IFromBTCWrapper {
    /**
     * @param chainIdentifier
     * @param unifiedStorage Storage interface for the current environment
     * @param unifiedChainEvents On-chain event listener
     * @param chain
     * @param contract Underlying contract handling the swaps
     * @param prices Pricing to use
     * @param tokens
     * @param swapDataDeserializer Deserializer for SwapData
     * @param btcRelay
     * @param synchronizer Btc relay synchronizer
     * @param btcRpc Bitcoin RPC which also supports getting transactions by txoHash
     * @param options
     * @param events Instance to use for emitting events
     */
    constructor(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, contract, prices, tokens, swapDataDeserializer, btcRelay, synchronizer, btcRpc, options, events) {
        if (options == null)
            options = {};
        options.bitcoinNetwork = options.bitcoinNetwork ?? utils_1.TEST_NETWORK;
        options.safetyFactor = options.safetyFactor || 2;
        options.blocksTillTxConfirms = options.blocksTillTxConfirms || 12;
        options.maxConfirmations = options.maxConfirmations || 6;
        options.minSendWindow = options.minSendWindow || 30 * 60; //Minimum time window for user to send in the on-chain funds for From BTC swap
        options.bitcoinBlocktime = options.bitcoinBlocktime || 10 * 60;
        super(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, contract, prices, tokens, swapDataDeserializer, options, events);
        this.claimableSwapStates = [FromBTCSwap_1.FromBTCSwapState.BTC_TX_CONFIRMED];
        this.TYPE = SwapType_1.SwapType.FROM_BTC;
        this.swapDeserializer = FromBTCSwap_1.FromBTCSwap;
        this.pendingSwapStates = [
            FromBTCSwap_1.FromBTCSwapState.PR_CREATED,
            FromBTCSwap_1.FromBTCSwapState.QUOTE_SOFT_EXPIRED,
            FromBTCSwap_1.FromBTCSwapState.CLAIM_COMMITED,
            FromBTCSwap_1.FromBTCSwapState.BTC_TX_CONFIRMED,
            FromBTCSwap_1.FromBTCSwapState.EXPIRED
        ];
        this.tickSwapState = [FromBTCSwap_1.FromBTCSwapState.PR_CREATED, FromBTCSwap_1.FromBTCSwapState.CLAIM_COMMITED, FromBTCSwap_1.FromBTCSwapState.EXPIRED];
        this.btcRelay = btcRelay;
        this.synchronizer = synchronizer;
        this.btcRpc = btcRpc;
    }
    processEventInitialize(swap, event) {
        if (swap.state === FromBTCSwap_1.FromBTCSwapState.PR_CREATED || swap.state === FromBTCSwap_1.FromBTCSwapState.QUOTE_SOFT_EXPIRED) {
            swap.state = FromBTCSwap_1.FromBTCSwapState.CLAIM_COMMITED;
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }
    processEventClaim(swap, event) {
        if (swap.state !== FromBTCSwap_1.FromBTCSwapState.FAILED && swap.state !== FromBTCSwap_1.FromBTCSwapState.CLAIM_CLAIMED) {
            swap.state = FromBTCSwap_1.FromBTCSwapState.CLAIM_CLAIMED;
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }
    processEventRefund(swap, event) {
        if (swap.state !== FromBTCSwap_1.FromBTCSwapState.CLAIM_CLAIMED && swap.state !== FromBTCSwap_1.FromBTCSwapState.FAILED) {
            swap.state = FromBTCSwap_1.FromBTCSwapState.FAILED;
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }
    /**
     * Returns the swap expiry, leaving enough time for the user to send a transaction and for it to confirm
     *
     * @param data Parsed swap data
     * @param requiredConfirmations Confirmations required to claim the tx
     */
    getOnchainSendTimeout(data, requiredConfirmations) {
        const tsDelta = (this.options.blocksTillTxConfirms + requiredConfirmations) * this.options.bitcoinBlocktime * this.options.safetyFactor;
        return data.getExpiry() - BigInt(tsDelta);
    }
    /**
     * Pre-fetches claimer (watchtower) bounty data for the swap. Doesn't throw, instead returns null and aborts the
     *  provided abortController
     *
     * @param signer Smartchain signer address initiating the swap
     * @param amountData
     * @param options Options as passed to the swap creation function
     * @param abortController
     * @private
     */
    async preFetchClaimerBounty(signer, amountData, options, abortController) {
        const startTimestamp = BigInt(Math.floor(Date.now() / 1000));
        if (options.unsafeZeroWatchtowerFee) {
            return {
                feePerBlock: 0n,
                safetyFactor: options.blockSafetyFactor,
                startTimestamp: startTimestamp,
                addBlock: 0,
                addFee: 0n
            };
        }
        const dummyAmount = BigInt(Math.floor(Math.random() * 0x1000000));
        const dummySwapData = await this.contract.createSwapData(base_1.ChainSwapType.CHAIN, signer, signer, amountData.token, dummyAmount, this.contract.getHashForOnchain((0, Utils_1.randomBytes)(20), dummyAmount, 3).toString("hex"), this.getRandomSequence(), startTimestamp, false, true, BigInt(Math.floor(Math.random() * 0x10000)), BigInt(Math.floor(Math.random() * 0x10000)));
        try {
            const [feePerBlock, btcRelayData, currentBtcBlock, claimFeeRate] = await Promise.all([
                (0, Utils_1.tryWithRetries)(() => this.btcRelay.getFeePerBlock(), null, null, abortController.signal),
                (0, Utils_1.tryWithRetries)(() => this.btcRelay.getTipData(), null, null, abortController.signal),
                this.btcRpc.getTipHeight(),
                (0, Utils_1.tryWithRetries)(() => this.contract.getClaimFee(signer, dummySwapData), null, null, abortController.signal)
            ]);
            const currentBtcRelayBlock = btcRelayData.blockheight;
            const addBlock = Math.max(currentBtcBlock - currentBtcRelayBlock, 0);
            return {
                feePerBlock: feePerBlock * options.feeSafetyFactor,
                safetyFactor: options.blockSafetyFactor,
                startTimestamp: startTimestamp,
                addBlock,
                addFee: claimFeeRate * options.feeSafetyFactor
            };
        }
        catch (e) {
            abortController.abort(e);
            return null;
        }
    }
    /**
     * Returns calculated claimer bounty calculated from the claimer bounty data as fetched from preFetchClaimerBounty()
     *
     * @param data Parsed swap data returned from the intermediary
     * @param options Options as passed to the swap creation function
     * @param claimerBounty Claimer bounty data as fetched from preFetchClaimerBounty() function
     * @private
     */
    getClaimerBounty(data, options, claimerBounty) {
        const tsDelta = data.getExpiry() - claimerBounty.startTimestamp;
        const blocksDelta = tsDelta / BigInt(this.options.bitcoinBlocktime) * BigInt(options.blockSafetyFactor);
        const totalBlock = blocksDelta + BigInt(claimerBounty.addBlock);
        return claimerBounty.addFee + (totalBlock * claimerBounty.feePerBlock);
    }
    /**
     * Verifies response returned from intermediary
     *
     * @param signer
     * @param resp Response as returned by the intermediary
     * @param amountData
     * @param lp Intermediary
     * @param options Options as passed to the swap creation function
     * @param data Parsed swap data returned by the intermediary
     * @param sequence Required swap sequence
     * @param claimerBounty Claimer bount data as returned from the preFetchClaimerBounty() pre-fetch promise
     * @param depositToken
     * @private
     * @throws {IntermediaryError} in case the response is invalid
     */
    verifyReturnedData(signer, resp, amountData, lp, options, data, sequence, claimerBounty, depositToken) {
        if (amountData.exactIn) {
            if (resp.amount !== amountData.amount)
                throw new IntermediaryError_1.IntermediaryError("Invalid amount returned");
        }
        else {
            if (resp.total !== amountData.amount)
                throw new IntermediaryError_1.IntermediaryError("Invalid total returned");
        }
        const requiredConfirmations = resp.confirmations ?? lp.services[SwapType_1.SwapType.FROM_BTC].data.confirmations;
        if (requiredConfirmations > this.options.maxConfirmations)
            throw new IntermediaryError_1.IntermediaryError("Requires too many confirmations");
        const totalClaimerBounty = this.getClaimerBounty(data, options, claimerBounty);
        if (data.getClaimerBounty() !== totalClaimerBounty ||
            data.getType() != base_1.ChainSwapType.CHAIN ||
            data.getSequence() !== sequence ||
            data.getAmount() !== resp.total ||
            data.isPayIn() ||
            !data.isToken(amountData.token) ||
            !data.isOfferer(lp.getAddress(this.chainIdentifier)) ||
            !data.isClaimer(signer) ||
            !data.isDepositToken(depositToken) ||
            data.hasSuccessAction()) {
            throw new IntermediaryError_1.IntermediaryError("Invalid data returned");
        }
        //Check that we have enough time to send the TX and for it to confirm
        const expiry = this.getOnchainSendTimeout(data, requiredConfirmations);
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        if ((expiry - currentTimestamp) < BigInt(this.options.minSendWindow)) {
            throw new IntermediaryError_1.IntermediaryError("Send window too low");
        }
        const lockingScript = (0, BitcoinUtils_1.toOutputScript)(this.options.bitcoinNetwork, resp.btcAddress);
        const desiredExtraData = this.contract.getExtraData(lockingScript, resp.amount, requiredConfirmations);
        const desiredClaimHash = this.contract.getHashForOnchain(lockingScript, resp.amount, requiredConfirmations);
        if (!desiredClaimHash.equals(buffer_1.Buffer.from(data.getClaimHash(), "hex"))) {
            throw new IntermediaryError_1.IntermediaryError("Invalid claim hash returned!");
        }
        if (!desiredExtraData.equals(buffer_1.Buffer.from(data.getExtraData(), "hex"))) {
            throw new IntermediaryError_1.IntermediaryError("Invalid extra data returned!");
        }
    }
    /**
     * Returns a newly created swap, receiving 'amount' on chain
     *
     * @param signer                Smartchain signer's address intiating the swap
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers) to get the quotes from
     * @param options               Quote options
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     */
    create(signer, amountData, lps, options, additionalParams, abortSignal) {
        options ??= {};
        options.blockSafetyFactor ??= 1;
        options.feeSafetyFactor ??= 2n;
        const sequence = this.getRandomSequence();
        const _abortController = (0, Utils_1.extendAbortController)(abortSignal);
        const pricePrefetchPromise = this.preFetchPrice(amountData, _abortController.signal);
        const claimerBountyPrefetchPromise = this.preFetchClaimerBounty(signer, amountData, options, _abortController);
        const nativeTokenAddress = this.chain.getNativeCurrencyAddress();
        const feeRatePromise = this.preFetchFeeRate(signer, amountData, null, _abortController);
        const _signDataPromise = this.contract.preFetchBlockDataForSignatures == null ? this.preFetchSignData(Promise.resolve(true)) : null;
        return lps.map(lp => {
            return {
                intermediary: lp,
                quote: (async () => {
                    const abortController = (0, Utils_1.extendAbortController)(_abortController.signal);
                    const liquidityPromise = this.preFetchIntermediaryLiquidity(amountData, lp, abortController);
                    try {
                        const { signDataPromise, resp } = await (0, Utils_1.tryWithRetries)(async (retryCount) => {
                            const { signDataPrefetch, response } = IntermediaryAPI_1.IntermediaryAPI.initFromBTC(this.chainIdentifier, lp.url, nativeTokenAddress, {
                                claimer: signer,
                                amount: amountData.amount,
                                token: amountData.token.toString(),
                                exactOut: !amountData.exactIn,
                                sequence,
                                claimerBounty: claimerBountyPrefetchPromise,
                                feeRate: feeRatePromise,
                                additionalParams
                            }, this.options.postRequestTimeout, abortController.signal, retryCount > 0 ? false : null);
                            return {
                                signDataPromise: _signDataPromise ?? this.preFetchSignData(signDataPrefetch),
                                resp: await response
                            };
                        }, null, e => e instanceof RequestError_1.RequestError, abortController.signal);
                        const data = new this.swapDataDeserializer(resp.data);
                        data.setClaimer(signer);
                        this.verifyReturnedData(signer, resp, amountData, lp, options, data, sequence, await claimerBountyPrefetchPromise, nativeTokenAddress);
                        const [pricingInfo, signatureExpiry] = await Promise.all([
                            //Get intermediary's liquidity
                            this.verifyReturnedPrice(lp.services[SwapType_1.SwapType.FROM_BTC], false, resp.amount, resp.total, amountData.token, {}, pricePrefetchPromise, abortController.signal),
                            this.verifyReturnedSignature(signer, data, resp, feeRatePromise, signDataPromise, abortController.signal),
                            this.verifyIntermediaryLiquidity(data.getAmount(), liquidityPromise),
                        ]);
                        const quote = new FromBTCSwap_1.FromBTCSwap(this, {
                            pricingInfo,
                            url: lp.url,
                            expiry: signatureExpiry,
                            swapFee: resp.swapFee,
                            feeRate: await feeRatePromise,
                            signatureData: resp,
                            data,
                            address: resp.btcAddress,
                            amount: resp.amount,
                            exactIn: amountData.exactIn ?? true,
                            requiredConfirmations: resp.confirmations ?? lp.services[SwapType_1.SwapType.FROM_BTC].data.confirmations
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
}
exports.FromBTCWrapper = FromBTCWrapper;
