import {ISwapPrice} from "../../prices/abstract/ISwapPrice";
import {
    BitcoinNetwork,
    BtcRelay,
    ChainData,
    ChainSwapType,
    ChainType,
    Messenger,
    RelaySynchronizer
} from "@atomiqlabs/base";
import {
    InvoiceCreateService,
    isInvoiceCreateService,
    ToBTCLNOptions,
    ToBTCLNWrapper
} from "../escrow_swaps/tobtc/ln/ToBTCLNWrapper";
import {ToBTCOptions, ToBTCWrapper} from "../escrow_swaps/tobtc/onchain/ToBTCWrapper";
import {FromBTCLNOptions, FromBTCLNWrapper} from "../escrow_swaps/frombtc/ln/FromBTCLNWrapper";
import {FromBTCOptions, FromBTCWrapper} from "../escrow_swaps/frombtc/onchain/FromBTCWrapper";
import {IntermediaryDiscovery, MultichainSwapBounds, SwapBounds} from "../../intermediaries/IntermediaryDiscovery";
import {decode as bolt11Decode} from "@atomiqlabs/bolt11";
import {ISwap} from "../ISwap";
import {IntermediaryError} from "../../errors/IntermediaryError";
import {SwapType} from "../enums/SwapType";
import {FromBTCLNSwap} from "../escrow_swaps/frombtc/ln/FromBTCLNSwap";
import {FromBTCSwap} from "../escrow_swaps/frombtc/onchain/FromBTCSwap";
import {ToBTCLNSwap} from "../escrow_swaps/tobtc/ln/ToBTCLNSwap";
import {ToBTCSwap} from "../escrow_swaps/tobtc/onchain/ToBTCSwap";
import {MempoolApi} from "../../btc/mempool/MempoolApi";
import {MempoolBitcoinRpc} from "../../btc/mempool/MempoolBitcoinRpc";
import {MempoolBtcRelaySynchronizer} from "../../btc/mempool/synchronizer/MempoolBtcRelaySynchronizer";
import {LnForGasWrapper} from "../trusted/ln/LnForGasWrapper";
import {LnForGasSwap} from "../trusted/ln/LnForGasSwap";
import {EventEmitter} from "events";
import {MempoolBitcoinBlock} from "../../btc/mempool/MempoolBitcoinBlock";
import {Intermediary} from "../../intermediaries/Intermediary";
import {isLNURLPay, isLNURLWithdraw, LNURLPay, LNURLWithdraw} from "../../utils/LNURL";
import {AmountData, ISwapWrapper, WrapperCtorTokens} from "../ISwapWrapper";
import {
    bigIntCompare,
    bigIntMax,
    bigIntMin,
    getLogger,
    objectMap,
    randomBytes,
    tryWithRetries
} from "../../utils/Utils";
import {OutOfBoundsError} from "../../errors/RequestError";
import {SwapperWithChain} from "./SwapperWithChain";
import {
    BitcoinTokens,
    BtcToken,
    fromDecimal,
    isBtcToken,
    isSCToken,
    SCToken,
    Token,
    TokenAmount,
    toTokenAmount
} from "../../Tokens";
import {OnchainForGasSwap} from "../trusted/onchain/OnchainForGasSwap";
import {OnchainForGasWrapper} from "../trusted/onchain/OnchainForGasWrapper";
import {BTC_NETWORK, NETWORK, TEST_NETWORK} from "@scure/btc-signer/utils";
import {IUnifiedStorage, QueryParams} from "../../storage/IUnifiedStorage";
import {IndexedDBUnifiedStorage} from "../../browser-storage/IndexedDBUnifiedStorage";
import {
    UnifiedSwapStorage,
    UnifiedSwapStorageCompositeIndexes,
    UnifiedSwapStorageIndexes
} from "../../storage/UnifiedSwapStorage";
import {UnifiedSwapEventListener} from "../../events/UnifiedSwapEventListener";
import {IToBTCSwap} from "../escrow_swaps/tobtc/IToBTCSwap";
import {SpvFromBTCOptions, SpvFromBTCWrapper} from "../spv_swaps/SpvFromBTCWrapper";
import {SpvFromBTCSwap} from "../spv_swaps/SpvFromBTCSwap";
import {SwapperUtils} from "./utils/SwapperUtils";
import {FromBTCLNAutoOptions, FromBTCLNAutoWrapper} from "../escrow_swaps/frombtc/ln_auto/FromBTCLNAutoWrapper";
import {FromBTCLNAutoSwap} from "../escrow_swaps/frombtc/ln_auto/FromBTCLNAutoSwap";
import {UserError} from "../../errors/UserError";
import {SwapAmountType} from "../enums/SwapAmountType";
import {IClaimableSwap} from "../IClaimableSwap";
import {correctClock} from "../../utils/AutomaticClockDriftCorrection";

export type SwapperOptions = {
    intermediaryUrl?: string | string[],
    registryUrl?: string,

    bitcoinNetwork?: BitcoinNetwork,

    getRequestTimeout?: number,
    postRequestTimeout?: number,
    defaultAdditionalParameters?: {[key: string]: any},
    storagePrefix?: string
    defaultTrustedIntermediaryUrl?: string,

    swapStorage?: <T extends ChainType>(chainId: T["ChainId"]) => IUnifiedStorage<UnifiedSwapStorageIndexes, UnifiedSwapStorageCompositeIndexes>,

    noTimers?: boolean,
    noEvents?: boolean,
    noSwapCache?: boolean,
    dontCheckPastSwaps?: boolean,
    dontFetchLPs?: boolean,
    saveUninitializedSwaps?: boolean, //automatically persist all created swaps - by default only initiated swaps are persisted
    automaticClockDriftCorrection?: boolean
};

export type MultiChain = {
    [chainIdentifier in string]: ChainType;
};

export type ChainSpecificData<T extends ChainType> = {
    wrappers: {
        [SwapType.TO_BTCLN]: ToBTCLNWrapper<T>,
        [SwapType.TO_BTC]: ToBTCWrapper<T>,
        [SwapType.FROM_BTCLN]: FromBTCLNWrapper<T>,
        [SwapType.FROM_BTC]: FromBTCWrapper<T>,
        [SwapType.TRUSTED_FROM_BTCLN]: LnForGasWrapper<T>,
        [SwapType.TRUSTED_FROM_BTC]: OnchainForGasWrapper<T>,
        [SwapType.SPV_VAULT_FROM_BTC]: SpvFromBTCWrapper<T>,
        [SwapType.FROM_BTCLN_AUTO]: FromBTCLNAutoWrapper<T>
    }
    chainEvents: T["Events"],
    swapContract: T["Contract"],
    spvVaultContract: T["SpvVaultContract"],
    chainInterface: T["ChainInterface"],
    btcRelay: BtcRelay<any, T["TX"], MempoolBitcoinBlock, T["Signer"]>,
    synchronizer: RelaySynchronizer<any, T["TX"], MempoolBitcoinBlock>,
    unifiedChainEvents: UnifiedSwapEventListener<T>,
    unifiedSwapStorage: UnifiedSwapStorage<T>,
    reviver: (val: any) => ISwap<T>
};

export type MultiChainData<T extends MultiChain> = {
    [chainIdentifier in keyof T]: ChainSpecificData<T[chainIdentifier]>
};

export type CtorMultiChainData<T extends MultiChain> = {
    [chainIdentifier in keyof T]: ChainData<T[chainIdentifier]>
};

export type ChainIds<T extends MultiChain> = keyof T & string;

type NotNever<T> = [T] extends [never] ? false : true;

export type SupportsSwapType<
    C extends ChainType,
    Type extends SwapType
> = Type extends SwapType.SPV_VAULT_FROM_BTC ?
        NotNever<C["SpvVaultContract"]> :
    Type extends (SwapType.TRUSTED_FROM_BTCLN | SwapType.TRUSTED_FROM_BTC) ?
        true :
    Type extends SwapType.FROM_BTCLN_AUTO ? (C["Contract"]["supportsInitWithoutClaimer"] extends true ? true : false) :
        NotNever<C["Contract"]>;

