import { LNURLPay, LNURLWithdraw } from "../../utils/LNURL";
import { IntermediaryDiscovery, SwapBounds } from "../../intermediaries/IntermediaryDiscovery";
import { SwapType } from "../enums/SwapType";
import { LnForGasSwap } from "../trusted/ln/LnForGasSwap";
import { ISwap } from "../ISwap";
import { IToBTCSwap } from "../escrow_swaps/tobtc/IToBTCSwap";
import { ChainIds, MultiChain, SupportsSwapType, Swapper } from "./Swapper";
import { FromBTCLNSwap } from "../escrow_swaps/frombtc/ln/FromBTCLNSwap";
import { FromBTCSwap } from "../escrow_swaps/frombtc/onchain/FromBTCSwap";
import { ToBTCLNSwap } from "../escrow_swaps/tobtc/ln/ToBTCLNSwap";
import { ToBTCSwap } from "../escrow_swaps/tobtc/onchain/ToBTCSwap";
import { SwapPriceWithChain } from "../../prices/SwapPriceWithChain";
import { MempoolApi } from "../../btc/mempool/MempoolApi";
import { MempoolBitcoinRpc } from "../../btc/mempool/MempoolBitcoinRpc";
import { BtcToken, SCToken, Token, TokenAmount } from "../../Tokens";
import { BTC_NETWORK } from "@scure/btc-signer/utils";
import { ToBTCOptions } from "../escrow_swaps/tobtc/onchain/ToBTCWrapper";
import { InvoiceCreateService, ToBTCLNOptions } from "../escrow_swaps/tobtc/ln/ToBTCLNWrapper";
import { FromBTCOptions } from "../escrow_swaps/frombtc/onchain/FromBTCWrapper";
import { FromBTCLNOptions } from "../escrow_swaps/frombtc/ln/FromBTCLNWrapper";
import { SwapperUtils } from "./utils/SwapperUtils";
import { SpvFromBTCOptions } from "../spv_swaps/SpvFromBTCWrapper";
import { SpvFromBTCSwap } from "../spv_swaps/SpvFromBTCSwap";
import { OnchainForGasSwap } from "../trusted/onchain/OnchainForGasSwap";
import { SwapperWithSigner } from "./SwapperWithSigner";
import { FromBTCLNAutoOptions } from "../escrow_swaps/frombtc/ln_auto/FromBTCLNAutoWrapper";
import { FromBTCLNAutoSwap } from "../escrow_swaps/frombtc/ln_auto/FromBTCLNAutoSwap";
import { SwapAmountType } from "../enums/SwapAmountType";
import { IClaimableSwap } from "../IClaimableSwap";
export declare class SwapperWithChain<T extends MultiChain, ChainIdentifier extends ChainIds<T>> {
    readonly chainIdentifier: ChainIdentifier;
    readonly swapper: Swapper<T>;
    readonly prices: SwapPriceWithChain<T, ChainIdentifier>;
    get intermediaryDiscovery(): IntermediaryDiscovery;
    get mempoolApi(): MempoolApi;
    get bitcoinRpc(): MempoolBitcoinRpc;
    get bitcoinNetwork(): BTC_NETWORK;
    get Utils(): SwapperUtils<T>;
    get SwapTypeInfo(): {
        readonly 2: {
            readonly requiresInputWallet: true;
            readonly requiresOutputWallet: false;
            readonly supportsGasDrop: false;
        };
        readonly 3: {
            readonly requiresInputWallet: true;
            readonly requiresOutputWallet: false;
            readonly supportsGasDrop: false;
        };
        readonly 0: {
            readonly requiresInputWallet: false;
            readonly requiresOutputWallet: true;
            readonly supportsGasDrop: false;
        };
        readonly 1: {
            readonly requiresInputWallet: false;
            readonly requiresOutputWallet: true;
            readonly supportsGasDrop: false;
        };
        readonly 6: {
            readonly requiresInputWallet: true;
            readonly requiresOutputWallet: false;
            readonly supportsGasDrop: true;
        };
        readonly 7: {
            readonly requiresInputWallet: false;
            readonly requiresOutputWallet: false;
            readonly supportsGasDrop: true;
        };
        readonly 4: {
            readonly requiresInputWallet: false;
            readonly requiresOutputWallet: false;
            readonly supportsGasDrop: false;
        };
        readonly 5: {
            readonly requiresInputWallet: false;
            readonly requiresOutputWallet: false;
            readonly supportsGasDrop: false;
        };
    };
    constructor(swapper: Swapper<T>, chainIdentifier: ChainIdentifier);
    createToBTCSwap(signer: string, tokenAddress: string, address: string, amount: bigint, exactIn?: boolean, additionalParams?: Record<string, any>, options?: ToBTCOptions): Promise<ToBTCSwap<T[ChainIdentifier]>>;
    createToBTCLNSwap(signer: string, tokenAddress: string, paymentRequest: string, additionalParams?: Record<string, any>, options?: ToBTCLNOptions & {
        comment?: string;
    }): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
    createToBTCLNSwapViaLNURL(signer: string, tokenAddress: string, lnurlPay: string | LNURLPay, amount: bigint, exactIn?: boolean, additionalParams?: Record<string, any>, options?: ToBTCLNOptions): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
    createToBTCLNSwapViaInvoiceCreateService(signer: string, tokenAddress: string, service: InvoiceCreateService, amount: bigint, exactIn?: boolean, additionalParams?: Record<string, any>, options?: ToBTCLNOptions): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
    createFromBTCSwap(signer: string, tokenAddress: string, amount: bigint, exactOut?: boolean, additionalParams?: Record<string, any>, options?: FromBTCOptions): Promise<FromBTCSwap<T[ChainIdentifier]>>;
    createFromBTCLNSwap(signer: string, tokenAddress: string, amount: bigint, exactOut?: boolean, additionalParams?: Record<string, any>, options?: FromBTCLNOptions): Promise<FromBTCLNSwap<T[ChainIdentifier]>>;
    createFromBTCLNSwapViaLNURL(signer: string, tokenAddress: string, lnurl: string | LNURLWithdraw, amount: bigint, exactOut?: boolean, additionalParams?: Record<string, any>): Promise<FromBTCLNSwap<T[ChainIdentifier]>>;
    createFromBTCLNSwapNew(signer: string, tokenAddress: string, amount: bigint, exactOut?: boolean, additionalParams?: Record<string, any>, options?: FromBTCLNAutoOptions): Promise<FromBTCLNAutoSwap<T[ChainIdentifier]>>;
    createFromBTCLNSwapNewViaLNURL(signer: string, tokenAddress: string, lnurl: string | LNURLWithdraw, amount: bigint, exactOut?: boolean, additionalParams?: Record<string, any>, options?: FromBTCLNAutoOptions): Promise<FromBTCLNAutoSwap<T[ChainIdentifier]>>;
    createTrustedLNForGasSwap(signer: string, amount: bigint, trustedIntermediaryUrl?: string): Promise<LnForGasSwap<T[ChainIdentifier]>>;
    createTrustedOnchainForGasSwap(signer: string, amount: bigint, refundAddress?: string, trustedIntermediaryUrl?: string): Promise<OnchainForGasSwap<T[ChainIdentifier]>>;
    create(signer: string, srcToken: BtcToken<true>, dstToken: SCToken<ChainIdentifier>, amount: bigint, exactIn: boolean, lnurlWithdraw?: string | LNURLWithdraw): Promise<SupportsSwapType<T[ChainIdentifier], SwapType.FROM_BTCLN_AUTO> extends true ? FromBTCLNAutoSwap<T[ChainIdentifier]> : FromBTCLNSwap<T[ChainIdentifier]>>;
    create(signer: string, srcToken: BtcToken<false>, dstToken: SCToken<ChainIdentifier>, amount: bigint, exactIn: boolean): Promise<(SupportsSwapType<T[ChainIdentifier], SwapType.SPV_VAULT_FROM_BTC> extends true ? SpvFromBTCSwap<T[ChainIdentifier]> : FromBTCSwap<T[ChainIdentifier]>)>;
    create(signer: string, srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<false>, amount: bigint, exactIn: boolean, address: string): Promise<ToBTCSwap<T[ChainIdentifier]>>;
    create(signer: string, srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<true>, amount: bigint, exactIn: boolean, lnurlPay: string | LNURLPay): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
    create(signer: string, srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<true>, amount: bigint, exactIn: false, lightningInvoice: string | LNURLWithdraw | LNURLPay): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
    swap(srcToken: BtcToken<true>, dstToken: SCToken<ChainIdentifier>, amount: bigint | string, exactIn: boolean | SwapAmountType, src: undefined | string | LNURLWithdraw, dstSmartchainWallet: string, options?: (SupportsSwapType<T[ChainIdentifier], SwapType.FROM_BTCLN_AUTO> extends true ? FromBTCLNAutoOptions : FromBTCLNOptions)): Promise<SupportsSwapType<T[ChainIdentifier], SwapType.FROM_BTCLN_AUTO> extends true ? FromBTCLNAutoSwap<T[ChainIdentifier]> : FromBTCLNSwap<T[ChainIdentifier]>>;
    swap(srcToken: BtcToken<false>, dstToken: SCToken<ChainIdentifier>, amount: bigint | string, exactIn: boolean | SwapAmountType, src: undefined | string, dstSmartchainWallet: string, options?: (SupportsSwapType<T[ChainIdentifier], SwapType.SPV_VAULT_FROM_BTC> extends true ? SpvFromBTCOptions : FromBTCOptions)): Promise<(SupportsSwapType<T[ChainIdentifier], SwapType.SPV_VAULT_FROM_BTC> extends true ? SpvFromBTCSwap<T[ChainIdentifier]> : FromBTCSwap<T[ChainIdentifier]>)>;
    swap(srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<false>, amount: bigint | string, exactIn: boolean | SwapAmountType, src: string, dstAddress: string, options?: ToBTCOptions): Promise<ToBTCSwap<T[ChainIdentifier]>>;
    swap(srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<true>, amount: bigint | string, exactIn: boolean | SwapAmountType, src: string, dstLnurlPayOrInvoiceCreateService: string | LNURLPay | InvoiceCreateService, options?: ToBTCLNOptions & {
        comment?: string;
    }): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
    swap(srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<true>, amount: bigint | string, exactIn: false | SwapAmountType.EXACT_OUT, src: string, dstLightningInvoice: string, options?: ToBTCLNOptions): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
    swap(srcToken: Token<ChainIdentifier> | string, dstToken: Token<ChainIdentifier> | string, amount: bigint | string, exactIn: boolean | SwapAmountType, src: undefined | string | LNURLWithdraw, dst: string | LNURLPay | InvoiceCreateService, options?: FromBTCLNOptions | SpvFromBTCOptions | FromBTCOptions | ToBTCOptions | (ToBTCLNOptions & {
        comment?: string;
    }) | FromBTCLNAutoOptions): Promise<ISwap<T[ChainIdentifier]>>;
    /**
     * Returns swaps that are in-progress and are claimable for the specific chain, optionally also for a specific signer's address
     */
    getAllSwaps(signer?: string): Promise<ISwap<T[ChainIdentifier]>[]>;
    /**
     * Returns swaps that are in-progress and are claimable for the specific chain, optionally also for a specific signer's address
     */
    getActionableSwaps(signer?: string): Promise<ISwap<T[ChainIdentifier]>[]>;
    /**
     * Returns swaps that are refundable for the specific chain, optionally also for a specific signer's address
     */
    getRefundableSwaps(signer?: string): Promise<IToBTCSwap<T[ChainIdentifier]>[]>;
    /**
     * Returns swaps that are due to be claimed/settled manually for the specific chain,
     *  optionally also for a specific signer's address
     */
    getClaimableSwaps(signer?: string): Promise<IClaimableSwap<T[ChainIdentifier]>[]>;
    /**
     * Returns swap with a specific id (identifier) on a specific chain and optionally with a signer
     */
    getSwapById(id: string, signer?: string): Promise<ISwap<T[ChainIdentifier]>>;
    getToken(tickerOrAddress: string): Token<ChainIdentifier>;
    /**
     * Synchronizes swaps from chain, this is usually ran when SDK is initialized, deletes expired quotes
     */
    _syncSwaps(signer?: string): Promise<void>;
    supportsSwapType<Type extends SwapType>(swapType: Type): SupportsSwapType<T[ChainIdentifier], Type>;
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
    /**
     * Returns minimum/maximum limits for inputs and outputs for a swap between given tokens
     *
     * @param srcToken
     * @param dstToken
     */
    getSwapLimits<A extends Token<ChainIdentifier>, B extends Token<ChainIdentifier>>(srcToken: A, dstToken: B): {
        input: {
            min: TokenAmount<string, A>;
            max: TokenAmount<string, A>;
        };
        output: {
            min: TokenAmount<string, B>;
            max: TokenAmount<string, B>;
        };
    };
    /**
     * Returns a set of supported tokens by all the intermediaries offering a specific swap service
     *
     * @param _swapType Swap service type to check supported tokens for
     */
    private getSupportedTokens;
    /**
     * Returns the set of supported tokens by all the intermediaries we know of offering a specific swapType service
     *
     * @param swapType Specific swap type for which to obtain supported tokens
     */
    private getSupportedTokenAddresses;
    /**
     * Returns tokens that you can swap to (if input=true) from a given token,
     *  or tokens that you can swap from (if input=false) to a given token
     */
    getSwapCounterTokens(token: Token, input: boolean): Token<ChainIdentifier>[];
    /**
     * Creates a child swapper instance with a signer
     *
     * @param signer Signer to use for the new swapper instance
     */
    withChain(signer: T[ChainIdentifier]["Signer"]): SwapperWithSigner<T, ChainIdentifier>;
    /**
     * Returns swap bounds (minimums & maximums) for different swap types & tokens
     * @deprecated Use getSwapLimits() instead!
     */
    getSwapBounds(): SwapBounds;
    /**
     * Returns maximum possible swap amount
     * @deprecated Use getSwapLimits() instead!
     *
     * @param type      Type of the swap
     * @param token     Token of the swap
     */
    getMaximum(type: SwapType, token: string): bigint;
    /**
     * Returns minimum possible swap amount
     * @deprecated Use getSwapLimits() instead!
     *
     * @param type      Type of swap
     * @param token     Token of the swap
     */
    getMinimum(type: SwapType, token: string): bigint;
}
