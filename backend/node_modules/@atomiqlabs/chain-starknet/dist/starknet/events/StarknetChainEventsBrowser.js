"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetChainEventsBrowser = void 0;
const base_1 = require("@atomiqlabs/base");
const Utils_1 = require("../../utils/Utils");
const starknet_1 = require("starknet");
const sha2_1 = require("@noble/hashes/sha2");
const buffer_1 = require("buffer");
const PROCESSED_EVENTS_BACKLOG = 5000;
const LOGS_SLIDING_WINDOW = 60;
/**
 * Starknet on-chain event handler for front-end systems without access to fs, uses WS or long-polling to subscribe, might lose
 *  out on some events if the network is unreliable, front-end systems should take this into consideration and not
 *  rely purely on events
 */
class StarknetChainEventsBrowser {
    constructor(chainInterface, starknetSwapContract, starknetSpvVaultContract, pollIntervalSeconds = 5) {
        this.eventsProcessing = {};
        this.processedEvents = new Set();
        this.listeners = [];
        this.logger = (0, Utils_1.getLogger)("StarknetChainEventsBrowser: ");
        this.initFunctionName = "initialize";
        this.initEntryPointSelector = BigInt(starknet_1.hash.starknetKeccak(this.initFunctionName));
        this.wsStarted = false;
        this.Chain = chainInterface;
        this.wsChannel = chainInterface.wsChannel;
        this.provider = chainInterface.provider;
        this.starknetSwapContract = starknetSwapContract;
        this.starknetSpvVaultContract = starknetSpvVaultContract;
        this.pollIntervalSeconds = pollIntervalSeconds;
    }
    getEventFingerprint(event) {
        const eventData = buffer_1.Buffer.concat([
            ...event.keys.map(value => (0, Utils_1.bigNumberishToBuffer)(value, 32)),
            ...event.data.map(value => (0, Utils_1.bigNumberishToBuffer)(value, 32))
        ]);
        const fingerprint = buffer_1.Buffer.from((0, sha2_1.sha256)(eventData));
        return event.txHash + ":" + fingerprint.toString("hex");
    }
    addProcessedEvent(event) {
        this.processedEvents.add(this.getEventFingerprint(event));
        if (this.processedEvents.size > PROCESSED_EVENTS_BACKLOG)
            this.processedEvents.delete(this.processedEvents.keys().next().value);
    }
    isEventProcessed(eventOrFingerprint) {
        const eventFingerprint = typeof (eventOrFingerprint) === "string" ? eventOrFingerprint : this.getEventFingerprint(eventOrFingerprint);
        return this.processedEvents.has(eventFingerprint);
    }
    findInitSwapData(call, escrowHash, claimHandler) {
        if (BigInt(call.contract_address) === BigInt(this.starknetSwapContract.contract.address) &&
            BigInt(call.entry_point_selector) === this.initEntryPointSelector) {
            //Found, check correct escrow hash
            const { escrow, extraData } = (0, Utils_1.parseInitFunctionCalldata)(call.calldata, claimHandler);
            if ("0x" + escrow.getEscrowHash() === (0, Utils_1.toHex)(escrowHash)) {
                if (extraData.length !== 0) {
                    escrow.setExtraData((0, Utils_1.bytes31SpanToBuffer)(extraData, 42).toString("hex"));
                }
                return escrow;
            }
        }
        for (let _call of call.calls) {
            const found = this.findInitSwapData(_call, escrowHash, claimHandler);
            if (found != null)
                return found;
        }
        return null;
    }
    /**
     * Returns async getter for fetching on-demand initialize event swap data
     *
     * @param event
     * @param claimHandler
     * @private
     * @returns {() => Promise<StarknetSwapData>} getter to be passed to InitializeEvent constructor
     */
    getSwapDataGetter(event, claimHandler) {
        return async () => {
            let trace;
            try {
                trace = await this.provider.getTransactionTrace(event.txHash);
            }
            catch (e) {
                this.logger.warn("getSwapDataGetter(): getter: starknet_traceTransaction not supported by the RPC: ", e);
                const blockTraces = await this.provider.getBlockTransactionsTraces(event.blockHash);
                const foundTrace = blockTraces.find(val => (0, Utils_1.toHex)(val.transaction_hash) === (0, Utils_1.toHex)(event.txHash));
                if (foundTrace == null)
                    throw new Error(`Cannot find ${event.txHash} in the block traces, block: ${event.blockHash}`);
                trace = foundTrace.trace_root;
            }
            if (trace == null)
                return null;
            if (trace.execute_invocation.revert_reason != null)
                return null;
            return this.findInitSwapData(trace.execute_invocation, event.params.escrow_hash, claimHandler);
        };
    }
    parseInitializeEvent(event) {
        const escrowHashBuffer = (0, Utils_1.bigNumberishToBuffer)(event.params.escrow_hash, 32);
        const escrowHash = escrowHashBuffer.toString("hex");
        const claimHandlerHex = (0, Utils_1.toHex)(event.params.claim_handler);
        const claimHandler = this.starknetSwapContract.claimHandlersByAddress[claimHandlerHex];
        if (claimHandler == null) {
            this.logger.warn("parseInitializeEvent(" + escrowHash + "): Unknown claim handler with claim: " + claimHandlerHex);
            return null;
        }
        const swapType = claimHandler.getType();
        this.logger.debug("InitializeEvent claimHash: " + (0, Utils_1.toHex)(event.params.claim_data) + " escrowHash: " + escrowHash);
        return new base_1.InitializeEvent(escrowHash, swapType, (0, Utils_1.onceAsync)(this.getSwapDataGetter(event, claimHandler)));
    }
    parseRefundEvent(event) {
        const escrowHashBuffer = (0, Utils_1.bigNumberishToBuffer)(event.params.escrow_hash, 32);
        const escrowHash = escrowHashBuffer.toString("hex");
        this.logger.debug("RefundEvent claimHash: " + (0, Utils_1.toHex)(event.params.claim_data) + " escrowHash: " + escrowHash);
        return new base_1.RefundEvent(escrowHash);
    }
    parseClaimEvent(event) {
        const escrowHashBuffer = (0, Utils_1.bigNumberishToBuffer)(event.params.escrow_hash, 32);
        const escrowHash = escrowHashBuffer.toString("hex");
        const claimHandlerHex = (0, Utils_1.toHex)(event.params.claim_handler);
        const claimHandler = this.starknetSwapContract.claimHandlersByAddress[claimHandlerHex];
        if (claimHandler == null) {
            this.logger.warn("parseClaimEvent(" + escrowHash + "): Unknown claim handler with claim: " + claimHandlerHex);
            return null;
        }
        const witnessResult = claimHandler.parseWitnessResult(event.params.witness_result);
        this.logger.debug("ClaimEvent claimHash: " + (0, Utils_1.toHex)(event.params.claim_data) +
            " witnessResult: " + witnessResult + " escrowHash: " + escrowHash);
        return new base_1.ClaimEvent(escrowHash, witnessResult);
    }
    parseSpvOpenEvent(event) {
        const owner = (0, Utils_1.toHex)(event.params.owner);
        const vaultId = (0, Utils_1.toBigInt)(event.params.vault_id);
        const btcTxId = (0, Utils_1.bigNumberishToBuffer)(event.params.btc_tx_hash, 32).reverse().toString("hex");
        const vout = Number((0, Utils_1.toBigInt)(event.params.vout));
        this.logger.debug("SpvOpenEvent owner: " + owner + " vaultId: " + vaultId + " utxo: " + btcTxId + ":" + vout);
        return new base_1.SpvVaultOpenEvent(owner, vaultId, btcTxId, vout);
    }
    parseSpvDepositEvent(event) {
        const owner = (0, Utils_1.toHex)(event.params.owner);
        const vaultId = (0, Utils_1.toBigInt)(event.params.vault_id);
        const amounts = [(0, Utils_1.toBigInt)(event.params.amounts["0"]), (0, Utils_1.toBigInt)(event.params.amounts["1"])];
        const depositCount = Number((0, Utils_1.toBigInt)(event.params.deposit_count));
        this.logger.debug("SpvDepositEvent owner: " + owner + " vaultId: " + vaultId + " depositCount: " + depositCount + " amounts: ", amounts);
        return new base_1.SpvVaultDepositEvent(owner, vaultId, amounts, depositCount);
    }
    parseSpvFrontEvent(event) {
        const owner = (0, Utils_1.toHex)(event.params.owner);
        const vaultId = (0, Utils_1.toBigInt)(event.params.vault_id);
        const btcTxId = (0, Utils_1.bigNumberishToBuffer)(event.params.btc_tx_hash, 32).reverse().toString("hex");
        const recipient = (0, Utils_1.toHex)(event.params.recipient);
        const executionHash = (0, Utils_1.toHex)(event.params.execution_hash);
        const amounts = [(0, Utils_1.toBigInt)(event.params.amounts["0"]), (0, Utils_1.toBigInt)(event.params.amounts["1"])];
        const frontingAddress = (0, Utils_1.toHex)(event.params.caller);
        this.logger.debug("SpvFrontEvent owner: " + owner + " vaultId: " + vaultId + " btcTxId: " + btcTxId +
            " recipient: " + recipient + " frontedBy: " + frontingAddress + " amounts: ", amounts);
        return new base_1.SpvVaultFrontEvent(owner, vaultId, btcTxId, recipient, executionHash, amounts, frontingAddress);
    }
    parseSpvClaimEvent(event) {
        const owner = (0, Utils_1.toHex)(event.params.owner);
        const vaultId = (0, Utils_1.toBigInt)(event.params.vault_id);
        const btcTxId = (0, Utils_1.bigNumberishToBuffer)(event.params.btc_tx_hash, 32).reverse().toString("hex");
        const recipient = (0, Utils_1.toHex)(event.params.recipient);
        const executionHash = (0, Utils_1.toHex)(event.params.execution_hash);
        const amounts = [(0, Utils_1.toBigInt)(event.params.amounts["0"]), (0, Utils_1.toBigInt)(event.params.amounts["1"])];
        const caller = (0, Utils_1.toHex)(event.params.caller);
        const frontingAddress = (0, Utils_1.toHex)(event.params.fronting_address);
        const withdrawCount = Number((0, Utils_1.toBigInt)(event.params.withdraw_count));
        this.logger.debug("SpvClaimEvent owner: " + owner + " vaultId: " + vaultId + " btcTxId: " + btcTxId + " withdrawCount: " + withdrawCount +
            " recipient: " + recipient + " frontedBy: " + frontingAddress + " claimedBy: " + caller + " amounts: ", amounts);
        return new base_1.SpvVaultClaimEvent(owner, vaultId, btcTxId, recipient, executionHash, amounts, caller, frontingAddress, withdrawCount);
    }
    parseSpvCloseEvent(event) {
        const owner = (0, Utils_1.toHex)(event.params.owner);
        const vaultId = (0, Utils_1.toBigInt)(event.params.vault_id);
        const btcTxId = (0, Utils_1.bigNumberishToBuffer)(event.params.btc_tx_hash, 32).reverse().toString("hex");
        const error = (0, Utils_1.bigNumberishToBuffer)(event.params.error).toString();
        return new base_1.SpvVaultCloseEvent(owner, vaultId, btcTxId, error);
    }
    /**
     * Processes event as received from the chain, parses it & calls event listeners
     *
     * @param events
     * @param currentBlockNumber
     * @param currentBlockTimestamp
     * @protected
     */
    async processEvents(events, currentBlockNumber, currentBlockTimestamp) {
        const blockTimestampsCache = {};
        const getBlockTimestamp = async (blockNumber) => {
            if (blockNumber === currentBlockNumber)
                return currentBlockTimestamp;
            const blockNumberString = blockNumber.toString();
            blockTimestampsCache[blockNumberString] ?? (blockTimestampsCache[blockNumberString] = await this.Chain.Blocks.getBlockTime(blockNumber));
            return blockTimestampsCache[blockNumberString];
        };
        for (let event of events) {
            const eventIdentifier = this.getEventFingerprint(event);
            if (this.isEventProcessed(eventIdentifier)) {
                this.logger.debug("processEvents(): skipping already processed event: " + eventIdentifier);
                continue;
            }
            let parsedEvent;
            switch (event.name) {
                case "escrow_manager::events::Claim":
                    parsedEvent = this.parseClaimEvent(event);
                    break;
                case "escrow_manager::events::Refund":
                    parsedEvent = this.parseRefundEvent(event);
                    break;
                case "escrow_manager::events::Initialize":
                    parsedEvent = this.parseInitializeEvent(event);
                    break;
                case "spv_swap_vault::events::Opened":
                    parsedEvent = this.parseSpvOpenEvent(event);
                    break;
                case "spv_swap_vault::events::Deposited":
                    parsedEvent = this.parseSpvDepositEvent(event);
                    break;
                case "spv_swap_vault::events::Fronted":
                    parsedEvent = this.parseSpvFrontEvent(event);
                    break;
                case "spv_swap_vault::events::Claimed":
                    parsedEvent = this.parseSpvClaimEvent(event);
                    break;
                case "spv_swap_vault::events::Closed":
                    parsedEvent = this.parseSpvCloseEvent(event);
                    break;
            }
            if (this.eventsProcessing[eventIdentifier] != null) {
                this.logger.debug("processEvents(): awaiting event that is currently processing: " + eventIdentifier);
                await this.eventsProcessing[eventIdentifier];
                continue;
            }
            const promise = (async () => {
                if (parsedEvent == null)
                    return;
                //We are not trusting pre-confs for events, so this shall never happen
                if (event.blockNumber == null)
                    throw new Error("Event block number cannot be null!");
                const timestamp = await getBlockTimestamp(event.blockNumber);
                parsedEvent.meta = {
                    blockTime: timestamp,
                    txId: event.txHash,
                    timestamp //Maybe deprecated
                };
                const eventsArr = [parsedEvent];
                for (let listener of this.listeners) {
                    await listener(eventsArr);
                }
                this.addProcessedEvent(event);
            })();
            this.eventsProcessing[eventIdentifier] = promise;
            try {
                await promise;
                delete this.eventsProcessing[eventIdentifier];
            }
            catch (e) {
                delete this.eventsProcessing[eventIdentifier];
                throw e;
            }
        }
    }
    async checkEventsEcrowManager(currentBlock, lastTxHash, lastBlockNumber) {
        const currentBlockNumber = currentBlock.block_number;
        lastBlockNumber ?? (lastBlockNumber = currentBlockNumber);
        if (currentBlockNumber < lastBlockNumber) {
            this.logger.warn(`checkEventsEscrowManager(): Sanity check triggered - not processing events, currentBlock: ${currentBlockNumber}, lastBlock: ${lastBlockNumber}`);
            return;
        }
        // this.logger.debug("checkEvents(EscrowManager): Requesting logs: "+logStartHeight+"...pending");
        let events = await this.starknetSwapContract.Events.getContractBlockEvents(["escrow_manager::events::Initialize", "escrow_manager::events::Claim", "escrow_manager::events::Refund"], [], lastBlockNumber, null);
        if (lastTxHash != null) {
            const latestProcessedEventIndex = (0, Utils_1.findLastIndex)(events, val => val.txHash === lastTxHash);
            if (latestProcessedEventIndex !== -1) {
                events.splice(0, latestProcessedEventIndex + 1);
                this.logger.debug("checkEvents(EscrowManager): Splicing processed events, resulting size: " + events.length);
            }
        }
        if (events.length > 0) {
            await this.processEvents(events, currentBlock?.block_number, currentBlock?.timestamp);
            const lastProcessed = events[events.length - 1];
            lastTxHash = lastProcessed.txHash;
            if (lastProcessed.blockNumber > lastBlockNumber)
                lastBlockNumber = lastProcessed.blockNumber;
        }
        else if (currentBlockNumber - lastBlockNumber > LOGS_SLIDING_WINDOW) {
            lastTxHash = null;
            lastBlockNumber = currentBlockNumber - LOGS_SLIDING_WINDOW;
        }
        return [lastTxHash, lastBlockNumber];
    }
    async checkEventsSpvVaults(currentBlock, lastTxHash, lastBlockNumber) {
        const currentBlockNumber = currentBlock.block_number;
        lastBlockNumber ?? (lastBlockNumber = currentBlockNumber);
        if (currentBlockNumber < lastBlockNumber) {
            this.logger.warn(`checkEventsSpvVaults(): Sanity check triggered - not processing events, currentBlock: ${currentBlockNumber}, lastBlock: ${lastBlockNumber}`);
            return;
        }
        // this.logger.debug("checkEvents(SpvVaults): Requesting logs: "+logStartHeight+"...pending");
        let events = await this.starknetSpvVaultContract.Events.getContractBlockEvents(["spv_swap_vault::events::Opened", "spv_swap_vault::events::Deposited", "spv_swap_vault::events::Closed", "spv_swap_vault::events::Fronted", "spv_swap_vault::events::Claimed"], [], lastBlockNumber, null);
        if (lastTxHash != null) {
            const latestProcessedEventIndex = (0, Utils_1.findLastIndex)(events, val => val.txHash === lastTxHash);
            if (latestProcessedEventIndex !== -1) {
                events.splice(0, latestProcessedEventIndex + 1);
                this.logger.debug("checkEvents(SpvVaults): Splicing processed events, resulting size: " + events.length);
            }
        }
        if (events.length > 0) {
            await this.processEvents(events, currentBlock?.block_number, currentBlock?.timestamp);
            const lastProcessed = events[events.length - 1];
            lastTxHash = lastProcessed.txHash;
            if (lastProcessed.blockNumber > lastBlockNumber)
                lastBlockNumber = lastProcessed.blockNumber;
        }
        else if (currentBlockNumber - lastBlockNumber > LOGS_SLIDING_WINDOW) {
            lastTxHash = null;
            lastBlockNumber = currentBlockNumber - LOGS_SLIDING_WINDOW;
        }
        return [lastTxHash, lastBlockNumber];
    }
    async checkEvents(lastState) {
        lastState ?? (lastState = []);
        const currentBlock = await this.Chain.Blocks.getBlock(starknet_1.BlockTag.LATEST);
        const [lastEscrowTxHash, lastEscrowHeight] = await this.checkEventsEcrowManager(currentBlock, lastState?.[0]?.lastTxHash, lastState?.[0]?.lastBlockNumber);
        const [lastSpvVaultTxHash, lastSpvVaultHeight] = await this.checkEventsSpvVaults(currentBlock, lastState?.[1]?.lastTxHash, lastState?.[1]?.lastBlockNumber);
        return [
            { lastBlockNumber: lastEscrowHeight, lastTxHash: lastEscrowTxHash },
            { lastBlockNumber: lastSpvVaultHeight, lastTxHash: lastSpvVaultTxHash }
        ];
    }
    /**
     * Sets up event handlers listening for swap events over websocket
     *
     * @protected
     */
    async setupPoll(lastState, saveLatestProcessedBlockNumber) {
        let func;
        func = async () => {
            await this.checkEvents(lastState).then(newState => {
                lastState = newState;
                if (saveLatestProcessedBlockNumber != null)
                    return saveLatestProcessedBlockNumber(newState);
            }).catch(e => {
                this.logger.error("setupPoll(): Failed to fetch starknet log: ", e);
            });
            if (this.stopped)
                return;
            this.timeout = setTimeout(func, this.pollIntervalSeconds * 1000);
        };
        await func();
    }
    async setupWebsocket() {
        this.wsStarted = true;
        this.wsChannel.on("open", () => {
            this.logger.info("setupWebsocket(): Websocket connection opened!");
        });
        this.wsChannel.on("close", () => {
            this.logger.warn("setupWebsocket(): Websocket connection closed!");
        });
        this.wsChannel.on("error", (err) => {
            this.logger.error("setupWebsocket(): Websocket connection error: ", err);
        });
        const [escrowContractSubscription, spvVaultContractSubscription] = await Promise.all([
            this.wsChannel.subscribeEvents({
                fromAddress: this.starknetSwapContract.contract.address,
                keys: this.starknetSwapContract.Events.toFilter(["escrow_manager::events::Initialize", "escrow_manager::events::Claim", "escrow_manager::events::Refund"], []),
                finalityStatus: starknet_1.TransactionFinalityStatus.ACCEPTED_ON_L2
            }),
            this.wsChannel.subscribeEvents({
                fromAddress: this.starknetSpvVaultContract.contract.address,
                keys: this.starknetSpvVaultContract.Events.toFilter(["spv_swap_vault::events::Opened", "spv_swap_vault::events::Deposited", "spv_swap_vault::events::Closed", "spv_swap_vault::events::Fronted", "spv_swap_vault::events::Claimed"], []),
                finalityStatus: starknet_1.TransactionFinalityStatus.ACCEPTED_ON_L2
            })
        ]);
        escrowContractSubscription.on((event) => {
            const parsedEvents = this.starknetSwapContract.Events.toStarknetAbiEvents([event]);
            this.processEvents(parsedEvents, event.block_number);
        });
        this.escrowContractSubscription = escrowContractSubscription;
        spvVaultContractSubscription.on((event) => {
            const parsedEvents = this.starknetSpvVaultContract.Events.toStarknetAbiEvents([event]);
            this.processEvents(parsedEvents, event.block_number);
        });
        this.spvVaultContractSubscription = spvVaultContractSubscription;
    }
    async init() {
        if (this.wsChannel != null) {
            await this.setupWebsocket();
        }
        else {
            await this.setupPoll();
        }
        this.stopped = false;
    }
    async stop() {
        this.stopped = true;
        if (this.timeout != null)
            clearTimeout(this.timeout);
        if (this.wsStarted) {
            await this.escrowContractSubscription.unsubscribe();
            await this.spvVaultContractSubscription.unsubscribe();
            this.wsStarted = false;
        }
    }
    registerListener(cbk) {
        this.listeners.push(cbk);
    }
    unregisterListener(cbk) {
        const index = this.listeners.indexOf(cbk);
        if (index >= 0) {
            this.listeners.splice(index, 1);
            return true;
        }
        return false;
    }
}
exports.StarknetChainEventsBrowser = StarknetChainEventsBrowser;
