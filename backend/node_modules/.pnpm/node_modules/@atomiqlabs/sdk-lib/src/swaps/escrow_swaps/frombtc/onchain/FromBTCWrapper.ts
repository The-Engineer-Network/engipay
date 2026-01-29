import {IFromBTCWrapper} from "../IFromBTCWrapper";
import {FromBTCSwap, FromBTCSwapInit, FromBTCSwapState} from "./FromBTCSwap";
import {
    ChainSwapType,
    ChainType,
    ClaimEvent,
    InitializeEvent,
    RefundEvent,
    RelaySynchronizer,
    SwapData,
    BtcRelay
} from "@atomiqlabs/base";
import {EventEmitter} from "events";
import {Intermediary} from "../../../../intermediaries/Intermediary";
import {BitcoinRpcWithAddressIndex} from "../../../../btc/BitcoinRpcWithAddressIndex";
import {ISwapPrice} from "../../../../prices/abstract/ISwapPrice";
import {AmountData, ISwapWrapperOptions, WrapperCtorTokens} from "../../../ISwapWrapper";
import {Buffer} from "buffer";
import {IntermediaryError} from "../../../../errors/IntermediaryError";
import {SwapType} from "../../../enums/SwapType";
import {extendAbortController, randomBytes, tryWithRetries} from "../../../../utils/Utils";
import { toOutputScript} from "../../../../utils/BitcoinUtils";
import {FromBTCResponseType, IntermediaryAPI} from "../../../../intermediaries/IntermediaryAPI";
import {RequestError} from "../../../../errors/RequestError";
import {BTC_NETWORK, TEST_NETWORK} from "@scure/btc-signer/utils";
import {UnifiedSwapEventListener} from "../../../../events/UnifiedSwapEventListener";
import {UnifiedSwapStorage} from "../../../../storage/UnifiedSwapStorage";
import {ISwap} from "../../../ISwap";
import {IClaimableSwapWrapper} from "../../../IClaimableSwapWrapper";

export type FromBTCOptions = {
    feeSafetyFactor?: bigint,
    blockSafetyFactor?: number,
    unsafeZeroWatchtowerFee?: boolean
};

export type FromBTCWrapperOptions = ISwapWrapperOptions & {
    safetyFactor?: number,
    blocksTillTxConfirms?: number,
    maxConfirmations?: number,
    minSendWindow?: number,
    bitcoinNetwork?: BTC_NETWORK,
    bitcoinBlocktime?: number
};

export class FromBTCWrapper<
    T extends ChainType
