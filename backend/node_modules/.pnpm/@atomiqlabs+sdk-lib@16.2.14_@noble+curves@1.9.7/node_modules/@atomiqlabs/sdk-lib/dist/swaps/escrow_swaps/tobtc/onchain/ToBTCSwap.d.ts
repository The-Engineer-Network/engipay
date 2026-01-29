import { ToBTCWrapper } from "./ToBTCWrapper";
import { IToBTCSwap, IToBTCSwapInit } from "../IToBTCSwap";
import { SwapType } from "../../../enums/SwapType";
import { ChainType, SwapData } from "@atomiqlabs/base";
import { BtcToken, TokenAmount } from "../../../../Tokens";
export type ToBTCSwapInit<T extends SwapData> = IToBTCSwapInit<T> & {
    address: string;
    amount: bigint;
    confirmationTarget: number;
    satsPerVByte: number;
    requiredConfirmations: number;
    nonce: bigint;
};
export declare function isToBTCSwapInit<T extends SwapData>(obj: any): obj is ToBTCSwapInit<T>;
export declare class ToBTCSwap<T extends ChainType = ChainType> extends IToBTCSwap<T> {
    protected readonly outputToken: BtcToken<false>;
    protected readonly TYPE = SwapType.TO_BTC;
    protected readonly wrapper: ToBTCWrapper<T>;
    private readonly address;
    private readonly amount;
    private readonly confirmationTarget;
    private readonly satsPerVByte;
    private readonly requiredConfirmations;
    private readonly nonce;
    private txId?;
    constructor(wrapper: ToBTCWrapper<T>, serializedObject: any);
    constructor(wrapper: ToBTCWrapper<T>, init: ToBTCSwapInit<T["Data"]>);
    _setPaymentResult(result: {
        secret?: string;
        txId?: string;
    }, check?: boolean): Promise<boolean>;
    getOutput(): TokenAmount<T["ChainId"], BtcToken<false>>;
    /**
     * Returns the bitcoin address where the BTC will be sent to
     */
    getOutputAddress(): string;
    getOutputTxId(): string | null;
    /**
     * Returns fee rate of the bitcoin transaction in sats/vB
     */
    getBitcoinFeeRate(): number;
    serialize(): any;
}
