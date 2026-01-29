import {SwapType} from "./enums/SwapType";
import {EventEmitter} from "events";
import {ISwapWrapper} from "./ISwapWrapper";
import {ChainType} from "@atomiqlabs/base";
import {isPriceInfoType, PriceInfoType} from "../prices/abstract/ISwapPrice";
import {LoggerType, randomBytes} from "../utils/Utils";
import {SCToken, TokenAmount} from "../Tokens";
import {SwapDirection} from "./enums/SwapDirection";
import {Fee, FeeBreakdown} from "./fee/Fee";

export type ISwapInit = {
    pricingInfo: PriceInfoType,
    url?: string,
    expiry: number,
    swapFee: bigint,
    swapFeeBtc?: bigint,
    exactIn: boolean
};

export function isISwapInit(obj: any): obj is ISwapInit {
    return typeof obj === 'object' &&
        obj != null &&
        isPriceInfoType(obj.pricingInfo) &&
        (obj.url==null || typeof obj.url === 'string') &&
        typeof obj.expiry === 'number' &&
        typeof(obj.swapFee) === "bigint" &&
        (obj.swapFeeBtc == null || typeof(obj.swapFeeBtc) === "bigint") &&
        (typeof obj.exactIn === 'boolean');
}

export type PercentagePPM = {
    ppm: bigint,
    decimal: number,
    percentage: number,
    toString: (decimal?: number) => string
};

export function ppmToPercentage(ppm: bigint): PercentagePPM {
    if(ppm==null) return null;
    const percentage = Number(ppm)/10_000;
    return {
        ppm,
        decimal: Number(ppm)/1_000_000,
        percentage: percentage,
        toString: (decimals?: number) => (decimals!=null ? percentage.toFixed(decimals) : percentage)+"%"
    }
}

export abstract class ISwap<
    T extends ChainType = ChainType,
    S extends number = number
