import { SwapType } from "../../enums/SwapType";
import { ChainType } from "@atomiqlabs/base";
import { LnForGasWrapper } from "./LnForGasWrapper";
import { ISwap, ISwapInit } from "../../ISwap";
import { BtcToken, SCToken, TokenAmount } from "../../../Tokens";
import { Fee, FeeType } from "../../fee/Fee";
import { IAddressSwap } from "../../IAddressSwap";
export declare enum LnForGasSwapState {
    EXPIRED = -2,
    FAILED = -1,
    PR_CREATED = 0,
    PR_PAID = 1,
    FINISHED = 2
}
export type LnForGasSwapInit = ISwapInit & {
    pr: string;
    outputAmount: bigint;
    recipient: string;
    token: string;
};
export declare function isLnForGasSwapInit(obj: any): obj is LnForGasSwapInit;
export declare class LnForGasSwap<T extends ChainType = ChainType> extends ISwap<T, LnForGasSwapState> implements IAddressSwap {
    protected readonly currentVersion: number;
    protected readonly TYPE: SwapType;
    private readonly pr;
    private readonly outputAmount;
    private readonly recipient;
    private readonly token;
    scTxId: string;
    constructor(wrapper: LnForGasWrapper<T>, init: LnForGasSwapInit);
    constructor(wrapper: LnForGasWrapper<T>, obj: any);
    protected upgradeVersion(): void;
    /**
     * In case swapFee in BTC is not supplied it recalculates it based on swap price
     * @protected
     */
    protected tryRecomputeSwapPrice(): void;
    _getEscrowHash(): string;
    getOutputAddress(): string | null;
    getInputTxId(): string | null;
    getOutputTxId(): string | null;
    getId(): string;
    /**
     * Returns the lightning network BOLT11 invoice that needs to be paid as an input to the swap
     */
    getAddress(): string;
    /**
     * Returns a string that can be displayed as QR code representation of the lightning invoice (with lightning: prefix)
     */
    getHyperlink(): string;
    requiresAction(): boolean;
    isFinished(): boolean;
    isQuoteExpired(): boolean;
    isQuoteSoftExpired(): boolean;
    isFailed(): boolean;
    isSuccessful(): boolean;
    verifyQuoteValid(): Promise<boolean>;
    protected getOutAmountWithoutFee(): bigint;
    getOutput(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
    getInput(): TokenAmount<T["ChainId"], BtcToken<true>>;
    getInputWithoutFee(): TokenAmount<T["ChainId"], BtcToken<true>>;
    protected getSwapFee(): Fee<T["ChainId"], BtcToken<true>, SCToken<T["ChainId"]>>;
    getFee(): Fee<T["ChainId"], BtcToken<true>, SCToken<T["ChainId"]>>;
    getFeeBreakdown(): [{
        type: FeeType.SWAP;
        fee: Fee<T["ChainId"], BtcToken<true>, SCToken<T["ChainId"]>>;
    }];
    protected checkInvoicePaid(save?: boolean): Promise<boolean>;
    /**
     * A blocking promise resolving when payment was received by the intermediary and client can continue
     * rejecting in case of failure
     *
     * @param checkIntervalSeconds How often to poll the intermediary for answer (default 5 seconds)
     * @param abortSignal Abort signal
     * @throws {PaymentAuthError} If swap expired or failed
     * @throws {Error} When in invalid state (not PR_CREATED)
     */
    waitForPayment(checkIntervalSeconds?: number, abortSignal?: AbortSignal): Promise<boolean>;
    serialize(): any;
    _getInitiator(): string;
    _sync(save?: boolean): Promise<boolean>;
    _tick(save?: boolean): Promise<boolean>;
}
