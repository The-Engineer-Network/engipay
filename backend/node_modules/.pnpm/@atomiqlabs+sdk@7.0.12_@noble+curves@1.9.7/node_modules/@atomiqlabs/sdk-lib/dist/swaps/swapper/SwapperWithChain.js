"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapperWithChain = void 0;
const SwapType_1 = require("../enums/SwapType");
const SwapPriceWithChain_1 = require("../../prices/SwapPriceWithChain");
const Tokens_1 = require("../../Tokens");
const SwapperWithSigner_1 = require("./SwapperWithSigner");
const UserError_1 = require("../../errors/UserError");
class SwapperWithChain {
    get intermediaryDiscovery() {
        return this.swapper.intermediaryDiscovery;
    }
    get mempoolApi() {
        return this.swapper.mempoolApi;
    }
    get bitcoinRpc() {
        return this.swapper.bitcoinRpc;
    }
    get bitcoinNetwork() {
        return this.swapper.bitcoinNetwork;
    }
    get Utils() {
        return this.swapper.Utils;
    }
    get SwapTypeInfo() {
        return this.swapper.SwapTypeInfo;
    }
    constructor(swapper, chainIdentifier) {
        this.swapper = swapper;
        this.chainIdentifier = chainIdentifier;
        this.prices = new SwapPriceWithChain_1.SwapPriceWithChain(swapper.prices, chainIdentifier);
    }
    createToBTCSwap(signer, tokenAddress, address, amount, exactIn, additionalParams, options) {
        return this.swapper.createToBTCSwap(this.chainIdentifier, signer, tokenAddress, address, amount, exactIn, additionalParams, options);
    }
    createToBTCLNSwap(signer, tokenAddress, paymentRequest, additionalParams, options) {
        return this.swapper.createToBTCLNSwap(this.chainIdentifier, signer, tokenAddress, paymentRequest, additionalParams, options);
    }
    createToBTCLNSwapViaLNURL(signer, tokenAddress, lnurlPay, amount, exactIn, additionalParams, options) {
        return this.swapper.createToBTCLNSwapViaLNURL(this.chainIdentifier, signer, tokenAddress, lnurlPay, amount, exactIn, additionalParams, options);
    }
    createToBTCLNSwapViaInvoiceCreateService(signer, tokenAddress, service, amount, exactIn, additionalParams, options) {
        return this.swapper.createToBTCLNSwapViaInvoiceCreateService(this.chainIdentifier, signer, tokenAddress, service, amount, exactIn, additionalParams, options);
    }
    createFromBTCSwap(signer, tokenAddress, amount, exactOut, additionalParams, options) {
        return this.swapper.createFromBTCSwap(this.chainIdentifier, signer, tokenAddress, amount, exactOut, additionalParams, options);
    }
    createFromBTCLNSwap(signer, tokenAddress, amount, exactOut, additionalParams, options) {
        return this.swapper.createFromBTCLNSwap(this.chainIdentifier, signer, tokenAddress, amount, exactOut, additionalParams, options);
    }
    createFromBTCLNSwapViaLNURL(signer, tokenAddress, lnurl, amount, exactOut, additionalParams) {
        return this.swapper.createFromBTCLNSwapViaLNURL(this.chainIdentifier, signer, tokenAddress, lnurl, amount, exactOut, additionalParams);
    }
    createFromBTCLNSwapNew(signer, tokenAddress, amount, exactOut, additionalParams, options) {
        return this.swapper.createFromBTCLNSwapNew(this.chainIdentifier, signer, tokenAddress, amount, exactOut, additionalParams, options);
    }
    createFromBTCLNSwapNewViaLNURL(signer, tokenAddress, lnurl, amount, exactOut, additionalParams, options) {
        return this.swapper.createFromBTCLNSwapNewViaLNURL(this.chainIdentifier, signer, tokenAddress, lnurl, amount, exactOut, additionalParams, options);
    }
    createTrustedLNForGasSwap(signer, amount, trustedIntermediaryUrl) {
        return this.swapper.createTrustedLNForGasSwap(this.chainIdentifier, signer, amount, trustedIntermediaryUrl);
    }
    createTrustedOnchainForGasSwap(signer, amount, refundAddress, trustedIntermediaryUrl) {
        return this.swapper.createTrustedOnchainForGasSwap(this.chainIdentifier, signer, amount, refundAddress, trustedIntermediaryUrl);
    }
    /**
     * Creates a swap from srcToken to dstToken, of a specific token amount, either specifying input amount (exactIn=true)
     *  or output amount (exactIn=false), NOTE: For regular -> BTC-LN (lightning) swaps the passed amount is ignored and
     *  invoice's pre-set amount is used instead.
     * @deprecated Use swap() instead
     *
     * @param signer Smartchain (Solana, Starknet, etc.) address of the user
     * @param srcToken Source token of the swap, user pays this token
     * @param dstToken Destination token of the swap, user receives this token
     * @param amount Amount of the swap
     * @param exactIn Whether the amount specified is an input amount (exactIn=true) or an output amount (exactIn=false)
     * @param addressLnurlLightningInvoice Bitcoin on-chain address, lightning invoice, LNURL-pay to pay or
     *  LNURL-withdrawal to withdraw money from
     */
    create(signer, srcToken, dstToken, amount, exactIn, addressLnurlLightningInvoice) {
        return this.swapper.create(signer, srcToken, dstToken, amount, exactIn, addressLnurlLightningInvoice);
    }
    /**
     * Creates a swap from srcToken to dstToken, of a specific token amount, either specifying input amount (exactIn=true)
     *  or output amount (exactIn=false), NOTE: For regular SmartChain -> BTC-LN (lightning) swaps the passed amount is ignored and
     *  invoice's pre-set amount is used instead, use LNURL-pay for dynamic amounts
     *
     * @param srcToken Source token of the swap, user pays this token
     * @param dstToken Destination token of the swap, user receives this token
     * @param amount Amount of the swap
     * @param exactIn Whether the amount specified is an input amount (exactIn=true) or an output amount (exactIn=false)
     * @param src Source wallet/lnurl-withdraw of the swap
     * @param dst Destination smart chain address, bitcoin on-chain address, lightning invoice, LNURL-pay
     * @param options Options for the swap
     */
    swap(srcToken, dstToken, amount, exactIn, src, dst, options) {
        if (typeof (srcToken) === "string")
            srcToken = this.getToken(srcToken);
        if (typeof (dstToken) === "string")
            dstToken = this.getToken(dstToken);
        return this.swapper.swap(srcToken, dstToken, amount, exactIn, src, dst, options);
    }
    /**
     * Returns swaps that are in-progress and are claimable for the specific chain, optionally also for a specific signer's address
     */
    getAllSwaps(signer) {
        return this.swapper.getAllSwaps(this.chainIdentifier, signer);
    }
    /**
     * Returns swaps that are in-progress and are claimable for the specific chain, optionally also for a specific signer's address
     */
    getActionableSwaps(signer) {
        return this.swapper.getActionableSwaps(this.chainIdentifier, signer);
    }
    /**
     * Returns swaps that are refundable for the specific chain, optionally also for a specific signer's address
     */
    getRefundableSwaps(signer) {
        return this.swapper.getRefundableSwaps(this.chainIdentifier, signer);
    }
    /**
     * Returns swaps that are due to be claimed/settled manually for the specific chain,
     *  optionally also for a specific signer's address
     */
    getClaimableSwaps(signer) {
        return this.swapper.getClaimableSwaps(this.chainIdentifier, signer);
    }
    /**
     * Returns swap with a specific id (identifier) on a specific chain and optionally with a signer
     */
    getSwapById(id, signer) {
        return this.swapper.getSwapById(id, this.chainIdentifier, signer);
    }
    getToken(tickerOrAddress) {
        //Btc tokens - BTC, BTCLN, BTC-LN
        if (tickerOrAddress === "BTC")
            return Tokens_1.BitcoinTokens.BTC;
        if (tickerOrAddress === "BTCLN" || tickerOrAddress === "BTC-LN")
            return Tokens_1.BitcoinTokens.BTCLN;
        //Check if the ticker is in format <chainId>-<ticker>, i.e. SOLANA-USDC, STARKNET-WBTC
        if (tickerOrAddress.includes("-")) {
            const [chainId, ticker] = tickerOrAddress.split("-");
            if (chainId !== this.chainIdentifier)
                throw new UserError_1.UserError(`Invalid chainId specified in ticker: ${chainId}, swapper chainId: ${this.chainIdentifier}`);
            const token = this.swapper.tokensByTicker[this.chainIdentifier]?.[ticker];
            if (token == null)
                throw new UserError_1.UserError(`Not found ticker: ${ticker} for chainId: ${chainId}`);
            return token;
        }
        const chain = this.swapper.chains[this.chainIdentifier];
        if (chain.chainInterface.isValidToken(tickerOrAddress)) {
            //Try to find in known token addresses
            const token = this.swapper.tokens[this.chainIdentifier]?.[tickerOrAddress];
            if (token != null)
                return token;
        }
        else {
            //Check in known tickers
            const token = this.swapper.tokensByTicker[this.chainIdentifier]?.[tickerOrAddress];
            if (token != null)
                return token;
        }
        throw new UserError_1.UserError(`Specified token address or ticker ${tickerOrAddress} not found for chainId: ${this.chainIdentifier}!`);
    }
    /**
     * Synchronizes swaps from chain, this is usually ran when SDK is initialized, deletes expired quotes
     */
    async _syncSwaps(signer) {
        return this.swapper._syncSwaps(this.chainIdentifier, signer);
    }
    supportsSwapType(swapType) {
        return this.swapper.supportsSwapType(this.chainIdentifier, swapType);
    }
    getSwapType(srcToken, dstToken) {
        return this.swapper.getSwapType(srcToken, dstToken);
    }
    /**
     * Returns minimum/maximum limits for inputs and outputs for a swap between given tokens
     *
     * @param srcToken
     * @param dstToken
     */
    getSwapLimits(srcToken, dstToken) {
        return this.swapper.getSwapLimits(srcToken, dstToken);
    }
    /**
     * Returns a set of supported tokens by all the intermediaries offering a specific swap service
     *
     * @param _swapType Swap service type to check supported tokens for
     */
    getSupportedTokens(_swapType) {
        const tokens = [];
        this.intermediaryDiscovery.intermediaries.forEach(lp => {
            let swapType = _swapType;
            if (swapType === SwapType_1.SwapType.FROM_BTCLN && this.supportsSwapType(SwapType_1.SwapType.FROM_BTCLN_AUTO))
                swapType = SwapType_1.SwapType.FROM_BTCLN_AUTO;
            if (swapType === SwapType_1.SwapType.FROM_BTC && this.supportsSwapType(SwapType_1.SwapType.SPV_VAULT_FROM_BTC))
                swapType = SwapType_1.SwapType.SPV_VAULT_FROM_BTC;
            if (lp.services[swapType] == null)
                return;
            if (lp.services[swapType].chainTokens == null)
                return;
            for (let tokenAddress of lp.services[swapType].chainTokens[this.chainIdentifier]) {
                const token = this.swapper.tokens?.[this.chainIdentifier]?.[tokenAddress];
                if (token != null)
                    tokens.push(token);
            }
        });
        return tokens;
    }
    /**
     * Returns the set of supported tokens by all the intermediaries we know of offering a specific swapType service
     *
     * @param swapType Specific swap type for which to obtain supported tokens
     */
    getSupportedTokenAddresses(swapType) {
        const set = new Set();
        this.intermediaryDiscovery.intermediaries.forEach(lp => {
            if (lp.services[swapType] == null)
                return;
            if (lp.services[swapType].chainTokens == null || lp.services[swapType].chainTokens[this.chainIdentifier] == null)
                return;
            lp.services[swapType].chainTokens[this.chainIdentifier].forEach(token => set.add(token));
        });
        return set;
    }
    /**
     * Returns tokens that you can swap to (if input=true) from a given token,
     *  or tokens that you can swap from (if input=false) to a given token
     */
    getSwapCounterTokens(token, input) {
        if ((0, Tokens_1.isSCToken)(token)) {
            const result = [];
            if (input) {
                //TO_BTC or TO_BTCLN
                if (this.getSupportedTokenAddresses(SwapType_1.SwapType.TO_BTCLN).has(token.address)) {
                    result.push(Tokens_1.BitcoinTokens.BTCLN);
                }
                if (this.getSupportedTokenAddresses(SwapType_1.SwapType.TO_BTC).has(token.address)) {
                    result.push(Tokens_1.BitcoinTokens.BTC);
                }
            }
            else {
                //FROM_BTC or FROM_BTCLN
                const fromLightningSwapType = this.supportsSwapType(SwapType_1.SwapType.FROM_BTCLN_AUTO) ? SwapType_1.SwapType.FROM_BTCLN_AUTO : SwapType_1.SwapType.FROM_BTCLN;
                if (this.getSupportedTokenAddresses(fromLightningSwapType).has(token.address)) {
                    result.push(Tokens_1.BitcoinTokens.BTCLN);
                }
                const fromOnchainSwapType = this.supportsSwapType(SwapType_1.SwapType.SPV_VAULT_FROM_BTC) ? SwapType_1.SwapType.SPV_VAULT_FROM_BTC : SwapType_1.SwapType.FROM_BTC;
                if (this.getSupportedTokenAddresses(fromOnchainSwapType).has(token.address)) {
                    result.push(Tokens_1.BitcoinTokens.BTC);
                }
            }
            return result;
        }
        else {
            if (input) {
                if (token.lightning) {
                    return this.getSupportedTokens(SwapType_1.SwapType.FROM_BTCLN);
                }
                else {
                    return this.getSupportedTokens(SwapType_1.SwapType.FROM_BTC);
                }
            }
            else {
                if (token.lightning) {
                    return this.getSupportedTokens(SwapType_1.SwapType.TO_BTCLN);
                }
                else {
                    return this.getSupportedTokens(SwapType_1.SwapType.TO_BTC);
                }
            }
        }
    }
    /**
     * Creates a child swapper instance with a signer
     *
     * @param signer Signer to use for the new swapper instance
     */
    withChain(signer) {
        return new SwapperWithSigner_1.SwapperWithSigner(this, signer);
    }
    ///////////////////////////////////
    /// Deprecated
    /**
     * Returns swap bounds (minimums & maximums) for different swap types & tokens
     * @deprecated Use getSwapLimits() instead!
     */
    getSwapBounds() {
        return this.swapper.getSwapBounds(this.chainIdentifier);
    }
    /**
     * Returns maximum possible swap amount
     * @deprecated Use getSwapLimits() instead!
     *
     * @param type      Type of the swap
     * @param token     Token of the swap
     */
    getMaximum(type, token) {
        return this.swapper.getMaximum(this.chainIdentifier, type, token);
    }
    /**
     * Returns minimum possible swap amount
     * @deprecated Use getSwapLimits() instead!
     *
     * @param type      Type of swap
     * @param token     Token of the swap
     */
    getMinimum(type, token) {
        return this.swapper.getMinimum(this.chainIdentifier, type, token);
    }
}
exports.SwapperWithChain = SwapperWithChain;
