import {LNURLPay, LNURLWithdraw} from "../../utils/LNURL";
import {IntermediaryDiscovery, SwapBounds} from "../../intermediaries/IntermediaryDiscovery";
import {SwapType} from "../enums/SwapType";
import {LnForGasSwap} from "../trusted/ln/LnForGasSwap";
import {ISwap} from "../ISwap";
import {IToBTCSwap} from "../escrow_swaps/tobtc/IToBTCSwap";
import {ChainIds, MultiChain, SupportsSwapType} from "./Swapper";
import {FromBTCLNSwap} from "../escrow_swaps/frombtc/ln/FromBTCLNSwap";
import {FromBTCSwap} from "../escrow_swaps/frombtc/onchain/FromBTCSwap";
import {ToBTCLNSwap} from "../escrow_swaps/tobtc/ln/ToBTCLNSwap";
import {ToBTCSwap} from "../escrow_swaps/tobtc/onchain/ToBTCSwap";
import {SwapPriceWithChain} from "../../prices/SwapPriceWithChain";
import {MempoolApi} from "../../btc/mempool/MempoolApi";
import {MempoolBitcoinRpc} from "../../btc/mempool/MempoolBitcoinRpc";
import {BtcToken, SCToken, Token, TokenAmount} from "../../Tokens";
import {BTC_NETWORK} from "@scure/btc-signer/utils";
import {ToBTCOptions} from "../escrow_swaps/tobtc/onchain/ToBTCWrapper";
import {ToBTCLNOptions} from "../escrow_swaps/tobtc/ln/ToBTCLNWrapper";
import {FromBTCOptions} from "../escrow_swaps/frombtc/onchain/FromBTCWrapper";
import {FromBTCLNOptions} from "../escrow_swaps/frombtc/ln/FromBTCLNWrapper";
import {SwapperUtils} from "./utils/SwapperUtils";
import {SpvFromBTCSwap} from "../spv_swaps/SpvFromBTCSwap";
import {SwapperWithChain} from "./SwapperWithChain";
import {SwapWithSigner, wrapSwapWithSigner} from "./SwapWithSigner";
import {OnchainForGasSwap} from "../trusted/onchain/OnchainForGasSwap";
import {FromBTCLNAutoSwap} from "../escrow_swaps/frombtc/ln_auto/FromBTCLNAutoSwap";
import {FromBTCLNAutoOptions} from "../escrow_swaps/frombtc/ln_auto/FromBTCLNAutoWrapper";

export class SwapperWithSigner<T extends MultiChain, ChainIdentifier extends ChainIds<T>> {

    readonly chainIdentifier: ChainIdentifier;
    readonly swapper: SwapperWithChain<T, ChainIdentifier>;
    readonly signer: T[ChainIdentifier]["Signer"];

    get prices(): SwapPriceWithChain<T, ChainIdentifier> {
        return this.swapper.prices;
    }
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

    constructor(swapper: SwapperWithChain<T, ChainIdentifier>, signer: T[ChainIdentifier]["Signer"]) {
        this.swapper = swapper;
        this.signer = signer;
    }

    createToBTCSwap(
        tokenAddress: string,
        address: string,
        amount: bigint,
        exactIn?: boolean,
        additionalParams?: Record<string, any>,
        options?: ToBTCOptions
    ): Promise<SwapWithSigner<ToBTCSwap<T[ChainIdentifier]>>> {
        return this.swapper.createToBTCSwap(this.signer.getAddress(), tokenAddress, address, amount, exactIn, additionalParams, options)
            .then(swap => wrapSwapWithSigner(swap, this.signer));
    }

    createToBTCLNSwap(
        tokenAddress: string,
        paymentRequest: string,
        additionalParams?: Record<string, any>,
        options?: ToBTCLNOptions & {comment?: string}
    ): Promise<SwapWithSigner<ToBTCLNSwap<T[ChainIdentifier]>>> {
        return this.swapper.createToBTCLNSwap(this.signer.getAddress(), tokenAddress, paymentRequest, additionalParams, options)
            .then(swap => wrapSwapWithSigner(swap, this.signer));
    }

