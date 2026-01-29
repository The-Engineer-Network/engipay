import {LNURLPay, LNURLWithdraw} from "../../utils/LNURL";
import {IntermediaryDiscovery, SwapBounds} from "../../intermediaries/IntermediaryDiscovery";
import {SwapType} from "../enums/SwapType";
import {LnForGasSwap} from "../trusted/ln/LnForGasSwap";
import {ISwap} from "../ISwap";
import {IToBTCSwap} from "../escrow_swaps/tobtc/IToBTCSwap";
import {ChainIds, MultiChain, SupportsSwapType, Swapper} from "./Swapper";
import {FromBTCLNSwap} from "../escrow_swaps/frombtc/ln/FromBTCLNSwap";
import {FromBTCSwap} from "../escrow_swaps/frombtc/onchain/FromBTCSwap";
import {ToBTCLNSwap} from "../escrow_swaps/tobtc/ln/ToBTCLNSwap";
import {ToBTCSwap} from "../escrow_swaps/tobtc/onchain/ToBTCSwap";
import {SwapPriceWithChain} from "../../prices/SwapPriceWithChain";
import {MempoolApi} from "../../btc/mempool/MempoolApi";
import {MempoolBitcoinRpc} from "../../btc/mempool/MempoolBitcoinRpc";
import {BitcoinTokens, BtcToken, isSCToken, SCToken, Token, TokenAmount} from "../../Tokens";
import {BTC_NETWORK} from "@scure/btc-signer/utils";
import {ToBTCOptions} from "../escrow_swaps/tobtc/onchain/ToBTCWrapper";
import {InvoiceCreateService, ToBTCLNOptions} from "../escrow_swaps/tobtc/ln/ToBTCLNWrapper";
import {FromBTCOptions} from "../escrow_swaps/frombtc/onchain/FromBTCWrapper";
import {FromBTCLNOptions} from "../escrow_swaps/frombtc/ln/FromBTCLNWrapper";
import {SwapperUtils} from "./utils/SwapperUtils";
import {SpvFromBTCOptions} from "../spv_swaps/SpvFromBTCWrapper";
import {SpvFromBTCSwap} from "../spv_swaps/SpvFromBTCSwap";
import {OnchainForGasSwap} from "../trusted/onchain/OnchainForGasSwap";
import {SwapperWithSigner} from "./SwapperWithSigner";
import {FromBTCLNAutoOptions} from "../escrow_swaps/frombtc/ln_auto/FromBTCLNAutoWrapper";
import {FromBTCLNAutoSwap} from "../escrow_swaps/frombtc/ln_auto/FromBTCLNAutoSwap";
import {SwapAmountType} from "../enums/SwapAmountType";
import {UserError} from "../../errors/UserError";
import {IClaimableSwap} from "../IClaimableSwap";

export class SwapperWithChain<T extends MultiChain, ChainIdentifier extends ChainIds<T>> {

    readonly chainIdentifier: ChainIdentifier;
    readonly swapper: Swapper<T>;

    readonly prices: SwapPriceWithChain<T, ChainIdentifier>;

    get intermediaryDiscovery(): IntermediaryDiscovery {
        return this.swapper.intermediaryDiscovery;
    }
    get mempoolApi(): MempoolApi {
        return this.swapper.mempoolApi;
    }
    get bitcoinRpc(): MempoolBitcoinRpc {
        return this.swapper.bitcoinRpc;
    }
    get bitcoinNetwork(): BTC_NETWORK {
        return this.swapper.bitcoinNetwork;
    }
    get Utils(): SwapperUtils<T> {
        return this.swapper.Utils;
    }
    get SwapTypeInfo() {
        return this.swapper.SwapTypeInfo;
    }

    constructor(swapper: Swapper<T>, chainIdentifier: ChainIdentifier) {
        this.swapper = swapper;
        this.chainIdentifier = chainIdentifier;
        this.prices = new SwapPriceWithChain<T, ChainIdentifier>(swapper.prices, chainIdentifier);
    }

