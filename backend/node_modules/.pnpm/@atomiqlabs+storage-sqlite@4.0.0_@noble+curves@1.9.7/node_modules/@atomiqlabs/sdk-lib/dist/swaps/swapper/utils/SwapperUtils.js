"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapperUtils = void 0;
const bolt11_1 = require("@atomiqlabs/bolt11");
const btc_signer_1 = require("@scure/btc-signer");
const LNURL_1 = require("../../../utils/LNURL");
const SwapType_1 = require("../../enums/SwapType");
const Tokens_1 = require("../../../Tokens");
const SingleAddressBitcoinWallet_1 = require("../../../btc/wallet/SingleAddressBitcoinWallet");
const base_1 = require("@atomiqlabs/base");
const Utils_1 = require("../../../utils/Utils");
const BitcoinHelpers_1 = require("../../../utils/BitcoinHelpers");
class SwapperUtils {
    constructor(root) {
        this.bitcoinNetwork = root.bitcoinNetwork;
        this.root = root;
    }
    /**
     * Returns true if string is a valid BOLT11 bitcoin lightning invoice
     *
     * @param lnpr
     */
    isLightningInvoice(lnpr) {
        try {
            (0, bolt11_1.decode)(lnpr);
            return true;
        }
        catch (e) { }
        return false;
    }
    /**
     * Returns true if string is a valid bitcoin address
     *
     * @param addr
     */
    isValidBitcoinAddress(addr) {
        try {
            (0, btc_signer_1.Address)(this.bitcoinNetwork).decode(addr);
            return true;
        }
        catch (e) {
            return false;
        }
    }
    /**
     * Returns true if string is a valid BOLT11 bitcoin lightning invoice WITH AMOUNT
     *
     * @param lnpr
     */
    isValidLightningInvoice(lnpr) {
        try {
            const parsed = (0, bolt11_1.decode)(lnpr);
            if (parsed.millisatoshis != null)
                return true;
        }
        catch (e) { }
        return false;
    }
    /**
     * Returns true if string is a valid LNURL (no checking on type is performed)
     *
     * @param lnurl
     */
    isValidLNURL(lnurl) {
        return LNURL_1.LNURL.isLNURL(lnurl);
    }
    /**
     * Returns type and data about an LNURL
     *
     * @param lnurl
     * @param shouldRetry
     */
    getLNURLTypeAndData(lnurl, shouldRetry) {
        return LNURL_1.LNURL.getLNURLType(lnurl, shouldRetry);
    }
    /**
     * Returns satoshi value of BOLT11 bitcoin lightning invoice WITH AMOUNT
     *
     * @param lnpr
     */
    getLightningInvoiceValue(lnpr) {
        const parsed = (0, bolt11_1.decode)(lnpr);
        if (parsed.millisatoshis != null)
            return (BigInt(parsed.millisatoshis) + 999n) / 1000n;
        return null;
    }
    parseBitcoinAddress(resultText) {
        let _amount = null;
        if (resultText.includes("?")) {
            const arr = resultText.split("?");
            resultText = arr[0];
            const params = arr[1].split("&");
            for (let param of params) {
                const arr2 = param.split("=");
                const key = arr2[0];
                const value = decodeURIComponent(arr2[1]);
                if (key === "amount") {
                    _amount = (0, Tokens_1.fromDecimal)(parseFloat(value).toFixed(8), 8);
                }
            }
        }
        if (this.isValidBitcoinAddress(resultText)) {
            return {
                address: resultText,
                type: "BITCOIN",
                swapType: SwapType_1.SwapType.TO_BTC,
                amount: _amount == null ? null : (0, Tokens_1.toTokenAmount)(_amount, Tokens_1.BitcoinTokens.BTC, this.root.prices)
            };
        }
    }
    parseLNURLSync(resultText) {
        if (this.isValidLNURL(resultText)) {
            return {
                address: resultText,
                type: "LNURL",
                swapType: null
            };
        }
    }
    async parseLNURL(resultText) {
        if (this.isValidLNURL(resultText)) {
            try {
                const result = await this.getLNURLTypeAndData(resultText);
                if (result == null)
                    throw new Error("Invalid LNURL specified!");
                const response = {
                    address: resultText,
                    type: "LNURL",
                    swapType: (0, LNURL_1.isLNURLPay)(result) ? SwapType_1.SwapType.TO_BTCLN : (0, LNURL_1.isLNURLWithdraw)(result) ? SwapType_1.SwapType.FROM_BTCLN : null,
                    lnurl: result
                };
                if (result.min === result.max) {
                    return {
                        ...response,
                        amount: result.min == null ? null : (0, Tokens_1.toTokenAmount)(result.min, Tokens_1.BitcoinTokens.BTCLN, this.root.prices)
                    };
                }
                else {
                    return {
                        ...response,
                        min: result.min == null ? null : (0, Tokens_1.toTokenAmount)(result.min, Tokens_1.BitcoinTokens.BTCLN, this.root.prices),
                        max: result.min == null ? null : (0, Tokens_1.toTokenAmount)(result.max, Tokens_1.BitcoinTokens.BTCLN, this.root.prices)
                    };
                }
            }
            catch (e) {
                throw new Error("Failed to contact LNURL service, check your internet connection and retry later.");
            }
        }
    }
    parseLightningInvoice(resultText) {
        if (this.isLightningInvoice(resultText)) {
            if (this.isValidLightningInvoice(resultText)) {
                const amountBN = this.getLightningInvoiceValue(resultText);
                return {
                    address: resultText,
                    type: "LIGHTNING",
                    swapType: SwapType_1.SwapType.TO_BTCLN,
                    amount: (0, Tokens_1.toTokenAmount)(amountBN, Tokens_1.BitcoinTokens.BTCLN, this.root.prices)
                };
            }
            else {
                throw new Error("Lightning invoice needs to contain an amount!");
            }
        }
    }
    parseSmartchainAddress(resultText) {
        for (let chainId of this.root.getSmartChains()) {
            if (this.root.chains[chainId].chainInterface.isValidAddress(resultText)) {
                if (this.root.supportsSwapType(chainId, SwapType_1.SwapType.SPV_VAULT_FROM_BTC)) {
                    return {
                        address: resultText,
                        type: chainId,
                        swapType: SwapType_1.SwapType.SPV_VAULT_FROM_BTC
                    };
                }
                else {
                    return {
                        address: resultText,
                        type: chainId,
                        swapType: null
                    };
                }
            }
        }
    }
    /**
     * General parser for bitcoin addresses, LNURLs, lightning invoices, smart chain addresses, also fetches LNURL data
     *  (hence returns Promise)
     *
     * @param addressString Address to parse
     * @throws {Error} Error in address parsing
     * @returns Address data or null if address doesn't conform to any known format
     */
    async parseAddress(addressString) {
        if (addressString.startsWith("bitcoin:")) {
            const parsedBitcoinAddress = this.parseBitcoinAddress(addressString.substring(8));
            if (parsedBitcoinAddress != null)
                return parsedBitcoinAddress;
            throw new Error("Invalid bitcoin address!");
        }
        const parsedBitcoinAddress = this.parseBitcoinAddress(addressString);
        if (parsedBitcoinAddress != null)
            return parsedBitcoinAddress;
        if (addressString.startsWith("lightning:")) {
            const resultText = addressString.substring(10);
            const resultLnurl = await this.parseLNURL(resultText);
            if (resultLnurl != null)
                return resultLnurl;
            const resultLightningInvoice = this.parseLightningInvoice(resultText);
            if (resultLightningInvoice != null)
                return resultLightningInvoice;
            throw new Error("Invalid lightning network invoice or LNURL!");
        }
        const resultLnurl = await this.parseLNURL(addressString);
        if (resultLnurl != null)
            return resultLnurl;
        const resultLightningInvoice = this.parseLightningInvoice(addressString);
        if (resultLightningInvoice != null)
            return resultLightningInvoice;
        return this.parseSmartchainAddress(addressString);
    }
    /**
     * Synchronous general parser for bitcoin addresses, LNURLs, lightning invoices, smart chain addresses, doesn't fetch
     *  LNURL data, reports swapType: null instead to prevent returning a Promise
     *
     * @param addressString Address to parse
     * @throws {Error} Error in address parsing
     * @returns Address data or null if address doesn't conform to any known format
     */
    parseAddressSync(addressString) {
        if (addressString.startsWith("bitcoin:")) {
            const parsedBitcoinAddress = this.parseBitcoinAddress(addressString.substring(8));
            if (parsedBitcoinAddress != null)
                return parsedBitcoinAddress;
            throw new Error("Invalid bitcoin address!");
        }
        const parsedBitcoinAddress = this.parseBitcoinAddress(addressString);
        if (parsedBitcoinAddress != null)
            return parsedBitcoinAddress;
        if (addressString.startsWith("lightning:")) {
            const resultText = addressString.substring(10);
            const resultLnurl = this.parseLNURLSync(resultText);
            if (resultLnurl != null)
                return resultLnurl;
            const resultLightningInvoice = this.parseLightningInvoice(resultText);
            if (resultLightningInvoice != null)
                return resultLightningInvoice;
            throw new Error("Invalid lightning network invoice or LNURL!");
        }
        const resultLnurl = this.parseLNURLSync(addressString);
        if (resultLnurl != null)
            return resultLnurl;
        const resultLightningInvoice = this.parseLightningInvoice(addressString);
        if (resultLightningInvoice != null)
            return resultLightningInvoice;
        return this.parseSmartchainAddress(addressString);
    }
    /**
     * Returns a random PSBT that can be used for fee estimation, the last output (the LP output) is omitted
     *  to allow for coinselection algorithm to determine maximum sendable amount there
     *
     * @param chainIdentifier
     * @param includeGasToken   Whether to return the PSBT also with the gas token amount (increases the vSize by 8)
     */
    getRandomSpvVaultPsbt(chainIdentifier, includeGasToken) {
        const wrapper = this.root.chains[chainIdentifier].wrappers[SwapType_1.SwapType.SPV_VAULT_FROM_BTC];
        if (wrapper == null)
            throw new Error("Chain doesn't support spv vault swaps!");
        return wrapper.getDummySwapPsbt(includeGasToken);
    }
    /**
     * Returns the spendable balance of a bitcoin wallet
     *
     * @param wallet
     * @param targetChain
     * @param options Additional options
     */
    async getBitcoinSpendableBalance(wallet, targetChain, options) {
        let bitcoinWallet;
        if (typeof (wallet) === "string") {
            bitcoinWallet = new SingleAddressBitcoinWallet_1.SingleAddressBitcoinWallet(this.root.bitcoinRpc, this.bitcoinNetwork, { address: wallet, publicKey: "" });
        }
        else {
            bitcoinWallet = (0, BitcoinHelpers_1.toBitcoinWallet)(wallet, this.root.bitcoinRpc, this.bitcoinNetwork);
        }
        let feeRate = options?.feeRate ?? await bitcoinWallet.getFeeRate();
        if (options?.minFeeRate != null)
            feeRate = Math.max(feeRate, options.minFeeRate);
        let result;
        if (targetChain != null && this.root.supportsSwapType(targetChain, SwapType_1.SwapType.SPV_VAULT_FROM_BTC)) {
            result = await bitcoinWallet.getSpendableBalance(this.getRandomSpvVaultPsbt(targetChain, options?.gasDrop), feeRate);
        }
        else {
            result = await bitcoinWallet.getSpendableBalance(undefined, feeRate);
        }
        return {
            balance: result.balance == null ? null : (0, Tokens_1.toTokenAmount)(result.balance, Tokens_1.BitcoinTokens.BTC, this.root.prices),
            feeRate: result.feeRate
        };
    }
    /**
     * Returns the maximum spendable balance of the wallet, deducting the fee needed to initiate a swap for native balances
     */
    async getSpendableBalance(wallet, token, options) {
        if (this.root.chains[token.chainId] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + token.chainId);
        const { swapContract, chainInterface } = this.root.chains[token.chainId];
        let signer;
        if (typeof (wallet) === "string") {
            signer = wallet;
        }
        else {
            const abstractSigner = (0, base_1.isAbstractSigner)(wallet) ? wallet : await chainInterface.wrapSigner(wallet);
            signer = abstractSigner.getAddress();
        }
        let finalBalance;
        if (chainInterface.getNativeCurrencyAddress() !== token.address) {
            finalBalance = await chainInterface.getBalance(signer, token.address);
        }
        else {
            let [balance, commitFee] = await Promise.all([
                chainInterface.getBalance(signer, token.address),
                swapContract.getCommitFee(signer, 
                //Use large amount, such that the fee for wrapping more tokens is always included!
                await swapContract.createSwapData(base_1.ChainSwapType.HTLC, signer, null, token.address, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn, swapContract.getHashForHtlc((0, Utils_1.randomBytes)(32)).toString("hex"), base_1.BigIntBufferUtils.fromBuffer((0, Utils_1.randomBytes)(8)), BigInt(Math.floor(Date.now() / 1000)), true, false, base_1.BigIntBufferUtils.fromBuffer((0, Utils_1.randomBytes)(2)), base_1.BigIntBufferUtils.fromBuffer((0, Utils_1.randomBytes)(2))), options?.feeRate)
            ]);
            if (options?.feeMultiplier != null) {
                commitFee = commitFee * (BigInt(Math.floor(options.feeMultiplier * 1000000))) / 1000000n;
            }
            finalBalance = (0, Utils_1.bigIntMax)(balance - commitFee, 0n);
        }
        return finalBalance == null ? null : (0, Tokens_1.toTokenAmount)(finalBalance, token, this.root.prices);
    }
    /**
     * Returns the address of the native currency of the chain
     */
    getNativeToken(chainIdentifier) {
        if (this.root.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        return this.root.tokens[chainIdentifier][this.root.chains[chainIdentifier].chainInterface.getNativeCurrencyAddress()];
    }
    /**
     * Returns a random signer for a given smart chain
     *
     * @param chainIdentifier
     */
    randomSigner(chainIdentifier) {
        if (this.root.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        return this.root.chains[chainIdentifier].chainInterface.randomSigner();
    }
    /**
     * Returns a random address for a given smart chain
     *
     * @param chainIdentifier
     */
    randomAddress(chainIdentifier) {
        if (this.root.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        return this.root.chains[chainIdentifier].chainInterface.randomAddress();
    }
}
exports.SwapperUtils = SwapperUtils;
