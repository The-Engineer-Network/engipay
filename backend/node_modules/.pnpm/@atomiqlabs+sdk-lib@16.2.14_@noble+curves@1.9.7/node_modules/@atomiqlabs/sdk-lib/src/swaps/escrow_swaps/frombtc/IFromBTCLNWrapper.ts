import {ChainType, SwapData} from "@atomiqlabs/base";
import {IFromBTCWrapper} from "./IFromBTCWrapper";
import {ISwapWrapperOptions, WrapperCtorTokens} from "../../ISwapWrapper";
import {LightningNetworkApi, LNNodeLiquidity} from "../../../btc/LightningNetworkApi";
import {UnifiedSwapStorage} from "../../../storage/UnifiedSwapStorage";
import {UnifiedSwapEventListener} from "../../../events/UnifiedSwapEventListener";
import {ISwapPrice} from "../../../prices/abstract/ISwapPrice";
import {EventEmitter} from "events";
import {Buffer} from "buffer";
import {randomBytes} from "../../../utils/Utils";
import {Intermediary} from "../../../intermediaries/Intermediary";
import {PaymentRequestObject, TagsObject} from "@atomiqlabs/bolt11";
import {IntermediaryError} from "../../../errors/IntermediaryError";
import {LNURL, LNURLWithdrawParamsWithUrl} from "../../../utils/LNURL";
import {UserError} from "../../../errors/UserError";
import { sha256 } from "@noble/hashes/sha256";
import {IEscrowSwap} from "../IEscrowSwap";

export abstract class IFromBTCLNWrapper<
    T extends ChainType,
    S extends IEscrowSwap<T>,
    O extends ISwapWrapperOptions = ISwapWrapperOptions
> extends IFromBTCWrapper<T, S, O> {

    protected readonly lnApi: LightningNetworkApi;

    /**
     * @param chainIdentifier
     * @param unifiedStorage Storage interface for the current environment
     * @param unifiedChainEvents On-chain event listener
     * @param chain
     * @param contract Underlying contract handling the swaps
     * @param prices Swap pricing handler
     * @param tokens
     * @param swapDataDeserializer Deserializer for SwapData
     * @param lnApi
     * @param options
     * @param events Instance to use for emitting events
     */
    constructor(
        chainIdentifier: string,
        unifiedStorage: UnifiedSwapStorage<T>,
        unifiedChainEvents: UnifiedSwapEventListener<T>,
        chain: T["ChainInterface"],
        contract: T["Contract"],
        prices: ISwapPrice,
        tokens: WrapperCtorTokens,
        swapDataDeserializer: new (data: any) => T["Data"],
        lnApi: LightningNetworkApi,
        options: O,
        events?: EventEmitter<{swapState: [IEscrowSwap]}>
    ) {
        super(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, contract, prices, tokens, swapDataDeserializer, options, events);
        this.lnApi = lnApi;
    }
    /**
     * Returns the swap expiry, leaving enough time for the user to claim the HTLC
     *
     * @param data Parsed swap data
     */
    getHtlcTimeout(data: SwapData): bigint {
        return data.getExpiry() - 600n;
    }

    /**
     * Generates a new 32-byte secret to be used as pre-image for lightning network invoice & HTLC swap\
     *
     * @private
     * @returns Hash pre-image & payment hash
     */
    protected getSecretAndHash(): {secret: Buffer, paymentHash: Buffer} {
        const secret = randomBytes(32);
        const paymentHash = Buffer.from(sha256(secret));
        return {secret, paymentHash};
    }

    /**
     * Pre-fetches intermediary's LN node capacity, doesn't throw, instead returns null
     *
     * @param pubkeyPromise Promise that resolves when we receive "lnPublicKey" param from the intermediary thorugh
     *  streaming
     * @private
     * @returns LN Node liquidity
     */
    protected preFetchLnCapacity(pubkeyPromise: Promise<string>): Promise<LNNodeLiquidity | null> {
        return pubkeyPromise.then(pubkey => {
            if(pubkey==null) return null;
            return this.lnApi.getLNNodeLiquidity(pubkey)
        }).catch(e => {
            this.logger.warn("preFetchLnCapacity(): Error: ", e);
            return null;
        })
    }

    /**
     * Verifies whether the intermediary's lightning node has enough inbound capacity to receive the LN payment
     *
     * @param lp Intermediary
     * @param decodedPr Decoded bolt11 lightning network invoice
     * @param amountIn Amount to be paid for the swap in sats
     * @param lnCapacityPrefetchPromise Pre-fetch for LN node capacity, preFetchLnCapacity()
     * @param abortSignal
     * @private
     * @throws {IntermediaryError} if the lightning network node doesn't have enough inbound liquidity
     * @throws {Error} if the lightning network node's inbound liquidity might be enough, but the swap would
     *  deplete more than half of the liquidity
     */
    protected async verifyLnNodeCapacity(
        lp: Intermediary,
        decodedPr: PaymentRequestObject & {tagsObject: TagsObject},
        lnCapacityPrefetchPromise: Promise<LNNodeLiquidity | null>,
        abortSignal?: AbortSignal
    ): Promise<void> {
        let result: LNNodeLiquidity = lnCapacityPrefetchPromise==null ? null : await lnCapacityPrefetchPromise;
        if(result==null) result = await this.lnApi.getLNNodeLiquidity(decodedPr.payeeNodeKey);
        if(abortSignal!=null) abortSignal.throwIfAborted();

        if(result===null) throw new IntermediaryError("LP's lightning node not found in the lightning network graph!");

        lp.lnData = result

        if(decodedPr.payeeNodeKey!==result.publicKey) throw new IntermediaryError("Invalid pr returned - payee pubkey");
        const amountIn = (BigInt(decodedPr.millisatoshis) + 999n) / 1000n;
        if(result.capacity < amountIn)
            throw new IntermediaryError("LP's lightning node doesn't have enough inbound capacity for the swap!");
        if((result.capacity / 2n) < amountIn)
            throw new Error("LP's lightning node probably doesn't have enough inbound capacity for the swap!");
    }

    /**
     * Parses and fetches lnurl withdraw params from the specified lnurl
     *
     * @param lnurl LNURL to be parsed and fetched
     * @param abortSignal
     * @private
     * @throws {UserError} if the LNURL is invalid or if it's not a LNURL-withdraw
     */
    protected async getLNURLWithdraw(lnurl: string | LNURLWithdrawParamsWithUrl, abortSignal: AbortSignal): Promise<LNURLWithdrawParamsWithUrl> {
        if(typeof(lnurl)!=="string") return lnurl;

        const res = await LNURL.getLNURL(lnurl, true, this.options.getRequestTimeout, abortSignal);
        if(res==null) throw new UserError("Invalid LNURL");
        if(res.tag!=="withdrawRequest") throw new UserError("Not a LNURL-withdrawal");
        return res;
    }

}