    createToBTCSwap(
        signer: string,
        tokenAddress: string,
        address: string,
        amount: bigint,
        exactIn?: boolean,
        additionalParams?: Record<string, any>,
        options?: ToBTCOptions
    ): Promise<ToBTCSwap<T[ChainIdentifier]>> {
        return this.swapper.createToBTCSwap(this.chainIdentifier, signer, tokenAddress, address, amount, exactIn, additionalParams, options);
    }

    createToBTCLNSwap(
        signer: string,
        tokenAddress: string,
        paymentRequest: string,
        additionalParams?: Record<string, any>,
        options?: ToBTCLNOptions & {comment?: string}
    ): Promise<ToBTCLNSwap<T[ChainIdentifier]>> {
        return this.swapper.createToBTCLNSwap(this.chainIdentifier, signer, tokenAddress, paymentRequest, additionalParams, options);
    }

    createToBTCLNSwapViaLNURL(
        signer: string,
        tokenAddress: string,
        lnurlPay: string | LNURLPay,
        amount: bigint,
        exactIn?: boolean,
        additionalParams?: Record<string, any>,
        options?: ToBTCLNOptions
    ): Promise<ToBTCLNSwap<T[ChainIdentifier]>> {
        return this.swapper.createToBTCLNSwapViaLNURL(this.chainIdentifier, signer, tokenAddress, lnurlPay, amount, exactIn, additionalParams, options);
    }

    createToBTCLNSwapViaInvoiceCreateService(
        signer: string,
        tokenAddress: string,
        service: InvoiceCreateService,
        amount: bigint,
        exactIn?: boolean,
        additionalParams?: Record<string, any>,
        options?: ToBTCLNOptions
    ): Promise<ToBTCLNSwap<T[ChainIdentifier]>> {
        return this.swapper.createToBTCLNSwapViaInvoiceCreateService(this.chainIdentifier, signer, tokenAddress, service, amount, exactIn, additionalParams, options);
    }

    createFromBTCSwap(
        signer: string,
        tokenAddress: string,
        amount: bigint,
        exactOut?: boolean,
        additionalParams?: Record<string, any>,
        options?: FromBTCOptions
    ): Promise<FromBTCSwap<T[ChainIdentifier]>> {
        return this.swapper.createFromBTCSwap(this.chainIdentifier, signer, tokenAddress, amount, exactOut, additionalParams, options);
    }

    createFromBTCLNSwap(
        signer: string,
        tokenAddress: string,
        amount: bigint,
        exactOut?: boolean,
        additionalParams?: Record<string, any>,
        options?: FromBTCLNOptions
    ): Promise<FromBTCLNSwap<T[ChainIdentifier]>> {
        return this.swapper.createFromBTCLNSwap(this.chainIdentifier, signer, tokenAddress, amount, exactOut, additionalParams, options);
    }

    createFromBTCLNSwapViaLNURL(
        signer: string,
        tokenAddress: string,
        lnurl: string | LNURLWithdraw,
        amount: bigint,
        exactOut?: boolean,
        additionalParams?: Record<string, any>
    ): Promise<FromBTCLNSwap<T[ChainIdentifier]>> {
        return this.swapper.createFromBTCLNSwapViaLNURL(this.chainIdentifier, signer, tokenAddress, lnurl, amount, exactOut, additionalParams);
    }

    createFromBTCLNSwapNew(
        signer: string,
        tokenAddress: string,
        amount: bigint,
        exactOut?: boolean,
        additionalParams?: Record<string, any>,
        options?: FromBTCLNAutoOptions
    ): Promise<FromBTCLNAutoSwap<T[ChainIdentifier]>> {
        return this.swapper.createFromBTCLNSwapNew(this.chainIdentifier, signer, tokenAddress, amount, exactOut, additionalParams, options);
    }

    createFromBTCLNSwapNewViaLNURL(
        signer: string,
        tokenAddress: string,
        lnurl: string | LNURLWithdraw,
        amount: bigint,
        exactOut?: boolean,
        additionalParams?: Record<string, any>,
        options?: FromBTCLNAutoOptions
    ): Promise<FromBTCLNAutoSwap<T[ChainIdentifier]>> {
        return this.swapper.createFromBTCLNSwapNewViaLNURL(this.chainIdentifier, signer, tokenAddress, lnurl, amount, exactOut, additionalParams, options);
    }

