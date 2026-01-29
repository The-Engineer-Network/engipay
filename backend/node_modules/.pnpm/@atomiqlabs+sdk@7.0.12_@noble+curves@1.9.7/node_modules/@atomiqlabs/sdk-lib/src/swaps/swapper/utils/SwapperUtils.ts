import {decode as bolt11Decode} from "@atomiqlabs/bolt11";
import {Address, Transaction} from "@scure/btc-signer";
import {isLNURLPay, isLNURLWithdraw, LNURL, LNURLPay, LNURLWithdraw} from "../../../utils/LNURL";
import {BTC_NETWORK} from "@scure/btc-signer/utils";
import {SwapType} from "../../enums/SwapType";
import {BitcoinTokens, fromDecimal, SCToken, TokenAmount, toTokenAmount} from "../../../Tokens";
import {ChainIds, MultiChain, Swapper} from "../Swapper";
import {IBitcoinWallet} from "../../../btc/wallet/IBitcoinWallet";
import {SingleAddressBitcoinWallet} from "../../../btc/wallet/SingleAddressBitcoinWallet";
import {BigIntBufferUtils, ChainSwapType, isAbstractSigner} from "@atomiqlabs/base";
import {bigIntMax, randomBytes} from "../../../utils/Utils";
import {MinimalBitcoinWalletInterface} from "../../../btc/wallet/MinimalBitcoinWalletInterface";
import {toBitcoinWallet} from "../../../utils/BitcoinHelpers";

export class SwapperUtils<T extends MultiChain> {

    readonly bitcoinNetwork: BTC_NETWORK;
    private readonly root: Swapper<T>;

    constructor(root: Swapper<T>) {
        this.bitcoinNetwork = root.bitcoinNetwork;
        this.root = root;
    }

    /**
     * Returns true if string is a valid BOLT11 bitcoin lightning invoice
     *
     * @param lnpr
     */
    isLightningInvoice(lnpr: string): boolean {
        try {
            bolt11Decode(lnpr);
            return true;
        } catch (e) {}
        return false;
    }