> extends IFromBTCWrapper<T, FromBTCSwap<T>, FromBTCWrapperOptions> implements IClaimableSwapWrapper<FromBTCSwap<T>> {

    public readonly claimableSwapStates = [FromBTCSwapState.BTC_TX_CONFIRMED];
    public readonly TYPE = SwapType.FROM_BTC;
    public readonly swapDeserializer = FromBTCSwap;

    readonly synchronizer: RelaySynchronizer<any, T["TX"], any>;
    readonly btcRelay: BtcRelay<any, T["TX"], any>;
    readonly btcRpc: BitcoinRpcWithAddressIndex<any>;

    /**
     * @param chainIdentifier
     * @param unifiedStorage Storage interface for the current environment
     * @param unifiedChainEvents On-chain event listener
     * @param chain
     * @param contract Underlying contract handling the swaps
     * @param prices Pricing to use
     * @param tokens
     * @param swapDataDeserializer Deserializer for SwapData
     * @param btcRelay
     * @param synchronizer Btc relay synchronizer
     * @param btcRpc Bitcoin RPC which also supports getting transactions by txoHash
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
        btcRelay: BtcRelay<any, T["TX"], any>,
        synchronizer: RelaySynchronizer<any, T["TX"], any>,
        btcRpc: BitcoinRpcWithAddressIndex<any>,
        options?: FromBTCWrapperOptions,
        events?: EventEmitter<{swapState: [ISwap]}>
    ) {
        if(options==null) options = {};
        options.bitcoinNetwork = options.bitcoinNetwork ?? TEST_NETWORK;
        options.safetyFactor = options.safetyFactor || 2;
        options.blocksTillTxConfirms = options.blocksTillTxConfirms || 12;
        options.maxConfirmations = options.maxConfirmations || 6;
        options.minSendWindow = options.minSendWindow || 30*60; //Minimum time window for user to send in the on-chain funds for From BTC swap
        options.bitcoinBlocktime = options.bitcoinBlocktime || 10*60;
        super(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, contract, prices, tokens, swapDataDeserializer, options, events);
        this.btcRelay = btcRelay;
        this.synchronizer = synchronizer;
        this.btcRpc = btcRpc;
    }

    public readonly pendingSwapStates = [
        FromBTCSwapState.PR_CREATED,
        FromBTCSwapState.QUOTE_SOFT_EXPIRED,
        FromBTCSwapState.CLAIM_COMMITED,
        FromBTCSwapState.BTC_TX_CONFIRMED,
        FromBTCSwapState.EXPIRED
    ];
    public readonly tickSwapState = [FromBTCSwapState.PR_CREATED, FromBTCSwapState.CLAIM_COMMITED, FromBTCSwapState.EXPIRED];

    protected processEventInitialize(swap: FromBTCSwap<T>, event: InitializeEvent<T["Data"]>): Promise<boolean> {
        if(swap.state===FromBTCSwapState.PR_CREATED || swap.state===FromBTCSwapState.QUOTE_SOFT_EXPIRED) {
            swap.state = FromBTCSwapState.CLAIM_COMMITED;
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }

    protected processEventClaim(swap: FromBTCSwap<T>, event: ClaimEvent<T["Data"]>): Promise<boolean> {
        if(swap.state!==FromBTCSwapState.FAILED && swap.state!==FromBTCSwapState.CLAIM_CLAIMED) {
            swap.state = FromBTCSwapState.CLAIM_CLAIMED;
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }

    protected processEventRefund(swap: FromBTCSwap<T>, event: RefundEvent<T["Data"]>): Promise<boolean> {
        if(swap.state!==FromBTCSwapState.CLAIM_CLAIMED && swap.state!==FromBTCSwapState.FAILED) {
            swap.state = FromBTCSwapState.FAILED;
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }

    /**
     * Returns the swap expiry, leaving enough time for the user to send a transaction and for it to confirm
     *
     * @param data Parsed swap data
     * @param requiredConfirmations Confirmations required to claim the tx
     */
    getOnchainSendTimeout(data: SwapData, requiredConfirmations: number): bigint {
        const tsDelta = (this.options.blocksTillTxConfirms + requiredConfirmations) * this.options.bitcoinBlocktime * this.options.safetyFactor;
        return data.getExpiry() - BigInt(tsDelta);
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
        options: FromBTCOptions,
        abortController: AbortController
    ): Promise<{
        feePerBlock: bigint,
        safetyFactor: number,
        startTimestamp: bigint,
        addBlock: number,
        addFee: bigint
    } | null> {
        const startTimestamp = BigInt(Math.floor(Date.now()/1000));

        if(options.unsafeZeroWatchtowerFee) {
            return {
                feePerBlock: 0n,
                safetyFactor: options.blockSafetyFactor,
                startTimestamp: startTimestamp,
                addBlock: 0,
                addFee: 0n
            }
        }

        const dummyAmount = BigInt(Math.floor(Math.random()* 0x1000000));
        const dummySwapData = await this.contract.createSwapData(
            ChainSwapType.CHAIN, signer, signer, amountData.token,
            dummyAmount, this.contract.getHashForOnchain(randomBytes(20), dummyAmount, 3).toString("hex"),
            this.getRandomSequence(), startTimestamp, false, true,
            BigInt(Math.floor(Math.random() * 0x10000)), BigInt(Math.floor(Math.random() * 0x10000))
        );

        try {
            const [feePerBlock, btcRelayData, currentBtcBlock, claimFeeRate] = await Promise.all([
                tryWithRetries(() => this.btcRelay.getFeePerBlock(), null, null, abortController.signal),
                tryWithRetries(() => this.btcRelay.getTipData(), null, null, abortController.signal),
                this.btcRpc.getTipHeight(),
                tryWithRetries<bigint>(() => this.contract.getClaimFee(signer, dummySwapData), null, null, abortController.signal)
            ]);

            const currentBtcRelayBlock = btcRelayData.blockheight;
            const addBlock = Math.max(currentBtcBlock-currentBtcRelayBlock, 0);
            return {
                feePerBlock: feePerBlock * options.feeSafetyFactor,
                safetyFactor: options.blockSafetyFactor,
                startTimestamp: startTimestamp,
                addBlock,
                addFee: claimFeeRate * options.feeSafetyFactor
            }
        } catch (e) {
            abortController.abort(e);
            return null;
        }
    }

    /**
     * Returns calculated claimer bounty calculated from the claimer bounty data as fetched from preFetchClaimerBounty()
     *
     * @param data Parsed swap data returned from the intermediary
     * @param options Options as passed to the swap creation function
     * @param claimerBounty Claimer bounty data as fetched from preFetchClaimerBounty() function
     * @private
     */
    private getClaimerBounty(
        data: T["Data"],
        options: FromBTCOptions,
        claimerBounty: {
            feePerBlock: bigint,
            safetyFactor: number,
            startTimestamp: bigint,
            addBlock: number,
            addFee: bigint
        }
    ) : bigint {
        const tsDelta = data.getExpiry() - claimerBounty.startTimestamp;
        const blocksDelta = tsDelta / BigInt(this.options.bitcoinBlocktime) * BigInt(options.blockSafetyFactor);
        const totalBlock = blocksDelta + BigInt(claimerBounty.addBlock);
        return claimerBounty.addFee + (totalBlock * claimerBounty.feePerBlock);
    }

    /**
     * Verifies response returned from intermediary
     *
     * @param signer
     * @param resp Response as returned by the intermediary
     * @param amountData
     * @param lp Intermediary
     * @param options Options as passed to the swap creation function
     * @param data Parsed swap data returned by the intermediary
     * @param sequence Required swap sequence
     * @param claimerBounty Claimer bount data as returned from the preFetchClaimerBounty() pre-fetch promise
     * @param depositToken
     * @private
     * @throws {IntermediaryError} in case the response is invalid
     */
    private verifyReturnedData(
        signer: string,
        resp: FromBTCResponseType,
        amountData: AmountData,
        lp: Intermediary,
        options: FromBTCOptions,
        data: T["Data"],
        sequence: bigint,
        claimerBounty: {
            feePerBlock: bigint,
            safetyFactor: number,
            startTimestamp: bigint,
            addBlock: number,
            addFee: bigint
        },
        depositToken: string
    ): void {
        if(amountData.exactIn) {
            if(resp.amount !== amountData.amount) throw new IntermediaryError("Invalid amount returned");
        } else {
            if(resp.total !== amountData.amount) throw new IntermediaryError("Invalid total returned");
        }

        const requiredConfirmations = resp.confirmations ?? lp.services[SwapType.FROM_BTC].data.confirmations;
        if(requiredConfirmations>this.options.maxConfirmations) throw new IntermediaryError("Requires too many confirmations");

        const totalClaimerBounty = this.getClaimerBounty(data, options, claimerBounty);

        if(
            data.getClaimerBounty() !== totalClaimerBounty ||
            data.getType()!=ChainSwapType.CHAIN ||
            data.getSequence() !== sequence ||
            data.getAmount() !== resp.total ||
            data.isPayIn() ||
            !data.isToken(amountData.token) ||
            !data.isOfferer(lp.getAddress(this.chainIdentifier)) ||
            !data.isClaimer(signer) ||
            !data.isDepositToken(depositToken) ||
            data.hasSuccessAction()
        ) {
            throw new IntermediaryError("Invalid data returned");
        }

        //Check that we have enough time to send the TX and for it to confirm
        const expiry = this.getOnchainSendTimeout(data, requiredConfirmations);
        const currentTimestamp = BigInt(Math.floor(Date.now()/1000));
        if((expiry - currentTimestamp) < BigInt(this.options.minSendWindow)) {
            throw new IntermediaryError("Send window too low");
        }

        const lockingScript = toOutputScript(this.options.bitcoinNetwork, resp.btcAddress);
        const desiredExtraData = this.contract.getExtraData(lockingScript, resp.amount, requiredConfirmations);
        const desiredClaimHash = this.contract.getHashForOnchain(lockingScript, resp.amount, requiredConfirmations);
        if(!desiredClaimHash.equals(Buffer.from(data.getClaimHash(), "hex"))) {
            throw new IntermediaryError("Invalid claim hash returned!");
        }
        if(!desiredExtraData.equals(Buffer.from(data.getExtraData(), "hex"))) {
            throw new IntermediaryError("Invalid extra data returned!");
        }
    }

    /**
     * Returns a newly created swap, receiving 'amount' on chain
     *
     * @param signer                Smartchain signer's address intiating the swap
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers) to get the quotes from
     * @param options               Quote options
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     */
    create(
        signer: string,
        amountData: AmountData,
        lps: Intermediary[],
        options?: FromBTCOptions,
        additionalParams?: Record<string, any>,
        abortSignal?: AbortSignal
    ): {
        quote: Promise<FromBTCSwap<T>>,
        intermediary: Intermediary
    }[] {
        options ??= {};
        options.blockSafetyFactor ??= 1;
        options.feeSafetyFactor ??= 2n;

        const sequence: bigint = this.getRandomSequence();

        const _abortController = extendAbortController(abortSignal);
        const pricePrefetchPromise: Promise<bigint> = this.preFetchPrice(amountData, _abortController.signal);
        const claimerBountyPrefetchPromise = this.preFetchClaimerBounty(signer, amountData, options, _abortController);
        const nativeTokenAddress = this.chain.getNativeCurrencyAddress();
        const feeRatePromise: Promise<any> = this.preFetchFeeRate(signer, amountData, null, _abortController);
        const _signDataPromise: Promise<any> = this.contract.preFetchBlockDataForSignatures==null ? this.preFetchSignData(Promise.resolve(true)) : null;

        return lps.map(lp => {
            return {
                intermediary: lp,
                quote: (async () => {
                    const abortController = extendAbortController(_abortController.signal);
                    const liquidityPromise: Promise<bigint> = this.preFetchIntermediaryLiquidity(amountData, lp, abortController);

                    try {
                        const {signDataPromise, resp} = await tryWithRetries(async(retryCount: number) => {
                            const {signDataPrefetch, response} = IntermediaryAPI.initFromBTC(
                                this.chainIdentifier, lp.url, nativeTokenAddress,
                                {
                                    claimer: signer,
                                    amount: amountData.amount,
                                    token: amountData.token.toString(),

                                    exactOut: !amountData.exactIn,
                                    sequence,

                                    claimerBounty: claimerBountyPrefetchPromise,
                                    feeRate: feeRatePromise,
                                    additionalParams
                                },
                                this.options.postRequestTimeout, abortController.signal, retryCount>0 ? false : null
                            );

                            return {
                                signDataPromise: _signDataPromise ?? this.preFetchSignData(signDataPrefetch),
                                resp: await response
                            };
                        }, null, e => e instanceof RequestError, abortController.signal);

                        const data: T["Data"] = new this.swapDataDeserializer(resp.data);
                        data.setClaimer(signer);

                        this.verifyReturnedData(signer, resp, amountData, lp, options, data, sequence, await claimerBountyPrefetchPromise, nativeTokenAddress);
                        const [pricingInfo, signatureExpiry] = await Promise.all([
                            //Get intermediary's liquidity
                            this.verifyReturnedPrice(
                                lp.services[SwapType.FROM_BTC], false, resp.amount, resp.total,
                                amountData.token, {}, pricePrefetchPromise, abortController.signal
                            ),
                            this.verifyReturnedSignature(signer, data, resp, feeRatePromise, signDataPromise, abortController.signal),
                            this.verifyIntermediaryLiquidity(data.getAmount(), liquidityPromise),
                        ]);

                        const quote = new FromBTCSwap<T>(this, {
                            pricingInfo,
                            url: lp.url,
                            expiry: signatureExpiry,
                            swapFee: resp.swapFee,
                            feeRate: await feeRatePromise,
                            signatureData: resp,
                            data,
                            address: resp.btcAddress,
                            amount: resp.amount,
                            exactIn: amountData.exactIn ?? true,
                            requiredConfirmations: resp.confirmations ?? lp.services[SwapType.FROM_BTC].data.confirmations
                        } as FromBTCSwapInit<T["Data"]>);
                        await quote._save();
                        return quote;
                    } catch (e) {
                        abortController.abort(e);
                        throw e;
                    }
                })()
            }
        });
    }

}
