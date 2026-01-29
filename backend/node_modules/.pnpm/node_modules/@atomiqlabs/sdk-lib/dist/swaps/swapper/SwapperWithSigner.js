"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapperWithSigner = void 0;
const SwapWithSigner_1 = require("./SwapWithSigner");
class SwapperWithSigner {
    get prices() {
        return this.swapper.prices;
    }
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
    constructor(swapper, signer) {
        this.swapper = swapper;
        this.signer = signer;
    }
    createToBTCSwap(tokenAddress, address, amount, exactIn, additionalParams, options) {
        return this.swapper.createToBTCSwap(this.signer.getAddress(), tokenAddress, address, amount, exactIn, additionalParams, options)
            .then(swap => (0, SwapWithSigner_1.wrapSwapWithSigner)(swap, this.signer));
    }
    createToBTCLNSwap(tokenAddress, paymentRequest, additionalParams, options) {
        return this.swapper.createToBTCLNSwap(this.signer.getAddress(), tokenAddress, paymentRequest, additionalParams, options)
            .then(swap => (0, SwapWithSigner_1.wrapSwapWithSigner)(swap, this.signer));
    }
    createToBTCLNSwapViaLNURL(tokenAddress, lnurlPay, amount, exactIn, additionalParams, options) {
        return this.swapper.createToBTCLNSwapViaLNURL(this.signer.getAddress(), tokenAddress, lnurlPay, amount, exactIn, additionalParams, options)
            .then(swap => (0, SwapWithSigner_1.wrapSwapWithSigner)(swap, this.signer));
    }
    createFromBTCSwap(tokenAddress, amount, exactOut, additionalParams, options) {
        return this.swapper.createFromBTCSwap(this.signer.getAddress(), tokenAddress, amount, exactOut, additionalParams, options)
            .then(swap => (0, SwapWithSigner_1.wrapSwapWithSigner)(swap, this.signer));
    }
    createFromBTCLNSwap(tokenAddress, amount, exactOut, additionalParams, options) {
        return this.swapper.createFromBTCLNSwap(this.signer.getAddress(), tokenAddress, amount, exactOut, additionalParams, options)
            .then(swap => (0, SwapWithSigner_1.wrapSwapWithSigner)(swap, this.signer));
    }
    createFromBTCLNSwapViaLNURL(tokenAddress, lnurl, amount, exactOut, additionalParams) {
        return this.swapper.createFromBTCLNSwapViaLNURL(this.signer.getAddress(), tokenAddress, lnurl, amount, exactOut, additionalParams)
            .then(swap => (0, SwapWithSigner_1.wrapSwapWithSigner)(swap, this.signer));
    }
    createFromBTCLNSwapNew(tokenAddress, amount, exactOut, additionalParams, options) {
        return this.swapper.createFromBTCLNSwapNew(this.signer.getAddress(), tokenAddress, amount, exactOut, additionalParams, options)
            .then(swap => (0, SwapWithSigner_1.wrapSwapWithSigner)(swap, this.signer));
    }
    createFromBTCLNSwapNewViaLNURL(tokenAddress, lnurl, amount, exactOut, additionalParams, options) {
        return this.swapper.createFromBTCLNSwapNewViaLNURL(this.signer.getAddress(), tokenAddress, lnurl, amount, exactOut, additionalParams, options)
            .then(swap => (0, SwapWithSigner_1.wrapSwapWithSigner)(swap, this.signer));
    }
    createTrustedLNForGasSwap(amount, trustedIntermediaryUrl) {
        return this.swapper.createTrustedLNForGasSwap(this.signer.getAddress(), amount, trustedIntermediaryUrl);
    }
    createTrustedOnchainForGasSwap(amount, refundAddress, trustedIntermediaryUrl) {
        return this.swapper.createTrustedOnchainForGasSwap(this.signer.getAddress(), amount, refundAddress, trustedIntermediaryUrl);
    }
    /**
     * Creates a swap from srcToken to dstToken, of a specific token amount, either specifying input amount (exactIn=true)
     *  or output amount (exactIn=false), NOTE: For regular -> BTC-LN (lightning) swaps the passed amount is ignored and
     *  invoice's pre-set amount is used instead.
     *
     * @param srcToken Source token of the swap, user pays this token
     * @param dstToken Destination token of the swap, user receives this token
     * @param amount Amount of the swap
     * @param exactIn Whether the amount specified is an input amount (exactIn=true) or an output amount (exactIn=false)
     * @param addressLnurlLightningInvoice Bitcoin on-chain address, lightning invoice, LNURL-pay to pay or
     *  LNURL-withdrawal to withdraw money from
     */
    create(srcToken, dstToken, amount, exactIn, addressLnurlLightningInvoice) {
        return this.swapper.create(this.signer.getAddress(), srcToken, dstToken, amount, exactIn, addressLnurlLightningInvoice)
            .then(swap => (0, SwapWithSigner_1.wrapSwapWithSigner)(swap, this.signer));
    }
    /**
     * Returns swaps that are in-progress and are claimable for the specific chain, optionally also for a specific signer's address
     */
    getAllSwaps() {
        return this.swapper.getAllSwaps(this.signer.getAddress());
    }
    /**
     * Returns swaps that are in-progress and are claimable for the specific chain, optionally also for a specific signer's address
     */
    getActionableSwaps() {
        return this.swapper.getActionableSwaps(this.signer.getAddress());
    }
    /**
     * Returns swaps that are refundable for the specific chain, optionally also for a specific signer's address
     */
    getRefundableSwaps() {
        return this.swapper.getRefundableSwaps(this.signer.getAddress());
    }
    /**
     * Returns swap with a specific id (identifier) on a specific chain and optionally with a signer
     */
    getSwapById(id) {
        return this.swapper.getSwapById(id, this.signer.getAddress());
    }
    /**
     * Synchronizes swaps from chain, this is usually ran when SDK is initialized, deletes expired quotes
     */
    async _syncSwaps() {
        return this.swapper._syncSwaps(this.signer.getAddress());
    }
    supportsSwapType(swapType) {
        return this.swapper.supportsSwapType(swapType);
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
     * Returns tokens that you can swap to (if input=true) from a given token,
     *  or tokens that you can swap from (if input=false) to a given token
     */
    getSwapCounterTokens(token, input) {
        return this.swapper.getSwapCounterTokens(token, input);
    }
    ///////////////////////////////////
    /// Deprecated
    /**
     * Returns swap bounds (minimums & maximums) for different swap types & tokens
     * @deprecated Use getSwapLimits() instead!
     */
    getSwapBounds() {
        return this.swapper.getSwapBounds();
    }
    /**
     * Returns maximum possible swap amount
     * @deprecated Use getSwapLimits() instead!
     *
     * @param type      Type of the swap
     * @param token     Token of the swap
     */
    getMaximum(type, token) {
        return this.swapper.getMaximum(type, token);
    }
    /**
     * Returns minimum possible swap amount
     * @deprecated Use getSwapLimits() instead!
     *
     * @param type      Type of swap
     * @param token     Token of the swap
     */
    getMinimum(type, token) {
        return this.swapper.getMinimum(type, token);
    }
}
exports.SwapperWithSigner = SwapperWithSigner;
