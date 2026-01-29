import {ISwapWrapper, ISwapWrapperOptions, WrapperCtorTokens} from "../../ISwapWrapper";
import {TrustedIntermediaryAPI} from "../../../intermediaries/TrustedIntermediaryAPI";
import {IntermediaryError} from "../../../errors/IntermediaryError";
import {ChainType} from "@atomiqlabs/base";
import {OnchainForGasSwap, OnchainForGasSwapInit, OnchainForGasSwapState} from "./OnchainForGasSwap";
import {BitcoinRpcWithAddressIndex} from "../../../btc/BitcoinRpcWithAddressIndex";
import {ISwapPrice} from "../../../prices/abstract/ISwapPrice";
import {EventEmitter} from "events";
import {Intermediary} from "../../../intermediaries/Intermediary";
import {SwapType} from "../../enums/SwapType";
import {UnifiedSwapEventListener} from "../../../events/UnifiedSwapEventListener";
import {UnifiedSwapStorage} from "../../../storage/UnifiedSwapStorage";
import {ISwap} from "../../ISwap";
import {BTC_NETWORK} from "@scure/btc-signer/utils";

export type OnchainForGasWrapperOptions = ISwapWrapperOptions & {
    bitcoinNetwork: BTC_NETWORK
};

export class OnchainForGasWrapper<T extends ChainType> extends ISwapWrapper<T, OnchainForGasSwap<T>, OnchainForGasWrapperOptions> {
    public readonly TYPE = SwapType.TRUSTED_FROM_BTC;
    public readonly swapDeserializer = OnchainForGasSwap;

    readonly btcRpc: BitcoinRpcWithAddressIndex<any>;

    /**
     * @param chainIdentifier
     * @param unifiedStorage Storage interface for the current environment
     * @param unifiedChainEvents On-chain event listener
     * @param chain
     * @param prices Pricing to use
     * @param tokens
     * @param btcRpc Bitcoin RPC which also supports getting transactions by txoHash
     * @param options
     * @param events Instance to use for emitting events
     */
    constructor(
        chainIdentifier: string,
        unifiedStorage: UnifiedSwapStorage<T>,
        unifiedChainEvents: UnifiedSwapEventListener<T>,
        chain: T["ChainInterface"],
        prices: ISwapPrice,
        tokens: WrapperCtorTokens,
        btcRpc: BitcoinRpcWithAddressIndex<any>,
        options?: OnchainForGasWrapperOptions,
        events?: EventEmitter<{swapState: [ISwap]}>
    ) {
        super(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, prices, tokens, options, events);
        this.btcRpc = btcRpc;
    }

    /**
     * Returns a newly created swap, receiving 'amount' base units of gas token
     *
     * @param signer
     * @param amount            Amount you wish to receive in base units
     * @param lpOrUrl           Intermediary/Counterparty swap service Intermediary object or raw url
     * @param refundAddress     Bitcoin address to receive refund on in case the counterparty cannot execute the swap
     */
    async create(signer: string, amount: bigint, lpOrUrl: Intermediary | string, refundAddress?: string): Promise<OnchainForGasSwap<T>> {
        if(!this.isInitialized) throw new Error("Not initialized, call init() first!");

        const lpUrl = typeof(lpOrUrl)==="string" ? lpOrUrl : lpOrUrl.url;

        const token = this.chain.getNativeCurrencyAddress();

        const resp = await TrustedIntermediaryAPI.initTrustedFromBTC(this.chainIdentifier, lpUrl, {
            address: signer,
            amount,
            refundAddress,
            token
        }, this.options.getRequestTimeout);

        if(resp.total !== amount) throw new IntermediaryError("Invalid total returned");

        const pricingInfo = await this.verifyReturnedPrice(
            typeof(lpOrUrl)==="string" ?
                {swapFeePPM: 10000, swapBaseFee: 10} :
                lpOrUrl.services[SwapType.TRUSTED_FROM_BTC],
            false, resp.amountSats,
            amount, this.chain.getNativeCurrencyAddress(), {}
        );

        const quote = new OnchainForGasSwap(this, {
            paymentHash: resp.paymentHash,
            sequence: resp.sequence,
            address: resp.btcAddress,
            inputAmount: resp.amountSats,
            outputAmount: resp.total,
            recipient: signer,
            refundAddress,
            pricingInfo,
            url: lpUrl,
            expiry: resp.expiresAt,
            swapFee: resp.swapFee,
            swapFeeBtc: resp.swapFeeSats,
            exactIn: false,
            token
        } as OnchainForGasSwapInit);
        await quote._save();
        return quote;
    }

    public readonly pendingSwapStates = [OnchainForGasSwapState.PR_CREATED];
    public readonly tickSwapState = null;
    protected processEvent = null;

}
