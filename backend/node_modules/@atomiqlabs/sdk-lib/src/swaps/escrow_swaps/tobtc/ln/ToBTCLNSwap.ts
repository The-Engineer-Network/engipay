import {decode as bolt11Decode} from "@atomiqlabs/bolt11";
import {ToBTCLNWrapper} from "./ToBTCLNWrapper";
import {isIToBTCSwapInit, IToBTCSwap, IToBTCSwapInit} from "../IToBTCSwap";
import {SwapType} from "../../../enums/SwapType";
import {ChainType, SwapData} from "@atomiqlabs/base";
import {Buffer} from "buffer";
import {sha256} from "@noble/hashes/sha2";
import {IntermediaryError} from "../../../../errors/IntermediaryError";
import {LNURL, LNURLDecodedSuccessAction, LNURLPaySuccessAction, isLNURLPaySuccessAction} from "../../../../utils/LNURL";
import {BtcToken, TokenAmount, Token, BitcoinTokens, toTokenAmount} from "../../../../Tokens";
import {getLogger} from "../../../../utils/Utils";

export type ToBTCLNSwapInit<T extends SwapData> = IToBTCSwapInit<T> & {
    confidence: number;
    pr?: string;
    lnurl?: string;
    successAction?: LNURLPaySuccessAction;
};

export function isToBTCLNSwapInit<T extends SwapData>(obj: any): obj is ToBTCLNSwapInit<T> {
    return typeof (obj.confidence) === "number" &&
        (obj.pr==null || typeof (obj.pr) === "string") &&
        (obj.lnurl == null || typeof (obj.lnurl) === "string") &&
        (obj.successAction == null || isLNURLPaySuccessAction(obj.successAction)) &&
        isIToBTCSwapInit<T>(obj);
}

//Set of nodes which disallow probing, resulting in 0 confidence reported by the LP
const SNOWFLAKE_LIST: Set<string> = new Set([
    "038f8f113c580048d847d6949371726653e02b928196bad310e3eda39ff61723f6",
    "03a6ce61fcaacd38d31d4e3ce2d506602818e3856b4b44faff1dde9642ba705976"
]);

export class ToBTCLNSwap<T extends ChainType = ChainType> extends IToBTCSwap<T> {
    protected outputToken: BtcToken<true> = BitcoinTokens.BTCLN;
    protected readonly TYPE = SwapType.TO_BTCLN;

    private readonly confidence: number;
    private readonly pr: string;

    readonly paymentHash: string;

    lnurl?: string;
    successAction?: LNURLPaySuccessAction;

    private secret?: string;

    constructor(wrapper: ToBTCLNWrapper<T>, init: ToBTCLNSwapInit<T["Data"]>);
    constructor(wrapper: ToBTCLNWrapper<T>, obj: any);

    constructor(wrapper: ToBTCLNWrapper<T>, initOrObj: ToBTCLNSwapInit<T["Data"]> | any) {
        if(isToBTCLNSwapInit(initOrObj)) initOrObj.url += "/tobtcln";
        super(wrapper, initOrObj);
        if(!isToBTCLNSwapInit(initOrObj)) {
            this.confidence = initOrObj.confidence;
            this.pr = initOrObj.pr;
            this.lnurl = initOrObj.lnurl;
            this.successAction = initOrObj.successAction;
            this.secret = initOrObj.secret;
        }

        this.paymentHash = this.getPaymentHash().toString("hex");
        this.logger = getLogger("ToBTCLN("+this.getIdentifierHashString()+"): ");
        this.tryRecomputeSwapPrice();
    }

    _setPaymentResult(result: { secret?: string; txId?: string }, check: boolean = false): Promise<boolean> {
        if(result==null) return Promise.resolve(false);
        if(result.secret==null) throw new IntermediaryError("No payment secret returned!");
        if(check) {
            const secretBuffer = Buffer.from(result.secret, "hex");
            const hash = Buffer.from(sha256(secretBuffer));

            if(!hash.equals(this.getPaymentHash())) throw new IntermediaryError("Invalid payment secret returned");
        }
        this.secret = result.secret;
        return Promise.resolve(true);
    }


