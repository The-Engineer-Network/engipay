"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ISwapWrapper = void 0;
const events_1 = require("events");
const IntermediaryError_1 = require("../errors/IntermediaryError");
const Utils_1 = require("../utils/Utils");
class ISwapWrapper {
    /**
     * @param chainIdentifier
     * @param unifiedStorage
     * @param unifiedChainEvents
     * @param chain
     * @param prices Swap pricing handler
     * @param tokens Chain specific token data
     * @param options
     * @param events Instance to use for emitting events
     */
    constructor(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, prices, tokens, options, events) {
        this.logger = (0, Utils_1.getLogger)(this.constructor.name + ": ");
        this.pendingSwaps = new Map();
        this.isInitialized = false;
        this.tickInterval = null;
        this.unifiedStorage = unifiedStorage;
        this.unifiedChainEvents = unifiedChainEvents;
        this.chainIdentifier = chainIdentifier;
        this.chain = chain;
        this.prices = prices;
        this.events = events || new events_1.EventEmitter();
        this.options = options;
        this.tokens = {};
        for (let tokenData of tokens) {
            const chainData = tokenData.chains[chainIdentifier];
            if (chainData == null)
                continue;
            this.tokens[chainData.address] = {
                chain: "SC",
                chainId: this.chainIdentifier,
                address: chainData.address,
                decimals: chainData.decimals,
                ticker: tokenData.ticker,
                name: tokenData.name,
                displayDecimals: chainData.displayDecimals
            };
        }
    }
    /**
     * Pre-fetches swap price for a given swap
     *
     * @param amountData
     * @param abortSignal
     * @protected
     * @returns Price of the token in uSats (micro sats)
     */
    preFetchPrice(amountData, abortSignal) {
        return this.prices.preFetchPrice(this.chainIdentifier, amountData.token, abortSignal).catch(e => {
            this.logger.error("preFetchPrice(): Error: ", e);
            return null;
        });
    }
    /**
     * Verifies returned  price for swaps
     *
     * @param lpServiceData Service data for the service in question (TO_BTCLN, TO_BTC, etc.) of the given intermediary
     * @param send Whether this is a send (SOL -> SC) or receive (BTC -> SC) swap
     * @param amountSats Amount in BTC
     * @param amountToken Amount in token
     * @param token Token used in the swap
     * @param feeData Fee data as returned by the intermediary
     * @param pricePrefetchPromise Price pre-fetch promise
     * @param abortSignal
     * @protected
     * @returns Price info object
     * @throws {IntermediaryError} if the calculated fee is too high
     */
    async verifyReturnedPrice(lpServiceData, send, amountSats, amountToken, token, feeData, pricePrefetchPromise = Promise.resolve(null), abortSignal) {
        const swapBaseFee = BigInt(lpServiceData.swapBaseFee);
        const swapFeePPM = BigInt(lpServiceData.swapFeePPM);
        if (send)
            amountToken = amountToken - feeData.networkFee;
        const isValidAmount = await (send ?
            this.prices.isValidAmountSend(this.chainIdentifier, amountSats, swapBaseFee, swapFeePPM, amountToken, token, abortSignal, await pricePrefetchPromise) :
            this.prices.isValidAmountReceive(this.chainIdentifier, amountSats, swapBaseFee, swapFeePPM, amountToken, token, abortSignal, await pricePrefetchPromise));
        if (!isValidAmount.isValid)
            throw new IntermediaryError_1.IntermediaryError("Fee too high");
        return isValidAmount;
    }
    /**
     * Initializes the swap wrapper, needs to be called before any other action can be taken
     */
    async init(noTimers = false, noCheckPastSwaps = false) {
        if (this.isInitialized)
            return;
        const hasEventListener = this.processEvent != null;
        //Save events received in the meantime into the event queue and process them only after we've checked and
        // processed all the past swaps
        let eventQueue = [];
        const initListener = (event, swap) => {
            eventQueue.push({ event, swap });
            return Promise.resolve();
        };
        if (hasEventListener)
            this.unifiedChainEvents.registerListener(this.TYPE, initListener, this.swapDeserializer.bind(null, this));
        if (!noCheckPastSwaps)
            await this.checkPastSwaps();
        if (hasEventListener) {
            //Process accumulated event queue
            for (let event of eventQueue) {
                await this.processEvent(event.event, event.swap);
            }
            //Register the correct event handler
            this.unifiedChainEvents.unregisterListener(this.TYPE);
            this.unifiedChainEvents.registerListener(this.TYPE, this.processEvent.bind(this), this.swapDeserializer.bind(null, this));
        }
        if (!noTimers)
            this.startTickInterval();
        // this.logger.info("init(): Swap wrapper initialized");
        this.isInitialized = true;
    }
    startTickInterval() {
        if (this.tickSwapState == null || this.tickSwapState.length === 0)
            return;
        this.tickInterval = setInterval(() => {
            this.tick();
        }, 1000);
    }
    async _checkPastSwaps(pastSwaps) {
        const changedSwaps = [];
        const removeSwaps = [];
        await Promise.all(pastSwaps.map((swap) => swap._sync(false).then(changed => {
            if (swap.isQuoteExpired()) {
                removeSwaps.push(swap);
                this.logger.debug("_checkPastSwaps(): Removing expired swap: " + swap.getId());
            }
            else {
                if (changed)
                    changedSwaps.push(swap);
            }
        }).catch(e => this.logger.error("_checkPastSwaps(): Error when checking swap " + swap.getId() + ": ", e))));
        return { changedSwaps, removeSwaps };
    }
    async checkPastSwaps(pastSwaps, noSave) {
        if (pastSwaps == null)
            pastSwaps = await this.unifiedStorage.query([[{ key: "type", value: this.TYPE }, { key: "state", value: this.pendingSwapStates }]], (val) => new this.swapDeserializer(this, val));
        const { removeSwaps, changedSwaps } = await this._checkPastSwaps(pastSwaps);
        if (!noSave) {
            await this.unifiedStorage.removeAll(removeSwaps);
            await this.unifiedStorage.saveAll(changedSwaps);
        }
        return {
            removeSwaps,
            changedSwaps
        };
    }
    async tick(swaps) {
        if (swaps == null)
            swaps = await this.unifiedStorage.query([[{ key: "type", value: this.TYPE }, { key: "state", value: this.tickSwapState }]], (val) => new this.swapDeserializer(this, val));
        for (let pendingSwap of this.pendingSwaps.values()) {
            const value = pendingSwap.deref();
            if (value != null)
                value._tick(true);
        }
        swaps.forEach(value => {
            value._tick(true);
        });
    }
    saveSwapData(swap) {
        if (!swap.isInitiated()) {
            this.logger.debug("saveSwapData(): Swap " + swap.getId() + " not initiated, saving to pending swaps");
            this.pendingSwaps.set(swap.getId(), new WeakRef(swap));
            return Promise.resolve();
        }
        else {
            this.pendingSwaps.delete(swap.getId());
        }
        return this.unifiedStorage.save(swap);
    }
    removeSwapData(swap) {
        this.pendingSwaps.delete(swap.getId());
        if (!swap.isInitiated())
            return Promise.resolve();
        return this.unifiedStorage.remove(swap);
    }
    recoverFromSwapDataAndState(init, state, lp) {
        return Promise.resolve(null);
    }
    /**
     * Un-subscribes from event listeners on Solana
     */
    async stop() {
        this.isInitialized = false;
        this.unifiedChainEvents.unregisterListener(this.TYPE);
        this.logger.info("stop(): Swap wrapper stopped");
        if (this.tickInterval != null)
            clearInterval(this.tickInterval);
    }
    /**
     * Returns the smart chain's native token used to pay for fees
     */
    getNativeToken() {
        return this.tokens[this.chain.getNativeCurrencyAddress()];
    }
}
exports.ISwapWrapper = ISwapWrapper;
