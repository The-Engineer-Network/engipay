import { IFromBTCWrapper } from "./IFromBTCWrapper";
import { ChainType } from "@atomiqlabs/base";
import { BtcToken, SCToken, TokenAmount } from "../../../Tokens";
import { Fee, FeeType } from "../../fee/Fee";
import { IAddressSwap } from "../../IAddressSwap";
import { IEscrowSelfInitSwap, IEscrowSelfInitSwapInit } from "../IEscrowSelfInitSwap";
export declare abstract class IFromBTCSwap<T extends ChainType = ChainType, S extends number = number> extends IEscrowSelfInitSwap<T, S> implements IAddressSwap {
    protected abstract readonly inputToken: BtcToken;
    protected constructor(wrapper: IFromBTCWrapper<T, IFromBTCSwap<T, S>>, init: IEscrowSelfInitSwapInit<T["Data"]>);
    protected constructor(wrapper: IFromBTCWrapper<T, IFromBTCSwap<T, S>>, obj: any);
    /**
     * In case swapFee in BTC is not supplied it recalculates it based on swap price
     * @protected
     */
    protected tryRecomputeSwapPrice(): void;
    protected getSwapData(): T["Data"];
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
    _getInitiator(): string;
    getOutputTxId(): string | null;
    getOutputAddress(): string | null;
    requiresAction(): boolean;
    protected getOutAmountWithoutFee(): bigint;
    protected getSwapFee(): Fee<T["ChainId"], BtcToken, SCToken<T["ChainId"]>>;
    getFee(): Fee;
    getFeeBreakdown(): [{
        type: FeeType.SWAP;
        fee: Fee<T["ChainId"], BtcToken, SCToken<T["ChainId"]>>;
    }];
    getOutput(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
    getInputWithoutFee(): TokenAmount<T["ChainId"], BtcToken>;
    getSecurityDeposit(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
    getTotalDeposit(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
    hasEnoughForTxFees(): Promise<{
        enoughBalance: boolean;
        balance: TokenAmount;
        required: TokenAmount;
    }>;
    /**
     * Returns the transactions required for committing the swap on-chain, locking the tokens from the intermediary
     *  in an HTLC or PTLC
     *
     * @param skipChecks Skip checks like making sure init signature is still valid and swap wasn't commited yet
     *  (this is handled when swap is created (quoted), if you commit right after quoting, you can use skipChecks=true)
     * @throws {Error} When in invalid state to commit the swap
     */
    txsCommit(skipChecks?: boolean): Promise<T["TX"][]>;
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
    getClaimFee(): Promise<bigint>;
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