    //////////////////////////////
    //// Amounts & fees

    getOutput(): TokenAmount<T["ChainId"], BtcToken<true>> {
        if(this.pr==null || !this.pr.startsWith("ln")) return toTokenAmount(null, this.outputToken, this.wrapper.prices);
        const parsedPR = bolt11Decode(this.pr);
        const amount = (BigInt(parsedPR.millisatoshis) + 999n) / 1000n;
        return toTokenAmount(amount, this.outputToken, this.wrapper.prices);
    }


    //////////////////////////////
    //// Getters & utils

    getOutputTxId(): string | null {
        return this.getLpIdentifier();
    }

    /**
     * Returns the lightning BOLT11 invoice where the BTC will be sent to
     */
    getOutputAddress(): string {
        return this.lnurl ?? this.pr;
    }

    /**
     * Returns payment secret (pre-image) as a proof of payment
     */
    getSecret(): string | null {
        return this.secret;
    }

    /**
     * Returns the confidence of the intermediary that this payment will succeed
     * Value between 0 and 1, where 0 is not likely and 1 is very likely
     */
    getConfidence(): number {
        return this.confidence;
    }

    /**
     * Checks whether a swap is likely to fail, based on the confidence as reported by the LP
     */
    willLikelyFail(): boolean {
        if(this.pr==null || !this.pr.startsWith("ln")) return false;

        const parsedRequest = bolt11Decode(this.pr);

        if(parsedRequest.tagsObject.routing_info!=null) {
            for (let route of parsedRequest.tagsObject.routing_info) {
                if(SNOWFLAKE_LIST.has(route.pubkey)) {
                    return false;
                }
            }
        }

        return this.confidence===0;
    }

    /**
     * Tries to detect if the target lightning invoice is a non-custodial mobile wallet, care must be taken
     *  for such a wallet to be online when attempting to make a swap
     */
    isPayingToNonCustodialWallet(): boolean {
        if(this.pr==null || !this.pr.startsWith("ln")) return false;

        const parsedRequest = bolt11Decode(this.pr);

        if(parsedRequest.tagsObject.routing_info!=null) {
            return parsedRequest.tagsObject.routing_info.length>0;
        }
        return false;
    }

    getIdentifierHash(): Buffer {
        const paymentHashBuffer = this.getPaymentHash();
        if(this.randomNonce==null) return paymentHashBuffer;
        return Buffer.concat([paymentHashBuffer, Buffer.from(this.randomNonce, "hex")]);
    }

    getPaymentHash(): Buffer {
        if(this.pr==null) return null;
        if(this.pr.startsWith("ln")) {
            const parsed = bolt11Decode(this.pr);
            return Buffer.from(parsed.tagsObject.payment_hash, "hex");
        }
        return Buffer.from(this.pr, "hex");
    }

    protected getLpIdentifier(): string {
        if(this.pr==null) return this.data.getEscrowHash();
        if(this.pr.startsWith("ln")) {
            const parsed = bolt11Decode(this.pr);
            return parsed.tagsObject.payment_hash;
        }
        return this.pr;
    }


    //////////////////////////////
    //// LNURL-pay

    /**
     * Is this an LNURL-pay swap?
     */
    isLNURL(): boolean {
        return this.lnurl!=null;
    }

    /**
     * Gets the used LNURL or null if this is not an LNURL-pay swap
     */
    getLNURL(): string | null {
        return this.lnurl;
    }

    /**
     * Checks whether this LNURL payment contains a success message
     */
    hasSuccessAction(): boolean {
        return this.successAction!=null;
    }

    /**
     * Returns the success action after a successful payment, else null
     */
    getSuccessAction(): LNURLDecodedSuccessAction | null {
        return LNURL.decodeSuccessAction(this.successAction, this.secret);
    }


    //////////////////////////////
    //// Storage

    serialize(): any {
        return {
            ...super.serialize(),
            paymentHash: this.getPaymentHash().toString("hex"),
            pr: this.pr,
            confidence: this.confidence,
            secret: this.secret,
            lnurl: this.lnurl,
            successAction: this.successAction
        };
    }

}