export class Swapper<T extends MultiChain> extends EventEmitter<{
    lpsRemoved: [Intermediary[]],
    lpsAdded: [Intermediary[]],
    swapState: [ISwap],
    swapLimitsChanged: []
}> {

    protected readonly logger = getLogger(this.constructor.name+": ");

    protected readonly swapStateListener: (swap: ISwap) => void;

    private defaultTrustedIntermediary: Intermediary;

    readonly chains: MultiChainData<T>;

    readonly prices: ISwapPrice<T>;
    readonly intermediaryDiscovery: IntermediaryDiscovery;
    readonly options: SwapperOptions;

    readonly mempoolApi: MempoolApi;
    readonly bitcoinRpc: MempoolBitcoinRpc;
    readonly bitcoinNetwork: BTC_NETWORK;
    private readonly _bitcoinNetwork: BitcoinNetwork;
    readonly tokens: {
        [chainId: string]: {
            [tokenAddress: string]: SCToken
        }
    };
    readonly tokensByTicker: {
        [chainId: string]: {
            [tokenTicker: string]: SCToken
        }
    };
    readonly Utils: SwapperUtils<T>;
    readonly messenger: Messenger;

    constructor(
        bitcoinRpc: MempoolBitcoinRpc,
        chainsData: CtorMultiChainData<T>,
        pricing: ISwapPrice<T>,
        tokens: WrapperCtorTokens<T>,
        messenger: Messenger,
        options?: SwapperOptions
    ) {
        super();
        const storagePrefix = options?.storagePrefix ?? "atomiq-";

        options.bitcoinNetwork = options.bitcoinNetwork==null ? BitcoinNetwork.TESTNET : options.bitcoinNetwork;
        options.swapStorage ??= (name: string) => new IndexedDBUnifiedStorage(name);

        this._bitcoinNetwork = options.bitcoinNetwork;
        this.bitcoinNetwork = options.bitcoinNetwork===BitcoinNetwork.MAINNET ? NETWORK :
            (options.bitcoinNetwork===BitcoinNetwork.TESTNET || options.bitcoinNetwork===BitcoinNetwork.TESTNET4) ? TEST_NETWORK : {
                bech32: 'bcrt',
                pubKeyHash: 111,
                scriptHash: 196,
                wif: 239
            };
        this.Utils = new SwapperUtils(this);

        this.prices = pricing;
        this.bitcoinRpc = bitcoinRpc;
        this.mempoolApi = bitcoinRpc.api;
        this.messenger = messenger;

        this.options = options;

        this.tokens = {};
        this.tokensByTicker = {};
        for(let tokenData of tokens) {
            for(let chainId in tokenData.chains) {
                const chainData = tokenData.chains[chainId];
                this.tokens[chainId] ??= {};
                this.tokensByTicker[chainId] ??= {};
                this.tokens[chainId][chainData.address] = this.tokensByTicker[chainId][tokenData.ticker] = {
                    chain: "SC",
                    chainId,
                    ticker: tokenData.ticker,
                    name: tokenData.name,
                    decimals: chainData.decimals,
                    displayDecimals: chainData.displayDecimals,
                    address: chainData.address
                }
            }
        }

        this.swapStateListener = (swap: ISwap) => {
            this.emit("swapState", swap);
        };

        this.chains = objectMap<CtorMultiChainData<T>, MultiChainData<T>>(chainsData, <InputKey extends keyof CtorMultiChainData<T>>(chainData: CtorMultiChainData<T>[InputKey], key: string) => {
            const {
                swapContract, chainEvents, btcRelay,
                chainInterface, spvVaultContract, spvVaultWithdrawalDataConstructor
            } = chainData;
            const synchronizer = new MempoolBtcRelaySynchronizer(btcRelay, bitcoinRpc);

            const storageHandler = options.swapStorage(storagePrefix + chainData.chainId);
            const unifiedSwapStorage = new UnifiedSwapStorage<T[InputKey]>(storageHandler, this.options.noSwapCache);
            const unifiedChainEvents = new UnifiedSwapEventListener<T[InputKey]>(unifiedSwapStorage, chainEvents);

            const wrappers: any = {};

            wrappers[SwapType.TO_BTCLN] = new ToBTCLNWrapper<T[InputKey]>(
                key,
                unifiedSwapStorage,
                unifiedChainEvents,
                chainInterface,
                swapContract,
                pricing,
                tokens,
                chainData.swapDataConstructor,
                {
                    getRequestTimeout: options.getRequestTimeout,
                    postRequestTimeout: options.postRequestTimeout,
                }
            );
            wrappers[SwapType.TO_BTC] = new ToBTCWrapper<T[InputKey]>(
                key,
                unifiedSwapStorage,
                unifiedChainEvents,
                chainInterface,
                swapContract,
                pricing,
                tokens,
                chainData.swapDataConstructor,
                this.bitcoinRpc,
                {
                    getRequestTimeout: options.getRequestTimeout,
                    postRequestTimeout: options.postRequestTimeout,
                    bitcoinNetwork: this.bitcoinNetwork
                }
            );
            wrappers[SwapType.FROM_BTCLN] = new FromBTCLNWrapper<T[InputKey]>(
                key,
                unifiedSwapStorage,
                unifiedChainEvents,
                chainInterface,
                swapContract,
                pricing,
                tokens,
                chainData.swapDataConstructor,
                bitcoinRpc,
                {
                    getRequestTimeout: options.getRequestTimeout,
                    postRequestTimeout: options.postRequestTimeout,
                    unsafeSkipLnNodeCheck: this._bitcoinNetwork===BitcoinNetwork.TESTNET4 || this._bitcoinNetwork===BitcoinNetwork.REGTEST
                }
            );
            wrappers[SwapType.FROM_BTC] = new FromBTCWrapper<T[InputKey]>(
                key,
                unifiedSwapStorage,
                unifiedChainEvents,
                chainInterface,
                swapContract,
                pricing,
                tokens,
                chainData.swapDataConstructor,
                btcRelay,
                synchronizer,
                this.bitcoinRpc,
                {
                    getRequestTimeout: options.getRequestTimeout,
                    postRequestTimeout: options.postRequestTimeout,
                    bitcoinNetwork: this.bitcoinNetwork
                }
            );
            wrappers[SwapType.TRUSTED_FROM_BTCLN] = new LnForGasWrapper<T[InputKey]>(
                key,
                unifiedSwapStorage,
                unifiedChainEvents,
                chainInterface,
                pricing,
                tokens,
                {
                    getRequestTimeout: options.getRequestTimeout,
                    postRequestTimeout: options.postRequestTimeout
                }
            );
            wrappers[SwapType.TRUSTED_FROM_BTC] = new OnchainForGasWrapper<T[InputKey]>(
                key,
                unifiedSwapStorage,
                unifiedChainEvents,
                chainInterface,
                pricing,
                tokens,
                bitcoinRpc,
                {
                    getRequestTimeout: options.getRequestTimeout,
                    postRequestTimeout: options.postRequestTimeout,
                    bitcoinNetwork: this.bitcoinNetwork
                }
            );

            if(spvVaultContract!=null) {
                wrappers[SwapType.SPV_VAULT_FROM_BTC] = new SpvFromBTCWrapper<T[InputKey]>(
                    key,
                    unifiedSwapStorage,
                    unifiedChainEvents,
                    chainInterface,
                    spvVaultContract,
                    pricing,
                    tokens,
                    spvVaultWithdrawalDataConstructor,
                    btcRelay,
                    synchronizer,
                    bitcoinRpc,
                    {
                        getRequestTimeout: options.getRequestTimeout,
                        postRequestTimeout: options.postRequestTimeout,
                        bitcoinNetwork: this.bitcoinNetwork
                    }
                );
            }

            if(swapContract.supportsInitWithoutClaimer) {
                wrappers[SwapType.FROM_BTCLN_AUTO] = new FromBTCLNAutoWrapper<T[InputKey]>(
                    key,
                    unifiedSwapStorage,
                    unifiedChainEvents,
                    chainInterface,
                    swapContract,
                    pricing,
                    tokens,
                    chainData.swapDataConstructor,
                    bitcoinRpc,
                    this.messenger,
                    {
                        getRequestTimeout: options.getRequestTimeout,
                        postRequestTimeout: options.postRequestTimeout,
                        unsafeSkipLnNodeCheck: this._bitcoinNetwork===BitcoinNetwork.TESTNET4 || this._bitcoinNetwork===BitcoinNetwork.REGTEST
                    }
                );
            }

            Object.keys(wrappers).forEach(key => wrappers[key].events.on("swapState", this.swapStateListener));

            const reviver = (val: any) => {
                const wrapper = wrappers[val.type];
                if(wrapper==null) return null;
                return new wrapper.swapDeserializer(wrapper, val);
            };

            return {
                chainEvents,
                spvVaultContract,
                swapContract,
                chainInterface,
                btcRelay,
                synchronizer,

                wrappers,

                unifiedChainEvents,
                unifiedSwapStorage,

                reviver
            }
        });

        const contracts = objectMap(chainsData, (data) => data.swapContract);
        if(options.intermediaryUrl!=null) {
            this.intermediaryDiscovery = new IntermediaryDiscovery(contracts, options.registryUrl, Array.isArray(options.intermediaryUrl) ? options.intermediaryUrl : [options.intermediaryUrl], options.getRequestTimeout);
        } else {
            this.intermediaryDiscovery = new IntermediaryDiscovery(contracts, options.registryUrl, null, options.getRequestTimeout);
        }

        this.intermediaryDiscovery.on("removed", (intermediaries: Intermediary[]) => {
            this.emit("lpsRemoved", intermediaries);
        });

        this.intermediaryDiscovery.on("added", (intermediaries: Intermediary[]) => {
            this.emit("lpsAdded", intermediaries);
        });
    }

    private async _init(): Promise<void> {
        this.logger.debug("init(): Initializing swapper, sdk-lib version 16.1.3");

        const abortController = new AbortController();

        const promises: Promise<void>[] = [];
        let automaticClockDriftCorrectionPromise: Promise<void>;
        if(this.options.automaticClockDriftCorrection) {
            promises.push(automaticClockDriftCorrectionPromise = tryWithRetries(correctClock, undefined, undefined, abortController.signal).catch((err) => {
                abortController.abort(err);
            }));
        }

        this.logger.debug("init(): Initializing intermediary discovery");
        if(!this.options.dontFetchLPs) promises.push(this.intermediaryDiscovery.init(abortController.signal).catch(err => {
            if(abortController.signal.aborted) return;
            this.logger.error("init(): Failed to fetch intermediaries/LPs: ", err);
        }));

        if(this.options.defaultTrustedIntermediaryUrl!=null) {
            promises.push(
                this.intermediaryDiscovery.getIntermediary(this.options.defaultTrustedIntermediaryUrl, abortController.signal)
                    .then(val => {
                        this.defaultTrustedIntermediary = val;
                    })
                    .catch(err => {
                        if(abortController.signal.aborted) return;
                        this.logger.error("init(): Failed to contact trusted LP url: ", err);
                    })
            );
        }

        if(automaticClockDriftCorrectionPromise!=null) {
            //We should await the promises here before checking the swaps
            await automaticClockDriftCorrectionPromise;
        }

        const chainPromises = [];
        for(let chainIdentifier in this.chains) {
            chainPromises.push((async() => {
                const {
                    swapContract,
                    unifiedChainEvents,
                    unifiedSwapStorage,
                    wrappers,
                    reviver
                } = this.chains[chainIdentifier];
                await swapContract.start();
                this.logger.debug("init(): Intialized swap contract: "+chainIdentifier);

                await unifiedSwapStorage.init();
                if(unifiedSwapStorage.storage instanceof IndexedDBUnifiedStorage) {
                    //Try to migrate the data here
                    const storagePrefix = chainIdentifier==="SOLANA" ?
                        "SOLv4-"+this._bitcoinNetwork+"-Swaps-" :
                        "atomiqsdk-"+this._bitcoinNetwork+chainIdentifier+"-Swaps-";
                    await unifiedSwapStorage.storage.tryMigrate(
                        [
                            [storagePrefix+"FromBTC", SwapType.FROM_BTC],
                            [storagePrefix+"FromBTCLN", SwapType.FROM_BTCLN],
                            [storagePrefix+"ToBTC", SwapType.TO_BTC],
                            [storagePrefix+"ToBTCLN", SwapType.TO_BTCLN]
                        ],
                        (obj: any) => {
                            const swap = reviver(obj);
                            if(swap.randomNonce==null) {
                                const oldIdentifierHash = swap.getId();
                                swap.randomNonce = randomBytes(16).toString("hex");
                                const newIdentifierHash = swap.getId();
                                this.logger.info("init(): Found older swap version without randomNonce, replacing, old hash: "+oldIdentifierHash+
                                    " new hash: "+newIdentifierHash);
                            }
                            return swap;
                        }
                    )
                }

                if(!this.options.noEvents) await unifiedChainEvents.start();
                this.logger.debug("init(): Intialized events: "+chainIdentifier);

                for(let key in wrappers) {
                    // this.logger.debug("init(): Initializing "+SwapType[key]+": "+chainIdentifier);
                    await wrappers[key].init(this.options.noTimers, this.options.dontCheckPastSwaps);
                }
            })());
        }
        await Promise.all(chainPromises);

        await Promise.all(promises);

        this.logger.debug("init(): Initializing messenger");
        await this.messenger.init();
    }

    private initPromise: Promise<void>;
    private initialized: boolean = false;

    /**
     * Initializes the swap storage and loads existing swaps, needs to be called before any other action
     */
    async init(): Promise<void> {
        if(this.initialized) return;
        if(this.initPromise!=null) await this.initPromise;

        try {
            const promise = this._init();
            this.initPromise = promise;
            await promise;
            delete this.initPromise;
            this.initialized = true;
        } catch (e) {
            delete this.initPromise;
            throw e;
        }
    }

    /**
     * Stops listening for onchain events and closes this Swapper instance
     */
    async stop() {
        if(this.initPromise) await this.initPromise;
        for(let chainIdentifier in this.chains) {
            const {
                wrappers,
                unifiedChainEvents
            } = this.chains[chainIdentifier];
            for(let key in wrappers) {
                (wrappers[key] as ISwapWrapper<any, any>).events.removeListener("swapState", this.swapStateListener);
                await wrappers[key].stop();
            }
            await unifiedChainEvents.stop();
            await this.messenger.stop();
        }
        this.initialized = false;
    }

    /**
     * Creates swap & handles intermediary, quote selection
     *
     * @param chainIdentifier
     * @param create Callback to create the
     * @param amountData Amount data as passed to the function
     * @param swapType Swap type of the execution
     * @param maxWaitTimeMS Maximum waiting time after the first intermediary returns the quote
     * @private
     * @throws {Error} when no intermediary was found
     * @throws {Error} if the chain with the provided identifier cannot be found
     */
    private async createSwap<ChainIdentifier extends ChainIds<T>, S extends ISwap<T[ChainIdentifier]>>(
        chainIdentifier: ChainIdentifier,
        create: (candidates: Intermediary[], abortSignal: AbortSignal, chain: ChainSpecificData<T[ChainIdentifier]>) => Promise<{
            quote: Promise<S>,
            intermediary: Intermediary
        }[]>,
        amountData: AmountData,
        swapType: SwapType,
        maxWaitTimeMS: number = 2000
    ): Promise<S> {
        if(!this.initialized) throw new Error("Swapper not initialized, init first with swapper.init()!");
        if(this.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        let candidates: Intermediary[];

        const inBtc: boolean = swapType===SwapType.TO_BTCLN || swapType===SwapType.TO_BTC ? !amountData.exactIn : amountData.exactIn;

        if(!inBtc) {
            //Get candidates not based on the amount
            candidates = this.intermediaryDiscovery.getSwapCandidates(chainIdentifier, swapType, amountData.token);
        } else {
            candidates = this.intermediaryDiscovery.getSwapCandidates(chainIdentifier, swapType, amountData.token, amountData.amount);
        }

        let swapLimitsChanged = false;

        if(candidates.length===0)  {
            this.logger.warn("createSwap(): No valid intermediary found, reloading intermediary database...");
            await this.intermediaryDiscovery.reloadIntermediaries();
            swapLimitsChanged = true;

            if(!inBtc) {
                //Get candidates not based on the amount
                candidates = this.intermediaryDiscovery.getSwapCandidates(chainIdentifier, swapType, amountData.token);
            } else {
                candidates = this.intermediaryDiscovery.getSwapCandidates(chainIdentifier, swapType, amountData.token, amountData.amount);

                if(candidates.length===0) {
                    const min = this.intermediaryDiscovery.getSwapMinimum(chainIdentifier, swapType, amountData.token);
                    const max = this.intermediaryDiscovery.getSwapMaximum(chainIdentifier, swapType, amountData.token);
                    if(min!=null && max!=null) {
                        if(amountData.amount < BigInt(min)) throw new OutOfBoundsError("Amount too low!", 200, BigInt(min), BigInt(max));
                        if(amountData.amount > BigInt(max)) throw new OutOfBoundsError("Amount too high!", 200, BigInt(min), BigInt(max));
                    }
                }
            }

            if(candidates.length===0) throw new Error("No intermediary found!");
        }


        const abortController = new AbortController();
        this.logger.debug("createSwap() Swap candidates: ", candidates.map(lp => lp.url).join());
        const quotePromises: {quote: Promise<S>, intermediary: Intermediary}[] = await create(candidates, abortController.signal, this.chains[chainIdentifier]);

        const promiseAll = new Promise<{
            quote: S,
            intermediary: Intermediary
        }[]>((resolve, reject) => {
            let min: bigint;
            let max: bigint;
            let error: Error;
            let numResolved = 0;
            let quotes: {
                quote: S,
                intermediary: Intermediary
            }[] = [];
            let timeout: NodeJS.Timeout;

            quotePromises.forEach(data => {
                data.quote.then(quote => {
                    if(numResolved===0) {
                        timeout = setTimeout(() => {
                            abortController.abort(new Error("Timed out waiting for quote!"));
                            resolve(quotes);
                        }, maxWaitTimeMS);
                    }
                    numResolved++;
                    quotes.push({
                        quote,
                        intermediary: data.intermediary
                    });
                    if(numResolved===quotePromises.length) {
                        clearTimeout(timeout);
                        resolve(quotes);
                        return;
                    }
                }).catch(e => {
                    numResolved++;
                    if(e instanceof IntermediaryError) {
                        //Blacklist that node
                        this.intermediaryDiscovery.removeIntermediary(data.intermediary);
                        swapLimitsChanged = true;
                    } else if(e instanceof OutOfBoundsError) {
                        if(min==null || max==null) {
                            min = e.min;
                            max = e.max;
                        } else {
                            min = bigIntMin(min, e.min);
                            max = bigIntMax(max, e.max);
                        }
                        data.intermediary.swapBounds[swapType] ??= {};
                        data.intermediary.swapBounds[swapType][chainIdentifier] ??= {};
                        const tokenBoundsData = (data.intermediary.swapBounds[swapType][chainIdentifier][amountData.token] ??= {input: null, output: null});
                        if(amountData.exactIn) {
                            tokenBoundsData.input = {min: e.min, max: e.max};
                        } else {
                            tokenBoundsData.output = {min: e.min, max: e.max};
                        }
                        swapLimitsChanged = true;
                    }
                    this.logger.warn("createSwap(): Intermediary "+data.intermediary.url+" error: ", e);
                    error = e;

                    if(numResolved===quotePromises.length) {
                        if(timeout!=null) clearTimeout(timeout);
                        if(quotes.length>0) {
                            resolve(quotes);
                            return;
                        }
                        if(min!=null && max!=null) {
                            reject(new OutOfBoundsError("Out of bounds", 400, min, max));
                            return;
                        }
                        reject(error);
                    }
                });
            });
        });

        try {
            const quotes = await promiseAll;

            //TODO: Intermediary's reputation is not taken into account!
            quotes.sort((a, b) => {
                if(amountData.exactIn) {
                    //Compare outputs
                    return bigIntCompare(b.quote.getOutput().rawAmount, a.quote.getOutput().rawAmount);
                } else {
                    //Compare inputs
                    return bigIntCompare(a.quote.getInput().rawAmount, b.quote.getInput().rawAmount);
                }
            });

            this.logger.debug("createSwap(): Sorted quotes, best price to worst: ", quotes);

            if(swapLimitsChanged) this.emit("swapLimitsChanged");

            const quote = quotes[0].quote;
            if(this.options.saveUninitializedSwaps) {
                quote._setInitiated();
                await quote._save();
            }
            return quote;
        } catch (e) {
            if(swapLimitsChanged) this.emit("swapLimitsChanged");
            throw e;
        }
    }

    /**
     * Creates To BTC swap
     *
     * @param chainIdentifier
     * @param signer
     * @param tokenAddress          Token address to pay with
     * @param address               Recipient's bitcoin address
     * @param amount                Amount to send in satoshis (bitcoin's smallest denomination)
     * @param exactIn               Whether to use exact in instead of exact out
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param options
     */
    createToBTCSwap<ChainIdentifier extends ChainIds<T>>(
        chainIdentifier: ChainIdentifier,
        signer: string,
        tokenAddress: string,
        address: string,
        amount: bigint,
        exactIn?: boolean,
        additionalParams: Record<string, any> = this.options.defaultAdditionalParameters,
        options?: ToBTCOptions
    ): Promise<ToBTCSwap<T[ChainIdentifier]>> {
        if(this.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        if(address.startsWith("bitcoin:")) {
            address = address.substring(8).split("?")[0];
        }
        if(!this.Utils.isValidBitcoinAddress(address)) throw new Error("Invalid bitcoin address");
        if(!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true)) throw new Error("Invalid "+chainIdentifier+" address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        options ??= {};
        options.confirmationTarget ??= 3;
        options.confirmations ??= 2;
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn
        };
        return this.createSwap(
            chainIdentifier as ChainIdentifier,
            (candidates: Intermediary[], abortSignal, chain) => Promise.resolve(chain.wrappers[SwapType.TO_BTC].create(
                signer,
                address,
                amountData,
                candidates,
                options,
                additionalParams,
                abortSignal
            )),
            amountData,
            SwapType.TO_BTC
        );
    }

    /**
     * Creates To BTCLN swap
     *
     * @param chainIdentifier
     * @param signer
     * @param tokenAddress          Token address to pay with
     * @param paymentRequest        BOLT11 lightning network invoice to be paid (needs to have a fixed amount)
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param options
     */
    async createToBTCLNSwap<ChainIdentifier extends ChainIds<T>>(
        chainIdentifier: ChainIdentifier,
        signer: string,
        tokenAddress: string,
        paymentRequest: string,
        additionalParams: Record<string, any> = this.options.defaultAdditionalParameters,
        options?: ToBTCLNOptions
    ): Promise<ToBTCLNSwap<T[ChainIdentifier]>> {
        if(this.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        options ??= {};
        if(paymentRequest.startsWith("lightning:")) paymentRequest = paymentRequest.substring(10);
        if(!this.Utils.isValidLightningInvoice(paymentRequest)) throw new Error("Invalid lightning network invoice");
        if(!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true)) throw new Error("Invalid "+chainIdentifier+" address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        const parsedPR = bolt11Decode(paymentRequest);
        const amountData = {
            amount: (BigInt(parsedPR.millisatoshis) + 999n) / 1000n,
            token: tokenAddress,
            exactIn: false
        };
        options.expirySeconds ??= 5*24*3600;
        return this.createSwap(
            chainIdentifier as ChainIdentifier,
            (candidates: Intermediary[], abortSignal: AbortSignal, chain) => chain.wrappers[SwapType.TO_BTCLN].create(
                signer,
                paymentRequest,
                amountData,
                candidates,
                options,
                additionalParams,
                abortSignal
            ),
            amountData,
            SwapType.TO_BTCLN
        );
    }

    /**
     * Creates To BTCLN swap via LNURL-pay
     *
     * @param chainIdentifier
     * @param signer
     * @param tokenAddress          Token address to pay with
     * @param lnurlPay              LNURL-pay link to use for the payment
     * @param amount                Amount to be paid in sats
     * @param exactIn               Whether to do an exact in swap instead of exact out
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param options
     */
    async createToBTCLNSwapViaLNURL<ChainIdentifier extends ChainIds<T>>(
        chainIdentifier: ChainIdentifier,
        signer: string,
        tokenAddress: string,
        lnurlPay: string | LNURLPay,
        amount: bigint,
        exactIn?: boolean,
        additionalParams: Record<string, any>  = this.options.defaultAdditionalParameters,
        options?: ToBTCLNOptions & {comment?: string}
    ): Promise<ToBTCLNSwap<T[ChainIdentifier]>> {
        if(this.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        if(typeof(lnurlPay)==="string" && !this.Utils.isValidLNURL(lnurlPay)) throw new Error("Invalid LNURL-pay link");
        if(!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true)) throw new Error("Invalid "+chainIdentifier+" address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        options ??= {};
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn
        };
        options.expirySeconds ??= 5*24*3600;
        return this.createSwap(
            chainIdentifier as ChainIdentifier,
            (candidates: Intermediary[], abortSignal: AbortSignal, chain) => chain.wrappers[SwapType.TO_BTCLN].createViaLNURL(
                signer,
                typeof(lnurlPay)==="string" ? (lnurlPay.startsWith("lightning:") ? lnurlPay.substring(10): lnurlPay) : lnurlPay.params,
                amountData,
                candidates,
                options,
                additionalParams,
                abortSignal
            ),
            amountData,
            SwapType.TO_BTCLN
        );
    }

    /**
     * Creates To BTCLN swap via InvoiceCreationService
     *
     * @param chainIdentifier
     * @param signer
     * @param tokenAddress          Token address to pay with
     * @param service               Invoice create service object which facilitates the creation of fixed amount LN invoices
     * @param amount                Amount to be paid in sats
     * @param exactIn               Whether to do an exact in swap instead of exact out
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param options
     */
    async createToBTCLNSwapViaInvoiceCreateService<ChainIdentifier extends ChainIds<T>>(
        chainIdentifier: ChainIdentifier,
        signer: string,
        tokenAddress: string,
        service: InvoiceCreateService,
        amount: bigint,
        exactIn?: boolean,
        additionalParams: Record<string, any>  = this.options.defaultAdditionalParameters,
        options?: ToBTCLNOptions
    ): Promise<ToBTCLNSwap<T[ChainIdentifier]>> {
        if(this.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        if(!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true)) throw new Error("Invalid "+chainIdentifier+" address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        options ??= {};
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn
        };
        options.expirySeconds ??= 5*24*3600;
        return this.createSwap(
            chainIdentifier as ChainIdentifier,
            (candidates: Intermediary[], abortSignal: AbortSignal, chain) => chain.wrappers[SwapType.TO_BTCLN].createViaInvoiceCreateService(
                signer,
                Promise.resolve(service),
                amountData,
                candidates,
                options,
                additionalParams,
                abortSignal
            ),
            amountData,
            SwapType.TO_BTCLN
        );
    }

    /**
     * Creates From BTC swap
     *
     * @param chainIdentifier
     * @param signer
     * @param tokenAddress          Token address to receive
     * @param amount                Amount to receive, in satoshis (bitcoin's smallest denomination)
     * @param exactOut              Whether to use a exact out instead of exact in
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param options
     */
    async createFromBTCSwapNew<ChainIdentifier extends ChainIds<T>>(
        chainIdentifier: ChainIdentifier,
        signer: string,
        tokenAddress: string,
        amount: bigint,
        exactOut?: boolean,
        additionalParams: Record<string, any> = this.options.defaultAdditionalParameters,
        options?: SpvFromBTCOptions
    ): Promise<SpvFromBTCSwap<T[ChainIdentifier]>> {
        if(this.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        if(!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true)) throw new Error("Invalid "+chainIdentifier+" address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn: !exactOut
        };
        return this.createSwap(
            chainIdentifier as ChainIdentifier,
            (candidates: Intermediary[], abortSignal: AbortSignal, chain) => Promise.resolve(chain.wrappers[SwapType.SPV_VAULT_FROM_BTC].create(
                signer,
                amountData,
                candidates,
                options,
                additionalParams,
                abortSignal
            )),
            amountData,
            SwapType.SPV_VAULT_FROM_BTC
        );
    }

    /**
     * Creates From BTC swap
     *
     * @param chainIdentifier
     * @param signer
     * @param tokenAddress          Token address to receive
     * @param amount                Amount to receive, in satoshis (bitcoin's smallest denomination)
     * @param exactOut              Whether to use a exact out instead of exact in
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param options
     */
    async createFromBTCSwap<ChainIdentifier extends ChainIds<T>>(
        chainIdentifier: ChainIdentifier,
        signer: string,
        tokenAddress: string,
        amount: bigint,
        exactOut?: boolean,
        additionalParams: Record<string, any> = this.options.defaultAdditionalParameters,
        options?: FromBTCOptions
    ): Promise<FromBTCSwap<T[ChainIdentifier]>> {
        if(this.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        if(!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true)) throw new Error("Invalid "+chainIdentifier+" address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn: !exactOut
        };
        return this.createSwap(
            chainIdentifier as ChainIdentifier,
            (candidates: Intermediary[], abortSignal: AbortSignal, chain) => Promise.resolve(chain.wrappers[SwapType.FROM_BTC].create(
                signer,
                amountData,
                candidates,
                options,
                additionalParams,
                abortSignal
            )),
            amountData,
            SwapType.FROM_BTC
        );
    }

    /**
     * Creates From BTCLN swap
     *
     * @param chainIdentifier
     * @param signer
     * @param tokenAddress      Token address to receive
     * @param amount            Amount to receive, in satoshis (bitcoin's smallest denomination)
     * @param exactOut          Whether to use exact out instead of exact in
     * @param additionalParams  Additional parameters sent to the LP when creating the swap
     * @param options
     */
    async createFromBTCLNSwap<ChainIdentifier extends ChainIds<T>>(
        chainIdentifier: ChainIdentifier,
        signer: string,
        tokenAddress: string,
        amount: bigint,
        exactOut?: boolean,
        additionalParams: Record<string, any> = this.options.defaultAdditionalParameters,
        options?: FromBTCLNOptions
    ): Promise<FromBTCLNSwap<T[ChainIdentifier]>> {
        if(this.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        if(!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true)) throw new Error("Invalid "+chainIdentifier+" address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn: !exactOut
        };
        return this.createSwap(
            chainIdentifier as ChainIdentifier,
            (candidates: Intermediary[], abortSignal: AbortSignal, chain) => Promise.resolve(chain.wrappers[SwapType.FROM_BTCLN].create(
                signer,
                amountData,
                candidates,
                options,
                additionalParams,
                abortSignal
            )),
            amountData,
            SwapType.FROM_BTCLN
        );
    }

    /**
     * Creates From BTCLN swap, withdrawing from LNURL-withdraw
     *
     * @param chainIdentifier
     * @param signer
     * @param tokenAddress      Token address to receive
     * @param lnurl             LNURL-withdraw to pull the funds from
     * @param amount            Amount to receive, in satoshis (bitcoin's smallest denomination)
     * @param exactOut          Whether to use exact out instead of exact in
     * @param additionalParams  Additional parameters sent to the LP when creating the swap
     */
    async createFromBTCLNSwapViaLNURL<ChainIdentifier extends ChainIds<T>>(
        chainIdentifier: ChainIdentifier,
        signer: string,
        tokenAddress: string,
        lnurl: string | LNURLWithdraw,
        amount: bigint,
        exactOut?: boolean,
        additionalParams: Record<string, any> = this.options.defaultAdditionalParameters
    ): Promise<FromBTCLNSwap<T[ChainIdentifier]>> {
        if(this.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        if(typeof(lnurl)==="string" && !this.Utils.isValidLNURL(lnurl)) throw new Error("Invalid LNURL-withdraw link");
        if(!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true)) throw new Error("Invalid "+chainIdentifier+" address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn: !exactOut
        };
        return this.createSwap(
            chainIdentifier as ChainIdentifier,
            (candidates: Intermediary[], abortSignal: AbortSignal, chain) => chain.wrappers[SwapType.FROM_BTCLN].createViaLNURL(
                signer,
                typeof(lnurl)==="string" ? (lnurl.startsWith("lightning:") ? lnurl.substring(10): lnurl) : lnurl.params,
                amountData,
                candidates,
                additionalParams,
                abortSignal
            ),
            amountData,
            SwapType.FROM_BTCLN
        );
    }

    /**
     * Creates From BTCLN swap using new protocol
     *
     * @param chainIdentifier
     * @param signer
     * @param tokenAddress      Token address to receive
     * @param amount            Amount to receive, in satoshis (bitcoin's smallest denomination)
     * @param exactOut          Whether to use exact out instead of exact in
     * @param additionalParams  Additional parameters sent to the LP when creating the swap
     * @param options
     */
    async createFromBTCLNSwapNew<ChainIdentifier extends ChainIds<T>>(
        chainIdentifier: ChainIdentifier,
        signer: string,
        tokenAddress: string,
        amount: bigint,
        exactOut?: boolean,
        additionalParams: Record<string, any> = this.options.defaultAdditionalParameters,
        options?: FromBTCLNAutoOptions
    ): Promise<FromBTCLNAutoSwap<T[ChainIdentifier]>> {
        if(this.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        if(!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true)) throw new Error("Invalid "+chainIdentifier+" address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn: !exactOut
        };
        return this.createSwap(
            chainIdentifier as ChainIdentifier,
            (candidates: Intermediary[], abortSignal: AbortSignal, chain) => Promise.resolve(chain.wrappers[SwapType.FROM_BTCLN_AUTO].create(
                signer,
                amountData,
                candidates,
                options,
                additionalParams,
                abortSignal
            )),
            amountData,
            SwapType.FROM_BTCLN_AUTO
        );
    }

    /**
     * Creates From BTCLN swap using new protocol, withdrawing from LNURL-withdraw
     *
     * @param chainIdentifier
     * @param signer
     * @param tokenAddress      Token address to receive
     * @param lnurl             LNURL-withdraw to pull the funds from
     * @param amount            Amount to receive, in satoshis (bitcoin's smallest denomination)
     * @param exactOut          Whether to use exact out instead of exact in
     * @param additionalParams  Additional parameters sent to the LP when creating the swap
     * @param options
     */
    async createFromBTCLNSwapNewViaLNURL<ChainIdentifier extends ChainIds<T>>(
        chainIdentifier: ChainIdentifier,
        signer: string,
        tokenAddress: string,
        lnurl: string | LNURLWithdraw,
        amount: bigint,
        exactOut?: boolean,
        additionalParams: Record<string, any> = this.options.defaultAdditionalParameters,
        options?: FromBTCLNAutoOptions
    ): Promise<FromBTCLNAutoSwap<T[ChainIdentifier]>> {
        if(this.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        if(typeof(lnurl)==="string" && !this.Utils.isValidLNURL(lnurl)) throw new Error("Invalid LNURL-withdraw link");
        if(!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true)) throw new Error("Invalid "+chainIdentifier+" address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn: !exactOut
        };
        return this.createSwap(
            chainIdentifier as ChainIdentifier,
            (candidates: Intermediary[], abortSignal: AbortSignal, chain) => chain.wrappers[SwapType.FROM_BTCLN_AUTO].createViaLNURL(
                signer,
                typeof(lnurl)==="string" ? (lnurl.startsWith("lightning:") ? lnurl.substring(10): lnurl) : lnurl.params,
                amountData,
                candidates,
                options,
                additionalParams,
                abortSignal
            ),
            amountData,
            SwapType.FROM_BTCLN_AUTO
        );
    }

    /**
     * Creates trusted LN for Gas swap
     *
     * @param chainId
     * @param signer
     * @param amount                    Amount of native token to receive, in base units
     * @param trustedIntermediaryOrUrl  URL or Intermediary object of the trusted intermediary to use, otherwise uses default
     * @throws {Error}                  If no trusted intermediary specified
     */
    createTrustedLNForGasSwap<C extends ChainIds<T>>(chainId: C, signer: string, amount: bigint, trustedIntermediaryOrUrl?: Intermediary | string): Promise<LnForGasSwap<T[C]>> {
        if(this.chains[chainId]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainId);
        if(!this.chains[chainId].chainInterface.isValidAddress(signer, true)) throw new Error("Invalid "+chainId+" address");
        signer = this.chains[chainId].chainInterface.normalizeAddress(signer);
        const useUrl = trustedIntermediaryOrUrl ?? this.defaultTrustedIntermediary ?? this.options.defaultTrustedIntermediaryUrl;
        if(useUrl==null) throw new Error("No trusted intermediary specified!");
        return this.chains[chainId as C].wrappers[SwapType.TRUSTED_FROM_BTCLN].create(signer, amount, useUrl);
    }

    /**
     * Creates trusted BTC on-chain for Gas swap
     *
     * @param chainId
     * @param signer
     * @param amount                    Amount of native token to receive, in base units
     * @param refundAddress             Bitcoin refund address, in case the swap fails
     * @param trustedIntermediaryOrUrl  URL or Intermediary object of the trusted intermediary to use, otherwise uses default
     * @throws {Error}                  If no trusted intermediary specified
     */
    createTrustedOnchainForGasSwap<C extends ChainIds<T>>(
        chainId: C, signer: string,
        amount: bigint, refundAddress?: string,
        trustedIntermediaryOrUrl?: Intermediary | string
    ): Promise<OnchainForGasSwap<T[C]>> {
        if(this.chains[chainId]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainId);
        if(!this.chains[chainId].chainInterface.isValidAddress(signer, true)) throw new Error("Invalid "+chainId+" address");
        signer = this.chains[chainId].chainInterface.normalizeAddress(signer);
        const useUrl = trustedIntermediaryOrUrl ?? this.defaultTrustedIntermediary ?? this.options.defaultTrustedIntermediaryUrl;
        if(useUrl==null) throw new Error("No trusted intermediary specified!");
        return this.chains[chainId as C].wrappers[SwapType.TRUSTED_FROM_BTC].create(signer, amount, useUrl, refundAddress);
    }

    create<C extends ChainIds<T>>(signer: string, srcToken: BtcToken<true>, dstToken: SCToken<C>, amount: bigint, exactIn: boolean, lnurlWithdraw?: string | LNURLWithdraw): Promise<(SupportsSwapType<T[C], SwapType.FROM_BTCLN_AUTO> extends true ? FromBTCLNAutoSwap<T[C]> : FromBTCLNSwap<T[C]>)>;
    create<C extends ChainIds<T>>(signer: string, srcToken: BtcToken<false>, dstToken: SCToken<C>, amount: bigint, exactIn: boolean): Promise<(SupportsSwapType<T[C], SwapType.SPV_VAULT_FROM_BTC> extends true ? SpvFromBTCSwap<T[C]> : FromBTCSwap<T[C]>)>;
    create<C extends ChainIds<T>>(signer: string, srcToken: SCToken<C>, dstToken: BtcToken<false>, amount: bigint, exactIn: boolean, address: string): Promise<ToBTCSwap<T[C]>>;
    create<C extends ChainIds<T>>(signer: string, srcToken: SCToken<C>, dstToken: BtcToken<true>, amount: bigint, exactIn: boolean, lnurlPay: string | LNURLPay): Promise<ToBTCLNSwap<T[C]>>;
    create<C extends ChainIds<T>>(signer: string, srcToken: SCToken<C>, dstToken: BtcToken<true>, amount: bigint, exactIn: false, lightningInvoice: string): Promise<ToBTCLNSwap<T[C]>>;
    create<C extends ChainIds<T>>(signer: string, srcToken: Token<C>, dstToken: Token<C>, amount: bigint, exactIn: boolean, addressLnurlLightningInvoice?: string | LNURLWithdraw | LNURLPay): Promise<ISwap<T[C]>>;
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
    create<C extends ChainIds<T>>(signer: string, srcToken: Token<C>, dstToken: Token<C>, amount: bigint, exactIn: boolean, addressLnurlLightningInvoice?: string | LNURLWithdraw | LNURLPay): Promise<ISwap<T[C]>> {
        if(srcToken.chain==="BTC") {
            return this.swap(srcToken, dstToken, amount, exactIn, addressLnurlLightningInvoice as any, signer);
        } else {
            return this.swap(srcToken, dstToken, amount, exactIn, signer, addressLnurlLightningInvoice as any);
        }
    }

    swap<C extends ChainIds<T>>(srcToken: BtcToken<true>, dstToken: SCToken<C>, amount: bigint | string, exactIn: boolean | SwapAmountType, src: undefined | string | LNURLWithdraw, dstSmartchainWallet: string, options?: (SupportsSwapType<T[C], SwapType.FROM_BTCLN_AUTO> extends true ? FromBTCLNAutoOptions : FromBTCLNOptions)): Promise<(SupportsSwapType<T[C], SwapType.FROM_BTCLN_AUTO> extends true ? FromBTCLNAutoSwap<T[C]> : FromBTCLNSwap<T[C]>)>;
    swap<C extends ChainIds<T>>(srcToken: BtcToken<false>, dstToken: SCToken<C>, amount: bigint | string, exactIn: boolean | SwapAmountType, src: undefined | string, dstSmartchainWallet: string, options?: (SupportsSwapType<T[C], SwapType.SPV_VAULT_FROM_BTC> extends true ? SpvFromBTCOptions : FromBTCOptions)): Promise<(SupportsSwapType<T[C], SwapType.SPV_VAULT_FROM_BTC> extends true ? SpvFromBTCSwap<T[C]> : FromBTCSwap<T[C]>)>;
    swap<C extends ChainIds<T>>(srcToken: SCToken<C>, dstToken: BtcToken<false>, amount: bigint | string, exactIn: boolean | SwapAmountType, src: string, dstAddress: string, options?: ToBTCOptions): Promise<ToBTCSwap<T[C]>>;
    swap<C extends ChainIds<T>>(srcToken: SCToken<C>, dstToken: BtcToken<true>, amount: bigint | string, exactIn: boolean | SwapAmountType, src: string, dstLnurlPayOrInvoiceCreateService: string | LNURLPay | InvoiceCreateService, options?: ToBTCLNOptions & {comment?: string}): Promise<ToBTCLNSwap<T[C]>>;
    swap<C extends ChainIds<T>>(srcToken: SCToken<C>, dstToken: BtcToken<true>, amount: bigint | string, exactIn: false | SwapAmountType.EXACT_OUT, src: string, dstLightningInvoice: string, options?: ToBTCLNOptions): Promise<ToBTCLNSwap<T[C]>>;
    swap<C extends ChainIds<T>>(srcToken: Token<C> | string, dstToken: Token<C> | string, amount: bigint | string, exactIn: boolean | SwapAmountType, src: undefined | string | LNURLWithdraw, dst: string | LNURLPay | InvoiceCreateService, options?: FromBTCLNOptions | SpvFromBTCOptions | FromBTCOptions | ToBTCOptions | (ToBTCLNOptions & {comment?: string}) | FromBTCLNAutoOptions): Promise<ISwap<T[C]>>;
    /**
     * Creates a swap from srcToken to dstToken, of a specific token amount, either specifying input amount (exactIn=true)
     *  or output amount (exactIn=false), NOTE: For regular SmartChain -> BTC-LN (lightning) swaps the passed amount is ignored and
     *  invoice's pre-set amount is used instead, use LNURL-pay for dynamic amounts
     *
     * @param _srcToken Source token of the swap, user pays this token
     * @param _dstToken Destination token of the swap, user receives this token
     * @param _amount Amount of the swap either in base units as {bigint} or in human readable format (with decimals) as {string}
     * @param exactIn Whether the amount specified is an input amount (exactIn=true) or an output amount (exactIn=false)
     * @param src Source wallet/lnurl-withdraw of the swap
     * @param dst Destination smart chain address, bitcoin on-chain address, lightning invoice, LNURL-pay
     * @param options Options for the swap
     */
    swap<C extends ChainIds<T>>(
        _srcToken: Token<C> | string,
        _dstToken: Token<C> | string,
        _amount: bigint | string,
        exactIn: boolean | SwapAmountType,
        src: undefined | string | LNURLWithdraw,
        dst: string |  LNURLPay | InvoiceCreateService,
        options?: FromBTCLNOptions | SpvFromBTCOptions | FromBTCOptions | ToBTCOptions | (ToBTCLNOptions & {comment?: string}) | FromBTCLNAutoOptions
    ): Promise<ISwap<T[C]>> {
        const srcToken = typeof(_srcToken)==="string" ? this.getToken(_srcToken) as Token<C> : _srcToken;
        const dstToken = typeof(_dstToken)==="string" ? this.getToken(_dstToken) as Token<C> : _dstToken;
        const amount = _amount==null ? null : (typeof(_amount)==="bigint" ? _amount : fromDecimal(_amount, exactIn ? srcToken.decimals : dstToken.decimals));
        if(srcToken.chain==="BTC") {
            if(dstToken.chain==="SC") {
                if(typeof(dst)!=="string") throw new Error("Destination for BTC/BTC-LN -> smart chain swaps must be a smart chain address!");
                if(srcToken.lightning) {
                    //FROM_BTCLN
                    if(src!=null) {
                        if(typeof(src)!=="string" && !isLNURLWithdraw(src)) throw new Error("LNURL must be a string or LNURLWithdraw object!");
                        return this.supportsSwapType(dstToken.chainId, SwapType.FROM_BTCLN_AUTO) ?
                            this.createFromBTCLNSwapNewViaLNURL(dstToken.chainId, dst, dstToken.address, src, amount, !exactIn, undefined, options as any) :
                            this.createFromBTCLNSwapViaLNURL(dstToken.chainId, dst, dstToken.address, src, amount, !exactIn);
                    } else {
                        return this.supportsSwapType(dstToken.chainId, SwapType.FROM_BTCLN_AUTO) ?
                            this.createFromBTCLNSwapNew(dstToken.chainId, dst, dstToken.address, amount, !exactIn, undefined, options as any):
                            this.createFromBTCLNSwap(dstToken.chainId, dst, dstToken.address, amount, !exactIn, undefined, options as any);
                    }
                } else {
                    //FROM_BTC
                    if(this.supportsSwapType(dstToken.chainId, SwapType.SPV_VAULT_FROM_BTC)) {
                        return this.createFromBTCSwapNew(dstToken.chainId, dst, dstToken.address, amount, !exactIn, undefined, options as any);
                    } else {
                        return this.createFromBTCSwap(dstToken.chainId, dst, dstToken.address, amount, !exactIn, undefined, options as any);
                    }
                }
            }
        } else {
            if(dstToken.chain==="BTC") {
                if(typeof(src)!=="string") throw new Error("Source address for BTC/BTC-LN -> smart chain swaps must be a smart chain address!");
                if(dstToken.lightning) {
                    //TO_BTCLN
                    if(typeof(dst)!=="string" && !isLNURLPay(dst)) throw new Error("Destination LNURL link/lightning invoice must be a string or LNURLPay object!");
                    if(isLNURLPay(dst) || this.Utils.isValidLNURL(dst)) {
                        return this.createToBTCLNSwapViaLNURL(srcToken.chainId, src, srcToken.address, dst, amount, !!exactIn, undefined, options as any);
                    } else if(isInvoiceCreateService(dst)) {
                        return this.createToBTCLNSwapViaInvoiceCreateService(srcToken.chainId, src, srcToken.address, dst, amount, !!exactIn, undefined, options as any);
                    } else if(this.Utils.isLightningInvoice(dst)) {
                        if(!this.Utils.isValidLightningInvoice(dst))
                            throw new Error("Invalid lightning invoice specified, lightning invoice MUST contain pre-set amount!");
                        if(exactIn)
                            throw new Error("Only exact out swaps are possible with lightning invoices, use LNURL links for exact in lightning swaps!");
                        return this.createToBTCLNSwap(srcToken.chainId, src, srcToken.address, dst, undefined, options as any);
                    } else {
                        throw new Error("Supplied parameter is not LNURL link nor lightning invoice (bolt11)!");
                    }
                } else {
                    //TO_BTC
                    if(typeof(dst)!=="string") throw new Error("Destination bitcoin address must be a string!");
                    return this.createToBTCSwap(srcToken.chainId, src, srcToken.address, dst, amount, !!exactIn, undefined, options as any);
                }
            }
        }
        throw new Error("Unsupported swap type");
    }

    /**
     * Returns all swaps
     */
    getAllSwaps(): Promise<ISwap[]>;
    /**
     * Returns all swaps for the specific chain, and optionally also for a specific signer's address
     */
    getAllSwaps<C extends ChainIds<T>>(chainId: C, signer?: string): Promise<ISwap<T[C]>[]>;
    async getAllSwaps<C extends ChainIds<T>>(chainId?: C, signer?: string): Promise<ISwap[]> {
        const queryParams: QueryParams[] = [];
        if(signer!=null) queryParams.push({key: "initiator", value: signer});

        if(chainId==null) {
            const res: ISwap[][] = await Promise.all(Object.keys(this.chains).map((chainId) => {
                const {unifiedSwapStorage, reviver} = this.chains[chainId];
                return unifiedSwapStorage.query([queryParams], reviver);
            }));
            return res.flat();
        } else {
            const {unifiedSwapStorage, reviver} = this.chains[chainId];
            return await unifiedSwapStorage.query([queryParams], reviver);
        }
    }

    /**
     * Returns all swaps where an action is required (either claim or refund)
     */
    getActionableSwaps(): Promise<ISwap[]>;
    /**
     * Returns swaps where an action is required (either claim or refund) for the specific chain, and optionally also for a specific signer's address
     */
    getActionableSwaps<C extends ChainIds<T>>(chainId: C, signer?: string): Promise<ISwap<T[C]>[]>;
    async getActionableSwaps<C extends ChainIds<T>>(chainId?: C, signer?: string): Promise<ISwap[]> {
        if(chainId==null) {
            const res: ISwap[][] = await Promise.all(Object.keys(this.chains).map((chainId) => {
                const {unifiedSwapStorage, reviver, wrappers} = this.chains[chainId];
                const queryParams: Array<QueryParams[]> = [];
                for(let key in wrappers) {
                    const wrapper = wrappers[key];
                    const swapTypeQueryParams: QueryParams[] = [{key: "type", value: wrapper.TYPE}];
                    if(signer!=null) swapTypeQueryParams.push({key: "initiator", value: signer});
                    swapTypeQueryParams.push({key: "state", value: wrapper.pendingSwapStates});
                    queryParams.push(swapTypeQueryParams);
                }
                return unifiedSwapStorage.query(queryParams, reviver);
            }));
            return res.flat().filter(swap => swap.requiresAction());
        } else {
            const {unifiedSwapStorage, reviver, wrappers} = this.chains[chainId];
            const queryParams: Array<QueryParams[]> = [];
            for(let key in wrappers) {
                const wrapper = wrappers[key];
                const swapTypeQueryParams: QueryParams[] = [{key: "type", value: wrapper.TYPE}];
                if(signer!=null) swapTypeQueryParams.push({key: "initiator", value: signer});
                swapTypeQueryParams.push({key: "state", value: wrapper.pendingSwapStates});
                queryParams.push(swapTypeQueryParams);
            }
            return (await unifiedSwapStorage.query(queryParams, reviver)).filter(swap => swap.requiresAction());
        }
    }

    /**
     * Returns all swaps that are refundable
     */
    getRefundableSwaps(): Promise<IToBTCSwap[]>;
    /**
     * Returns swaps which are refundable for the specific chain, and optionally also for a specific signer's address
     */
    getRefundableSwaps<C extends ChainIds<T>>(chainId: C, signer?: string): Promise<IToBTCSwap<T[C]>[]>;
    async getRefundableSwaps<C extends ChainIds<T>>(chainId?: C, signer?: string): Promise<IToBTCSwap[]> {
        if(chainId==null) {
            const res: IToBTCSwap[][] = await Promise.all(Object.keys(this.chains).map((chainId) => {
                const {unifiedSwapStorage, reviver, wrappers} = this.chains[chainId];
                const queryParams: Array<QueryParams[]> = [];
                for(let wrapper of [wrappers[SwapType.TO_BTCLN], wrappers[SwapType.TO_BTC]]) {
                    const swapTypeQueryParams: QueryParams[] = [{key: "type", value: wrapper.TYPE}];
                    if(signer!=null) swapTypeQueryParams.push({key: "initiator", value: signer});
                    swapTypeQueryParams.push({key: "state", value: wrapper.refundableSwapStates});
                    queryParams.push(swapTypeQueryParams);
                }
                return unifiedSwapStorage.query<IToBTCSwap<T[C]>>(queryParams, reviver as (val: any) => IToBTCSwap<T[C]>);
            }));
            return res.flat().filter(swap => swap.isRefundable());
        } else {
            const {unifiedSwapStorage, reviver, wrappers} = this.chains[chainId];
            const queryParams: Array<QueryParams[]> = [];
            for(let wrapper of [wrappers[SwapType.TO_BTCLN], wrappers[SwapType.TO_BTC]]) {
                const swapTypeQueryParams: QueryParams[] = [{key: "type", value: wrapper.TYPE}];
                if(signer!=null) swapTypeQueryParams.push({key: "initiator", value: signer});
                swapTypeQueryParams.push({key: "state", value: wrapper.refundableSwapStates});
                queryParams.push(swapTypeQueryParams);
            }
            const result = await unifiedSwapStorage.query<IToBTCSwap<T[C]>>(queryParams, reviver as (val: any) => IToBTCSwap<T[C]>);
            return result.filter(swap => swap.isRefundable());
        }
    }

    /**
     * Returns all swaps that are manually claimable
     */
    getClaimableSwaps(): Promise<IClaimableSwap[]>;
    /**
     * Returns all swaps that are manually claimable for the specific chain, and optionally also for a specific signer's address
     */
    getClaimableSwaps<C extends ChainIds<T>>(chainId: C, signer?: string): Promise<IClaimableSwap<T[C]>[]>;
    async getClaimableSwaps<C extends ChainIds<T>>(chainId?: C, signer?: string): Promise<IClaimableSwap[]> {
        if(chainId==null) {
            const res: IClaimableSwap[][] = await Promise.all(Object.keys(this.chains).map((chainId) => {
                const {unifiedSwapStorage, reviver, wrappers} = this.chains[chainId];
                const queryParams: Array<QueryParams[]> = [];
                for(let wrapper of [wrappers[SwapType.FROM_BTC], wrappers[SwapType.FROM_BTCLN], wrappers[SwapType.SPV_VAULT_FROM_BTC], wrappers[SwapType.FROM_BTCLN_AUTO]]) {
                    if(wrapper==null) continue;
                    const swapTypeQueryParams: QueryParams[] = [{key: "type", value: wrapper.TYPE}];
                    if(signer!=null) swapTypeQueryParams.push({key: "initiator", value: signer});
                    swapTypeQueryParams.push({key: "state", value: wrapper.claimableSwapStates});
                    queryParams.push(swapTypeQueryParams);
                }
                return unifiedSwapStorage.query<IClaimableSwap<T[C]>>(queryParams, reviver as any as (val: any) => IClaimableSwap<T[C]>);
            }));
            return res.flat().filter(swap => swap.isClaimable());
        } else {
            const {unifiedSwapStorage, reviver, wrappers} = this.chains[chainId];
            const queryParams: Array<QueryParams[]> = [];
            for(let wrapper of [wrappers[SwapType.FROM_BTC], wrappers[SwapType.FROM_BTCLN], wrappers[SwapType.SPV_VAULT_FROM_BTC], wrappers[SwapType.FROM_BTCLN_AUTO]]) {
                if(wrapper==null) continue;
                const swapTypeQueryParams: QueryParams[] = [{key: "type", value: wrapper.TYPE}];
                if(signer!=null) swapTypeQueryParams.push({key: "initiator", value: signer});
                swapTypeQueryParams.push({key: "state", value: wrapper.claimableSwapStates});
                queryParams.push(swapTypeQueryParams);
            }
            const result = await unifiedSwapStorage.query<IClaimableSwap<T[C]>>(queryParams, reviver as any as (val: any) => IClaimableSwap<T[C]>);
            return result.filter(swap => swap.isClaimable());
        }
    }

    /**
     * Returns swap with a specific id (identifier)
     */
    getSwapById(id: string): Promise<ISwap>;
    /**
     * Returns swap with a specific id (identifier) on a specific chain and optionally with a signer
     */
    getSwapById<C extends ChainIds<T>>(id: string, chainId: C, signer?: string): Promise<ISwap<T[C]>>;
    async getSwapById<C extends ChainIds<T>>(id: string, chainId?: C, signer?: string): Promise<ISwap> {
        //Check in pending swaps first
        if(chainId!=null) {
            for(let key in this.chains[chainId].wrappers) {
                const wrapper: ISwapWrapper<any, ISwap> = this.chains[chainId].wrappers[key];
                const result = wrapper.pendingSwaps.get(id)?.deref();
                if(result!=null) {
                    if (signer != null) {
                        if (result._getInitiator() === signer) return result;
                    } else {
                        return result;
                    }
                }
            }
        } else {
            for(let chainId in this.chains) {
                for(let key in this.chains[chainId].wrappers) {
                    const wrapper: ISwapWrapper<any, ISwap> = this.chains[chainId].wrappers[key];
                    const result = wrapper.pendingSwaps.get(id)?.deref();
                    if(result!=null) {
                        if(signer!=null) {
                            if(result._getInitiator()===signer) return result;
                        } else {
                            return result;
                        }
                    }
                }
            }
        }

        const queryParams: QueryParams[] = [];
        if(signer!=null) queryParams.push({key: "initiator", value: signer});
        queryParams.push({key: "id", value: id});
        if(chainId==null) {
            const res: ISwap[][] = await Promise.all(Object.keys(this.chains).map((chainId) => {
                const {unifiedSwapStorage, reviver} = this.chains[chainId];
                return unifiedSwapStorage.query([queryParams], reviver);
            }));
            return res.flat()[0];
        } else {
            const {unifiedSwapStorage, reviver} = this.chains[chainId];
            return (await unifiedSwapStorage.query([queryParams], reviver))[0];
        }
    }

    private async syncSwapsForChain<C extends ChainIds<T>>(chainId: C, signer?: string): Promise<void> {
        const {unifiedSwapStorage, reviver, wrappers} = this.chains[chainId];
        const queryParams: Array<QueryParams[]> = [];
        for(let key in wrappers) {
            const wrapper = wrappers[key];
            const swapTypeQueryParams: QueryParams[] = [{key: "type", value: wrapper.TYPE}];
            if(signer!=null) swapTypeQueryParams.push({key: "initiator", value: signer});
            swapTypeQueryParams.push({key: "state", value: wrapper.pendingSwapStates});
            queryParams.push(swapTypeQueryParams);
        }
        this.logger.debug("_syncSwaps(): Querying swaps swaps for chain "+chainId+"!");
        const swaps = await unifiedSwapStorage.query(queryParams, reviver);
        this.logger.debug("_syncSwaps(): Syncing "+swaps.length+" swaps!");

        const changedSwaps: ISwap<T[C]>[] = [];
        const removeSwaps: ISwap<T[C]>[] = [];

        const assortedSwaps: {[swapType in SwapType]?: ISwap<T[string]>[]} = {};
        swaps.forEach(swap => {
            assortedSwaps[swap.getType()] ??= [];
            assortedSwaps[swap.getType()].push(swap);
        });

        for(let swapType in assortedSwaps) {
            const wrapperSwaps = assortedSwaps[swapType];
            const wrapper: ISwapWrapper<T[C], ISwap<T[C]>> = wrappers[swapType];
            const result = await wrapper.checkPastSwaps(wrapperSwaps, true);
            changedSwaps.push(...result.changedSwaps);
            removeSwaps.push(...result.removeSwaps);
        }

        this.logger.debug("_syncSwaps(): Done syncing "+swaps.length+" swaps, saving "+changedSwaps.length+" changed swaps, removing "+removeSwaps.length+" swaps!");
        await unifiedSwapStorage.saveAll(changedSwaps);
        await unifiedSwapStorage.removeAll(removeSwaps);
    }

    /**
     * Synchronizes swaps from chain, this is usually ran when SDK is initialized, deletes expired quotes
     *
     * @param chainId
     * @param signer
     */
    async _syncSwaps<C extends ChainIds<T>>(chainId?: C, signer?: string): Promise<void> {
        if(chainId==null) {
            await Promise.all(Object.keys(this.chains).map((chainId) => {
                return this.syncSwapsForChain(chainId, signer);
            }));
        } else {
            await this.syncSwapsForChain(chainId, signer);
        }
    }

    /**
     * Attempts to recover partial swap data from on-chain historical data
     *
     * @param chainId
     * @param signer
     * @param startBlockheight
     */
    async recoverSwaps<C extends ChainIds<T>>(chainId: C, signer: string, startBlockheight?: number): Promise<ISwap<T[C]>[]> {
        const {swapContract, unifiedSwapStorage, reviver, wrappers} = this.chains[chainId];

        if(swapContract.getHistoricalSwaps==null) throw new Error(`Historical swap recovery is not supported for ${chainId}`);

        const {swaps} = await swapContract.getHistoricalSwaps(signer);

        const escrowHashes = Object.keys(swaps);
        this.logger.debug(`recoverSwaps(): Loaded on-chain data for ${escrowHashes.length} swaps`);
        this.logger.debug(`recoverSwaps(): Fetching if swap escrowHashes are known: ${escrowHashes.join(", ")}`);
        const knownSwapsArray = await unifiedSwapStorage.query([[{key: "escrowHash", value: escrowHashes}]], reviver);
        const knownSwaps: {[escrowHash: string]: ISwap<T[C]>} = {};
        knownSwapsArray.forEach(val => knownSwaps[val._getEscrowHash()] = val);
        this.logger.debug(`recoverSwaps(): Fetched known swaps escrowHashes: ${Object.keys(knownSwaps).join(", ")}`);

        const recoveredSwaps: ISwap<T[C]>[] = [];

        for(let escrowHash in swaps) {
            const {init, state} = swaps[escrowHash];
            const knownSwap = knownSwaps[escrowHash];
            if(init==null) {
                if(knownSwap==null) this.logger.warn(`recoverSwaps(): Fetched ${escrowHash} swap state, but swap not found locally!`);
                //TODO: Update the existing swaps here
                this.logger.debug(`recoverSwaps(): Skipping ${escrowHash} swap: swap already known and in local storage!`);
                continue;
            }
            if(knownSwap!=null) {
                //TODO: Update the existing swaps here
                this.logger.debug(`recoverSwaps(): Skipping ${escrowHash} swap: swap already known and in local storage!`);
                continue;
            }
            const data = init.data;

            //Classify swap
            let swap: ISwap<T[C]>;
            let typeIdentified: boolean = false;
            if(data.getType()===ChainSwapType.HTLC) {
                if(data.isOfferer(signer)) {
                    //To BTCLN
                    typeIdentified = true;
                    const lp = this.intermediaryDiscovery.intermediaries.find(val => val.supportsChain(chainId) && data.isClaimer(val.getAddress(chainId)));
                    swap = await wrappers[SwapType.TO_BTCLN].recoverFromSwapDataAndState(init, state, lp);
                } else if(data.isClaimer(signer)) {
                    //From BTCLN
                    typeIdentified = true;
                    const lp = this.intermediaryDiscovery.intermediaries.find(val => val.supportsChain(chainId) && data.isOfferer(val.getAddress(chainId)));
                    if(this.supportsSwapType(chainId, SwapType.FROM_BTCLN_AUTO)) {
                        swap = await wrappers[SwapType.FROM_BTCLN_AUTO].recoverFromSwapDataAndState(init, state, lp);
                    } else {
                        swap = await wrappers[SwapType.FROM_BTCLN].recoverFromSwapDataAndState(init, state, lp);
                    }
                }
            } else if(data.getType()===ChainSwapType.CHAIN_NONCED) {
                //To BTC
                typeIdentified = true;
                const lp = this.intermediaryDiscovery.intermediaries.find(val => val.supportsChain(chainId) && data.isClaimer(val.getAddress(chainId)));
                swap = await wrappers[SwapType.TO_BTC].recoverFromSwapDataAndState(init, state, lp);
            } else if(data.getType()===ChainSwapType.CHAIN) {
                //From BTC
                typeIdentified = true;
                const lp = this.intermediaryDiscovery.intermediaries.find(val => val.supportsChain(chainId) && data.isOfferer(val.getAddress(chainId)));
                swap = await wrappers[SwapType.FROM_BTC].recoverFromSwapDataAndState(init, state, lp);
            }
            
            if(swap!=null) {
                recoveredSwaps.push(swap);
            } else {
                if(typeIdentified) this.logger.debug(`recoverSwaps(): Swap data type correctly identified but swap returned is null for swap ${escrowHash}`);
            }
        }

        this.logger.debug(`recoverSwaps(): Successfully recovered ${recoveredSwaps.length} swaps!`);

        return recoveredSwaps;
    }

    getToken(tickerOrAddress: string): Token {
        //Btc tokens - BTC, BTCLN, BTC-LN
        if(tickerOrAddress==="BTC") return BitcoinTokens.BTC;
        if(tickerOrAddress==="BTCLN" || tickerOrAddress==="BTC-LN") return BitcoinTokens.BTCLN;

        //Check if the ticker is in format <chainId>-<ticker>, i.e. SOLANA-USDC, STARKNET-WBTC
        if(tickerOrAddress.includes("-")) {
            const [chainId, ticker] = tickerOrAddress.split("-");
            const token = this.tokensByTicker[chainId]?.[ticker];
            if(token==null) throw new UserError(`Not found ticker: ${ticker} for chainId: ${chainId}`);
            return token;
        }

        const possibleTokens: SCToken[] = [];
        for(let chainId in this.chains) {
            const chain = this.chains[chainId];
            if(chain.chainInterface.isValidToken(tickerOrAddress)) {
                //Try to find in known token addresses
                const token = this.tokens[chainId]?.[tickerOrAddress];
                if(token!=null) return token;
            } else {
                //Check in known tickers
                const token = this.tokensByTicker[chainId]?.[tickerOrAddress];
                if(token!=null) possibleTokens.push(token);
            }
        }

        if(possibleTokens.length===0) throw new UserError(`Specified token address or ticker ${tickerOrAddress} not found!`);
        //In case we've found the token in multiple chains
        if(possibleTokens.length>1) throw new UserError(`A ticker ${tickerOrAddress} has been found in multiple chains, narrow it down by using <chainId>-${tickerOrAddress} notation`)
        return possibleTokens[0];
    }

    /**
     * Creates a child swapper instance with a given smart chain
     *
     * @param chainIdentifier
     */
    withChain<ChainIdentifier extends ChainIds<T>>(chainIdentifier: ChainIdentifier): SwapperWithChain<T, ChainIdentifier> {
        if(this.chains[chainIdentifier]==null) throw new Error("Invalid chain identifier! Unknown chain: "+chainIdentifier);
        return new SwapperWithChain<T, ChainIdentifier>(this, chainIdentifier as ChainIdentifier);
    }

    /**
     * Returns supported smart chains
     */
    getSmartChains(): ChainIds<T>[] {
        return Object.keys(this.chains);
    }

    /**
     * Returns whether the SDK supports a given swap type on a given chain based on currently known LPs
     *
     * @param chainId
     * @param swapType
     */
    supportsSwapType<
        ChainIdentifier extends ChainIds<T>,
        Type extends SwapType
    >(chainId: ChainIdentifier, swapType: Type): SupportsSwapType<T[ChainIdentifier], Type> {
        return (this.chains[chainId]?.wrappers[swapType] != null) as any;
    }

    /**
     * Returns type of the swap based on input and output tokens specified
     *
     * @param srcToken
     * @param dstToken
     */
    getSwapType<C extends ChainIds<T>>(srcToken: BtcToken<true>, dstToken: SCToken<C>): (SupportsSwapType<T[C], SwapType.FROM_BTCLN_AUTO> extends true ? SwapType.FROM_BTCLN_AUTO : SwapType.FROM_BTCLN);
    getSwapType<C extends ChainIds<T>>(srcToken: BtcToken<false>, dstToken: SCToken<C>): (SupportsSwapType<T[C], SwapType.SPV_VAULT_FROM_BTC> extends true ? SwapType.SPV_VAULT_FROM_BTC : SwapType.FROM_BTC);
    getSwapType<C extends ChainIds<T>>(srcToken: SCToken<C>, dstToken: BtcToken<false>): SwapType.TO_BTC;
    getSwapType<C extends ChainIds<T>>(srcToken: SCToken<C>, dstToken: BtcToken<true>): SwapType.TO_BTCLN;
    getSwapType<C extends ChainIds<T>>(srcToken: Token<C>, dstToken: Token<C>): SwapType.FROM_BTCLN_AUTO | SwapType.FROM_BTCLN | SwapType.SPV_VAULT_FROM_BTC | SwapType.FROM_BTC | SwapType.TO_BTC | SwapType.TO_BTCLN;
    getSwapType<C extends ChainIds<T>>(srcToken: Token<C>, dstToken: Token<C>): SwapType.FROM_BTCLN_AUTO | SwapType.FROM_BTCLN | SwapType.SPV_VAULT_FROM_BTC | SwapType.FROM_BTC | SwapType.TO_BTC | SwapType.TO_BTCLN {
        if(isSCToken(srcToken)) {
            if(!isBtcToken(dstToken)) throw new Error("Swap not supported");
            if(dstToken.lightning) {
                return SwapType.TO_BTCLN;
            } else {
                return SwapType.TO_BTC;
            }
        } else if(isBtcToken(srcToken)) {
            if(!isSCToken(dstToken)) throw new Error("Swap not supported");
            if(srcToken.lightning) {
                if(this.supportsSwapType(dstToken.chainId, SwapType.FROM_BTCLN_AUTO)) {
                    return SwapType.FROM_BTCLN_AUTO;
                } else {
                    return SwapType.FROM_BTCLN;
                }
            } else {
                if(this.supportsSwapType(dstToken.chainId, SwapType.SPV_VAULT_FROM_BTC)) {
                    return SwapType.SPV_VAULT_FROM_BTC;
                } else {
                    return SwapType.FROM_BTC;
                }
            }
        }
        return null;
    }

    readonly SwapTypeInfo = {
        [SwapType.TO_BTC]: {
            requiresInputWallet: true,
            requiresOutputWallet: false,
            supportsGasDrop: false
        },
        [SwapType.TO_BTCLN]: {
            requiresInputWallet: true,
            requiresOutputWallet: false,
            supportsGasDrop: false
        },
        [SwapType.FROM_BTC]: {
            requiresInputWallet: false,
            requiresOutputWallet: true,
            supportsGasDrop: false
        },
        [SwapType.FROM_BTCLN]: {
            requiresInputWallet: false,
            requiresOutputWallet: true,
            supportsGasDrop: false
        },
        [SwapType.SPV_VAULT_FROM_BTC]: {
            requiresInputWallet: true,
            requiresOutputWallet: false,
            supportsGasDrop: true
        },
        [SwapType.FROM_BTCLN_AUTO]: {
            requiresInputWallet: false,
            requiresOutputWallet: false,
            supportsGasDrop: true
        },
        [SwapType.TRUSTED_FROM_BTC]: {
            requiresInputWallet: false,
            requiresOutputWallet: false,
            supportsGasDrop: false
        },
        [SwapType.TRUSTED_FROM_BTCLN]: {
            requiresInputWallet: false,
            requiresOutputWallet: false,
            supportsGasDrop: false
        }
    } as const;

    /**
     * Returns minimum/maximum limits for inputs and outputs for a swap between given tokens
     *
     * @param srcToken
     * @param dstToken
     */
    getSwapLimits<C extends ChainIds<T>, A extends Token<C>, B extends Token<C>>(srcToken: A, dstToken: B): {
        input: {min: TokenAmount<string, A>, max: TokenAmount<string, A>},
        output: {min: TokenAmount<string, B>, max: TokenAmount<string, B>}
    } {
        const swapType = this.getSwapType(srcToken, dstToken);
        const scToken = isSCToken(srcToken) ? srcToken : isSCToken(dstToken) ? dstToken : null;
        const result: {input: {min: bigint, max: bigint}, output: {min: bigint, max: bigint}} = {
            input: {min: null, max: null},
            output: {min: null, max: null}
        };
        for(let lp of this.intermediaryDiscovery.intermediaries) {
            const lpMinMax = lp.getSwapLimits(swapType, scToken.chainId, scToken.address);
            if(lpMinMax==null) continue;
            result.input.min = result.input.min==null ? lpMinMax.input.min : bigIntMin(result.input.min, lpMinMax.input.min);
            result.input.max = result.input.max==null ? lpMinMax.input.max : bigIntMax(result.input.max, lpMinMax.input.max);
            result.output.min = result.output.min==null ? lpMinMax.output.min : bigIntMin(result.output.min, lpMinMax.output.min);
            result.output.max = result.output.max==null ? lpMinMax.output.max : bigIntMax(result.output.max, lpMinMax.output.max);
        }
        return {
            input: {
                min: toTokenAmount(result.input.min ?? 1n, srcToken, this.prices),
                max: result.input.max==null ? null : toTokenAmount(result.input.max, srcToken, this.prices),
            },
            output: {
                min: toTokenAmount(result.output.min ?? 1n, dstToken, this.prices),
                max: result.input.max==null ? null : toTokenAmount(result.output.max, dstToken, this.prices),
            }
        }
    }

    /**
     * Returns supported tokens for a given direction
     *
     * @param input Whether to return input tokens or output tokens
     */
    getSupportedTokens(input: boolean): Token[] {
        const tokens: {[chainId: string]: Set<string>} = {};
        let lightning = false;
        let btc = false;
        this.intermediaryDiscovery.intermediaries.forEach(lp => {
            for(let swapType of [SwapType.TO_BTC, SwapType.TO_BTCLN, SwapType.FROM_BTC, SwapType.FROM_BTCLN, SwapType.SPV_VAULT_FROM_BTC, SwapType.FROM_BTCLN_AUTO]) {
                if(lp.services[swapType]==null) continue;
                if(lp.services[swapType].chainTokens==null) continue;
                for(let chainId of this.getSmartChains()) {
                    if(this.supportsSwapType(chainId, SwapType.SPV_VAULT_FROM_BTC) ? swapType===SwapType.FROM_BTC : swapType===SwapType.SPV_VAULT_FROM_BTC) continue;
                    if(this.supportsSwapType(chainId, SwapType.FROM_BTCLN_AUTO) ? swapType===SwapType.FROM_BTCLN : swapType===SwapType.FROM_BTCLN_AUTO) continue;
                    if(lp.services[swapType].chainTokens[chainId]==null) continue;
                    for (let tokenAddress of lp.services[swapType].chainTokens[chainId]) {
                        if(input) {
                            if(swapType===SwapType.TO_BTC || swapType===SwapType.TO_BTCLN) {
                                tokens[chainId] ??= new Set();
                                tokens[chainId].add(tokenAddress);
                            }
                            if(swapType===SwapType.FROM_BTCLN || swapType===SwapType.FROM_BTCLN_AUTO) {
                                lightning = true;
                            }
                            if(swapType===SwapType.FROM_BTC || swapType===SwapType.SPV_VAULT_FROM_BTC) {
                                btc = true;
                            }
                        } else {
                            if(swapType===SwapType.FROM_BTCLN || swapType===SwapType.FROM_BTC || swapType===SwapType.SPV_VAULT_FROM_BTC || swapType===SwapType.FROM_BTCLN_AUTO) {
                                tokens[chainId] ??= new Set();
                                tokens[chainId].add(tokenAddress);
                            }
                            if(swapType===SwapType.TO_BTCLN) {
                                lightning = true;
                            }
                            if(swapType===SwapType.TO_BTC) {
                                btc = true;
                            }
                        }
                    }
                }
            }
        });
        const output: Token[] = [];
        if(lightning) output.push(BitcoinTokens.BTCLN);
        if(btc) output.push(BitcoinTokens.BTC);
        for(let chainId in tokens) {
            tokens[chainId].forEach(tokenAddress => {
                const token = this.tokens?.[chainId]?.[tokenAddress];
                if(token!=null) output.push(token);
            })
        }
        return output;
    }

    /**
     * Returns a set of supported tokens by all the intermediaries offering a specific swap service
     *
     * @param _swapType Swap service type to check supported tokens for
     */
    private getSupportedTokensForSwapType(_swapType: SwapType): SCToken[] {
        const tokens: {[chainId: string]: Set<string>} = {};
        this.intermediaryDiscovery.intermediaries.forEach(lp => {
            for(let chainId of this.getSmartChains()) {
                let swapType = _swapType;
                if(swapType===SwapType.FROM_BTC && this.supportsSwapType(chainId, SwapType.SPV_VAULT_FROM_BTC)) swapType = SwapType.SPV_VAULT_FROM_BTC;
                if(swapType===SwapType.FROM_BTCLN && this.supportsSwapType(chainId, SwapType.FROM_BTCLN_AUTO)) swapType = SwapType.FROM_BTCLN_AUTO;
                if(lp.services[swapType]==null) break;
                if(lp.services[swapType].chainTokens==null) break;
                if(lp.services[swapType].chainTokens[chainId]==null) continue;
                for(let tokenAddress of lp.services[swapType].chainTokens[chainId]) {
                    tokens[chainId] ??= new Set();
                    tokens[chainId].add(tokenAddress);
                }
            }
        });
        const output: SCToken[] = [];
        for(let chainId in tokens) {
            tokens[chainId].forEach(tokenAddress => {
                const token = this.tokens?.[chainId]?.[tokenAddress];
                if(token!=null) output.push(token);
            })
        }
        return output;
    }

    /**
     * Returns the set of supported token addresses by all the intermediaries we know of offering a specific swapType service
     *
     * @param chainIdentifier
     * @param swapType Specific swap type for which to obtain supported tokens
     */
    private getSupportedTokenAddresses<ChainIdentifier extends ChainIds<T>>(chainIdentifier: ChainIdentifier, swapType: SwapType): Set<string> {
        const set = new Set<string>();
        this.intermediaryDiscovery.intermediaries.forEach(lp => {
            if(lp.services[swapType]==null) return;
            if(lp.services[swapType].chainTokens==null || lp.services[swapType].chainTokens[chainIdentifier]==null) return;
            lp.services[swapType].chainTokens[chainIdentifier].forEach(token => set.add(token));
        });
        return set;
    }

    /**
     * Returns tokens that you can swap to (if input=true) from a given token,
     *  or tokens that you can swap from (if input=false) to a given token
     */
    getSwapCounterTokens(token: Token, input: boolean): Token[] {
        if(isSCToken(token)) {
            const result: Token[] = [];
            if(input) {
                //TO_BTC or TO_BTCLN
                if(this.getSupportedTokenAddresses(token.chainId, SwapType.TO_BTCLN).has(token.address)) {
                    result.push(BitcoinTokens.BTCLN);
                }
                if(this.getSupportedTokenAddresses(token.chainId, SwapType.TO_BTC).has(token.address)) {
                    result.push(BitcoinTokens.BTC);
                }
            } else {
                //FROM_BTC or FROM_BTCLN
                const fromLightningSwapType = this.supportsSwapType(token.chainId, SwapType.FROM_BTCLN_AUTO) ? SwapType.FROM_BTCLN_AUTO : SwapType.FROM_BTCLN;
                if(this.getSupportedTokenAddresses(token.chainId, fromLightningSwapType).has(token.address)) {
                    result.push(BitcoinTokens.BTCLN);
                }
                const fromOnchainSwapType = this.supportsSwapType(token.chainId, SwapType.SPV_VAULT_FROM_BTC) ? SwapType.SPV_VAULT_FROM_BTC : SwapType.FROM_BTC;
                if(this.getSupportedTokenAddresses(token.chainId, fromOnchainSwapType).has(token.address)) {
                    result.push(BitcoinTokens.BTC);
                }
            }
            return result;
        } else {
            if(input) {
                if(token.lightning) {
                    return this.getSupportedTokensForSwapType(SwapType.FROM_BTCLN);
                } else {
                    return this.getSupportedTokensForSwapType(SwapType.FROM_BTC);
                }
            } else {
                if(token.lightning) {
                    return this.getSupportedTokensForSwapType(SwapType.TO_BTCLN);
                } else {
                    return this.getSupportedTokensForSwapType(SwapType.TO_BTC);
                }
            }
        }
    }


    ///////////////////////////////////
    /// Deprecated

    /**
     * Returns swap bounds (minimums & maximums) for different swap types & tokens
     * @deprecated Use getSwapLimits() instead!
     */
    getSwapBounds<ChainIdentifier extends ChainIds<T>>(chainIdentifier: ChainIdentifier): SwapBounds;
    getSwapBounds(): MultichainSwapBounds;
    getSwapBounds<ChainIdentifier extends ChainIds<T>>(chainIdentifier?: ChainIdentifier): SwapBounds | MultichainSwapBounds {
        if(this.intermediaryDiscovery!=null) {
            if(chainIdentifier==null) {
                return this.intermediaryDiscovery.getMultichainSwapBounds();
            } else {
                return this.intermediaryDiscovery.getSwapBounds(chainIdentifier);
            }
        }
        return null;
    }

    /**
     * Returns maximum possible swap amount
     * @deprecated Use getSwapLimits() instead!
     *
     * @param chainIdentifier
     * @param type      Type of the swap
     * @param token     Token of the swap
     */
    getMaximum<ChainIdentifier extends ChainIds<T>>(chainIdentifier: ChainIdentifier, type: SwapType, token: string): bigint {
        if(this.intermediaryDiscovery!=null) {
            const max = this.intermediaryDiscovery.getSwapMaximum(chainIdentifier, type, token);
            if(max!=null) return BigInt(max);
        }
        return 0n;
    }

    /**
     * Returns minimum possible swap amount
     * @deprecated Use getSwapLimits() instead!
     *
     * @param chainIdentifier
     * @param type      Type of swap
     * @param token     Token of the swap
     */
    getMinimum<ChainIdentifier extends ChainIds<T>>(chainIdentifier: ChainIdentifier, type: SwapType, token: string): bigint {
        if(this.intermediaryDiscovery!=null) {
            const min = this.intermediaryDiscovery.getSwapMinimum(chainIdentifier, type, token);
            if(min!=null) return BigInt(min);
        }
        return 0n;
    }

}