    createToBTCLNSwapViaLNURL(
        tokenAddress: string,
        lnurlPay: string | LNURLPay,
        amount: bigint,
        exactIn?: boolean,
        additionalParams?: Record<string, any>,
        options?: ToBTCLNOptions
    ): Promise<SwapWithSigner<ToBTCLNSwap<T[ChainIdentifier]>>> {
        return this.swapper.createToBTCLNSwapViaLNURL(this.signer.getAddress(), tokenAddress, lnurlPay, amount, exactIn, additionalParams, options)
            .then(swap => wrapSwapWithSigner(swap, this.signer));
    }

    createFromBTCSwap(
        tokenAddress: string,
        amount: bigint,
        exactOut?: boolean,
        additionalParams?: Record<string, any>,
        options?: FromBTCOptions
    ): Promise<SwapWithSigner<FromBTCSwap<T[ChainIdentifier]>>> {
        return this.swapper.createFromBTCSwap(this.signer.getAddress(), tokenAddress, amount, exactOut, additionalParams, options)
            .then(swap => wrapSwapWithSigner(swap, this.signer));
    }

    createFromBTCLNSwap(
        tokenAddress: string,
        amount: bigint,
        exactOut?: boolean,
        additionalParams?: Record<string, any>,
        options?: FromBTCLNOptions
    ): Promise<SwapWithSigner<FromBTCLNSwap<T[ChainIdentifier]>>> {
        return this.swapper.createFromBTCLNSwap(this.signer.getAddress(), tokenAddress, amount, exactOut, additionalParams, options)
            .then(swap => wrapSwapWithSigner(swap, this.signer));
    }

    createFromBTCLNSwapViaLNURL(
        tokenAddress: string,
        lnurl: string | LNURLWithdraw,
        amount: bigint,
        exactOut?: boolean,
        additionalParams?: Record<string, any>
    ): Promise<SwapWithSigner<FromBTCLNSwap<T[ChainIdentifier]>>> {
        return this.swapper.createFromBTCLNSwapViaLNURL(this.signer.getAddress(), tokenAddress, lnurl, amount, exactOut, additionalParams)
            .then(swap => wrapSwapWithSigner(swap, this.signer));
    }

    createFromBTCLNSwapNew(
        tokenAddress: string,
        amount: bigint,
        exactOut?: boolean,
        additionalParams?: Record<string, any>,
        options?: FromBTCLNAutoOptions
    ): Promise<SwapWithSigner<FromBTCLNAutoSwap<T[ChainIdentifier]>>> {
        return this.swapper.createFromBTCLNSwapNew(this.signer.getAddress(), tokenAddress, amount, exactOut, additionalParams, options)
            .then(swap => wrapSwapWithSigner(swap, this.signer));
    }

    createFromBTCLNSwapNewViaLNURL(
        tokenAddress: string,
        lnurl: string | LNURLWithdraw,
        amount: bigint,
        exactOut?: boolean,
        additionalParams?: Record<string, any>,
        options?: FromBTCLNAutoOptions
    ): Promise<SwapWithSigner<FromBTCLNAutoSwap<T[ChainIdentifier]>>> {
        return this.swapper.createFromBTCLNSwapNewViaLNURL(this.signer.getAddress(), tokenAddress, lnurl, amount, exactOut, additionalParams, options)
            .then(swap => wrapSwapWithSigner(swap, this.signer));
    }

    createTrustedLNForGasSwap(amount: bigint, trustedIntermediaryUrl?: string): Promise<LnForGasSwap<T[ChainIdentifier]>> {
        return this.swapper.createTrustedLNForGasSwap(this.signer.getAddress(), amount, trustedIntermediaryUrl);
    }

    createTrustedOnchainForGasSwap(amount: bigint, refundAddress?: string, trustedIntermediaryUrl?: string): Promise<OnchainForGasSwap<T[ChainIdentifier]>> {
        return this.swapper.createTrustedOnchainForGasSwap(this.signer.getAddress(), amount, refundAddress, trustedIntermediaryUrl);
    }