    createTrustedLNForGasSwap(signer: string, amount: bigint, trustedIntermediaryUrl?: string): Promise<LnForGasSwap<T[ChainIdentifier]>> {
        return this.swapper.createTrustedLNForGasSwap(this.chainIdentifier, signer, amount, trustedIntermediaryUrl);
    }

    createTrustedOnchainForGasSwap(signer: string, amount: bigint, refundAddress?: string, trustedIntermediaryUrl?: string): Promise<OnchainForGasSwap<T[ChainIdentifier]>> {
        return this.swapper.createTrustedOnchainForGasSwap(this.chainIdentifier, signer, amount, refundAddress, trustedIntermediaryUrl);
    }

    create(signer: string, srcToken: BtcToken<true>, dstToken: SCToken<ChainIdentifier>, amount: bigint, exactIn: boolean, lnurlWithdraw?: string | LNURLWithdraw): Promise<SupportsSwapType<T[ChainIdentifier], SwapType.FROM_BTCLN_AUTO> extends true ? FromBTCLNAutoSwap<T[ChainIdentifier]> : FromBTCLNSwap<T[ChainIdentifier]>>;
    create(signer: string, srcToken: BtcToken<false>, dstToken: SCToken<ChainIdentifier>, amount: bigint, exactIn: boolean): Promise<(SupportsSwapType<T[ChainIdentifier], SwapType.SPV_VAULT_FROM_BTC> extends true ? SpvFromBTCSwap<T[ChainIdentifier]> : FromBTCSwap<T[ChainIdentifier]>)>;
    create(signer: string, srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<false>, amount: bigint, exactIn: boolean, address: string): Promise<ToBTCSwap<T[ChainIdentifier]>>;
    create(signer: string, srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<true>, amount: bigint, exactIn: boolean, lnurlPay: string | LNURLPay): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
    create(signer: string, srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<true>, amount: bigint, exactIn: false, lightningInvoice: string | LNURLWithdraw | LNURLPay): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
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
    create(signer: string, srcToken: Token<ChainIdentifier>, dstToken: Token<ChainIdentifier>, amount: bigint, exactIn: boolean, addressLnurlLightningInvoice?: string | LNURLWithdraw | LNURLPay): Promise<ISwap<T[ChainIdentifier]>> {
        return this.swapper.create(signer, srcToken, dstToken, amount, exactIn, addressLnurlLightningInvoice);
    }

    swap(srcToken: BtcToken<true>, dstToken: SCToken<ChainIdentifier>, amount: bigint | string, exactIn: boolean | SwapAmountType, src: undefined | string | LNURLWithdraw, dstSmartchainWallet: string, options?: (SupportsSwapType<T[ChainIdentifier], SwapType.FROM_BTCLN_AUTO> extends true ? FromBTCLNAutoOptions : FromBTCLNOptions)): Promise<SupportsSwapType<T[ChainIdentifier], SwapType.FROM_BTCLN_AUTO> extends true ? FromBTCLNAutoSwap<T[ChainIdentifier]> : FromBTCLNSwap<T[ChainIdentifier]>>;
    swap(srcToken: BtcToken<false>, dstToken: SCToken<ChainIdentifier>, amount: bigint | string, exactIn: boolean | SwapAmountType, src: undefined | string, dstSmartchainWallet: string, options?: (SupportsSwapType<T[ChainIdentifier], SwapType.SPV_VAULT_FROM_BTC> extends true ? SpvFromBTCOptions : FromBTCOptions)): Promise<(SupportsSwapType<T[ChainIdentifier], SwapType.SPV_VAULT_FROM_BTC> extends true ? SpvFromBTCSwap<T[ChainIdentifier]> : FromBTCSwap<T[ChainIdentifier]>)>;
    swap(srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<false>, amount: bigint | string, exactIn: boolean | SwapAmountType, src: string, dstAddress: string, options?: ToBTCOptions): Promise<ToBTCSwap<T[ChainIdentifier]>>;
    swap(srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<true>, amount: bigint | string, exactIn: boolean | SwapAmountType, src: string, dstLnurlPayOrInvoiceCreateService: string | LNURLPay | InvoiceCreateService, options?: ToBTCLNOptions & {comment?: string}): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
    swap(srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<true>, amount: bigint | string, exactIn: false | SwapAmountType.EXACT_OUT, src: string, dstLightningInvoice: string, options?: ToBTCLNOptions): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
    swap(srcToken: Token<ChainIdentifier> | string, dstToken: Token<ChainIdentifier> | string, amount: bigint | string, exactIn: boolean | SwapAmountType, src: undefined | string | LNURLWithdraw, dst: string | LNURLPay | InvoiceCreateService, options?: FromBTCLNOptions | SpvFromBTCOptions | FromBTCOptions | ToBTCOptions | (ToBTCLNOptions & {comment?: string}) | FromBTCLNAutoOptions): Promise<ISwap<T[ChainIdentifier]>>;
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
    swap(
        srcToken: Token<ChainIdentifier> | string,
        dstToken: Token<ChainIdentifier> | string,
        amount: bigint | string,
        exactIn: boolean | SwapAmountType,
        src: undefined | string | LNURLWithdraw,
        dst: string |  LNURLPay | InvoiceCreateService,
        options?: FromBTCLNOptions | SpvFromBTCOptions | FromBTCOptions | ToBTCOptions | ToBTCLNOptions | FromBTCLNAutoOptions
    ): Promise<ISwap<T[ChainIdentifier]>> {
        if(typeof(srcToken)==="string") srcToken = this.getToken(srcToken);
        if(typeof(dstToken)==="string") dstToken = this.getToken(dstToken);
        return this.swapper.swap(srcToken, dstToken, amount, exactIn, src, dst, options);
    }