    /**
     * Returns true if string is a valid bitcoin address
     *
     * @param addr
     */
    isValidBitcoinAddress(addr: string): boolean {
        try {
            Address(this.bitcoinNetwork).decode(addr);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Returns true if string is a valid BOLT11 bitcoin lightning invoice WITH AMOUNT
     *
     * @param lnpr
     */
    isValidLightningInvoice(lnpr: string): boolean {
        try {
            const parsed = bolt11Decode(lnpr);
            if(parsed.millisatoshis!=null) return true;
        } catch (e) {}
        return false;
    }

    /**
     * Returns true if string is a valid LNURL (no checking on type is performed)
     *
     * @param lnurl
     */
    isValidLNURL(lnurl: string): boolean {
        return LNURL.isLNURL(lnurl);
    }

    /**
     * Returns type and data about an LNURL
     *
     * @param lnurl
     * @param shouldRetry
     */
    getLNURLTypeAndData(lnurl: string, shouldRetry?: boolean): Promise<LNURLPay | LNURLWithdraw | null> {
        return LNURL.getLNURLType(lnurl, shouldRetry);
    }

    /**
     * Returns satoshi value of BOLT11 bitcoin lightning invoice WITH AMOUNT
     *
     * @param lnpr
     */
    getLightningInvoiceValue(lnpr: string): bigint {
        const parsed = bolt11Decode(lnpr);
        if(parsed.millisatoshis!=null) return (BigInt(parsed.millisatoshis) + 999n) / 1000n;
        return null;
    }

    private parseBitcoinAddress(resultText: string): {
        address: string,
        type: "BITCOIN",
        swapType: SwapType.TO_BTC,
        amount?: TokenAmount
    } {
        let _amount: bigint = null;
        if(resultText.includes("?")) {
            const arr = resultText.split("?");
            resultText = arr[0];
            const params = arr[1].split("&");
            for(let param of params) {
                const arr2 = param.split("=");
                const key = arr2[0];
                const value = decodeURIComponent(arr2[1]);
                if(key==="amount") {
                    _amount = fromDecimal(parseFloat(value).toFixed(8), 8);
                }
            }
        }
        if(this.isValidBitcoinAddress(resultText)) {
            return {
                address: resultText,
                type: "BITCOIN",
                swapType: SwapType.TO_BTC,
                amount: _amount==null ? null : toTokenAmount(_amount, BitcoinTokens.BTC, this.root.prices)
            };
        }
    }

    private parseLNURLSync(resultText: string): {
        address: string,
        type: "LNURL",
        swapType: null
    } {
        if(this.isValidLNURL(resultText)) {
            return {
                address: resultText,
                type: "LNURL",
                swapType: null
            };
        }
    }

    private async parseLNURL(resultText: string): Promise<{
        address: string,
        type: "LNURL",
        swapType: SwapType.TO_BTCLN | SwapType.FROM_BTCLN,
        lnurl: LNURLPay | LNURLWithdraw,
        min?: TokenAmount,
        max?: TokenAmount,
        amount?: TokenAmount
    }> {
        if(this.isValidLNURL(resultText)) {
            try {
                const result = await this.getLNURLTypeAndData(resultText);
                if(result==null) throw new Error("Invalid LNURL specified!");
                const response = {
                    address: resultText,
                    type: "LNURL",
                    swapType: isLNURLPay(result) ? SwapType.TO_BTCLN : isLNURLWithdraw(result) ? SwapType.FROM_BTCLN : null,
                    lnurl: result
                } as const;
                if(result.min===result.max) {
                    return {
                        ...response,
                        amount: result.min==null ? null : toTokenAmount(result.min, BitcoinTokens.BTCLN, this.root.prices)
                    }
                } else {
                    return {
                        ...response,
                        min: result.min==null ? null : toTokenAmount(result.min, BitcoinTokens.BTCLN, this.root.prices),
                        max: result.min==null ? null : toTokenAmount(result.max, BitcoinTokens.BTCLN, this.root.prices)
                    }
                }
            } catch (e) {
                throw new Error("Failed to contact LNURL service, check your internet connection and retry later.");
            }
        }
    }

    private parseLightningInvoice(resultText: string): {
        address: string,
        type: "LIGHTNING",
        swapType: SwapType.TO_BTCLN,
        amount: TokenAmount
    } {
        if(this.isLightningInvoice(resultText)) {
            if(this.isValidLightningInvoice(resultText)) {
                const amountBN = this.getLightningInvoiceValue(resultText);
                return {
                    address: resultText,
                    type: "LIGHTNING",
                    swapType: SwapType.TO_BTCLN,
                    amount: toTokenAmount(amountBN, BitcoinTokens.BTCLN, this.root.prices)
                }
            } else {
                throw new Error("Lightning invoice needs to contain an amount!");
            }
        }
    }

    private parseSmartchainAddress(resultText: string): {
        address: string,
        type: ChainIds<T>,
        swapType: SwapType.SPV_VAULT_FROM_BTC,
        min?: TokenAmount,
        max?: TokenAmount
    } {
        for(let chainId of this.root.getSmartChains()) {
            if(this.root.chains[chainId].chainInterface.isValidAddress(resultText)) {
                if(this.root.supportsSwapType(chainId, SwapType.SPV_VAULT_FROM_BTC)) {
                    return {
                        address: resultText,
                        type: chainId,
                        swapType: SwapType.SPV_VAULT_FROM_BTC
                    }
                } else {
                    return {
                        address: resultText,
                        type: chainId,
                        swapType: null
                    }
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
    async parseAddress(addressString: string): Promise<{
        address: string,
        type: "BITCOIN" | "LIGHTNING" | "LNURL" | ChainIds<T>,
        swapType: SwapType.TO_BTC | SwapType.TO_BTCLN | SwapType.SPV_VAULT_FROM_BTC | SwapType.FROM_BTCLN | null,
        lnurl?: LNURLPay | LNURLWithdraw,
        min?: TokenAmount,
        max?: TokenAmount,
        amount?: TokenAmount
    }> {
        if(addressString.startsWith("bitcoin:")) {
            const parsedBitcoinAddress = this.parseBitcoinAddress(addressString.substring(8));
            if(parsedBitcoinAddress!=null) return parsedBitcoinAddress;
            throw new Error("Invalid bitcoin address!");
        }

        const parsedBitcoinAddress = this.parseBitcoinAddress(addressString);
        if(parsedBitcoinAddress!=null) return parsedBitcoinAddress;

        if(addressString.startsWith("lightning:")) {
            const resultText = addressString.substring(10);
            const resultLnurl = await this.parseLNURL(resultText);
            if(resultLnurl!=null) return resultLnurl;

            const resultLightningInvoice = this.parseLightningInvoice(resultText);
            if(resultLightningInvoice!=null) return resultLightningInvoice;

            throw new Error("Invalid lightning network invoice or LNURL!");
        }

        const resultLnurl = await this.parseLNURL(addressString);
        if(resultLnurl!=null) return resultLnurl;

        const resultLightningInvoice = this.parseLightningInvoice(addressString);
        if(resultLightningInvoice!=null) return resultLightningInvoice;

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
    parseAddressSync(addressString: string): {
        address: string,
        type: "BITCOIN" | "LIGHTNING" | "LNURL" | ChainIds<T>,
        swapType: SwapType.TO_BTC | SwapType.TO_BTCLN | SwapType.SPV_VAULT_FROM_BTC | null,
        min?: TokenAmount,
        max?: TokenAmount,
        amount?: TokenAmount
    } {
        if(addressString.startsWith("bitcoin:")) {
            const parsedBitcoinAddress = this.parseBitcoinAddress(addressString.substring(8));
            if(parsedBitcoinAddress!=null) return parsedBitcoinAddress;
            throw new Error("Invalid bitcoin address!");
        }

        const parsedBitcoinAddress = this.parseBitcoinAddress(addressString);
        if(parsedBitcoinAddress!=null) return parsedBitcoinAddress;

        if(addressString.startsWith("lightning:")) {
            const resultText = addressString.substring(10);
            const resultLnurl = this.parseLNURLSync(resultText);
            if(resultLnurl!=null) return resultLnurl;

            const resultLightningInvoice = this.parseLightningInvoice(resultText);
            if(resultLightningInvoice!=null) return resultLightningInvoice;

            throw new Error("Invalid lightning network invoice or LNURL!");
        }

        const resultLnurl = this.parseLNURLSync(addressString);
        if(resultLnurl!=null) return resultLnurl;

        const resultLightningInvoice = this.parseLightningInvoice(addressString);
        if(resultLightningInvoice!=null) return resultLightningInvoice;

        return this.parseSmartchainAddress(addressString);
    }

    /**
     * Returns a random PSBT that can be used for fee estimation, the last output (the LP output) is omitted
     *  to allow for coinselection algorithm to determine maximum sendable amount there
     *
     * @param chainIdentifier
     * @param includeGasToken   Whether to return the PSBT also with the gas token amount (increases the vSize by 8)
     */
    getRandomSpvVaultPsbt<ChainIdentifier extends ChainIds<T>>(chainIdentifier: ChainIdentifier, includeGasToken?: boolean): Transaction {
        const wrapper = this.root.chains[chainIdentifier].wrappers[SwapType.SPV_VAULT_FROM_BTC];
        if(wrapper==null) throw new Error("Chain doesn't support spv vault swaps!");
        return wrapper.getDummySwapPsbt(includeGasToken);
    }

    /**
     * Returns the spendable balance of a bitcoin wallet
     *
     * @param wallet
     * @param targetChain
     * @param options Additional options
     */
    async getBitcoinSpendableBalance(
        wallet: string | IBitcoinWallet | MinimalBitcoinWalletInterface,
        targetChain?: ChainIds<T>,
        options?: {
            gasDrop?: boolean,
            feeRate?: number,
            minFeeRate?: number
        }
    ): Promise<{
        balance: TokenAmount,
        feeRate: number
    }> {
        let bitcoinWallet: IBitcoinWallet;
        if(typeof(wallet)==="string") {
            bitcoinWallet = new SingleAddressBitcoinWallet(this.root.bitcoinRpc, this.bitcoinNetwork, {address: wallet, publicKey: ""});
        } else {
            bitcoinWallet = toBitcoinWallet(wallet, this.root.bitcoinRpc, this.bitcoinNetwork);
        }

        let feeRate = options?.feeRate ?? await bitcoinWallet.getFeeRate();
        if(options?.minFeeRate!=null) feeRate = Math.max(feeRate, options.minFeeRate);

        let result: {balance: bigint, feeRate: number, totalFee: number};
        if(targetChain!=null && this.root.supportsSwapType(targetChain, SwapType.SPV_VAULT_FROM_BTC)) {
            result = await bitcoinWallet.getSpendableBalance(this.getRandomSpvVaultPsbt(targetChain, options?.gasDrop), feeRate);
        } else {
            result = await bitcoinWallet.getSpendableBalance(undefined, feeRate);
        }

        return {
            balance: result.balance==null ? null : toTokenAmount(result.balance, BitcoinTokens.BTC, this.root.prices),
            feeRate: result.feeRate
        }
    }

    /**
     * Returns the maximum spendable balance of the wallet, deducting the fee needed to initiate a swap for native balances
     */
    async getSpendableBalance<ChainIdentifier extends ChainIds<T>>(wallet: string | T[ChainIdentifier]["Signer"] | T[ChainIdentifier]["NativeSigner"], token: SCToken<ChainIdentifier>, options?: {
        feeMultiplier?: number,
        feeRate?: any
    }): Promise<TokenAmount> {
        if(this.root.chains[token.chainId]==null) throw new Error("Invalid chain identifier! Unknown chain: "+token.chainId);
        const {swapContract, chainInterface} = this.root.chains[token.chainId];

        let signer: string;
        if(typeof(wallet)==="string") {
            signer = wallet;
        } else {
            const abstractSigner = isAbstractSigner(wallet) ? wallet : await chainInterface.wrapSigner(wallet);
            signer = abstractSigner.getAddress();
        }

        let finalBalance: bigint;
        if(chainInterface.getNativeCurrencyAddress()!==token.address) {
            finalBalance = await chainInterface.getBalance(signer, token.address);
        } else {
            let [balance, commitFee] = await Promise.all([
                chainInterface.getBalance(signer, token.address),
                swapContract.getCommitFee(
                    signer,
                    //Use large amount, such that the fee for wrapping more tokens is always included!
                    await swapContract.createSwapData(
                        ChainSwapType.HTLC, signer, null, token.address,
                        0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn,
                        swapContract.getHashForHtlc(randomBytes(32)).toString("hex"),
                        BigIntBufferUtils.fromBuffer(randomBytes(8)), BigInt(Math.floor(Date.now()/1000)),
                        true, false, BigIntBufferUtils.fromBuffer(randomBytes(2)), BigIntBufferUtils.fromBuffer(randomBytes(2))
                    ),
                    options?.feeRate
                )
            ]);

            if(options?.feeMultiplier!=null) {
                commitFee = commitFee * (BigInt(Math.floor(options.feeMultiplier*1000000))) / 1000000n;
            }

            finalBalance = bigIntMax(balance - commitFee, 0n);
        }

        return finalBalance==null ? null : toTokenAmount(finalBalance, token, this.root.prices);
    }

    /**
     * Returns the address of the native currency of the chain
     */
    getNativeToken<ChainIdentifier extends ChainIds<T>>(chainIdentifier: ChainIdentifier): SCToken<ChainIdentifier> {
        if(this.root.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        return this.root.tokens[chainIdentifier][this.root.chains[chainIdentifier].chainInterface.getNativeCurrencyAddress()] as SCToken<ChainIdentifier>;
    }

    /**
     * Returns a random signer for a given smart chain
     *
     * @param chainIdentifier
     */
    randomSigner<ChainIdentifier extends ChainIds<T>>(chainIdentifier: ChainIdentifier): T[ChainIdentifier]["Signer"] {
        if(this.root.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        return this.root.chains[chainIdentifier].chainInterface.randomSigner();
    }

    /**
     * Returns a random address for a given smart chain
     *
     * @param chainIdentifier
     */
    randomAddress<ChainIdentifier extends ChainIds<T>>(chainIdentifier: ChainIdentifier): string {
        if(this.root.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        return this.root.chains[chainIdentifier].chainInterface.randomAddress();
    }

}