    create(srcToken: BtcToken<true>, dstToken: SCToken<ChainIdentifier>, amount: bigint, exactIn: boolean, lnurlWithdraw?: string | LNURLWithdraw): Promise<(SupportsSwapType<T[ChainIdentifier], SwapType.FROM_BTCLN_AUTO> extends true ? FromBTCLNAutoSwap<T[ChainIdentifier]> : FromBTCLNSwap<T[ChainIdentifier]>)>;
    create(srcToken: BtcToken<false>, dstToken: SCToken<ChainIdentifier>, amount: bigint, exactIn: boolean): Promise<(SupportsSwapType<T[ChainIdentifier], SwapType.SPV_VAULT_FROM_BTC> extends true ? SpvFromBTCSwap<T[ChainIdentifier]> : FromBTCSwap<T[ChainIdentifier]>)>;
    create(srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<false>, amount: bigint, exactIn: boolean, address: string): Promise<ToBTCSwap<T[ChainIdentifier]>>;
    create(srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<true>, amount: bigint, exactIn: boolean, lnurlPay: string | LNURLPay): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
    create(srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<true>, amount: bigint, exactIn: false, lightningInvoice: string | LNURLWithdraw | LNURLPay): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
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
    create(srcToken: Token<ChainIdentifier>, dstToken: Token<ChainIdentifier>, amount: bigint, exactIn: boolean, addressLnurlLightningInvoice?: string | LNURLWithdraw | LNURLPay): Promise<SwapWithSigner<ISwap<T[ChainIdentifier]>>> {
        return this.swapper.create(this.signer.getAddress(), srcToken as any, dstToken as any, amount, exactIn, addressLnurlLightningInvoice as any)
            .then(swap => wrapSwapWithSigner(swap, this.signer));
    }

    /**
     * Returns swaps that are in-progress and are claimable for the specific chain, optionally also for a specific signer's address
     */
    getAllSwaps(): Promise<ISwap<T[ChainIdentifier]>[]> {
        return this.swapper.getAllSwaps(this.signer.getAddress());
    }

    /**
     * Returns swaps that are in-progress and are claimable for the specific chain, optionally also for a specific signer's address
     */
    getActionableSwaps(): Promise<ISwap<T[ChainIdentifier]>[]> {
        return this.swapper.getActionableSwaps(this.signer.getAddress());
    }

    /**
     * Returns swaps that are refundable for the specific chain, optionally also for a specific signer's address
     */
    getRefundableSwaps(): Promise<IToBTCSwap<T[ChainIdentifier]>[]> {
        return this.swapper.getRefundableSwaps(this.signer.getAddress());
    }

    /**
     * Returns swap with a specific id (identifier) on a specific chain and optionally with a signer
     */
    getSwapById(id: string): Promise<ISwap<T[ChainIdentifier]>> {
        return this.swapper.getSwapById(id, this.signer.getAddress());
    }

    /**
     * Synchronizes swaps from chain, this is usually ran when SDK is initialized, deletes expired quotes
     */
    async _syncSwaps(): Promise<void> {
        return this.swapper._syncSwaps(this.signer.getAddress());
    }

    supportsSwapType<
        Type extends SwapType
    >(swapType: Type): SupportsSwapType<T[ChainIdentifier], Type> {
        return this.swapper.supportsSwapType(swapType);
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
        return this.swapper.getSwapLimits<A, B>(srcToken, dstToken);
    }

    /**
     * Returns tokens that you can swap to (if input=true) from a given token,
     *  or tokens that you can swap from (if input=false) to a given token
     */
    getSwapCounterTokens(token: Token, input: boolean): Token<ChainIdentifier>[] {
        return this.swapper.getSwapCounterTokens(token, input);
    }


    ///////////////////////////////////
    /// Deprecated

    /**
     * Returns swap bounds (minimums & maximums) for different swap types & tokens
     * @deprecated Use getSwapLimits() instead!
     */
    getSwapBounds(): SwapBounds {
        return this.swapper.getSwapBounds();
    }

    /**
     * Returns maximum possible swap amount
     * @deprecated Use getSwapLimits() instead!
     *
     * @param type      Type of the swap
     * @param token     Token of the swap
     */
    getMaximum(type: SwapType, token: string): bigint {
        return this.swapper.getMaximum(type, token);
    }

    /**
     * Returns minimum possible swap amount
     * @deprecated Use getSwapLimits() instead!
     *
     * @param type      Type of swap
     * @param token     Token of the swap
     */
    getMinimum(type: SwapType, token: string): bigint {
        return this.swapper.getMinimum(type, token);
    }

}