    /**
     * Returns swaps that are in-progress and are claimable for the specific chain, optionally also for a specific signer's address
     */
    getAllSwaps(signer?: string): Promise<ISwap<T[ChainIdentifier]>[]> {
        return this.swapper.getAllSwaps(this.chainIdentifier, signer);
    }

    /**
     * Returns swaps that are in-progress and are claimable for the specific chain, optionally also for a specific signer's address
     */
    getActionableSwaps(signer?: string): Promise<ISwap<T[ChainIdentifier]>[]> {
        return this.swapper.getActionableSwaps(this.chainIdentifier, signer);
    }

    /**
     * Returns swaps that are refundable for the specific chain, optionally also for a specific signer's address
     */
    getRefundableSwaps(signer?: string): Promise<IToBTCSwap<T[ChainIdentifier]>[]> {
        return this.swapper.getRefundableSwaps(this.chainIdentifier, signer);
    }

    /**
     * Returns swaps that are due to be claimed/settled manually for the specific chain,
     *  optionally also for a specific signer's address
     */
    getClaimableSwaps(signer?: string): Promise<IClaimableSwap<T[ChainIdentifier]>[]> {
        return this.swapper.getClaimableSwaps(this.chainIdentifier, signer);
    }

    /**
     * Returns swap with a specific id (identifier) on a specific chain and optionally with a signer
     */
    getSwapById(id: string, signer?: string): Promise<ISwap<T[ChainIdentifier]>> {
        return this.swapper.getSwapById(id, this.chainIdentifier, signer);
    }

    getToken(tickerOrAddress: string): Token<ChainIdentifier> {
        //Btc tokens - BTC, BTCLN, BTC-LN
        if(tickerOrAddress==="BTC") return BitcoinTokens.BTC;
        if(tickerOrAddress==="BTCLN" || tickerOrAddress==="BTC-LN") return BitcoinTokens.BTCLN;

        //Check if the ticker is in format <chainId>-<ticker>, i.e. SOLANA-USDC, STARKNET-WBTC
        if(tickerOrAddress.includes("-")) {
            const [chainId, ticker] = tickerOrAddress.split("-");
            if(chainId!==this.chainIdentifier) throw new UserError(`Invalid chainId specified in ticker: ${chainId}, swapper chainId: ${this.chainIdentifier}`);
            const token = this.swapper.tokensByTicker[this.chainIdentifier]?.[ticker];
            if(token==null) throw new UserError(`Not found ticker: ${ticker} for chainId: ${chainId}`);
            return token as Token<ChainIdentifier>;
        }

        const chain = this.swapper.chains[this.chainIdentifier];
        if(chain.chainInterface.isValidToken(tickerOrAddress)) {
            //Try to find in known token addresses
            const token = this.swapper.tokens[this.chainIdentifier]?.[tickerOrAddress];
            if(token!=null) return token as Token<ChainIdentifier>;
        } else {
            //Check in known tickers
            const token = this.swapper.tokensByTicker[this.chainIdentifier]?.[tickerOrAddress];
            if(token!=null) return token as Token<ChainIdentifier>;
        }

        throw new UserError(`Specified token address or ticker ${tickerOrAddress} not found for chainId: ${this.chainIdentifier}!`)
    }

