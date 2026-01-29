import { IEscrowSwap, IEscrowSwapInit } from "./IEscrowSwap";
import { ChainType, SignatureData, SwapData } from "@atomiqlabs/base";
import { SCToken, TokenAmount } from "../../Tokens";
import { IEscrowSwapWrapper } from "./IEscrowSwapWrapper";
export type IEscrowSelfInitSwapInit<T extends SwapData> = IEscrowSwapInit<T> & {
    feeRate: any;
    signatureData: SignatureData;
};
export declare function isIEscrowSelfInitSwapInit<T extends SwapData>(obj: any): obj is IEscrowSelfInitSwapInit<T>;
export declare abstract class IEscrowSelfInitSwap<T extends ChainType = ChainType, S extends number = number> extends IEscrowSwap<T, S> {
    signatureData?: SignatureData;
    feeRate?: any;
    protected constructor(wrapper: IEscrowSwapWrapper<T, IEscrowSwap<T, S>>, obj: any);
    protected constructor(wrapper: IEscrowSwapWrapper<T, IEscrowSwap<T, S>>, swapInit: IEscrowSelfInitSwapInit<T["Data"]>);
    /**
     * Periodically checks for init signature's expiry
     *
     * @param intervalSeconds How often to check (in seconds), default to 5s
     * @param abortSignal
     * @protected
     */
    protected watchdogWaitTillSignatureExpiry(intervalSeconds?: number, abortSignal?: AbortSignal): Promise<void>;
    /**
     * Get the estimated smart chain fee of the commit transaction
     */
    protected getCommitFee(): Promise<bigint>;
    /**
     * Returns the transaction fee paid on the smart chain
     */
    getSmartChainNetworkFee(): Promise<TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>>;
    /**
     * Checks if the initiator/sender has enough balance to cover the transaction fee for processing the swap
     */
    abstract hasEnoughForTxFees(): Promise<{
        enoughBalance: boolean;
        balance: TokenAmount;
        required: TokenAmount;
    }>;
    abstract txsCommit(skipChecks?: boolean): Promise<T["TX"][]>;
    abstract commit(_signer: T["Signer"] | T["NativeSigner"], abortSignal?: AbortSignal, skipChecks?: boolean, onBeforeTxSent?: (txId: string) => void): Promise<string>;
    /**
     * Checks if the swap's quote is expired for good (i.e. the swap strictly cannot be committed on-chain anymore)
     */
    _verifyQuoteDefinitelyExpired(): Promise<boolean>;
    /**
     * Checks if the swap's quote is still valid
     */
    verifyQuoteValid(): Promise<boolean>;
    serialize(): any;
}
