import {IEscrowSwap, IEscrowSwapInit, isIEscrowSwapInit} from "./IEscrowSwap";
import {ChainType, SignatureData, SignatureVerificationError, SwapData} from "@atomiqlabs/base";
import {SCToken, TokenAmount, toTokenAmount} from "../../Tokens";
import {timeoutPromise, tryWithRetries} from "../../utils/Utils";
import {IEscrowSwapWrapper} from "./IEscrowSwapWrapper";

export type IEscrowSelfInitSwapInit<T extends SwapData> = IEscrowSwapInit<T> & {
    feeRate: any,
    signatureData: SignatureData,
};

export function isIEscrowSelfInitSwapInit<T extends SwapData>(obj: any): obj is IEscrowSelfInitSwapInit<T> {
    return typeof obj === 'object' &&
        obj.feeRate != null &&
        (obj.signatureData == null || (
            typeof(obj.signatureData) === 'object' &&
            typeof(obj.signatureData.prefix)==="string" &&
            typeof(obj.signatureData.timeout)==="string" &&
            typeof(obj.signatureData.signature)==="string"
        )) &&
        isIEscrowSwapInit(obj);
}

export abstract class IEscrowSelfInitSwap<
    T extends ChainType = ChainType,
    S extends number = number
> extends IEscrowSwap<T, S> {

    signatureData?: SignatureData;
    feeRate?: any;

    protected constructor(wrapper: IEscrowSwapWrapper<T, IEscrowSwap<T, S>>, obj: any);
    protected constructor(wrapper: IEscrowSwapWrapper<T, IEscrowSwap<T, S>>, swapInit: IEscrowSelfInitSwapInit<T["Data"]>);
    protected constructor(
        wrapper: IEscrowSwapWrapper<T, IEscrowSwap<T, S>>,
        swapInitOrObj: IEscrowSelfInitSwapInit<T["Data"]> | any,
    ) {
        super(wrapper, swapInitOrObj);

        if(!isIEscrowSelfInitSwapInit(swapInitOrObj)) {
            this.signatureData = swapInitOrObj.signature==null ? null : {
                prefix: swapInitOrObj.prefix,
                timeout: swapInitOrObj.timeout,
                signature: swapInitOrObj.signature
            };
            this.feeRate = swapInitOrObj.feeRate;
        }
    }

    //////////////////////////////
    //// Watchdogs

    /**
     * Periodically checks for init signature's expiry
     *
     * @param intervalSeconds How often to check (in seconds), default to 5s
     * @param abortSignal
     * @protected
     */
    protected async watchdogWaitTillSignatureExpiry(intervalSeconds?: number, abortSignal?: AbortSignal): Promise<void> {
        intervalSeconds ??= 5;
        let expired = false
        while(!expired) {
            await timeoutPromise(intervalSeconds*1000, abortSignal);
            try {
                expired = await this.wrapper.contract.isInitAuthorizationExpired(this.data, this.signatureData);
            } catch (e) {
                this.logger.error("watchdogWaitTillSignatureExpiry(): Error when checking signature expiry: ", e);
            }
        }
        if(abortSignal!=null) abortSignal.throwIfAborted();
    }


    //////////////////////////////
    //// Amounts & fees

    /**
     * Get the estimated smart chain fee of the commit transaction
     */
    protected getCommitFee(): Promise<bigint> {
        return this.wrapper.contract.getCommitFee(this._getInitiator(), this.data, this.feeRate);
    }

    /**
     * Returns the transaction fee paid on the smart chain
     */
    async getSmartChainNetworkFee(): Promise<TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>> {
        const swapContract: T["Contract"] = this.wrapper.contract;
        return toTokenAmount(
            await (
                swapContract.getRawCommitFee!=null ?
                    swapContract.getRawCommitFee(this._getInitiator(), this.data, this.feeRate) :
                    swapContract.getCommitFee(this._getInitiator(), this.data, this.feeRate)
            ),
            this.wrapper.getNativeToken(),
            this.wrapper.prices
        );
    }

    /**
     * Checks if the initiator/sender has enough balance to cover the transaction fee for processing the swap
     */
    abstract hasEnoughForTxFees(): Promise<{enoughBalance: boolean, balance: TokenAmount, required: TokenAmount}>;


    //////////////////////////////
    //// Commit and claim

    abstract txsCommit(skipChecks?: boolean): Promise<T["TX"][]>;
    abstract commit(_signer: T["Signer"] | T["NativeSigner"], abortSignal?: AbortSignal, skipChecks?: boolean, onBeforeTxSent?: (txId: string) => void): Promise<string>;


    //////////////////////////////
    //// Quote verification

    /**
     * Checks if the swap's quote is expired for good (i.e. the swap strictly cannot be committed on-chain anymore)
     */
    async _verifyQuoteDefinitelyExpired(): Promise<boolean> {
        return tryWithRetries(
            () => this.wrapper.contract.isInitAuthorizationExpired(
                this.data, this.signatureData
            )
        );
    }

    /**
     * Checks if the swap's quote is still valid
     */
    async verifyQuoteValid(): Promise<boolean> {
        try {
            await tryWithRetries(
                () => this.wrapper.contract.isValidInitAuthorization(
                    this._getInitiator(), this.data, this.signatureData, this.feeRate
                ),
                null,
                SignatureVerificationError
            );
            return true;
        } catch (e) {
            if(e instanceof SignatureVerificationError) {
                return false;
            }
            throw e;
        }
    }

    serialize(): any {
        return {
            ...super.serialize(),
            prefix: this.signatureData?.prefix,
            timeout: this.signatureData?.timeout,
            signature: this.signatureData?.signature,
            feeRate: this.feeRate==null ? null : this.feeRate.toString(),
        }
    };

}