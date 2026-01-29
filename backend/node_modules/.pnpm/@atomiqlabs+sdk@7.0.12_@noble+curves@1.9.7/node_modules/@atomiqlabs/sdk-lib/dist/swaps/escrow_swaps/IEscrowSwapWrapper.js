"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IEscrowSwapWrapper = void 0;
const ISwapWrapper_1 = require("../ISwapWrapper");
const base_1 = require("@atomiqlabs/base");
const Utils_1 = require("../../utils/Utils");
class IEscrowSwapWrapper extends ISwapWrapper_1.ISwapWrapper {
    constructor(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, contract, prices, tokens, swapDataDeserializer, options, events) {
        super(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, prices, tokens, options, events);
        this.swapDataDeserializer = swapDataDeserializer;
        this.contract = contract;
    }
    /**
     * Pre-fetches signature verification data from the server's pre-sent promise, doesn't throw, instead returns null
     *
     * @param signDataPrefetch Promise that resolves when we receive "signDataPrefetch" from the LP in streaming mode
     * @protected
     * @returns Pre-fetched signature verification data or null if failed
     */
    preFetchSignData(signDataPrefetch) {
        if (this.contract.preFetchForInitSignatureVerification == null)
            return Promise.resolve(null);
        return signDataPrefetch.then(obj => {
            if (obj == null)
                return null;
            return this.contract.preFetchForInitSignatureVerification(obj);
        }).catch(e => {
            this.logger.error("preFetchSignData(): Error: ", e);
            return null;
        });
    }
    /**
     * Verifies swap initialization signature returned by the intermediary
     *
     * @param initiator A smart chain account initiating the swap
     * @param data Parsed swap data from the intermediary
     * @param signature Response of the intermediary
     * @param feeRatePromise Pre-fetched fee rate promise
     * @param preFetchSignatureVerificationData Pre-fetched signature verification data
     * @param abortSignal
     * @protected
     * @returns Swap initialization signature expiry
     * @throws {SignatureVerificationError} when swap init signature is invalid
     */
    async verifyReturnedSignature(initiator, data, signature, feeRatePromise, preFetchSignatureVerificationData, abortSignal) {
        const [feeRate, preFetchedSignatureData] = await Promise.all([feeRatePromise, preFetchSignatureVerificationData]);
        await (0, Utils_1.tryWithRetries)(() => this.contract.isValidInitAuthorization(initiator, data, signature, feeRate, preFetchedSignatureData), null, base_1.SignatureVerificationError, abortSignal);
        return await (0, Utils_1.tryWithRetries)(() => this.contract.getInitAuthorizationExpiry(data, signature, preFetchedSignatureData), null, base_1.SignatureVerificationError, abortSignal);
    }
    /**
     * Processes a single SC on-chain event
     * @private
     * @param event
     * @param swap
     */
    async processEvent(event, swap) {
        if (swap == null)
            return;
        let swapChanged = false;
        if (event instanceof base_1.InitializeEvent) {
            swapChanged = await this.processEventInitialize(swap, event);
            if (event.meta?.txId != null && swap.commitTxId !== event.meta.txId) {
                swap.commitTxId = event.meta.txId;
                swapChanged ||= true;
            }
        }
        if (event instanceof base_1.ClaimEvent) {
            swapChanged = await this.processEventClaim(swap, event);
            if (event.meta?.txId != null && swap.claimTxId !== event.meta.txId) {
                swap.claimTxId = event.meta.txId;
                swapChanged ||= true;
            }
        }
        if (event instanceof base_1.RefundEvent) {
            swapChanged = await this.processEventRefund(swap, event);
            if (event.meta?.txId != null && swap.refundTxId !== event.meta.txId) {
                swap.refundTxId = event.meta.txId;
                swapChanged ||= true;
            }
        }
        this.logger.info("processEvents(): " + event.constructor.name + " processed for " + swap.getId() + " swap: ", swap);
        if (swapChanged) {
            await swap._saveAndEmit();
        }
        return true;
    }
    async _checkPastSwaps(pastSwaps) {
        const changedSwaps = [];
        const removeSwaps = [];
        const swapExpiredStatus = {};
        const checkStatusSwaps = [];
        for (let pastSwap of pastSwaps) {
            if (pastSwap._shouldFetchExpiryStatus()) {
                //Check expiry
                swapExpiredStatus[pastSwap.getEscrowHash()] = await pastSwap._verifyQuoteDefinitelyExpired();
            }
            if (pastSwap._shouldFetchCommitStatus()) {
                //Add to swaps for which status should be checked
                checkStatusSwaps.push(pastSwap);
            }
        }
        const swapStatuses = await this.contract.getCommitStatuses(checkStatusSwaps.map(val => ({ signer: val._getInitiator(), swapData: val.data })));
        for (let pastSwap of checkStatusSwaps) {
            const escrowHash = pastSwap.getEscrowHash();
            const shouldSave = await pastSwap._sync(false, swapExpiredStatus[escrowHash], swapStatuses[escrowHash]);
            if (shouldSave) {
                if (pastSwap.isQuoteExpired()) {
                    removeSwaps.push(pastSwap);
                }
                else {
                    changedSwaps.push(pastSwap);
                }
            }
        }
        return {
            changedSwaps,
            removeSwaps
        };
    }
}
exports.IEscrowSwapWrapper = IEscrowSwapWrapper;
