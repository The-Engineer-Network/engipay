import {IFromBTCWrapper} from "./IFromBTCWrapper";
import {ppmToPercentage} from "../../ISwap";
import {
    ChainType,
    SignatureVerificationError,
} from "@atomiqlabs/base";
import {BtcToken, SCToken, TokenAmount, toTokenAmount} from "../../../Tokens";
import {Fee, FeeType} from "../../fee/Fee";
import {IAddressSwap} from "../../IAddressSwap";
import {IEscrowSelfInitSwap, IEscrowSelfInitSwapInit} from "../IEscrowSelfInitSwap";


export abstract class IFromBTCSwap<
    T extends ChainType = ChainType,
    S extends number = number
> extends IEscrowSelfInitSwap<T, S> implements IAddressSwap {
    protected abstract readonly inputToken: BtcToken;

    protected constructor(wrapper: IFromBTCWrapper<T, IFromBTCSwap<T, S>>, init: IEscrowSelfInitSwapInit<T["Data"]>);
    protected constructor(wrapper: IFromBTCWrapper<T, IFromBTCSwap<T, S>>, obj: any);
    protected constructor(
        wrapper: IFromBTCWrapper<T, IFromBTCSwap<T, S>>,
        initOrObj: IEscrowSelfInitSwapInit<T["Data"]> | any
    ) {
        super(wrapper, initOrObj);
    }

    /**
     * In case swapFee in BTC is not supplied it recalculates it based on swap price
     * @protected
     */
    protected tryRecomputeSwapPrice() {
        if(this.swapFeeBtc==null) {
            this.swapFeeBtc = this.swapFee * this.getInput().rawAmount / this.getOutAmountWithoutFee();
        }
        super.tryRecomputeSwapPrice();
    }

    protected getSwapData(): T["Data"] {
        return this.data;
    }


    //////////////////////////////
    //// Getters & utils

    /**
     * Returns the bitcoin address or lightning invoice to be paid for the swap
     */
    abstract getAddress(): string;

    /**
     * Returns a string that can be displayed as QR code representation of the address or lightning invoice
     *  (with bitcoin: or lightning: prefix)
     */
    abstract getHyperlink(): string;

    abstract isClaimable(): boolean;

    /**
     * Returns if the swap can be committed
     */
    protected abstract canCommit(): boolean;

    _getInitiator(): string {
        return this.getSwapData().getClaimer();
    }

    getOutputTxId(): string | null {
        return this.claimTxId;
    }

    getOutputAddress(): string | null {
        return this._getInitiator();
    }

    requiresAction(): boolean {
        return this.isClaimable();
    }


    //////////////////////////////
    //// Amounts & fees

    protected getOutAmountWithoutFee(): bigint {
        return this.getSwapData().getAmount() + this.swapFee;
    }

    protected getSwapFee(): Fee<T["ChainId"], BtcToken, SCToken<T["ChainId"]>> {
        const feeWithoutBaseFee = this.swapFeeBtc - this.pricingInfo.satsBaseFee;
        const swapFeePPM = feeWithoutBaseFee * 1000000n / this.getInputWithoutFee().rawAmount;

        return {
            amountInSrcToken: toTokenAmount(this.swapFeeBtc, this.inputToken, this.wrapper.prices),
            amountInDstToken: toTokenAmount(this.swapFee, this.wrapper.tokens[this.getSwapData().getToken()], this.wrapper.prices),
            usdValue: (abortSignal?: AbortSignal, preFetchedUsdPrice?: number) =>
                this.wrapper.prices.getBtcUsdValue(this.swapFeeBtc, abortSignal, preFetchedUsdPrice),
            composition: {
                base: toTokenAmount(this.pricingInfo.satsBaseFee, this.inputToken, this.wrapper.prices),
                percentage: ppmToPercentage(swapFeePPM)
            }
        };
    }

    getFee(): Fee {
        return this.getSwapFee();
    }

    getFeeBreakdown(): [{type: FeeType.SWAP, fee: Fee<T["ChainId"], BtcToken, SCToken<T["ChainId"]>>}] {
        return [{
            type: FeeType.SWAP,
            fee: this.getSwapFee()
        }];
    }

    getOutput(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>> {
        return toTokenAmount(this.getSwapData().getAmount(), this.wrapper.tokens[this.getSwapData().getToken()], this.wrapper.prices);
    }

    getInputWithoutFee(): TokenAmount<T["ChainId"], BtcToken> {
        return toTokenAmount(this.getInput().rawAmount - this.swapFeeBtc, this.inputToken, this.wrapper.prices);
    }

    getSecurityDeposit(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>> {
        return toTokenAmount(this.getSwapData().getSecurityDeposit(), this.wrapper.getNativeToken(), this.wrapper.prices);
    }

    getTotalDeposit(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>> {
        return toTokenAmount(this.getSwapData().getTotalDeposit(), this.wrapper.getNativeToken(), this.wrapper.prices);
    }

    async hasEnoughForTxFees(): Promise<{enoughBalance: boolean, balance: TokenAmount, required: TokenAmount}> {
        const [balance, commitFee] = await Promise.all([
            this.wrapper.contract.getBalance(this._getInitiator(), this.wrapper.chain.getNativeCurrencyAddress(), false),
            this.getCommitFee()
        ]);
        const totalFee = commitFee + this.getSwapData().getTotalDeposit();
        return {
            enoughBalance: balance >= totalFee,
            balance: toTokenAmount(balance, this.wrapper.getNativeToken(), this.wrapper.prices),
            required: toTokenAmount(totalFee, this.wrapper.getNativeToken(), this.wrapper.prices)
        };
    }


    //////////////////////////////
    //// Commit

    /**
     * Returns the transactions required for committing the swap on-chain, locking the tokens from the intermediary
     *  in an HTLC or PTLC
     *
     * @param skipChecks Skip checks like making sure init signature is still valid and swap wasn't commited yet
     *  (this is handled when swap is created (quoted), if you commit right after quoting, you can use skipChecks=true)
     * @throws {Error} When in invalid state to commit the swap
     */
    async txsCommit(skipChecks?: boolean): Promise<T["TX"][]> {
        if(!this.canCommit()) throw new Error("Must be in CREATED state!");

        if(!this.initiated) {
            this.initiated = true;
            await this._saveAndEmit();
        }

        return await this.wrapper.contract.txsInit(
            this._getInitiator(), this.data, this.signatureData, skipChecks, this.feeRate
        ).catch(e => Promise.reject(e instanceof SignatureVerificationError ? new Error("Request timed out") : e));
    }

    /**
     * Commits the swap on-chain, locking the tokens from the intermediary in an HTLC or PTLC
     *
     * @param signer Signer to sign the transactions with, must be the same as used in the initialization
     * @param abortSignal Abort signal to stop waiting for the transaction confirmation and abort
     * @param skipChecks Skip checks like making sure init signature is still valid and swap wasn't commited yet
     *  (this is handled when swap is created (quoted), if you commit right after quoting, you can use skipChecks=true)
     * @throws {Error} If invalid signer is provided that doesn't match the swap data
     */
    abstract commit(signer: T["Signer"] | T["NativeSigner"], abortSignal?: AbortSignal, skipChecks?: boolean): Promise<string>;

    abstract waitTillCommited(abortSignal?: AbortSignal): Promise<void>;


    //////////////////////////////
    //// Claim

    getClaimFee(): Promise<bigint> {
        return this.wrapper.contract.getClaimFee(this._getInitiator(), this.getSwapData());
    }

    abstract txsClaim(signer?: T["Signer"]): Promise<T["TX"][]>;

    /**
     * Claims and finishes the swap
     *
     * @param signer Signer to sign the transactions with, can also be different to the initializer
     * @param abortSignal Abort signal to stop waiting for transaction confirmation
     */
    abstract claim(signer: T["Signer"] | T["NativeSigner"], abortSignal?: AbortSignal): Promise<string>;

    /**
     * Waits till the swap is successfully claimed
     *
     * @param maxWaitTimeSeconds Maximum time in seconds to wait for the swap to be settled
     * @param abortSignal AbortSignal
     * @throws {Error} If swap is in invalid state (must be COMMIT)
     * @returns {boolean} whether the swap was claimed in time or not
     */
    abstract waitTillClaimed(maxWaitTimeSeconds?: number, abortSignal?: AbortSignal): Promise<boolean>;

}
