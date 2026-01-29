"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Swapper = void 0;
const base_1 = require("@atomiqlabs/base");
const ToBTCLNWrapper_1 = require("../escrow_swaps/tobtc/ln/ToBTCLNWrapper");
const ToBTCWrapper_1 = require("../escrow_swaps/tobtc/onchain/ToBTCWrapper");
const FromBTCLNWrapper_1 = require("../escrow_swaps/frombtc/ln/FromBTCLNWrapper");
const FromBTCWrapper_1 = require("../escrow_swaps/frombtc/onchain/FromBTCWrapper");
const IntermediaryDiscovery_1 = require("../../intermediaries/IntermediaryDiscovery");
const bolt11_1 = require("@atomiqlabs/bolt11");
const IntermediaryError_1 = require("../../errors/IntermediaryError");
const SwapType_1 = require("../enums/SwapType");
const MempoolBtcRelaySynchronizer_1 = require("../../btc/mempool/synchronizer/MempoolBtcRelaySynchronizer");
const LnForGasWrapper_1 = require("../trusted/ln/LnForGasWrapper");
const events_1 = require("events");
const LNURL_1 = require("../../utils/LNURL");
const Utils_1 = require("../../utils/Utils");
const RequestError_1 = require("../../errors/RequestError");
const SwapperWithChain_1 = require("./SwapperWithChain");
const Tokens_1 = require("../../Tokens");
const OnchainForGasWrapper_1 = require("../trusted/onchain/OnchainForGasWrapper");
const utils_1 = require("@scure/btc-signer/utils");
const IndexedDBUnifiedStorage_1 = require("../../browser-storage/IndexedDBUnifiedStorage");
const UnifiedSwapStorage_1 = require("../../storage/UnifiedSwapStorage");
const UnifiedSwapEventListener_1 = require("../../events/UnifiedSwapEventListener");
const SpvFromBTCWrapper_1 = require("../spv_swaps/SpvFromBTCWrapper");
const SwapperUtils_1 = require("./utils/SwapperUtils");
const FromBTCLNAutoWrapper_1 = require("../escrow_swaps/frombtc/ln_auto/FromBTCLNAutoWrapper");
const UserError_1 = require("../../errors/UserError");
const AutomaticClockDriftCorrection_1 = require("../../utils/AutomaticClockDriftCorrection");
class Swapper extends events_1.EventEmitter {
    constructor(bitcoinRpc, chainsData, pricing, tokens, messenger, options) {
        super();
        this.logger = (0, Utils_1.getLogger)(this.constructor.name + ": ");
        this.initialized = false;
        this.SwapTypeInfo = {
            [SwapType_1.SwapType.TO_BTC]: {
                requiresInputWallet: true,
                requiresOutputWallet: false,
                supportsGasDrop: false
            },
            [SwapType_1.SwapType.TO_BTCLN]: {
                requiresInputWallet: true,
                requiresOutputWallet: false,
                supportsGasDrop: false
            },
            [SwapType_1.SwapType.FROM_BTC]: {
                requiresInputWallet: false,
                requiresOutputWallet: true,
                supportsGasDrop: false
            },
            [SwapType_1.SwapType.FROM_BTCLN]: {
                requiresInputWallet: false,
                requiresOutputWallet: true,
                supportsGasDrop: false
            },
            [SwapType_1.SwapType.SPV_VAULT_FROM_BTC]: {
                requiresInputWallet: true,
                requiresOutputWallet: false,
                supportsGasDrop: true
            },
            [SwapType_1.SwapType.FROM_BTCLN_AUTO]: {
                requiresInputWallet: false,
                requiresOutputWallet: false,
                supportsGasDrop: true
            },
            [SwapType_1.SwapType.TRUSTED_FROM_BTC]: {
                requiresInputWallet: false,
                requiresOutputWallet: false,
                supportsGasDrop: false
            },
            [SwapType_1.SwapType.TRUSTED_FROM_BTCLN]: {
                requiresInputWallet: false,
                requiresOutputWallet: false,
                supportsGasDrop: false
            }
        };
        const storagePrefix = options?.storagePrefix ?? "atomiq-";
        options.bitcoinNetwork = options.bitcoinNetwork == null ? base_1.BitcoinNetwork.TESTNET : options.bitcoinNetwork;
        options.swapStorage ??= (name) => new IndexedDBUnifiedStorage_1.IndexedDBUnifiedStorage(name);
        this._bitcoinNetwork = options.bitcoinNetwork;
        this.bitcoinNetwork = options.bitcoinNetwork === base_1.BitcoinNetwork.MAINNET ? utils_1.NETWORK :
            (options.bitcoinNetwork === base_1.BitcoinNetwork.TESTNET || options.bitcoinNetwork === base_1.BitcoinNetwork.TESTNET4) ? utils_1.TEST_NETWORK : {
                bech32: 'bcrt',
                pubKeyHash: 111,
                scriptHash: 196,
                wif: 239
            };
        this.Utils = new SwapperUtils_1.SwapperUtils(this);
        this.prices = pricing;
        this.bitcoinRpc = bitcoinRpc;
        this.mempoolApi = bitcoinRpc.api;
        this.messenger = messenger;
        this.options = options;
        this.tokens = {};
        this.tokensByTicker = {};
        for (let tokenData of tokens) {
            for (let chainId in tokenData.chains) {
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
                };
            }
        }
        this.swapStateListener = (swap) => {
            this.emit("swapState", swap);
        };
        this.chains = (0, Utils_1.objectMap)(chainsData, (chainData, key) => {
            const { swapContract, chainEvents, btcRelay, chainInterface, spvVaultContract, spvVaultWithdrawalDataConstructor } = chainData;
            const synchronizer = new MempoolBtcRelaySynchronizer_1.MempoolBtcRelaySynchronizer(btcRelay, bitcoinRpc);
            const storageHandler = options.swapStorage(storagePrefix + chainData.chainId);
            const unifiedSwapStorage = new UnifiedSwapStorage_1.UnifiedSwapStorage(storageHandler, this.options.noSwapCache);
            const unifiedChainEvents = new UnifiedSwapEventListener_1.UnifiedSwapEventListener(unifiedSwapStorage, chainEvents);
            const wrappers = {};
            wrappers[SwapType_1.SwapType.TO_BTCLN] = new ToBTCLNWrapper_1.ToBTCLNWrapper(key, unifiedSwapStorage, unifiedChainEvents, chainInterface, swapContract, pricing, tokens, chainData.swapDataConstructor, {
                getRequestTimeout: options.getRequestTimeout,
                postRequestTimeout: options.postRequestTimeout,
            });
            wrappers[SwapType_1.SwapType.TO_BTC] = new ToBTCWrapper_1.ToBTCWrapper(key, unifiedSwapStorage, unifiedChainEvents, chainInterface, swapContract, pricing, tokens, chainData.swapDataConstructor, this.bitcoinRpc, {
                getRequestTimeout: options.getRequestTimeout,
                postRequestTimeout: options.postRequestTimeout,
                bitcoinNetwork: this.bitcoinNetwork
            });
            wrappers[SwapType_1.SwapType.FROM_BTCLN] = new FromBTCLNWrapper_1.FromBTCLNWrapper(key, unifiedSwapStorage, unifiedChainEvents, chainInterface, swapContract, pricing, tokens, chainData.swapDataConstructor, bitcoinRpc, {
                getRequestTimeout: options.getRequestTimeout,
                postRequestTimeout: options.postRequestTimeout,
                unsafeSkipLnNodeCheck: this._bitcoinNetwork === base_1.BitcoinNetwork.TESTNET4 || this._bitcoinNetwork === base_1.BitcoinNetwork.REGTEST
            });
            wrappers[SwapType_1.SwapType.FROM_BTC] = new FromBTCWrapper_1.FromBTCWrapper(key, unifiedSwapStorage, unifiedChainEvents, chainInterface, swapContract, pricing, tokens, chainData.swapDataConstructor, btcRelay, synchronizer, this.bitcoinRpc, {
                getRequestTimeout: options.getRequestTimeout,
                postRequestTimeout: options.postRequestTimeout,
                bitcoinNetwork: this.bitcoinNetwork
            });
            wrappers[SwapType_1.SwapType.TRUSTED_FROM_BTCLN] = new LnForGasWrapper_1.LnForGasWrapper(key, unifiedSwapStorage, unifiedChainEvents, chainInterface, pricing, tokens, {
                getRequestTimeout: options.getRequestTimeout,
                postRequestTimeout: options.postRequestTimeout
            });
            wrappers[SwapType_1.SwapType.TRUSTED_FROM_BTC] = new OnchainForGasWrapper_1.OnchainForGasWrapper(key, unifiedSwapStorage, unifiedChainEvents, chainInterface, pricing, tokens, bitcoinRpc, {
                getRequestTimeout: options.getRequestTimeout,
                postRequestTimeout: options.postRequestTimeout,
                bitcoinNetwork: this.bitcoinNetwork
            });
            if (spvVaultContract != null) {
                wrappers[SwapType_1.SwapType.SPV_VAULT_FROM_BTC] = new SpvFromBTCWrapper_1.SpvFromBTCWrapper(key, unifiedSwapStorage, unifiedChainEvents, chainInterface, spvVaultContract, pricing, tokens, spvVaultWithdrawalDataConstructor, btcRelay, synchronizer, bitcoinRpc, {
                    getRequestTimeout: options.getRequestTimeout,
                    postRequestTimeout: options.postRequestTimeout,
                    bitcoinNetwork: this.bitcoinNetwork
                });
            }
            if (swapContract.supportsInitWithoutClaimer) {
                wrappers[SwapType_1.SwapType.FROM_BTCLN_AUTO] = new FromBTCLNAutoWrapper_1.FromBTCLNAutoWrapper(key, unifiedSwapStorage, unifiedChainEvents, chainInterface, swapContract, pricing, tokens, chainData.swapDataConstructor, bitcoinRpc, this.messenger, {
                    getRequestTimeout: options.getRequestTimeout,
                    postRequestTimeout: options.postRequestTimeout,
                    unsafeSkipLnNodeCheck: this._bitcoinNetwork === base_1.BitcoinNetwork.TESTNET4 || this._bitcoinNetwork === base_1.BitcoinNetwork.REGTEST
                });
            }
            Object.keys(wrappers).forEach(key => wrappers[key].events.on("swapState", this.swapStateListener));
            const reviver = (val) => {
                const wrapper = wrappers[val.type];
                if (wrapper == null)
                    return null;
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
            };
        });
        const contracts = (0, Utils_1.objectMap)(chainsData, (data) => data.swapContract);
        if (options.intermediaryUrl != null) {
            this.intermediaryDiscovery = new IntermediaryDiscovery_1.IntermediaryDiscovery(contracts, options.registryUrl, Array.isArray(options.intermediaryUrl) ? options.intermediaryUrl : [options.intermediaryUrl], options.getRequestTimeout);
        }
        else {
            this.intermediaryDiscovery = new IntermediaryDiscovery_1.IntermediaryDiscovery(contracts, options.registryUrl, null, options.getRequestTimeout);
        }
        this.intermediaryDiscovery.on("removed", (intermediaries) => {
            this.emit("lpsRemoved", intermediaries);
        });
        this.intermediaryDiscovery.on("added", (intermediaries) => {
            this.emit("lpsAdded", intermediaries);
        });
    }
    async _init() {
        this.logger.debug("init(): Initializing swapper, sdk-lib version 16.1.3");
        const abortController = new AbortController();
        const promises = [];
        let automaticClockDriftCorrectionPromise;
        if (this.options.automaticClockDriftCorrection) {
            promises.push(automaticClockDriftCorrectionPromise = (0, Utils_1.tryWithRetries)(AutomaticClockDriftCorrection_1.correctClock, undefined, undefined, abortController.signal).catch((err) => {
                abortController.abort(err);
            }));
        }
        this.logger.debug("init(): Initializing intermediary discovery");
        if (!this.options.dontFetchLPs)
            promises.push(this.intermediaryDiscovery.init(abortController.signal).catch(err => {
                if (abortController.signal.aborted)
                    return;
                this.logger.error("init(): Failed to fetch intermediaries/LPs: ", err);
            }));
        if (this.options.defaultTrustedIntermediaryUrl != null) {
            promises.push(this.intermediaryDiscovery.getIntermediary(this.options.defaultTrustedIntermediaryUrl, abortController.signal)
                .then(val => {
                this.defaultTrustedIntermediary = val;
            })
                .catch(err => {
                if (abortController.signal.aborted)
                    return;
                this.logger.error("init(): Failed to contact trusted LP url: ", err);
            }));
        }
        if (automaticClockDriftCorrectionPromise != null) {
            //We should await the promises here before checking the swaps
            await automaticClockDriftCorrectionPromise;
        }
        const chainPromises = [];
        for (let chainIdentifier in this.chains) {
            chainPromises.push((async () => {
                const { swapContract, unifiedChainEvents, unifiedSwapStorage, wrappers, reviver } = this.chains[chainIdentifier];
                await swapContract.start();
                this.logger.debug("init(): Intialized swap contract: " + chainIdentifier);
                await unifiedSwapStorage.init();
                if (unifiedSwapStorage.storage instanceof IndexedDBUnifiedStorage_1.IndexedDBUnifiedStorage) {
                    //Try to migrate the data here
                    const storagePrefix = chainIdentifier === "SOLANA" ?
                        "SOLv4-" + this._bitcoinNetwork + "-Swaps-" :
                        "atomiqsdk-" + this._bitcoinNetwork + chainIdentifier + "-Swaps-";
                    await unifiedSwapStorage.storage.tryMigrate([
                        [storagePrefix + "FromBTC", SwapType_1.SwapType.FROM_BTC],
                        [storagePrefix + "FromBTCLN", SwapType_1.SwapType.FROM_BTCLN],
                        [storagePrefix + "ToBTC", SwapType_1.SwapType.TO_BTC],
                        [storagePrefix + "ToBTCLN", SwapType_1.SwapType.TO_BTCLN]
                    ], (obj) => {
                        const swap = reviver(obj);
                        if (swap.randomNonce == null) {
                            const oldIdentifierHash = swap.getId();
                            swap.randomNonce = (0, Utils_1.randomBytes)(16).toString("hex");
                            const newIdentifierHash = swap.getId();
                            this.logger.info("init(): Found older swap version without randomNonce, replacing, old hash: " + oldIdentifierHash +
                                " new hash: " + newIdentifierHash);
                        }
                        return swap;
                    });
                }
                if (!this.options.noEvents)
                    await unifiedChainEvents.start();
                this.logger.debug("init(): Intialized events: " + chainIdentifier);
                for (let key in wrappers) {
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
    /**
     * Initializes the swap storage and loads existing swaps, needs to be called before any other action
     */
    async init() {
        if (this.initialized)
            return;
        if (this.initPromise != null)
            await this.initPromise;
        try {
            const promise = this._init();
            this.initPromise = promise;
            await promise;
            delete this.initPromise;
            this.initialized = true;
        }
        catch (e) {
            delete this.initPromise;
            throw e;
        }
    }
    /**
     * Stops listening for onchain events and closes this Swapper instance
     */
    async stop() {
        if (this.initPromise)
            await this.initPromise;
        for (let chainIdentifier in this.chains) {
            const { wrappers, unifiedChainEvents } = this.chains[chainIdentifier];
            for (let key in wrappers) {
                wrappers[key].events.removeListener("swapState", this.swapStateListener);
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
    async createSwap(chainIdentifier, create, amountData, swapType, maxWaitTimeMS = 2000) {
        if (!this.initialized)
            throw new Error("Swapper not initialized, init first with swapper.init()!");
        if (this.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        let candidates;
        const inBtc = swapType === SwapType_1.SwapType.TO_BTCLN || swapType === SwapType_1.SwapType.TO_BTC ? !amountData.exactIn : amountData.exactIn;
        if (!inBtc) {
            //Get candidates not based on the amount
            candidates = this.intermediaryDiscovery.getSwapCandidates(chainIdentifier, swapType, amountData.token);
        }
        else {
            candidates = this.intermediaryDiscovery.getSwapCandidates(chainIdentifier, swapType, amountData.token, amountData.amount);
        }
        let swapLimitsChanged = false;
        if (candidates.length === 0) {
            this.logger.warn("createSwap(): No valid intermediary found, reloading intermediary database...");
            await this.intermediaryDiscovery.reloadIntermediaries();
            swapLimitsChanged = true;
            if (!inBtc) {
                //Get candidates not based on the amount
                candidates = this.intermediaryDiscovery.getSwapCandidates(chainIdentifier, swapType, amountData.token);
            }
            else {
                candidates = this.intermediaryDiscovery.getSwapCandidates(chainIdentifier, swapType, amountData.token, amountData.amount);
                if (candidates.length === 0) {
                    const min = this.intermediaryDiscovery.getSwapMinimum(chainIdentifier, swapType, amountData.token);
                    const max = this.intermediaryDiscovery.getSwapMaximum(chainIdentifier, swapType, amountData.token);
                    if (min != null && max != null) {
                        if (amountData.amount < BigInt(min))
                            throw new RequestError_1.OutOfBoundsError("Amount too low!", 200, BigInt(min), BigInt(max));
                        if (amountData.amount > BigInt(max))
                            throw new RequestError_1.OutOfBoundsError("Amount too high!", 200, BigInt(min), BigInt(max));
                    }
                }
            }
            if (candidates.length === 0)
                throw new Error("No intermediary found!");
        }
        const abortController = new AbortController();
        this.logger.debug("createSwap() Swap candidates: ", candidates.map(lp => lp.url).join());
        const quotePromises = await create(candidates, abortController.signal, this.chains[chainIdentifier]);
        const promiseAll = new Promise((resolve, reject) => {
            let min;
            let max;
            let error;
            let numResolved = 0;
            let quotes = [];
            let timeout;
            quotePromises.forEach(data => {
                data.quote.then(quote => {
                    if (numResolved === 0) {
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
                    if (numResolved === quotePromises.length) {
                        clearTimeout(timeout);
                        resolve(quotes);
                        return;
                    }
                }).catch(e => {
                    numResolved++;
                    if (e instanceof IntermediaryError_1.IntermediaryError) {
                        //Blacklist that node
                        this.intermediaryDiscovery.removeIntermediary(data.intermediary);
                        swapLimitsChanged = true;
                    }
                    else if (e instanceof RequestError_1.OutOfBoundsError) {
                        if (min == null || max == null) {
                            min = e.min;
                            max = e.max;
                        }
                        else {
                            min = (0, Utils_1.bigIntMin)(min, e.min);
                            max = (0, Utils_1.bigIntMax)(max, e.max);
                        }
                        data.intermediary.swapBounds[swapType] ??= {};
                        data.intermediary.swapBounds[swapType][chainIdentifier] ??= {};
                        const tokenBoundsData = (data.intermediary.swapBounds[swapType][chainIdentifier][amountData.token] ??= { input: null, output: null });
                        if (amountData.exactIn) {
                            tokenBoundsData.input = { min: e.min, max: e.max };
                        }
                        else {
                            tokenBoundsData.output = { min: e.min, max: e.max };
                        }
                        swapLimitsChanged = true;
                    }
                    this.logger.warn("createSwap(): Intermediary " + data.intermediary.url + " error: ", e);
                    error = e;
                    if (numResolved === quotePromises.length) {
                        if (timeout != null)
                            clearTimeout(timeout);
                        if (quotes.length > 0) {
                            resolve(quotes);
                            return;
                        }
                        if (min != null && max != null) {
                            reject(new RequestError_1.OutOfBoundsError("Out of bounds", 400, min, max));
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
                if (amountData.exactIn) {
                    //Compare outputs
                    return (0, Utils_1.bigIntCompare)(b.quote.getOutput().rawAmount, a.quote.getOutput().rawAmount);
                }
                else {
                    //Compare inputs
                    return (0, Utils_1.bigIntCompare)(a.quote.getInput().rawAmount, b.quote.getInput().rawAmount);
                }
            });
            this.logger.debug("createSwap(): Sorted quotes, best price to worst: ", quotes);
            if (swapLimitsChanged)
                this.emit("swapLimitsChanged");
            const quote = quotes[0].quote;
            if (this.options.saveUninitializedSwaps) {
                quote._setInitiated();
                await quote._save();
            }
            return quote;
        }
        catch (e) {
            if (swapLimitsChanged)
                this.emit("swapLimitsChanged");
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
    createToBTCSwap(chainIdentifier, signer, tokenAddress, address, amount, exactIn, additionalParams = this.options.defaultAdditionalParameters, options) {
        if (this.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        if (address.startsWith("bitcoin:")) {
            address = address.substring(8).split("?")[0];
        }
        if (!this.Utils.isValidBitcoinAddress(address))
            throw new Error("Invalid bitcoin address");
        if (!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true))
            throw new Error("Invalid " + chainIdentifier + " address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        options ??= {};
        options.confirmationTarget ??= 3;
        options.confirmations ??= 2;
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn
        };
        return this.createSwap(chainIdentifier, (candidates, abortSignal, chain) => Promise.resolve(chain.wrappers[SwapType_1.SwapType.TO_BTC].create(signer, address, amountData, candidates, options, additionalParams, abortSignal)), amountData, SwapType_1.SwapType.TO_BTC);
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
    async createToBTCLNSwap(chainIdentifier, signer, tokenAddress, paymentRequest, additionalParams = this.options.defaultAdditionalParameters, options) {
        if (this.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        options ??= {};
        if (paymentRequest.startsWith("lightning:"))
            paymentRequest = paymentRequest.substring(10);
        if (!this.Utils.isValidLightningInvoice(paymentRequest))
            throw new Error("Invalid lightning network invoice");
        if (!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true))
            throw new Error("Invalid " + chainIdentifier + " address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        const parsedPR = (0, bolt11_1.decode)(paymentRequest);
        const amountData = {
            amount: (BigInt(parsedPR.millisatoshis) + 999n) / 1000n,
            token: tokenAddress,
            exactIn: false
        };
        options.expirySeconds ??= 5 * 24 * 3600;
        return this.createSwap(chainIdentifier, (candidates, abortSignal, chain) => chain.wrappers[SwapType_1.SwapType.TO_BTCLN].create(signer, paymentRequest, amountData, candidates, options, additionalParams, abortSignal), amountData, SwapType_1.SwapType.TO_BTCLN);
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
    async createToBTCLNSwapViaLNURL(chainIdentifier, signer, tokenAddress, lnurlPay, amount, exactIn, additionalParams = this.options.defaultAdditionalParameters, options) {
        if (this.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        if (typeof (lnurlPay) === "string" && !this.Utils.isValidLNURL(lnurlPay))
            throw new Error("Invalid LNURL-pay link");
        if (!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true))
            throw new Error("Invalid " + chainIdentifier + " address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        options ??= {};
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn
        };
        options.expirySeconds ??= 5 * 24 * 3600;
        return this.createSwap(chainIdentifier, (candidates, abortSignal, chain) => chain.wrappers[SwapType_1.SwapType.TO_BTCLN].createViaLNURL(signer, typeof (lnurlPay) === "string" ? (lnurlPay.startsWith("lightning:") ? lnurlPay.substring(10) : lnurlPay) : lnurlPay.params, amountData, candidates, options, additionalParams, abortSignal), amountData, SwapType_1.SwapType.TO_BTCLN);
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
    async createToBTCLNSwapViaInvoiceCreateService(chainIdentifier, signer, tokenAddress, service, amount, exactIn, additionalParams = this.options.defaultAdditionalParameters, options) {
        if (this.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        if (!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true))
            throw new Error("Invalid " + chainIdentifier + " address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        options ??= {};
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn
        };
        options.expirySeconds ??= 5 * 24 * 3600;
        return this.createSwap(chainIdentifier, (candidates, abortSignal, chain) => chain.wrappers[SwapType_1.SwapType.TO_BTCLN].createViaInvoiceCreateService(signer, Promise.resolve(service), amountData, candidates, options, additionalParams, abortSignal), amountData, SwapType_1.SwapType.TO_BTCLN);
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
    async createFromBTCSwapNew(chainIdentifier, signer, tokenAddress, amount, exactOut, additionalParams = this.options.defaultAdditionalParameters, options) {
        if (this.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        if (!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true))
            throw new Error("Invalid " + chainIdentifier + " address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn: !exactOut
        };
        return this.createSwap(chainIdentifier, (candidates, abortSignal, chain) => Promise.resolve(chain.wrappers[SwapType_1.SwapType.SPV_VAULT_FROM_BTC].create(signer, amountData, candidates, options, additionalParams, abortSignal)), amountData, SwapType_1.SwapType.SPV_VAULT_FROM_BTC);
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
    async createFromBTCSwap(chainIdentifier, signer, tokenAddress, amount, exactOut, additionalParams = this.options.defaultAdditionalParameters, options) {
        if (this.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        if (!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true))
            throw new Error("Invalid " + chainIdentifier + " address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn: !exactOut
        };
        return this.createSwap(chainIdentifier, (candidates, abortSignal, chain) => Promise.resolve(chain.wrappers[SwapType_1.SwapType.FROM_BTC].create(signer, amountData, candidates, options, additionalParams, abortSignal)), amountData, SwapType_1.SwapType.FROM_BTC);
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
    async createFromBTCLNSwap(chainIdentifier, signer, tokenAddress, amount, exactOut, additionalParams = this.options.defaultAdditionalParameters, options) {
        if (this.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        if (!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true))
            throw new Error("Invalid " + chainIdentifier + " address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn: !exactOut
        };
        return this.createSwap(chainIdentifier, (candidates, abortSignal, chain) => Promise.resolve(chain.wrappers[SwapType_1.SwapType.FROM_BTCLN].create(signer, amountData, candidates, options, additionalParams, abortSignal)), amountData, SwapType_1.SwapType.FROM_BTCLN);
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
    async createFromBTCLNSwapViaLNURL(chainIdentifier, signer, tokenAddress, lnurl, amount, exactOut, additionalParams = this.options.defaultAdditionalParameters) {
        if (this.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        if (typeof (lnurl) === "string" && !this.Utils.isValidLNURL(lnurl))
            throw new Error("Invalid LNURL-withdraw link");
        if (!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true))
            throw new Error("Invalid " + chainIdentifier + " address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn: !exactOut
        };
        return this.createSwap(chainIdentifier, (candidates, abortSignal, chain) => chain.wrappers[SwapType_1.SwapType.FROM_BTCLN].createViaLNURL(signer, typeof (lnurl) === "string" ? (lnurl.startsWith("lightning:") ? lnurl.substring(10) : lnurl) : lnurl.params, amountData, candidates, additionalParams, abortSignal), amountData, SwapType_1.SwapType.FROM_BTCLN);
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
    async createFromBTCLNSwapNew(chainIdentifier, signer, tokenAddress, amount, exactOut, additionalParams = this.options.defaultAdditionalParameters, options) {
        if (this.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        if (!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true))
            throw new Error("Invalid " + chainIdentifier + " address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn: !exactOut
        };
        return this.createSwap(chainIdentifier, (candidates, abortSignal, chain) => Promise.resolve(chain.wrappers[SwapType_1.SwapType.FROM_BTCLN_AUTO].create(signer, amountData, candidates, options, additionalParams, abortSignal)), amountData, SwapType_1.SwapType.FROM_BTCLN_AUTO);
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
    async createFromBTCLNSwapNewViaLNURL(chainIdentifier, signer, tokenAddress, lnurl, amount, exactOut, additionalParams = this.options.defaultAdditionalParameters, options) {
        if (this.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        if (typeof (lnurl) === "string" && !this.Utils.isValidLNURL(lnurl))
            throw new Error("Invalid LNURL-withdraw link");
        if (!this.chains[chainIdentifier].chainInterface.isValidAddress(signer, true))
            throw new Error("Invalid " + chainIdentifier + " address");
        signer = this.chains[chainIdentifier].chainInterface.normalizeAddress(signer);
        const amountData = {
            amount,
            token: tokenAddress,
            exactIn: !exactOut
        };
        return this.createSwap(chainIdentifier, (candidates, abortSignal, chain) => chain.wrappers[SwapType_1.SwapType.FROM_BTCLN_AUTO].createViaLNURL(signer, typeof (lnurl) === "string" ? (lnurl.startsWith("lightning:") ? lnurl.substring(10) : lnurl) : lnurl.params, amountData, candidates, options, additionalParams, abortSignal), amountData, SwapType_1.SwapType.FROM_BTCLN_AUTO);
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
    createTrustedLNForGasSwap(chainId, signer, amount, trustedIntermediaryOrUrl) {
        if (this.chains[chainId] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainId);
        if (!this.chains[chainId].chainInterface.isValidAddress(signer, true))
            throw new Error("Invalid " + chainId + " address");
        signer = this.chains[chainId].chainInterface.normalizeAddress(signer);
        const useUrl = trustedIntermediaryOrUrl ?? this.defaultTrustedIntermediary ?? this.options.defaultTrustedIntermediaryUrl;
        if (useUrl == null)
            throw new Error("No trusted intermediary specified!");
        return this.chains[chainId].wrappers[SwapType_1.SwapType.TRUSTED_FROM_BTCLN].create(signer, amount, useUrl);
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
    createTrustedOnchainForGasSwap(chainId, signer, amount, refundAddress, trustedIntermediaryOrUrl) {
        if (this.chains[chainId] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainId);
        if (!this.chains[chainId].chainInterface.isValidAddress(signer, true))
            throw new Error("Invalid " + chainId + " address");
        signer = this.chains[chainId].chainInterface.normalizeAddress(signer);
        const useUrl = trustedIntermediaryOrUrl ?? this.defaultTrustedIntermediary ?? this.options.defaultTrustedIntermediaryUrl;
        if (useUrl == null)
            throw new Error("No trusted intermediary specified!");
        return this.chains[chainId].wrappers[SwapType_1.SwapType.TRUSTED_FROM_BTC].create(signer, amount, useUrl, refundAddress);
    }
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
    create(signer, srcToken, dstToken, amount, exactIn, addressLnurlLightningInvoice) {
        if (srcToken.chain === "BTC") {
            return this.swap(srcToken, dstToken, amount, exactIn, addressLnurlLightningInvoice, signer);
        }
        else {
            return this.swap(srcToken, dstToken, amount, exactIn, signer, addressLnurlLightningInvoice);
        }
    }
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
    swap(_srcToken, _dstToken, _amount, exactIn, src, dst, options) {
        const srcToken = typeof (_srcToken) === "string" ? this.getToken(_srcToken) : _srcToken;
        const dstToken = typeof (_dstToken) === "string" ? this.getToken(_dstToken) : _dstToken;
        const amount = _amount == null ? null : (typeof (_amount) === "bigint" ? _amount : (0, Tokens_1.fromDecimal)(_amount, exactIn ? srcToken.decimals : dstToken.decimals));
        if (srcToken.chain === "BTC") {
            if (dstToken.chain === "SC") {
                if (typeof (dst) !== "string")
                    throw new Error("Destination for BTC/BTC-LN -> smart chain swaps must be a smart chain address!");
                if (srcToken.lightning) {
                    //FROM_BTCLN
                    if (src != null) {
                        if (typeof (src) !== "string" && !(0, LNURL_1.isLNURLWithdraw)(src))
                            throw new Error("LNURL must be a string or LNURLWithdraw object!");
                        return this.supportsSwapType(dstToken.chainId, SwapType_1.SwapType.FROM_BTCLN_AUTO) ?
                            this.createFromBTCLNSwapNewViaLNURL(dstToken.chainId, dst, dstToken.address, src, amount, !exactIn, undefined, options) :
                            this.createFromBTCLNSwapViaLNURL(dstToken.chainId, dst, dstToken.address, src, amount, !exactIn);
                    }
                    else {
                        return this.supportsSwapType(dstToken.chainId, SwapType_1.SwapType.FROM_BTCLN_AUTO) ?
                            this.createFromBTCLNSwapNew(dstToken.chainId, dst, dstToken.address, amount, !exactIn, undefined, options) :
                            this.createFromBTCLNSwap(dstToken.chainId, dst, dstToken.address, amount, !exactIn, undefined, options);
                    }
                }
                else {
                    //FROM_BTC
                    if (this.supportsSwapType(dstToken.chainId, SwapType_1.SwapType.SPV_VAULT_FROM_BTC)) {
                        return this.createFromBTCSwapNew(dstToken.chainId, dst, dstToken.address, amount, !exactIn, undefined, options);
                    }
                    else {
                        return this.createFromBTCSwap(dstToken.chainId, dst, dstToken.address, amount, !exactIn, undefined, options);
                    }
                }
            }
        }
        else {
            if (dstToken.chain === "BTC") {
                if (typeof (src) !== "string")
                    throw new Error("Source address for BTC/BTC-LN -> smart chain swaps must be a smart chain address!");
                if (dstToken.lightning) {
                    //TO_BTCLN
                    if (typeof (dst) !== "string" && !(0, LNURL_1.isLNURLPay)(dst))
                        throw new Error("Destination LNURL link/lightning invoice must be a string or LNURLPay object!");
                    if ((0, LNURL_1.isLNURLPay)(dst) || this.Utils.isValidLNURL(dst)) {
                        return this.createToBTCLNSwapViaLNURL(srcToken.chainId, src, srcToken.address, dst, amount, !!exactIn, undefined, options);
                    }
                    else if ((0, ToBTCLNWrapper_1.isInvoiceCreateService)(dst)) {
                        return this.createToBTCLNSwapViaInvoiceCreateService(srcToken.chainId, src, srcToken.address, dst, amount, !!exactIn, undefined, options);
                    }
                    else if (this.Utils.isLightningInvoice(dst)) {
                        if (!this.Utils.isValidLightningInvoice(dst))
                            throw new Error("Invalid lightning invoice specified, lightning invoice MUST contain pre-set amount!");
                        if (exactIn)
                            throw new Error("Only exact out swaps are possible with lightning invoices, use LNURL links for exact in lightning swaps!");
                        return this.createToBTCLNSwap(srcToken.chainId, src, srcToken.address, dst, undefined, options);
                    }
                    else {
                        throw new Error("Supplied parameter is not LNURL link nor lightning invoice (bolt11)!");
                    }
                }
                else {
                    //TO_BTC
                    if (typeof (dst) !== "string")
                        throw new Error("Destination bitcoin address must be a string!");
                    return this.createToBTCSwap(srcToken.chainId, src, srcToken.address, dst, amount, !!exactIn, undefined, options);
                }
            }
        }
        throw new Error("Unsupported swap type");
    }
    async getAllSwaps(chainId, signer) {
        const queryParams = [];
        if (signer != null)
            queryParams.push({ key: "initiator", value: signer });
        if (chainId == null) {
            const res = await Promise.all(Object.keys(this.chains).map((chainId) => {
                const { unifiedSwapStorage, reviver } = this.chains[chainId];
                return unifiedSwapStorage.query([queryParams], reviver);
            }));
            return res.flat();
        }
        else {
            const { unifiedSwapStorage, reviver } = this.chains[chainId];
            return await unifiedSwapStorage.query([queryParams], reviver);
        }
    }
    async getActionableSwaps(chainId, signer) {
        if (chainId == null) {
            const res = await Promise.all(Object.keys(this.chains).map((chainId) => {
                const { unifiedSwapStorage, reviver, wrappers } = this.chains[chainId];
                const queryParams = [];
                for (let key in wrappers) {
                    const wrapper = wrappers[key];
                    const swapTypeQueryParams = [{ key: "type", value: wrapper.TYPE }];
                    if (signer != null)
                        swapTypeQueryParams.push({ key: "initiator", value: signer });
                    swapTypeQueryParams.push({ key: "state", value: wrapper.pendingSwapStates });
                    queryParams.push(swapTypeQueryParams);
                }
                return unifiedSwapStorage.query(queryParams, reviver);
            }));
            return res.flat().filter(swap => swap.requiresAction());
        }
        else {
            const { unifiedSwapStorage, reviver, wrappers } = this.chains[chainId];
            const queryParams = [];
            for (let key in wrappers) {
                const wrapper = wrappers[key];
                const swapTypeQueryParams = [{ key: "type", value: wrapper.TYPE }];
                if (signer != null)
                    swapTypeQueryParams.push({ key: "initiator", value: signer });
                swapTypeQueryParams.push({ key: "state", value: wrapper.pendingSwapStates });
                queryParams.push(swapTypeQueryParams);
            }
            return (await unifiedSwapStorage.query(queryParams, reviver)).filter(swap => swap.requiresAction());
        }
    }
    async getRefundableSwaps(chainId, signer) {
        if (chainId == null) {
            const res = await Promise.all(Object.keys(this.chains).map((chainId) => {
                const { unifiedSwapStorage, reviver, wrappers } = this.chains[chainId];
                const queryParams = [];
                for (let wrapper of [wrappers[SwapType_1.SwapType.TO_BTCLN], wrappers[SwapType_1.SwapType.TO_BTC]]) {
                    const swapTypeQueryParams = [{ key: "type", value: wrapper.TYPE }];
                    if (signer != null)
                        swapTypeQueryParams.push({ key: "initiator", value: signer });
                    swapTypeQueryParams.push({ key: "state", value: wrapper.refundableSwapStates });
                    queryParams.push(swapTypeQueryParams);
                }
                return unifiedSwapStorage.query(queryParams, reviver);
            }));
            return res.flat().filter(swap => swap.isRefundable());
        }
        else {
            const { unifiedSwapStorage, reviver, wrappers } = this.chains[chainId];
            const queryParams = [];
            for (let wrapper of [wrappers[SwapType_1.SwapType.TO_BTCLN], wrappers[SwapType_1.SwapType.TO_BTC]]) {
                const swapTypeQueryParams = [{ key: "type", value: wrapper.TYPE }];
                if (signer != null)
                    swapTypeQueryParams.push({ key: "initiator", value: signer });
                swapTypeQueryParams.push({ key: "state", value: wrapper.refundableSwapStates });
                queryParams.push(swapTypeQueryParams);
            }
            const result = await unifiedSwapStorage.query(queryParams, reviver);
            return result.filter(swap => swap.isRefundable());
        }
    }
    async getClaimableSwaps(chainId, signer) {
        if (chainId == null) {
            const res = await Promise.all(Object.keys(this.chains).map((chainId) => {
                const { unifiedSwapStorage, reviver, wrappers } = this.chains[chainId];
                const queryParams = [];
                for (let wrapper of [wrappers[SwapType_1.SwapType.FROM_BTC], wrappers[SwapType_1.SwapType.FROM_BTCLN], wrappers[SwapType_1.SwapType.SPV_VAULT_FROM_BTC], wrappers[SwapType_1.SwapType.FROM_BTCLN_AUTO]]) {
                    if (wrapper == null)
                        continue;
                    const swapTypeQueryParams = [{ key: "type", value: wrapper.TYPE }];
                    if (signer != null)
                        swapTypeQueryParams.push({ key: "initiator", value: signer });
                    swapTypeQueryParams.push({ key: "state", value: wrapper.claimableSwapStates });
                    queryParams.push(swapTypeQueryParams);
                }
                return unifiedSwapStorage.query(queryParams, reviver);
            }));
            return res.flat().filter(swap => swap.isClaimable());
        }
        else {
            const { unifiedSwapStorage, reviver, wrappers } = this.chains[chainId];
            const queryParams = [];
            for (let wrapper of [wrappers[SwapType_1.SwapType.FROM_BTC], wrappers[SwapType_1.SwapType.FROM_BTCLN], wrappers[SwapType_1.SwapType.SPV_VAULT_FROM_BTC], wrappers[SwapType_1.SwapType.FROM_BTCLN_AUTO]]) {
                if (wrapper == null)
                    continue;
                const swapTypeQueryParams = [{ key: "type", value: wrapper.TYPE }];
                if (signer != null)
                    swapTypeQueryParams.push({ key: "initiator", value: signer });
                swapTypeQueryParams.push({ key: "state", value: wrapper.claimableSwapStates });
                queryParams.push(swapTypeQueryParams);
            }
            const result = await unifiedSwapStorage.query(queryParams, reviver);
            return result.filter(swap => swap.isClaimable());
        }
    }
    async getSwapById(id, chainId, signer) {
        //Check in pending swaps first
        if (chainId != null) {
            for (let key in this.chains[chainId].wrappers) {
                const wrapper = this.chains[chainId].wrappers[key];
                const result = wrapper.pendingSwaps.get(id)?.deref();
                if (result != null) {
                    if (signer != null) {
                        if (result._getInitiator() === signer)
                            return result;
                    }
                    else {
                        return result;
                    }
                }
            }
        }
        else {
            for (let chainId in this.chains) {
                for (let key in this.chains[chainId].wrappers) {
                    const wrapper = this.chains[chainId].wrappers[key];
                    const result = wrapper.pendingSwaps.get(id)?.deref();
                    if (result != null) {
                        if (signer != null) {
                            if (result._getInitiator() === signer)
                                return result;
                        }
                        else {
                            return result;
                        }
                    }
                }
            }
        }
        const queryParams = [];
        if (signer != null)
            queryParams.push({ key: "initiator", value: signer });
        queryParams.push({ key: "id", value: id });
        if (chainId == null) {
            const res = await Promise.all(Object.keys(this.chains).map((chainId) => {
                const { unifiedSwapStorage, reviver } = this.chains[chainId];
                return unifiedSwapStorage.query([queryParams], reviver);
            }));
            return res.flat()[0];
        }
        else {
            const { unifiedSwapStorage, reviver } = this.chains[chainId];
            return (await unifiedSwapStorage.query([queryParams], reviver))[0];
        }
    }
    async syncSwapsForChain(chainId, signer) {
        const { unifiedSwapStorage, reviver, wrappers } = this.chains[chainId];
        const queryParams = [];
        for (let key in wrappers) {
            const wrapper = wrappers[key];
            const swapTypeQueryParams = [{ key: "type", value: wrapper.TYPE }];
            if (signer != null)
                swapTypeQueryParams.push({ key: "initiator", value: signer });
            swapTypeQueryParams.push({ key: "state", value: wrapper.pendingSwapStates });
            queryParams.push(swapTypeQueryParams);
        }
        this.logger.debug("_syncSwaps(): Querying swaps swaps for chain " + chainId + "!");
        const swaps = await unifiedSwapStorage.query(queryParams, reviver);
        this.logger.debug("_syncSwaps(): Syncing " + swaps.length + " swaps!");
        const changedSwaps = [];
        const removeSwaps = [];
        const assortedSwaps = {};
        swaps.forEach(swap => {
            assortedSwaps[swap.getType()] ??= [];
            assortedSwaps[swap.getType()].push(swap);
        });
        for (let swapType in assortedSwaps) {
            const wrapperSwaps = assortedSwaps[swapType];
            const wrapper = wrappers[swapType];
            const result = await wrapper.checkPastSwaps(wrapperSwaps, true);
            changedSwaps.push(...result.changedSwaps);
            removeSwaps.push(...result.removeSwaps);
        }
        this.logger.debug("_syncSwaps(): Done syncing " + swaps.length + " swaps, saving " + changedSwaps.length + " changed swaps, removing " + removeSwaps.length + " swaps!");
        await unifiedSwapStorage.saveAll(changedSwaps);
        await unifiedSwapStorage.removeAll(removeSwaps);
    }
    /**
     * Synchronizes swaps from chain, this is usually ran when SDK is initialized, deletes expired quotes
     *
     * @param chainId
     * @param signer
     */
    async _syncSwaps(chainId, signer) {
        if (chainId == null) {
            await Promise.all(Object.keys(this.chains).map((chainId) => {
                return this.syncSwapsForChain(chainId, signer);
            }));
        }
        else {
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
    async recoverSwaps(chainId, signer, startBlockheight) {
        const { swapContract, unifiedSwapStorage, reviver, wrappers } = this.chains[chainId];
        if (swapContract.getHistoricalSwaps == null)
            throw new Error(`Historical swap recovery is not supported for ${chainId}`);
        const { swaps } = await swapContract.getHistoricalSwaps(signer);
        const escrowHashes = Object.keys(swaps);
        this.logger.debug(`recoverSwaps(): Loaded on-chain data for ${escrowHashes.length} swaps`);
        this.logger.debug(`recoverSwaps(): Fetching if swap escrowHashes are known: ${escrowHashes.join(", ")}`);
        const knownSwapsArray = await unifiedSwapStorage.query([[{ key: "escrowHash", value: escrowHashes }]], reviver);
        const knownSwaps = {};
        knownSwapsArray.forEach(val => knownSwaps[val._getEscrowHash()] = val);
        this.logger.debug(`recoverSwaps(): Fetched known swaps escrowHashes: ${Object.keys(knownSwaps).join(", ")}`);
        const recoveredSwaps = [];
        for (let escrowHash in swaps) {
            const { init, state } = swaps[escrowHash];
            const knownSwap = knownSwaps[escrowHash];
            if (init == null) {
                if (knownSwap == null)
                    this.logger.warn(`recoverSwaps(): Fetched ${escrowHash} swap state, but swap not found locally!`);
                //TODO: Update the existing swaps here
                this.logger.debug(`recoverSwaps(): Skipping ${escrowHash} swap: swap already known and in local storage!`);
                continue;
            }
            if (knownSwap != null) {
                //TODO: Update the existing swaps here
                this.logger.debug(`recoverSwaps(): Skipping ${escrowHash} swap: swap already known and in local storage!`);
                continue;
            }
            const data = init.data;
            //Classify swap
            let swap;
            let typeIdentified = false;
            if (data.getType() === base_1.ChainSwapType.HTLC) {
                if (data.isOfferer(signer)) {
                    //To BTCLN
                    typeIdentified = true;
                    const lp = this.intermediaryDiscovery.intermediaries.find(val => val.supportsChain(chainId) && data.isClaimer(val.getAddress(chainId)));
                    swap = await wrappers[SwapType_1.SwapType.TO_BTCLN].recoverFromSwapDataAndState(init, state, lp);
                }
                else if (data.isClaimer(signer)) {
                    //From BTCLN
                    typeIdentified = true;
                    const lp = this.intermediaryDiscovery.intermediaries.find(val => val.supportsChain(chainId) && data.isOfferer(val.getAddress(chainId)));
                    if (this.supportsSwapType(chainId, SwapType_1.SwapType.FROM_BTCLN_AUTO)) {
                        swap = await wrappers[SwapType_1.SwapType.FROM_BTCLN_AUTO].recoverFromSwapDataAndState(init, state, lp);
                    }
                    else {
                        swap = await wrappers[SwapType_1.SwapType.FROM_BTCLN].recoverFromSwapDataAndState(init, state, lp);
                    }
                }
            }
            else if (data.getType() === base_1.ChainSwapType.CHAIN_NONCED) {
                //To BTC
                typeIdentified = true;
                const lp = this.intermediaryDiscovery.intermediaries.find(val => val.supportsChain(chainId) && data.isClaimer(val.getAddress(chainId)));
                swap = await wrappers[SwapType_1.SwapType.TO_BTC].recoverFromSwapDataAndState(init, state, lp);
            }
            else if (data.getType() === base_1.ChainSwapType.CHAIN) {
                //From BTC
                typeIdentified = true;
                const lp = this.intermediaryDiscovery.intermediaries.find(val => val.supportsChain(chainId) && data.isOfferer(val.getAddress(chainId)));
                swap = await wrappers[SwapType_1.SwapType.FROM_BTC].recoverFromSwapDataAndState(init, state, lp);
            }
            if (swap != null) {
                recoveredSwaps.push(swap);
            }
            else {
                if (typeIdentified)
                    this.logger.debug(`recoverSwaps(): Swap data type correctly identified but swap returned is null for swap ${escrowHash}`);
            }
        }
        this.logger.debug(`recoverSwaps(): Successfully recovered ${recoveredSwaps.length} swaps!`);
        return recoveredSwaps;
    }
    getToken(tickerOrAddress) {
        //Btc tokens - BTC, BTCLN, BTC-LN
        if (tickerOrAddress === "BTC")
            return Tokens_1.BitcoinTokens.BTC;
        if (tickerOrAddress === "BTCLN" || tickerOrAddress === "BTC-LN")
            return Tokens_1.BitcoinTokens.BTCLN;
        //Check if the ticker is in format <chainId>-<ticker>, i.e. SOLANA-USDC, STARKNET-WBTC
        if (tickerOrAddress.includes("-")) {
            const [chainId, ticker] = tickerOrAddress.split("-");
            const token = this.tokensByTicker[chainId]?.[ticker];
            if (token == null)
                throw new UserError_1.UserError(`Not found ticker: ${ticker} for chainId: ${chainId}`);
            return token;
        }
        const possibleTokens = [];
        for (let chainId in this.chains) {
            const chain = this.chains[chainId];
            if (chain.chainInterface.isValidToken(tickerOrAddress)) {
                //Try to find in known token addresses
                const token = this.tokens[chainId]?.[tickerOrAddress];
                if (token != null)
                    return token;
            }
            else {
                //Check in known tickers
                const token = this.tokensByTicker[chainId]?.[tickerOrAddress];
                if (token != null)
                    possibleTokens.push(token);
            }
        }
        if (possibleTokens.length === 0)
            throw new UserError_1.UserError(`Specified token address or ticker ${tickerOrAddress} not found!`);
        //In case we've found the token in multiple chains
        if (possibleTokens.length > 1)
            throw new UserError_1.UserError(`A ticker ${tickerOrAddress} has been found in multiple chains, narrow it down by using <chainId>-${tickerOrAddress} notation`);
        return possibleTokens[0];
    }
    /**
     * Creates a child swapper instance with a given smart chain
     *
     * @param chainIdentifier
     */
    withChain(chainIdentifier) {
        if (this.chains[chainIdentifier] == null)
            throw new Error("Invalid chain identifier! Unknown chain: " + chainIdentifier);
        return new SwapperWithChain_1.SwapperWithChain(this, chainIdentifier);
    }
    /**
     * Returns supported smart chains
     */
    getSmartChains() {
        return Object.keys(this.chains);
    }
    /**
     * Returns whether the SDK supports a given swap type on a given chain based on currently known LPs
     *
     * @param chainId
     * @param swapType
     */
    supportsSwapType(chainId, swapType) {
        return (this.chains[chainId]?.wrappers[swapType] != null);
    }
    getSwapType(srcToken, dstToken) {
        if ((0, Tokens_1.isSCToken)(srcToken)) {
            if (!(0, Tokens_1.isBtcToken)(dstToken))
                throw new Error("Swap not supported");
            if (dstToken.lightning) {
                return SwapType_1.SwapType.TO_BTCLN;
            }
            else {
                return SwapType_1.SwapType.TO_BTC;
            }
        }
        else if ((0, Tokens_1.isBtcToken)(srcToken)) {
            if (!(0, Tokens_1.isSCToken)(dstToken))
                throw new Error("Swap not supported");
            if (srcToken.lightning) {
                if (this.supportsSwapType(dstToken.chainId, SwapType_1.SwapType.FROM_BTCLN_AUTO)) {
                    return SwapType_1.SwapType.FROM_BTCLN_AUTO;
                }
                else {
                    return SwapType_1.SwapType.FROM_BTCLN;
                }
            }
            else {
                if (this.supportsSwapType(dstToken.chainId, SwapType_1.SwapType.SPV_VAULT_FROM_BTC)) {
                    return SwapType_1.SwapType.SPV_VAULT_FROM_BTC;
                }
                else {
                    return SwapType_1.SwapType.FROM_BTC;
                }
            }
        }
        return null;
    }
    /**
     * Returns minimum/maximum limits for inputs and outputs for a swap between given tokens
     *
     * @param srcToken
     * @param dstToken
     */
    getSwapLimits(srcToken, dstToken) {
        const swapType = this.getSwapType(srcToken, dstToken);
        const scToken = (0, Tokens_1.isSCToken)(srcToken) ? srcToken : (0, Tokens_1.isSCToken)(dstToken) ? dstToken : null;
        const result = {
            input: { min: null, max: null },
            output: { min: null, max: null }
        };
        for (let lp of this.intermediaryDiscovery.intermediaries) {
            const lpMinMax = lp.getSwapLimits(swapType, scToken.chainId, scToken.address);
            if (lpMinMax == null)
                continue;
            result.input.min = result.input.min == null ? lpMinMax.input.min : (0, Utils_1.bigIntMin)(result.input.min, lpMinMax.input.min);
            result.input.max = result.input.max == null ? lpMinMax.input.max : (0, Utils_1.bigIntMax)(result.input.max, lpMinMax.input.max);
            result.output.min = result.output.min == null ? lpMinMax.output.min : (0, Utils_1.bigIntMin)(result.output.min, lpMinMax.output.min);
            result.output.max = result.output.max == null ? lpMinMax.output.max : (0, Utils_1.bigIntMax)(result.output.max, lpMinMax.output.max);
        }
        return {
            input: {
                min: (0, Tokens_1.toTokenAmount)(result.input.min ?? 1n, srcToken, this.prices),
                max: result.input.max == null ? null : (0, Tokens_1.toTokenAmount)(result.input.max, srcToken, this.prices),
            },
            output: {
                min: (0, Tokens_1.toTokenAmount)(result.output.min ?? 1n, dstToken, this.prices),
                max: result.input.max == null ? null : (0, Tokens_1.toTokenAmount)(result.output.max, dstToken, this.prices),
            }
        };
    }
    /**
     * Returns supported tokens for a given direction
     *
     * @param input Whether to return input tokens or output tokens
     */
    getSupportedTokens(input) {
        const tokens = {};
        let lightning = false;
        let btc = false;
        this.intermediaryDiscovery.intermediaries.forEach(lp => {
            for (let swapType of [SwapType_1.SwapType.TO_BTC, SwapType_1.SwapType.TO_BTCLN, SwapType_1.SwapType.FROM_BTC, SwapType_1.SwapType.FROM_BTCLN, SwapType_1.SwapType.SPV_VAULT_FROM_BTC, SwapType_1.SwapType.FROM_BTCLN_AUTO]) {
                if (lp.services[swapType] == null)
                    continue;
                if (lp.services[swapType].chainTokens == null)
                    continue;
                for (let chainId of this.getSmartChains()) {
                    if (this.supportsSwapType(chainId, SwapType_1.SwapType.SPV_VAULT_FROM_BTC) ? swapType === SwapType_1.SwapType.FROM_BTC : swapType === SwapType_1.SwapType.SPV_VAULT_FROM_BTC)
                        continue;
                    if (this.supportsSwapType(chainId, SwapType_1.SwapType.FROM_BTCLN_AUTO) ? swapType === SwapType_1.SwapType.FROM_BTCLN : swapType === SwapType_1.SwapType.FROM_BTCLN_AUTO)
                        continue;
                    if (lp.services[swapType].chainTokens[chainId] == null)
                        continue;
                    for (let tokenAddress of lp.services[swapType].chainTokens[chainId]) {
                        if (input) {
                            if (swapType === SwapType_1.SwapType.TO_BTC || swapType === SwapType_1.SwapType.TO_BTCLN) {
                                tokens[chainId] ??= new Set();
                                tokens[chainId].add(tokenAddress);
                            }
                            if (swapType === SwapType_1.SwapType.FROM_BTCLN || swapType === SwapType_1.SwapType.FROM_BTCLN_AUTO) {
                                lightning = true;
                            }
                            if (swapType === SwapType_1.SwapType.FROM_BTC || swapType === SwapType_1.SwapType.SPV_VAULT_FROM_BTC) {
                                btc = true;
                            }
                        }
                        else {
                            if (swapType === SwapType_1.SwapType.FROM_BTCLN || swapType === SwapType_1.SwapType.FROM_BTC || swapType === SwapType_1.SwapType.SPV_VAULT_FROM_BTC || swapType === SwapType_1.SwapType.FROM_BTCLN_AUTO) {
                                tokens[chainId] ??= new Set();
                                tokens[chainId].add(tokenAddress);
                            }
                            if (swapType === SwapType_1.SwapType.TO_BTCLN) {
                                lightning = true;
                            }
                            if (swapType === SwapType_1.SwapType.TO_BTC) {
                                btc = true;
                            }
                        }
                    }
                }
            }
        });
        const output = [];
        if (lightning)
            output.push(Tokens_1.BitcoinTokens.BTCLN);
        if (btc)
            output.push(Tokens_1.BitcoinTokens.BTC);
        for (let chainId in tokens) {
            tokens[chainId].forEach(tokenAddress => {
                const token = this.tokens?.[chainId]?.[tokenAddress];
                if (token != null)
                    output.push(token);
            });
        }
        return output;
    }
    /**
     * Returns a set of supported tokens by all the intermediaries offering a specific swap service
     *
     * @param _swapType Swap service type to check supported tokens for
     */
    getSupportedTokensForSwapType(_swapType) {
        const tokens = {};
        this.intermediaryDiscovery.intermediaries.forEach(lp => {
            for (let chainId of this.getSmartChains()) {
                let swapType = _swapType;
                if (swapType === SwapType_1.SwapType.FROM_BTC && this.supportsSwapType(chainId, SwapType_1.SwapType.SPV_VAULT_FROM_BTC))
                    swapType = SwapType_1.SwapType.SPV_VAULT_FROM_BTC;
                if (swapType === SwapType_1.SwapType.FROM_BTCLN && this.supportsSwapType(chainId, SwapType_1.SwapType.FROM_BTCLN_AUTO))
                    swapType = SwapType_1.SwapType.FROM_BTCLN_AUTO;
                if (lp.services[swapType] == null)
                    break;
                if (lp.services[swapType].chainTokens == null)
                    break;
                if (lp.services[swapType].chainTokens[chainId] == null)
                    continue;
                for (let tokenAddress of lp.services[swapType].chainTokens[chainId]) {
                    tokens[chainId] ??= new Set();
                    tokens[chainId].add(tokenAddress);
                }
            }
        });
        const output = [];
        for (let chainId in tokens) {
            tokens[chainId].forEach(tokenAddress => {
                const token = this.tokens?.[chainId]?.[tokenAddress];
                if (token != null)
                    output.push(token);
            });
        }
        return output;
    }
    /**
     * Returns the set of supported token addresses by all the intermediaries we know of offering a specific swapType service
     *
     * @param chainIdentifier
     * @param swapType Specific swap type for which to obtain supported tokens
     */
    getSupportedTokenAddresses(chainIdentifier, swapType) {
        const set = new Set();
        this.intermediaryDiscovery.intermediaries.forEach(lp => {
            if (lp.services[swapType] == null)
                return;
            if (lp.services[swapType].chainTokens == null || lp.services[swapType].chainTokens[chainIdentifier] == null)
                return;
            lp.services[swapType].chainTokens[chainIdentifier].forEach(token => set.add(token));
        });
        return set;
    }
    /**
     * Returns tokens that you can swap to (if input=true) from a given token,
     *  or tokens that you can swap from (if input=false) to a given token
     */
    getSwapCounterTokens(token, input) {
        if ((0, Tokens_1.isSCToken)(token)) {
            const result = [];
            if (input) {
                //TO_BTC or TO_BTCLN
                if (this.getSupportedTokenAddresses(token.chainId, SwapType_1.SwapType.TO_BTCLN).has(token.address)) {
                    result.push(Tokens_1.BitcoinTokens.BTCLN);
                }
                if (this.getSupportedTokenAddresses(token.chainId, SwapType_1.SwapType.TO_BTC).has(token.address)) {
                    result.push(Tokens_1.BitcoinTokens.BTC);
                }
            }
            else {
                //FROM_BTC or FROM_BTCLN
                const fromLightningSwapType = this.supportsSwapType(token.chainId, SwapType_1.SwapType.FROM_BTCLN_AUTO) ? SwapType_1.SwapType.FROM_BTCLN_AUTO : SwapType_1.SwapType.FROM_BTCLN;
                if (this.getSupportedTokenAddresses(token.chainId, fromLightningSwapType).has(token.address)) {
                    result.push(Tokens_1.BitcoinTokens.BTCLN);
                }
                const fromOnchainSwapType = this.supportsSwapType(token.chainId, SwapType_1.SwapType.SPV_VAULT_FROM_BTC) ? SwapType_1.SwapType.SPV_VAULT_FROM_BTC : SwapType_1.SwapType.FROM_BTC;
                if (this.getSupportedTokenAddresses(token.chainId, fromOnchainSwapType).has(token.address)) {
                    result.push(Tokens_1.BitcoinTokens.BTC);
                }
            }
            return result;
        }
        else {
            if (input) {
                if (token.lightning) {
                    return this.getSupportedTokensForSwapType(SwapType_1.SwapType.FROM_BTCLN);
                }
                else {
                    return this.getSupportedTokensForSwapType(SwapType_1.SwapType.FROM_BTC);
                }
            }
            else {
                if (token.lightning) {
                    return this.getSupportedTokensForSwapType(SwapType_1.SwapType.TO_BTCLN);
                }
                else {
                    return this.getSupportedTokensForSwapType(SwapType_1.SwapType.TO_BTC);
                }
            }
        }
    }
    getSwapBounds(chainIdentifier) {
        if (this.intermediaryDiscovery != null) {
            if (chainIdentifier == null) {
                return this.intermediaryDiscovery.getMultichainSwapBounds();
            }
            else {
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
    getMaximum(chainIdentifier, type, token) {
        if (this.intermediaryDiscovery != null) {
            const max = this.intermediaryDiscovery.getSwapMaximum(chainIdentifier, type, token);
            if (max != null)
                return BigInt(max);
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
    getMinimum(chainIdentifier, type, token) {
        if (this.intermediaryDiscovery != null) {
            const min = this.intermediaryDiscovery.getSwapMinimum(chainIdentifier, type, token);
            if (min != null)
                return BigInt(min);
        }
        return 0n;
    }
}
exports.Swapper = Swapper;