    /**
     * Synchronizes swaps from chain, this is usually ran when SDK is initialized, deletes expired quotes
     */
    async _syncSwaps(signer?: string): Promise<void> {
        return this.swapper._syncSwaps<ChainIdentifier>(this.chainIdentifier, signer);
    }

    supportsSwapType<
        Type extends SwapType
    >(swapType: Type): SupportsSwapType<T[ChainIdentifier], Type> {
        return this.swapper.supportsSwapType(this.chainIdentifier, swapType);
    }

    /**
     * Returns type of the swap based on input and output tokens specified
     *
     * @param srcToken
     * @param dstToken
     */
    getSwapType(srcToken: BtcToken<true>, dstToken: SCToken<ChainIdentifier>): (SupportsSwapType<T[ChainIdentifier], SwapType.FROM_BTCLN_AUTO> extends true ? SwapType.FROM_BTCLN_AUTO : SwapType.FROM_BTCLN);
    getSwapType(srcToken: BtcToken<false>, dstToken: SCToken<ChainIdentifier>): (SupportsSwapType<T[ChainIdentifier], SwapType.SPV_VAULT_FROM_BTC> extends true ? SwapType.SPV_VAULT_FROM_BTC : SwapType.FROM_BTC);
    getSwapType(srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<false>): SwapType.TO_BTC;
    getSwapType(srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<true>): SwapType.TO_BTCLN;
    getSwapType(srcToken: Token<ChainIdentifier>, dstToken: Token<ChainIdentifier>): SwapType.FROM_BTCLN_AUTO | SwapType.FROM_BTCLN | SwapType.SPV_VAULT_FROM_BTC | SwapType.FROM_BTC | SwapType.TO_BTC | SwapType.TO_BTCLN;
    getSwapType(srcToken: Token<ChainIdentifier>, dstToken: Token<ChainIdentifier>): SwapType.FROM_BTCLN_AUTO | SwapType.FROM_BTCLN | SwapType.SPV_VAULT_FROM_BTC | SwapType.FROM_BTC | SwapType.TO_BTC | SwapType.TO_BTCLN {
        return this.swapper.getSwapType(srcToken, dstToken);
    }

    /**
     * Returns minimum/maximum limits for inputs and outputs for a swap between given tokens
     *
     * @param srcToken
     * @param dstToken
     */
    getSwapLimits<A extends Token<ChainIdentifier>, B extends Token<ChainIdentifier>>(srcToken: A, dstToken: B): {
        input: {min: TokenAmount<string, A>, max: TokenAmount<string, A>},
        output: {min: TokenAmount<string, B>, max: TokenAmount<string, B>}
    } {
        return this.swapper.getSwapLimits<ChainIdentifier, A, B>(srcToken, dstToken);
    }

    /**
     * Returns a set of supported tokens by all the intermediaries offering a specific swap service
     *
     * @param _swapType Swap service type to check supported tokens for
     */
    private getSupportedTokens(_swapType: SwapType): SCToken<ChainIdentifier>[] {
        const tokens: SCToken<ChainIdentifier>[] = [];
        this.intermediaryDiscovery.intermediaries.forEach(lp => {
            let swapType = _swapType;
            if(swapType===SwapType.FROM_BTCLN && this.supportsSwapType(SwapType.FROM_BTCLN_AUTO)) swapType = SwapType.FROM_BTCLN_AUTO;
            if(swapType===SwapType.FROM_BTC && this.supportsSwapType(SwapType.SPV_VAULT_FROM_BTC)) swapType = SwapType.SPV_VAULT_FROM_BTC;
            if(lp.services[swapType]==null) return;
            if(lp.services[swapType].chainTokens==null) return;
            for(let tokenAddress of lp.services[swapType].chainTokens[this.chainIdentifier]) {
                const token = this.swapper.tokens?.[this.chainIdentifier]?.[tokenAddress];
                if(token!=null) tokens.push(token as SCToken<ChainIdentifier>);
            }
        });
        return tokens;
    }

