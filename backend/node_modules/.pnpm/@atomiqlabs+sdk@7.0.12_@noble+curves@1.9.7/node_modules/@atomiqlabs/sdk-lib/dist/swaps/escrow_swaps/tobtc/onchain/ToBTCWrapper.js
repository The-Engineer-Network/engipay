"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToBTCWrapper = void 0;
const ToBTCSwap_1 = require("./ToBTCSwap");
const IToBTCWrapper_1 = require("../IToBTCWrapper");
const base_1 = require("@atomiqlabs/base");
const UserError_1 = require("../../../../errors/UserError");
const IntermediaryError_1 = require("../../../../errors/IntermediaryError");
const SwapType_1 = require("../../../enums/SwapType");
const Utils_1 = require("../../../../utils/Utils");
const BitcoinUtils_1 = require("../../../../utils/BitcoinUtils");
const IntermediaryAPI_1 = require("../../../../intermediaries/IntermediaryAPI");
const RequestError_1 = require("../../../../errors/RequestError");
const utils_1 = require("@scure/btc-signer/utils");
class ToBTCWrapper extends IToBTCWrapper_1.IToBTCWrapper {
    /**
     * @param chainIdentifier
     * @param unifiedStorage Storage interface for the current environment
     * @param unifiedChainEvents Smart chain on-chain event listener
     * @param chain
     * @param contract Chain specific swap contract
     * @param prices Swap pricing handler
     * @param tokens
     * @param swapDataDeserializer Deserializer for chain specific SwapData
     * @param btcRpc Bitcoin RPC api
     * @param options
     * @param events Instance to use for emitting events
     */
    constructor(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, contract, prices, tokens, swapDataDeserializer, btcRpc, options, events) {
        if (options == null)
            options = {};
        options.bitcoinNetwork = options.bitcoinNetwork ?? utils_1.TEST_NETWORK;
        options.safetyFactor = options.safetyFactor || 2;
        options.maxConfirmations = options.maxConfirmations || 6;
        options.bitcoinBlocktime = options.bitcoinBlocktime || (60 * 10);
        options.maxExpectedOnchainSendSafetyFactor = options.maxExpectedOnchainSendSafetyFactor || 4;
        options.maxExpectedOnchainSendGracePeriodBlocks = options.maxExpectedOnchainSendGracePeriodBlocks || 12;
        super(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, contract, prices, tokens, swapDataDeserializer, options, events);
        this.TYPE = SwapType_1.SwapType.TO_BTC;
        this.swapDeserializer = ToBTCSwap_1.ToBTCSwap;
        this.btcRpc = btcRpc;
    }
    /**
     * Returns randomly generated random escrow nonce to be used for to BTC on-chain swaps
     * @private
     * @returns Escrow nonce
     */
    getRandomNonce() {
        const firstPart = BigInt(Math.floor((Date.now() / 1000)) - 700000000);
        return (firstPart << 24n) | base_1.BigIntBufferUtils.fromBuffer((0, Utils_1.randomBytes)(3));
    }
    /**
     * Converts bitcoin address to its corresponding output script
     *
     * @param addr Bitcoin address to get the output script for
     * @private
     * @returns Output script as Buffer
     * @throws {UserError} if invalid address is specified
     */
    btcAddressToOutputScript(addr) {
        try {
            return (0, BitcoinUtils_1.toOutputScript)(this.options.bitcoinNetwork, addr);
        }
        catch (e) {
            throw new UserError_1.UserError("Invalid address specified");
        }
    }
    /**
     * Verifies returned LP data
     *
     * @param signer
     * @param resp LP's response
     * @param amountData
     * @param lp
     * @param options Options as passed to the swap create function
     * @param data LP's returned parsed swap data
     * @param hash Payment hash of the swap
     * @private
     * @throws {IntermediaryError} if returned data are not correct
     */
    verifyReturnedData(signer, resp, amountData, lp, options, data, hash) {
        if (resp.totalFee !== (resp.swapFee + resp.networkFee))
            throw new IntermediaryError_1.IntermediaryError("Invalid totalFee returned");
        if (amountData.exactIn) {
            if (resp.total !== amountData.amount)
                throw new IntermediaryError_1.IntermediaryError("Invalid total returned");
        }
        else {
            if (resp.amount !== amountData.amount)
                throw new IntermediaryError_1.IntermediaryError("Invalid amount returned");
        }
        const maxAllowedBlockDelta = BigInt(options.confirmations +
            options.confirmationTarget +
            this.options.maxExpectedOnchainSendGracePeriodBlocks);
        const maxAllowedExpiryDelta = maxAllowedBlockDelta
            * BigInt(this.options.maxExpectedOnchainSendSafetyFactor)
            * BigInt(this.options.bitcoinBlocktime);
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const maxAllowedExpiryTimestamp = currentTimestamp + maxAllowedExpiryDelta;
        if (data.getExpiry() > maxAllowedExpiryTimestamp) {
            throw new IntermediaryError_1.IntermediaryError("Expiry time returned too high!");
        }
        if (data.getAmount() !== resp.total ||
            data.getClaimHash() !== hash ||
            data.getType() !== base_1.ChainSwapType.CHAIN_NONCED ||
            !data.isPayIn() ||
            !data.isToken(amountData.token) ||
            !data.isClaimer(lp.getAddress(this.chainIdentifier)) ||
            !data.isOfferer(signer) ||
            data.getTotalDeposit() !== 0n) {
            throw new IntermediaryError_1.IntermediaryError("Invalid data returned");
        }
    }
    /**
     * Returns quotes fetched from LPs, paying to an 'address' - a bitcoin address
     *
     * @param signer                Smart-chain signer address initiating the swap
     * @param address               Bitcoin on-chain address you wish to pay to
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers) to get the quotes from
     * @param options               Quote options
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     */
    create(signer, address, amountData, lps, options, additionalParams, abortSignal) {
        if (!this.isInitialized)
            throw new Error("Not initialized, call init() first!");
        options ??= {};
        options.confirmationTarget ??= 3;
        options.confirmations ??= 2;
        const nonce = this.getRandomNonce();
        const outputScript = this.btcAddressToOutputScript(address);
        const _hash = !amountData.exactIn ?
            this.contract.getHashForOnchain(outputScript, amountData.amount, options.confirmations, nonce).toString("hex") :
            null;
        const _abortController = (0, Utils_1.extendAbortController)(abortSignal);
        const pricePreFetchPromise = this.preFetchPrice(amountData, _abortController.signal);
        const feeRatePromise = this.preFetchFeeRate(signer, amountData, _hash, _abortController);
        const _signDataPromise = this.contract.preFetchBlockDataForSignatures == null ? this.preFetchSignData(Promise.resolve(true)) : null;
        return lps.map(lp => {
            return {
                intermediary: lp,
                quote: (async () => {
                    const abortController = (0, Utils_1.extendAbortController)(_abortController.signal);
                    const reputationPromise = this.preFetchIntermediaryReputation(amountData, lp, abortController);
                    try {
                        const { signDataPromise, resp } = await (0, Utils_1.tryWithRetries)(async (retryCount) => {
                            const { signDataPrefetch, response } = IntermediaryAPI_1.IntermediaryAPI.initToBTC(this.chainIdentifier, lp.url, {
                                btcAddress: address,
                                amount: amountData.amount,
                                confirmationTarget: options.confirmationTarget,
                                confirmations: options.confirmations,
                                nonce: nonce,
                                token: amountData.token,
                                offerer: signer,
                                exactIn: amountData.exactIn,
                                feeRate: feeRatePromise,
                                additionalParams
                            }, this.options.postRequestTimeout, abortController.signal, retryCount > 0 ? false : null);
                            return {
                                signDataPromise: _signDataPromise ?? this.preFetchSignData(signDataPrefetch),
                                resp: await response
                            };
                        }, null, RequestError_1.RequestError, abortController.signal);
                        let hash = amountData.exactIn ?
                            this.contract.getHashForOnchain(outputScript, resp.amount, options.confirmations, nonce).toString("hex") :
                            _hash;
                        const data = new this.swapDataDeserializer(resp.data);
                        data.setOfferer(signer);
                        this.verifyReturnedData(signer, resp, amountData, lp, options, data, hash);
                        const [pricingInfo, signatureExpiry, reputation] = await Promise.all([
                            this.verifyReturnedPrice(lp.services[SwapType_1.SwapType.TO_BTC], true, resp.amount, data.getAmount(), amountData.token, resp, pricePreFetchPromise, abortController.signal),
                            this.verifyReturnedSignature(signer, data, resp, feeRatePromise, signDataPromise, abortController.signal),
                            reputationPromise
                        ]);
                        abortController.signal.throwIfAborted();
                        lp.reputation[amountData.token.toString()] = reputation;
                        const quote = new ToBTCSwap_1.ToBTCSwap(this, {
                            pricingInfo,
                            url: lp.url,
                            expiry: signatureExpiry,
                            swapFee: resp.swapFee,
                            feeRate: await feeRatePromise,
                            signatureData: resp,
                            data,
                            networkFee: resp.networkFee,
                            address,
                            amount: resp.amount,
                            confirmationTarget: options.confirmationTarget,
                            satsPerVByte: Number(resp.satsPervByte),
                            exactIn: amountData.exactIn ?? false,
                            requiredConfirmations: options.confirmations,
                            nonce
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
exports.ToBTCWrapper = ToBTCWrapper;
