import { LNURLPay, LNURLWithdraw } from "../../utils/LNURL";
import { IntermediaryDiscovery, SwapBounds } from "../../intermediaries/IntermediaryDiscovery";
import { SwapType } from "../enums/SwapType";
import { LnForGasSwap } from "../trusted/ln/LnForGasSwap";
import { ISwap } from "../ISwap";
import { IToBTCSwap } from "../escrow_swaps/tobtc/IToBTCSwap";
import { ChainIds, MultiChain, SupportsSwapType } from "./Swapper";
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
import { ToBTCLNOptions } from "../escrow_swaps/tobtc/ln/ToBTCLNWrapper";
import { FromBTCOptions } from "../escrow_swaps/frombtc/onchain/FromBTCWrapper";
import { FromBTCLNOptions } from "../escrow_swaps/frombtc/ln/FromBTCLNWrapper";
import { SwapperUtils } from "./utils/SwapperUtils";
import { SpvFromBTCSwap } from "../spv_swaps/SpvFromBTCSwap";
import { SwapperWithChain } from "./SwapperWithChain";
import { SwapWithSigner } from "./SwapWithSigner";
import { OnchainForGasSwap } from "../trusted/onchain/OnchainForGasSwap";
import { FromBTCLNAutoSwap } from "../escrow_swaps/frombtc/ln_auto/FromBTCLNAutoSwap";
import { FromBTCLNAutoOptions } from "../escrow_swaps/frombtc/ln_auto/FromBTCLNAutoWrapper";
export declare class SwapperWithSigner<T extends MultiChain, ChainIdentifier extends ChainIds<T>> {
    readonly chainIdentifier: ChainIdentifier;
    readonly swapper: SwapperWithChain<T, ChainIdentifier>;
    readonly signer: T[ChainIdentifier]["Signer"];
    get prices(): SwapPriceWithChain<T, ChainIdentifier>;
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
    constructor(swapper: SwapperWithChain<T, ChainIdentifier>, signer: T[ChainIdentifier]["Signer"]);
    createToBTCSwap(tokenAddress: string, address: string, amount: bigint, exactIn?: boolean, additionalParams?: Record<string, any>, options?: ToBTCOptions): Promise<SwapWithSigner<ToBTCSwap<T[ChainIdentifier]>>>;
    createToBTCLNSwap(tokenAddress: string, paymentRequest: string, additionalParams?: Record<string, any>, options?: ToBTCLNOptions & {
        comment?: string;
    }): Promise<SwapWithSigner<ToBTCLNSwap<T[ChainIdentifier]>>>;
    createToBTCLNSwapViaLNURL(tokenAddress: string, lnurlPay: string | LNURLPay, amount: bigint, exactIn?: boolean, additionalParams?: Record<string, any>, options?: ToBTCLNOptions): Promise<SwapWithSigner<ToBTCLNSwap<T[ChainIdentifier]>>>;
    createFromBTCSwap(tokenAddress: string, amount: bigint, exactOut?: boolean, additionalParams?: Record<string, any>, options?: FromBTCOptions): Promise<SwapWithSigner<FromBTCSwap<T[ChainIdentifier]>>>;
    createFromBTCLNSwap(tokenAddress: string, amount: bigint, exactOut?: boolean, additionalParams?: Record<string, any>, options?: FromBTCLNOptions): Promise<SwapWithSigner<FromBTCLNSwap<T[ChainIdentifier]>>>;
    createFromBTCLNSwapViaLNURL(tokenAddress: string, lnurl: string | LNURLWithdraw, amount: bigint, exactOut?: boolean, additionalParams?: Record<string, any>): Promise<SwapWithSigner<FromBTCLNSwap<T[ChainIdentifier]>>>;
    createFromBTCLNSwapNew(tokenAddress: string, amount: bigint, exactOut?: boolean, additionalParams?: Record<string, any>, options?: FromBTCLNAutoOptions): Promise<SwapWithSigner<FromBTCLNAutoSwap<T[ChainIdentifier]>>>;
    createFromBTCLNSwapNewViaLNURL(tokenAddress: string, lnurl: string | LNURLWithdraw, amount: bigint, exactOut?: boolean, additionalParams?: Record<string, any>, options?: FromBTCLNAutoOptions): Promise<SwapWithSigner<FromBTCLNAutoSwap<T[ChainIdentifier]>>>;
    createTrustedLNForGasSwap(amount: bigint, trustedIntermediaryUrl?: string): Promise<LnForGasSwap<T[ChainIdentifier]>>;
    createTrustedOnchainForGasSwap(amount: bigint, refundAddress?: string, trustedIntermediaryUrl?: string): Promise<OnchainForGasSwap<T[ChainIdentifier]>>;
    create(srcToken: BtcToken<true>, dstToken: SCToken<ChainIdentifier>, amount: bigint, exactIn: boolean, lnurlWithdraw?: string | LNURLWithdraw): Promise<(SupportsSwapType<T[ChainIdentifier], SwapType.FROM_BTCLN_AUTO> extends true ? FromBTCLNAutoSwap<T[ChainIdentifier]> : FromBTCLNSwap<T[ChainIdentifier]>)>;
    create(srcToken: BtcToken<false>, dstToken: SCToken<ChainIdentifier>, amount: bigint, exactIn: boolean): Promise<(SupportsSwapType<T[ChainIdentifier], SwapType.SPV_VAULT_FROM_BTC> extends true ? SpvFromBTCSwap<T[ChainIdentifier]> : FromBTCSwap<T[ChainIdentifier]>)>;
    create(srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<false>, amount: bigint, exactIn: boolean, address: string): Promise<ToBTCSwap<T[ChainIdentifier]>>;
    create(srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<true>, amount: bigint, exactIn: boolean, lnurlPay: string | LNURLPay): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
    create(srcToken: SCToken<ChainIdentifier>, dstToken: BtcToken<true>, amount: bigint, exactIn: false, lightningInvoice: string | LNURLWithdraw | LNURLPay): Promise<ToBTCLNSwap<T[ChainIdentifier]>>;
    /**
     * Returns swaps that are in-progress and are claimable for the specific chain, optionally also for a specific signer's address
     */
    getAllSwaps(): Promise<ISwap<T[ChainIdentifier]>[]>;
    /**
     * Returns swaps that are in-progress and are claimable for the specific chain, optionally also for a specific signer's address
     */
    getActionableSwaps(): Promise<ISwap<T[ChainIdentifier]>[]>;
    /**
     * Returns swaps that are refundable for the specific chain, optionally also for a specific signer's address
     */
    getRefundableSwaps(): Promise<IToBTCSwap<T[ChainIdentifier]>[]>;
    /**
     * Returns swap with a specific id (identifier) on a specific chain and optionally with a signer
     */
    getSwapById(id: string): Promise<ISwap<T[ChainIdentifier]>>;
    /**
     * Synchronizes swaps from chain, this is usually ran when SDK is initialized, deletes expired quotes
     */
    _syncSwaps(): Promise<void>;
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
     * Returns tokens that you can swap to (if input=true) from a given token,
     *  or tokens that you can swap from (if input=false) to a given token
     */
    getSwapCounterTokens(token: Token, input: boolean): Token<ChainIdentifier>[];
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
