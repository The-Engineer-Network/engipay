import {decode as bolt11Decode, PaymentRequestObject, TagsObject} from "@atomiqlabs/bolt11";
import {
    ChainSwapType,
    ChainType,
    ClaimEvent,
    InitializeEvent, Messenger,
    RefundEvent
} from "@atomiqlabs/base";
import {Intermediary} from "../../../../intermediaries/Intermediary";
import {Buffer} from "buffer";
import {UserError} from "../../../../errors/UserError";
import {IntermediaryError} from "../../../../errors/IntermediaryError";
import {SwapType} from "../../../enums/SwapType";
import {extendAbortController, randomBytes, tryWithRetries} from "../../../../utils/Utils";
import {
    FromBTCLNAutoResponseType,
    IntermediaryAPI
} from "../../../../intermediaries/IntermediaryAPI";
import {RequestError} from "../../../../errors/RequestError";
import {LightningNetworkApi} from "../../../../btc/LightningNetworkApi";
import {ISwapPrice} from "../../../../prices/abstract/ISwapPrice";
import {EventEmitter} from "events";
import {AmountData, ISwapWrapperOptions, WrapperCtorTokens} from "../../../ISwapWrapper";
import {LNURLWithdrawParamsWithUrl} from "../../../../utils/LNURL";
import {UnifiedSwapEventListener} from "../../../../events/UnifiedSwapEventListener";
import {UnifiedSwapStorage} from "../../../../storage/UnifiedSwapStorage";
import {ISwap} from "../../../ISwap";
import {FromBTCLNAutoSwap, FromBTCLNAutoSwapInit, FromBTCLNAutoSwapState} from "./FromBTCLNAutoSwap";
import { IFromBTCLNWrapper } from "../IFromBTCLNWrapper";
import {IClaimableSwapWrapper} from "../../../IClaimableSwapWrapper";

export type FromBTCLNAutoOptions = {
    descriptionHash?: Buffer,
    unsafeSkipLnNodeCheck?: boolean,
    gasAmount?: bigint,
    unsafeZeroWatchtowerFee?: boolean,
    feeSafetyFactor?: number
};

export type FromBTCLNAutoWrapperOptions = ISwapWrapperOptions & {
    safetyFactor?: number,
    bitcoinBlocktime?: number,
    unsafeSkipLnNodeCheck?: boolean
};

export class FromBTCLNAutoWrapper<
    T extends ChainType
