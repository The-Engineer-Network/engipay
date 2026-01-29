import {AmountData, ISwapWrapper, ISwapWrapperOptions, WrapperCtorTokens} from "../ISwapWrapper";
import {
    ChainType,
    ClaimEvent,
    InitializeEvent,
    RefundEvent,
    SignatureData,
    SignatureVerificationError, SwapEvent
} from "@atomiqlabs/base";
import {ISwap} from "../ISwap";
import {tryWithRetries} from "../../utils/Utils";
import {UnifiedSwapStorage} from "../../storage/UnifiedSwapStorage";
import {UnifiedSwapEventListener} from "../../events/UnifiedSwapEventListener";
import {ISwapPrice} from "../../prices/abstract/ISwapPrice";
import {EventEmitter} from "events";
import {SwapType} from "../enums/SwapType";
import {IEscrowSwap} from "./IEscrowSwap";

export abstract class IEscrowSwapWrapper<
    T extends ChainType,
    S extends IEscrowSwap<T>,
    O extends ISwapWrapperOptions = ISwapWrapperOptions
> extends ISwapWrapper<T, S, O> {
    readonly abstract TYPE: SwapType;
    readonly abstract pendingSwapStates: Array<S["state"]>;
    readonly abstract swapDeserializer: { new(wrapper: ISwapWrapper<T, S, O>, data: any): S };
    readonly abstract tickSwapState: Array<S["state"]>;

    readonly contract: T["Contract"];
    readonly swapDataDeserializer: new (data: any) => T["Data"];

    constructor(
        chainIdentifier: string,
        unifiedStorage: UnifiedSwapStorage<T>,
        unifiedChainEvents: UnifiedSwapEventListener<T>,
        chain: T["ChainInterface"],
        contract: T["Contract"],
        prices: ISwapPrice,
        tokens: WrapperCtorTokens,
        swapDataDeserializer: new (data: any) => T["Data"],
        options: O,
        events?: EventEmitter<{swapState: [ISwap]}>
    ) {
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
    protected preFetchSignData(signDataPrefetch: Promise<any | null>): Promise<any | null> {
        if(this.contract.preFetchForInitSignatureVerification==null) return Promise.resolve(null);
        return signDataPrefetch.then(obj => {
            if(obj==null) return null;
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
    protected async verifyReturnedSignature(
        initiator: string,
        data: T["Data"],
        signature: SignatureData,
        feeRatePromise: Promise<any>,
        preFetchSignatureVerificationData: Promise<any>,
        abortSignal?: AbortSignal
    ): Promise<number> {
        const [feeRate, preFetchedSignatureData] = await Promise.all([feeRatePromise, preFetchSignatureVerificationData]);
        await tryWithRetries(
            () => this.contract.isValidInitAuthorization(initiator, data, signature, feeRate, preFetchedSignatureData),
            null,
            SignatureVerificationError,
            abortSignal
        );
        return await tryWithRetries(
            () => this.contract.getInitAuthorizationExpiry(data, signature, preFetchedSignatureData),
            null,
            SignatureVerificationError,
            abortSignal
        );
    }

    /**
     * Processes InitializeEvent for a given swap
     * @param swap
     * @param event
     * @protected
     * @returns Whether the swap was updated/changed
     */
    protected processEventInitialize?(swap: S, event: InitializeEvent<T["Data"]>): Promise<boolean>;

    /**
     * Processes ClaimEvent for a given swap
     * @param swap
     * @param event
     * @protected
     * @returns Whether the swap was updated/changed
     */
    protected processEventClaim?(swap: S, event: ClaimEvent<T["Data"]>): Promise<boolean>;

    /**
     * Processes RefundEvent for a given swap
     * @param swap
     * @param event
     * @protected
     * @returns Whether the swap was updated/changed
     */
    protected processEventRefund?(swap: S, event: RefundEvent<T["Data"]>): Promise<boolean>;

    /**
     * Processes a single SC on-chain event
     * @private
     * @param event
     * @param swap
     */
    protected async processEvent(event: SwapEvent<T["Data"]>, swap: S): Promise<boolean> {
        if(swap==null) return;

        let swapChanged: boolean = false;
        if(event instanceof InitializeEvent) {
            swapChanged = await this.processEventInitialize(swap, event);
            if(event.meta?.txId!=null && swap.commitTxId!==event.meta.txId) {
                swap.commitTxId = event.meta.txId;
                swapChanged ||= true;
            }
        }
        if(event instanceof ClaimEvent) {
            swapChanged = await this.processEventClaim(swap, event);
            if(event.meta?.txId!=null && swap.claimTxId!==event.meta.txId) {
                swap.claimTxId = event.meta.txId;
                swapChanged ||= true;
            }
        }
        if(event instanceof RefundEvent) {
            swapChanged = await this.processEventRefund(swap, event);
            if(event.meta?.txId!=null && swap.refundTxId!==event.meta.txId) {
                swap.refundTxId = event.meta.txId;
                swapChanged ||= true;
            }
        }

        this.logger.info("processEvents(): "+event.constructor.name+" processed for "+swap.getId()+" swap: ", swap);

        if(swapChanged) {
            await swap._saveAndEmit();
        }
        return true;
    }

    protected async _checkPastSwaps(pastSwaps: S[]): Promise<{ changedSwaps: S[]; removeSwaps: S[] }> {
        const changedSwaps: S[] = [];
        const removeSwaps: S[] = [];

        const swapExpiredStatus: {[escrowHash: string]: boolean} = {};

        const checkStatusSwaps: S[] = [];

        for(let pastSwap of pastSwaps) {
            if(pastSwap._shouldFetchExpiryStatus()) {
                //Check expiry
                swapExpiredStatus[pastSwap.getEscrowHash()] = await pastSwap._verifyQuoteDefinitelyExpired();
            }
            if(pastSwap._shouldFetchCommitStatus()) {
                //Add to swaps for which status should be checked
                checkStatusSwaps.push(pastSwap);
            }
        }

        const swapStatuses = await this.contract.getCommitStatuses(checkStatusSwaps.map(val => ({signer: val._getInitiator(), swapData: val.data})));

        for(let pastSwap of checkStatusSwaps) {
            const escrowHash = pastSwap.getEscrowHash();
            const shouldSave = await pastSwap._sync(false, swapExpiredStatus[escrowHash], swapStatuses[escrowHash]);
            if(shouldSave) {
                if(pastSwap.isQuoteExpired()) {
                    removeSwaps.push(pastSwap);
                } else {
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