    /**
     * Returns the set of supported tokens by all the intermediaries we know of offering a specific swapType service
     *
     * @param swapType Specific swap type for which to obtain supported tokens
     */
    private getSupportedTokenAddresses(swapType: SwapType): Set<string> {
        const set = new Set<string>();
        this.intermediaryDiscovery.intermediaries.forEach(lp => {
            if(lp.services[swapType]==null) return;
            if(lp.services[swapType].chainTokens==null || lp.services[swapType].chainTokens[this.chainIdentifier]==null) return;
            lp.services[swapType].chainTokens[this.chainIdentifier].forEach(token => set.add(token));
        });
        return set;
    }

    /**
     * Returns tokens that you can swap to (if input=true) from a given token,
     *  or tokens that you can swap from (if input=false) to a given token
     */
    getSwapCounterTokens(token: Token, input: boolean): Token<ChainIdentifier>[] {
        if(isSCToken(token)) {
            const result: Token<ChainIdentifier>[] = [];
            if(input) {
                //TO_BTC or TO_BTCLN
                if(this.getSupportedTokenAddresses(SwapType.TO_BTCLN).has(token.address)) {
                    result.push(BitcoinTokens.BTCLN);
                }
                if(this.getSupportedTokenAddresses(SwapType.TO_BTC).has(token.address)) {
                    result.push(BitcoinTokens.BTC);
                }
            } else {
                //FROM_BTC or FROM_BTCLN
                const fromLightningSwapType = this.supportsSwapType(SwapType.FROM_BTCLN_AUTO) ? SwapType.FROM_BTCLN_AUTO : SwapType.FROM_BTCLN;
                if(this.getSupportedTokenAddresses(fromLightningSwapType).has(token.address)) {
                    result.push(BitcoinTokens.BTCLN);
                }
                const fromOnchainSwapType = this.supportsSwapType(SwapType.SPV_VAULT_FROM_BTC) ? SwapType.SPV_VAULT_FROM_BTC : SwapType.FROM_BTC;
                if(this.getSupportedTokenAddresses(fromOnchainSwapType).has(token.address)) {
                    result.push(BitcoinTokens.BTC);
                }
            }
            return result;
        } else {
            if(input) {
                if(token.lightning) {
                    return this.getSupportedTokens(SwapType.FROM_BTCLN);
                } else {
                    return this.getSupportedTokens(SwapType.FROM_BTC);
                }
            } else {
                if(token.lightning) {
                    return this.getSupportedTokens(SwapType.TO_BTCLN);
                } else {
                    return this.getSupportedTokens(SwapType.TO_BTC);
                }
            }
        }
    }

    /**
     * Creates a child swapper instance with a signer
     *
     * @param signer Signer to use for the new swapper instance
     */
    withChain(signer: T[ChainIdentifier]["Signer"]): SwapperWithSigner<T, ChainIdentifier> {
        return new SwapperWithSigner<T, ChainIdentifier>(this, signer);
    }


    ///////////////////////////////////
    /// Deprecated

    /**
     * Returns swap bounds (minimums & maximums) for different swap types & tokens
     * @deprecated Use getSwapLimits() instead!
     */
    getSwapBounds(): SwapBounds {
        return this.swapper.getSwapBounds(this.chainIdentifier);
    }

    /**
     * Returns maximum possible swap amount
     * @deprecated Use getSwapLimits() instead!
     *
     * @param type      Type of the swap
     * @param token     Token of the swap
     */
    getMaximum(type: SwapType, token: string): bigint {
        return this.swapper.getMaximum(this.chainIdentifier, type, token);
    }

    /**
     * Returns minimum possible swap amount
     * @deprecated Use getSwapLimits() instead!
     *
     * @param type      Type of swap
     * @param token     Token of the swap
     */
    getMinimum(type: SwapType, token: string): bigint {
        return this.swapper.getMinimum(this.chainIdentifier, type, token);
    }

}