> extends IFromBTCLNWrapper<T, FromBTCLNAutoSwap<T>, FromBTCLNAutoWrapperOptions> implements IClaimableSwapWrapper<FromBTCLNAutoSwap<T>> {

    public readonly claimableSwapStates = [FromBTCLNAutoSwapState.CLAIM_COMMITED];
    public readonly TYPE = SwapType.FROM_BTCLN_AUTO;
    public readonly swapDeserializer = FromBTCLNAutoSwap;

    protected readonly lnApi: LightningNetworkApi;
    readonly messenger: Messenger;

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
     * @param messenger
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
        messenger: Messenger,
        options: FromBTCLNAutoWrapperOptions,
        events?: EventEmitter<{swapState: [ISwap]}>
    ) {
        options.safetyFactor ??= 2;
        options.bitcoinBlocktime ??= 10*60;
        super(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, contract, prices, tokens, swapDataDeserializer, lnApi, options, events);
        this.messenger = messenger;
    }

    public readonly pendingSwapStates = [
        FromBTCLNAutoSwapState.PR_CREATED,
        FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED,
        FromBTCLNAutoSwapState.PR_PAID,
        FromBTCLNAutoSwapState.CLAIM_COMMITED,
        FromBTCLNAutoSwapState.EXPIRED
    ];
    public readonly tickSwapState = [
        FromBTCLNAutoSwapState.PR_CREATED,
        FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED,
        FromBTCLNAutoSwapState.PR_PAID,
        FromBTCLNAutoSwapState.CLAIM_COMMITED
    ];

    protected async processEventInitialize(swap: FromBTCLNAutoSwap<T>, event: InitializeEvent<T["Data"]>): Promise<boolean> {
        if(swap.state===FromBTCLNAutoSwapState.PR_PAID || swap.state===FromBTCLNAutoSwapState.PR_CREATED || swap.state===FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED) {
            if(swap.data==null) {
                //Obtain data from the initialize event
                const eventData = await event.swapData();
                try {
                    await swap._saveRealSwapData(eventData, false);
                    this.logger.info("processEventInitialize("+swap.getId()+"): Successfully taken swap data from on-chain event!");
                } catch (e) {
                    this.logger.error("processEventInitialize("+swap.getId()+"): Error when saving swap data for swap: ", e);
                    return false;
                }
            }

            if(swap._getEscrowHash()!==event.escrowHash) {
                this.logger.error("processEventInitialize("+swap.getId()+"): Error when processing event, escrow hashes don't match!");
                return false;
            }

            swap.commitTxId = event.meta.txId;
            swap.state = FromBTCLNAutoSwapState.CLAIM_COMMITED;
            swap._broadcastSecret().catch(e => {
                this.logger.error("processEventInitialize("+swap.getId()+"): Error when broadcasting swap secret: ", e);
            });
            return true;
        }
        return false;
    }

    protected processEventClaim(swap: FromBTCLNAutoSwap<T>, event: ClaimEvent<T["Data"]>): Promise<boolean> {
        if(swap.state!==FromBTCLNAutoSwapState.FAILED && swap.state!==FromBTCLNAutoSwapState.CLAIM_CLAIMED) {
            swap.claimTxId = event.meta.txId;
            swap.state = FromBTCLNAutoSwapState.CLAIM_CLAIMED;
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }

    protected processEventRefund(swap: FromBTCLNAutoSwap<T>, event: RefundEvent<T["Data"]>): Promise<boolean> {
        if(swap.state!==FromBTCLNAutoSwapState.CLAIM_CLAIMED && swap.state!==FromBTCLNAutoSwapState.FAILED) {
            swap.state = FromBTCLNAutoSwapState.FAILED;
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }

    /**
     * Pre-fetches claimer (watchtower) bounty data for the swap. Doesn't throw, instead returns null and aborts the
     *  provided abortController
     *
     * @param signer Smartchain signer address initiating the swap
     * @param amountData
     * @param options Options as passed to the swap creation function
     * @param abortController
     * @private
     */
    private async preFetchClaimerBounty(
        signer: string,
        amountData: AmountData,
        options: FromBTCLNAutoOptions,
        abortController: AbortController
    ): Promise<bigint | null> {
        if(options.unsafeZeroWatchtowerFee) return 0n;

        const dummyAmount = BigInt(Math.floor(Math.random()* 0x1000000));
        const dummySwapData = await this.contract.createSwapData(
            ChainSwapType.HTLC, this.chain.randomAddress(), signer, amountData.token,
            dummyAmount, this.contract.getHashForHtlc(randomBytes(32)).toString("hex"),
            this.getRandomSequence(), BigInt(Math.floor(Date.now()/1000)), false, true,
            BigInt(Math.floor(Math.random() * 0x10000)), BigInt(Math.floor(Math.random() * 0x10000))
        );

        try {
            const result = await tryWithRetries<bigint>(
                () => this.contract.getClaimFee(this.chain.randomAddress(), dummySwapData),
                null, null, abortController.signal
            );
            return result * BigInt(Math.floor(options.feeSafetyFactor*1000000)) / 1_000_000n
        } catch (e) {
            abortController.abort(e);
            return null;
        }
    }

    /**
     * Verifies response returned from intermediary
     *
     * @param resp Response as returned by the intermediary
     * @param amountData
     * @param lp Intermediary
     * @param options Options as passed to the swap creation function
     * @param decodedPr Decoded bolt11 lightning network invoice
     * @param paymentHash Expected payment hash of the bolt11 lightning network invoice
     * @param claimerBounty Claimer bounty as request by the user
     * @private
     * @throws {IntermediaryError} in case the response is invalid
     */
    private verifyReturnedData(
        resp: FromBTCLNAutoResponseType,
        amountData: AmountData,
        lp: Intermediary,
        options: FromBTCLNAutoOptions,
        decodedPr: PaymentRequestObject & {tagsObject: TagsObject},
        paymentHash: Buffer,
        claimerBounty: bigint
    ): void {
        if(lp.getAddress(this.chainIdentifier)!==resp.intermediaryKey) throw new IntermediaryError("Invalid intermediary address/pubkey");

        if(options.descriptionHash!=null && decodedPr.tagsObject.purpose_commit_hash!==options.descriptionHash.toString("hex"))
            throw new IntermediaryError("Invalid pr returned - description hash");

        if(!Buffer.from(decodedPr.tagsObject.payment_hash, "hex").equals(paymentHash))
            throw new IntermediaryError("Invalid pr returned - payment hash");

        const amountIn = (BigInt(decodedPr.millisatoshis) + 999n) / 1000n;
        if(resp.btcAmountGas + resp.btcAmountSwap !== amountIn) throw new IntermediaryError("Invalid total btc returned");
        if(resp.gasSwapFeeBtc + resp.swapFeeBtc !== resp.totalFeeBtc) throw new IntermediaryError("Invalid total btc fee returned");
        if(resp.claimerBounty !== claimerBounty) throw new IntermediaryError("Invalid claimer bounty");
        if(resp.totalGas !== options.gasAmount) throw new IntermediaryError("Invalid total gas amount");
        if(!amountData.exactIn) {
            if(resp.total != amountData.amount) throw new IntermediaryError("Invalid amount returned");
        } else {
            if(amountIn !== amountData.amount) throw new IntermediaryError("Invalid payment request returned, amount mismatch");
        }
    }

    /**
     * Returns a newly created swap, receiving 'amount' on lightning network
     *
     * @param signer                Smart chain signer's address intiating the swap
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers) to get the quotes from
     * @param options               Quote options
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     * @param preFetches
     */
    create(
        signer: string,
        amountData: AmountData,
        lps: Intermediary[],
        options: FromBTCLNAutoOptions,
        additionalParams?: Record<string, any>,
        abortSignal?: AbortSignal,
        preFetches?: {
            pricePrefetchPromise?: Promise<bigint>,
            gasTokenPricePrefetchPromise?: Promise<bigint>,
            claimerBountyPrefetch?: Promise<bigint>,
        }
    ): {
        quote: Promise<FromBTCLNAutoSwap<T>>,
        intermediary: Intermediary
    }[] {
        if(options==null) options = {};
        options.unsafeSkipLnNodeCheck ??= this.options.unsafeSkipLnNodeCheck;
        options.gasAmount ??= 0n;
        options.feeSafetyFactor ??= 1.25; //No need to add much of a margin, since the claim should happen rather soon
        if(preFetches==null) preFetches = {};

        if(options.descriptionHash!=null && options.descriptionHash.length!==32)
            throw new UserError("Invalid description hash length");

        const {secret, paymentHash} = this.getSecretAndHash();
        const claimHash = this.contract.getHashForHtlc(paymentHash);

        const _abortController = extendAbortController(abortSignal);
        preFetches.pricePrefetchPromise ??= this.preFetchPrice(amountData, _abortController.signal);
        const nativeTokenAddress = this.chain.getNativeCurrencyAddress();
        preFetches.claimerBountyPrefetch ??= this.preFetchClaimerBounty(signer, amountData, options, _abortController);
        if(options.gasAmount!==0n || !options.unsafeZeroWatchtowerFee)
            preFetches.gasTokenPricePrefetchPromise ??= this.preFetchPrice({token: nativeTokenAddress}, _abortController.signal);

        return lps.map(lp => {
            return {
                intermediary: lp,
                quote: (async () => {
                    const abortController = extendAbortController(_abortController.signal);

                    const liquidityPromise: Promise<bigint> = this.preFetchIntermediaryLiquidity(amountData, lp, abortController);

                    const {lnCapacityPromise, resp} = await tryWithRetries(async(retryCount: number) => {
                        const {lnPublicKey, response} = IntermediaryAPI.initFromBTCLNAuto(
                            this.chainIdentifier, lp.url,
                            {
                                paymentHash,
                                amount: amountData.amount,
                                claimer: signer,
                                token: amountData.token.toString(),
                                descriptionHash: options.descriptionHash,
                                exactOut: !amountData.exactIn,
                                additionalParams,
                                gasToken: this.chain.getNativeCurrencyAddress(),
                                gasAmount: options.gasAmount,
                                claimerBounty: preFetches.claimerBountyPrefetch
                            },
                            this.options.postRequestTimeout, abortController.signal, retryCount>0 ? false : null
                        );

                        return {
                            lnCapacityPromise: options.unsafeSkipLnNodeCheck ? null : this.preFetchLnCapacity(lnPublicKey),
                            resp: await response
                        };
                    }, null, RequestError, abortController.signal);

                    const decodedPr = bolt11Decode(resp.pr);
                    const amountIn = (BigInt(decodedPr.millisatoshis) + 999n) / 1000n;
                    const claimerBounty = await preFetches.claimerBountyPrefetch;

                    try {
                        this.verifyReturnedData(resp, amountData, lp, options, decodedPr, paymentHash, claimerBounty);
                        const [pricingInfo] = await Promise.all([
                            this.verifyReturnedPrice(
                                lp.services[SwapType.FROM_BTCLN_AUTO],
                                false, resp.btcAmountSwap,
                                resp.total,
                                amountData.token, {}, preFetches.pricePrefetchPromise, abortController.signal
                            ),
                            options.gasAmount===0n ? Promise.resolve() : this.verifyReturnedPrice(
                                {...lp.services[SwapType.FROM_BTCLN_AUTO], swapBaseFee: 0}, //Base fee should be charged only on the amount, not on gas
                                false, resp.btcAmountGas,
                                resp.totalGas + resp.claimerBounty,
                                nativeTokenAddress, {}, preFetches.gasTokenPricePrefetchPromise, abortController.signal
                            ),
                            this.verifyIntermediaryLiquidity(resp.total, liquidityPromise),
                            options.unsafeSkipLnNodeCheck ? Promise.resolve() : this.verifyLnNodeCapacity(lp, decodedPr, lnCapacityPromise, abortController.signal)
                        ]);

                        const swapInit: FromBTCLNAutoSwapInit<T["Data"]> = {
                            pricingInfo,
                            url: lp.url,
                            expiry: decodedPr.timeExpireDate*1000,

                            swapFee: resp.swapFee,
                            gasSwapFee: resp.gasSwapFee,

                            swapFeeBtc: resp.swapFeeBtc,
                            gasSwapFeeBtc: resp.gasSwapFeeBtc,

                            btcAmountGas: resp.btcAmountGas,
                            btcAmountSwap: resp.btcAmountSwap,

                            initialSwapData: await this.contract.createSwapData(
                                ChainSwapType.HTLC, lp.getAddress(this.chainIdentifier), signer, amountData.token,
                                resp.total, claimHash.toString("hex"),
                                this.getRandomSequence(), BigInt(Math.floor(Date.now()/1000)), false, true,
                                options.gasAmount + resp.claimerBounty, resp.claimerBounty, nativeTokenAddress
                            ),
                            pr: resp.pr,
                            secret: secret.toString("hex"),
                            exactIn: amountData.exactIn ?? true
                        };
                        const quote = new FromBTCLNAutoSwap<T>(this, swapInit);
                        await quote._save();
                        this.logger.debug("create(): Created new FromBTCLNAutoSwap quote, claimHash (pseudo escrowHash): ", quote._getEscrowHash());
                        return quote;
                    } catch (e) {
                        abortController.abort(e);
                        throw e;
                    }
                })()
            }
        });
    }

    /**
     * Returns a newly created swap, receiving 'amount' from the lnurl-withdraw
     *
     * @param signer                Smart chains signer's address intiating the swap
     * @param lnurl                 LNURL-withdraw to withdraw funds from
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers) to get the quotes from
     * @param options
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     */
    async createViaLNURL(
        signer: string,
        lnurl: string | LNURLWithdrawParamsWithUrl,
        amountData: AmountData,
        lps: Intermediary[],
        options: FromBTCLNAutoOptions,
        additionalParams?: Record<string, any>,
        abortSignal?: AbortSignal
    ): Promise<{
        quote: Promise<FromBTCLNAutoSwap<T>>,
        intermediary: Intermediary
    }[]> {
        options ??= {};
        options.unsafeSkipLnNodeCheck ??= this.options.unsafeSkipLnNodeCheck;
        options.gasAmount ??= 0n;
        options.feeSafetyFactor ??= 1.25; //No need to add much of a margin, since the claim should happen rather soon
        if(!this.isInitialized) throw new Error("Not initialized, call init() first!");

        const abortController = extendAbortController(abortSignal);
        const preFetches = {
            pricePrefetchPromise: this.preFetchPrice(amountData, abortController.signal),
            gasTokenPricePrefetchPromise: options.gasAmount==null && options.unsafeZeroWatchtowerFee ?
                null :
                this.preFetchPrice({token: this.chain.getNativeCurrencyAddress()}, abortController.signal),
            claimerBountyPrefetch: this.preFetchClaimerBounty(signer, amountData, options, abortController)
        };

        try {
            const exactOutAmountPromise: Promise<bigint> = !amountData.exactIn ? preFetches.pricePrefetchPromise.then(price =>
                this.prices.getToBtcSwapAmount(this.chainIdentifier, amountData.amount, amountData.token, abortController.signal, price)
            ).catch(e => {
                abortController.abort(e);
                return null;
            }) : null;

            const withdrawRequest = await this.getLNURLWithdraw(lnurl, abortController.signal);

            const min = BigInt(withdrawRequest.minWithdrawable) / 1000n;
            const max = BigInt(withdrawRequest.maxWithdrawable) / 1000n;

            if(amountData.exactIn) {
                if(amountData.amount < min) throw new UserError("Amount less than LNURL-withdraw minimum");
                if(amountData.amount > max) throw new UserError("Amount more than LNURL-withdraw maximum");
            } else {
                const amount = await exactOutAmountPromise;
                abortController.signal.throwIfAborted();

                if((amount * 95n / 100n) < min) throw new UserError("Amount less than LNURL-withdraw minimum");
                if((amount * 105n / 100n) > max) throw new UserError("Amount more than LNURL-withdraw maximum");
            }

            return this.create(signer, amountData, lps, options, additionalParams, abortSignal, preFetches).map(data => {
                return {
                    quote: data.quote.then(quote => {
                        quote.lnurl = withdrawRequest.url;
                        quote.lnurlK1 = withdrawRequest.k1;
                        quote.lnurlCallback = withdrawRequest.callback;

                        const amountIn = quote.getInput().rawAmount;
                        if(amountIn < min) throw new UserError("Amount less than LNURL-withdraw minimum");
                        if(amountIn > max) throw new UserError("Amount more than LNURL-withdraw maximum");

                        return quote;
                    }),
                    intermediary: data.intermediary
                }
            });
        } catch (e) {
            abortController.abort(e);
            throw e;
        }
    }

    protected async _checkPastSwaps(pastSwaps: FromBTCLNAutoSwap<T>[]): Promise<{
        changedSwaps: FromBTCLNAutoSwap<T>[];
        removeSwaps: FromBTCLNAutoSwap<T>[]
    }> {
        const changedSwapSet: Set<FromBTCLNAutoSwap<T>> = new Set();

        const swapExpiredStatus: {[escrowHash: string]: boolean} = {};
        const checkStatusSwaps: FromBTCLNAutoSwap<T>[] = [];

        await Promise.all(pastSwaps.map(async (pastSwap) => {
            if(pastSwap._shouldCheckIntermediary()) {
                try {
                    const result = await pastSwap._checkIntermediaryPaymentReceived(false);
                    if(result!=null) {
                        changedSwapSet.add(pastSwap);
                    }
                } catch (e) {
                    this.logger.error(`_checkPastSwaps(): Failed to contact LP regarding swap ${pastSwap.getId()}, error: `, e);
                }
            }
            if(pastSwap._shouldFetchExpiryStatus()) {
                //Check expiry
                swapExpiredStatus[pastSwap.getEscrowHash()] = await pastSwap._verifyQuoteDefinitelyExpired();
            }
            if(pastSwap._shouldFetchCommitStatus()) {
                //Add to swaps for which status should be checked
                checkStatusSwaps.push(pastSwap);
            }
        }));

        const swapStatuses = await this.contract.getCommitStatuses(checkStatusSwaps.map(val => ({signer: val._getInitiator(), swapData: val.data})));

        for(let pastSwap of checkStatusSwaps) {
            const escrowHash = pastSwap.getEscrowHash();
            const shouldSave = await pastSwap._sync(false, swapExpiredStatus[escrowHash], swapStatuses[escrowHash], true);
            if(shouldSave) {
                changedSwapSet.add(pastSwap);
            }
        }

        const changedSwaps: FromBTCLNAutoSwap<T>[] = [];
        const removeSwaps: FromBTCLNAutoSwap<T>[] = [];
        changedSwapSet.forEach(val => {
            if(val.isQuoteExpired()) {
                removeSwaps.push(val);
            } else {
                changedSwaps.push(val);
            }
        });

        return {
            changedSwaps,
            removeSwaps
        };
    }

}