> {
    protected readonly abstract TYPE: SwapType;
    protected readonly currentVersion: number = 1;
    protected readonly wrapper: ISwapWrapper<T, ISwap<T, S>>;
    readonly url: string;

    readonly chainIdentifier: T["ChainId"];
    readonly exactIn: boolean;
    createdAt: number;

    protected version: number;
    protected initiated: boolean = false;
    protected logger: LoggerType;

    expiry?: number;
    state: S;
    pricingInfo: PriceInfoType;

    protected swapFee: bigint;
    protected swapFeeBtc?: bigint;

    /**
     * Random nonce to differentiate the swap from others with the same identifier hash (i.e. when quoting the same swap
     *  from multiple LPs)
     */
    randomNonce: string;

    /**
     * Event emitter emitting "swapState" event when swap's state changes
     */
    events: EventEmitter<{swapState: [ISwap]}> = new EventEmitter();

    protected constructor(wrapper: ISwapWrapper<T, ISwap<T, S>>, obj: any);
    protected constructor(wrapper: ISwapWrapper<T, ISwap<T, S>>, swapInit: ISwapInit);
    protected constructor(
        wrapper: ISwapWrapper<T, ISwap<T, S>>,
        swapInitOrObj: ISwapInit | any,
    ) {
        this.chainIdentifier = wrapper.chainIdentifier;
        this.wrapper = wrapper;
        if(isISwapInit(swapInitOrObj)) {
            Object.assign(this, swapInitOrObj);
            this.version = this.currentVersion;
            this.createdAt = Date.now();
            this.randomNonce = randomBytes(16).toString("hex");
        } else {
            this.expiry = swapInitOrObj.expiry;
            this.url = swapInitOrObj.url;

            this.state = swapInitOrObj.state;

            this.pricingInfo = {
                isValid: swapInitOrObj._isValid,
                differencePPM: swapInitOrObj._differencePPM==null ? null : BigInt(swapInitOrObj._differencePPM),
                satsBaseFee: swapInitOrObj._satsBaseFee==null ? null : BigInt(swapInitOrObj._satsBaseFee),
                feePPM: swapInitOrObj._feePPM==null ? null : BigInt(swapInitOrObj._feePPM),
                realPriceUSatPerToken: swapInitOrObj._realPriceUSatPerToken==null ? null : BigInt(swapInitOrObj._realPriceUSatPerToken),
                swapPriceUSatPerToken: swapInitOrObj._swapPriceUSatPerToken==null ? null : BigInt(swapInitOrObj._swapPriceUSatPerToken),
            };

            this.swapFee = swapInitOrObj.swapFee==null ? null : BigInt(swapInitOrObj.swapFee);
            this.swapFeeBtc = swapInitOrObj.swapFeeBtc==null ? null : BigInt(swapInitOrObj.swapFeeBtc);

            this.version = swapInitOrObj.version;
            this.initiated = swapInitOrObj.initiated;
            this.exactIn = swapInitOrObj.exactIn;
            this.createdAt = swapInitOrObj.createdAt ?? swapInitOrObj.expiry;

            this.randomNonce = swapInitOrObj.randomNonce;
        }
        if(this.version!==this.currentVersion) {
            this.upgradeVersion();
        }
        if(this.initiated==null) this.initiated = true;
    }

    protected abstract upgradeVersion(): void;

    /**
     * Waits till the swap reaches a specific state
     *
     * @param targetState The state to wait for
     * @param type Whether to wait for the state exactly or also to a state with a higher number
     * @param abortSignal
     * @protected
     */
    protected waitTillState(targetState: S, type: "eq" | "gte" | "neq" = "eq", abortSignal?: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            let listener;
            listener = (swap) => {
                if(type==="eq" ? swap.state===targetState : type==="gte" ? swap.state>=targetState : swap.state!=targetState) {
                    resolve();
                    this.events.removeListener("swapState", listener);
                }
            };
            this.events.on("swapState", listener);
            if(abortSignal!=null) abortSignal.addEventListener("abort", () => {
                this.events.removeListener("swapState", listener);
                reject(abortSignal.reason);
            });
        });
    }


    //////////////////////////////
    //// Pricing

    protected tryRecomputeSwapPrice(): void {
        if(this.pricingInfo.swapPriceUSatPerToken==null) {
            if(this.getDirection()===SwapDirection.TO_BTC) {
                const input = this.getInput() as TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
                this.pricingInfo = this.wrapper.prices.recomputePriceInfoSend(
                    this.chainIdentifier,
                    this.getOutput().rawAmount,
                    this.pricingInfo.satsBaseFee,
                    this.pricingInfo.feePPM,
                    input.rawAmount,
                    input.token.address
                );
            } else {
                const output = this.getOutput() as TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
                this.pricingInfo = this.wrapper.prices.recomputePriceInfoReceive(
                    this.chainIdentifier,
                    this.getInput().rawAmount,
                    this.pricingInfo.satsBaseFee,
                    this.pricingInfo.feePPM,
                    output.rawAmount,
                    output.token.address
                );
            }
        }
    }

    /**
     * Re-fetches & revalidates the price data
     */
    async refreshPriceData(): Promise<void> {
        if(this.pricingInfo==null) return null;
        if(this.getDirection()===SwapDirection.TO_BTC) {
            const input = this.getInput() as TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
            this.pricingInfo = await this.wrapper.prices.isValidAmountSend(
                this.chainIdentifier,
                this.getOutput().rawAmount,
                this.pricingInfo.satsBaseFee,
                this.pricingInfo.feePPM,
                input.rawAmount,
                input.token.address
            );
        } else {
            const output = this.getOutput() as TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
            this.pricingInfo = await this.wrapper.prices.isValidAmountReceive(
                this.chainIdentifier,
                this.getInput().rawAmount,
                this.pricingInfo.satsBaseFee,
                this.pricingInfo.feePPM,
                output.rawAmount,
                output.token.address
            );
        }
    }

    /**
     * Checks if the pricing for the swap is valid, according to max allowed price difference set in the ISwapPrice
     */
    hasValidPrice(): boolean {
        return this.pricingInfo==null ? null : this.pricingInfo.isValid;
    }

    /**
     * Returns pricing info about the swap
     */
    getPriceInfo(): {
        marketPrice: number,
        swapPrice: number,
        difference: PercentagePPM
    } {
        const swapPrice = this.getDirection()===SwapDirection.TO_BTC ?
            100_000_000_000_000/Number(this.pricingInfo.swapPriceUSatPerToken) :
            Number(this.pricingInfo.swapPriceUSatPerToken)/100_000_000_000_000;
        const marketPrice = this.getDirection()===SwapDirection.TO_BTC ?
            100_000_000_000_000/Number(this.pricingInfo.realPriceUSatPerToken) :
            Number(this.pricingInfo.realPriceUSatPerToken)/100_000_000_000_000;

        return {
            marketPrice,
            swapPrice,
            difference: ppmToPercentage(this.pricingInfo.differencePPM)
        }
    }


    //////////////////////////////
    //// Getters & utils

    abstract _getEscrowHash(): string;

    /**
     * @param signer Signer to check with this swap's initiator
     * @throws {Error} When signer's address doesn't match with the swap's initiator one
     */
    protected checkSigner(signer: T["Signer"] | string): void {
        if((typeof(signer)==="string" ? signer : signer.getAddress())!==this._getInitiator()) throw new Error("Invalid signer provided!");
    }

    /**
     * Checks if the swap's quote is still valid
     */
    abstract verifyQuoteValid(): Promise<boolean>;

    abstract getOutputAddress(): string | null;

    abstract getInputTxId(): string | null;
    abstract getOutputTxId(): string | null;

    /**
     * Returns the ID of the swap, as used in the storage and getSwapById function
     */
    abstract getId(): string;

    /**
     * Checks whether there is some action required from the user for this swap - can mean either refundable or claimable
     */
    abstract requiresAction(): boolean;

    /**
     * Returns whether the swap is finished and in its terminal state (this can mean successful, refunded or failed)
     */
    abstract isFinished(): boolean;

    /**
     * Checks whether the swap's quote has definitely expired and cannot be committed anymore, we can remove such swap
     */
    abstract isQuoteExpired(): boolean;

    /**
     * Checks whether the swap's quote is soft expired (this means there is not enough time buffer for it to commit,
     *  but it still can happen)
     */
    abstract isQuoteSoftExpired(): boolean;

    /**
     * Returns whether the swap finished successful
     */
    abstract isSuccessful(): boolean;

    /**
     * Returns whether the swap failed (e.g. was refunded)
     */
    abstract isFailed(): boolean;

    /**
     * Returns the intiator address of the swap - address that created this swap
     */
    abstract _getInitiator(): string;

    isInitiated(): boolean {
        return this.initiated;
    }

    _setInitiated(): void {
        this.initiated = true;
    }

    /**
     * Returns quote expiry in UNIX millis
     */
    getQuoteExpiry(): number {
        return this.expiry;
    }

    /**
     * Returns the type of the swap
     */
    getType(): SwapType {
        return this.TYPE;
    }

    /**
     * Returns the direction of the swap
     */
    getDirection(): SwapDirection {
        return this.TYPE===SwapType.TO_BTC || this.TYPE===SwapType.TO_BTCLN ? SwapDirection.TO_BTC : SwapDirection.FROM_BTC;
    }

    /**
     * Returns the current state of the swap
     */
    getState(): S {
        return this.state;
    }

    //////////////////////////////
    //// Amounts & fees

    /**
     * Returns output amount of the swap, user receives this much
     */
    abstract getOutput(): TokenAmount;

    /**
     * Returns input amount of the swap, user needs to pay this much
     */
    abstract getInput(): TokenAmount;

    /**
     * Returns input amount if the swap without the fees (swap fee, network fee)
     */
    abstract getInputWithoutFee(): TokenAmount;

    /**
     * Returns total fee for the swap, the fee is represented in source currency & destination currency, but is
     *  paid only once
     */
    abstract getFee(): Fee;

    /**
     * Returns the breakdown of all the fees paid
     */
    abstract getFeeBreakdown(): FeeBreakdown<T["ChainId"]>;


    //////////////////////////////
    //// Storage

    serialize(): any {
        if(this.pricingInfo==null) return {};
        return {
            id: this.getId(),
            type: this.getType(),
            escrowHash: this._getEscrowHash(),
            initiator: this._getInitiator(),

            _isValid: this.pricingInfo.isValid,
            _differencePPM: this.pricingInfo.differencePPM==null ? null :this.pricingInfo.differencePPM.toString(10),
            _satsBaseFee: this.pricingInfo.satsBaseFee==null ? null :this.pricingInfo.satsBaseFee.toString(10),
            _feePPM: this.pricingInfo.feePPM==null ? null :this.pricingInfo.feePPM.toString(10),
            _realPriceUSatPerToken: this.pricingInfo.realPriceUSatPerToken==null ? null :this.pricingInfo.realPriceUSatPerToken.toString(10),
            _swapPriceUSatPerToken: this.pricingInfo.swapPriceUSatPerToken==null ? null :this.pricingInfo.swapPriceUSatPerToken.toString(10),
            state: this.state,
            url: this.url,
            swapFee: this.swapFee==null ? null : this.swapFee.toString(10),
            swapFeeBtc: this.swapFeeBtc==null ? null : this.swapFeeBtc.toString(10),
            expiry: this.expiry,
            version: this.version,
            initiated: this.initiated,
            exactIn: this.exactIn,
            createdAt: this.createdAt,
            randomNonce: this.randomNonce
        }
    }

    _save(): Promise<void> {
        if(this.isQuoteExpired()) {
            return this.wrapper.removeSwapData(this);
        } else {
            return this.wrapper.saveSwapData(this);
        }
    }

    async _saveAndEmit(state?: S): Promise<void> {
        if(state!=null) this.state = state;
        await this._save();
        this._emitEvent();
    }


    //////////////////////////////
    //// Events

    protected _emitEvent() {
        this.wrapper.events.emit("swapState", this);
        this.events.emit("swapState", this);
    }


    //////////////////////////////
    //// Swap ticks & sync

    /**
     * Synchronizes swap state from chain and/or LP node, usually ran on startup
     *
     * @param save whether to save the new swap state or not
     *
     * @returns {boolean} true if the swap changed, false if the swap hasn't changed
     */
    abstract _sync(save?: boolean): Promise<boolean>;

    /**
     * Runs quick checks on the swap, such as checking the expiry, usually ran periodically every few seconds
     *
     * @param save whether to save the new swap state or not
     *
     * @returns {boolean} true if the swap changed, false if the swap hasn't changed
     */
    abstract _tick(save?: boolean): Promise<boolean>;

}
