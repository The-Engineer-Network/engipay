import {SwapData, ChainSwapType} from "@atomiqlabs/base";
import {TimelockRefundHandler} from "./handlers/refund/TimelockRefundHandler";
import {BigNumberish, cairo, CairoOption, CairoOptionVariant, hash} from "starknet";
import {toBigInt, toHex} from "../../utils/Utils";
import {
    StringToPrimitiveType
} from "abi-wan-kanabi/dist/kanabi";
import {EscrowManagerAbi} from "./EscrowManagerAbi";
import {IClaimHandler} from "./handlers/claim/ClaimHandlers";

const FLAG_PAY_OUT: bigint = 0x01n;
const FLAG_PAY_IN: bigint = 0x02n;
const FLAG_REPUTATION: bigint = 0x04n;

export type StarknetSwapDataType = StringToPrimitiveType<typeof EscrowManagerAbi, "escrow_manager::structs::escrow::EscrowData">;

export type StarknetSuccessAction = {
    executionHash: string,
    executionExpiry: bigint,
    executionFee: bigint
}

function successActionEquals(a: StarknetSuccessAction, b: StarknetSuccessAction): boolean {
    if(a!=null && b!=null) {
        return a.executionHash.toLowerCase()===b.executionHash.toLowerCase() &&
            a.executionExpiry === b.executionExpiry &&
            a.executionFee === b.executionFee;
    }
    return a === b;
}

export class StarknetSwapData extends SwapData {

    static toFlags(value: number | bigint | string): {payOut: boolean, payIn: boolean, reputation: boolean, sequence: bigint} {
        const val = toBigInt(value);
        return {
            sequence: val >> 64n,
            payOut: (val & FLAG_PAY_OUT) === FLAG_PAY_OUT,
            payIn: (val & FLAG_PAY_IN) === FLAG_PAY_IN,
            reputation: (val & FLAG_REPUTATION) === FLAG_REPUTATION
        }
    }

    private getFlags(): bigint {
        return (this.sequence << 64n) +
            (this.payOut ? FLAG_PAY_OUT : 0n) +
            (this.payIn ? FLAG_PAY_IN : 0n) +
            (this.reputation ? FLAG_REPUTATION : 0n);
    }

    offerer: string;
    claimer: string;
    token: string;

    refundHandler: string;
    claimHandler: string;

    //Flags
    payOut: boolean;
    payIn: boolean;
    reputation: boolean;
    sequence: bigint;

    claimData: string;
    refundData: string;

    amount: bigint;

    feeToken: string;
    securityDeposit: bigint;
    claimerBounty: bigint;

    extraData: string;

    successAction?: StarknetSuccessAction;

    kind: ChainSwapType;

    constructor(
        offerer: string,
        claimer: string,
        token: string,
        refundHandler: string,
        claimHandler: string,
        payOut: boolean,
        payIn: boolean,
        reputation: boolean,
        sequence: bigint,
        claimData: string,
        refundData: string,
        amount: bigint,
        feeToken: string,
        securityDeposit: bigint,
        claimerBounty: bigint,
        kind: ChainSwapType,
        extraData: string,
        successAction?: StarknetSuccessAction
    );

    constructor(data: any);

    constructor(
        offererOrData: string | any,
        claimer?: string,
        token?: string,
        refundHandler?: string,
        claimHandler?: string,
        payOut?: boolean,
        payIn?: boolean,
        reputation?: boolean,
        sequence?: bigint,
        claimData?: string,
        refundData?: string,
        amount?: bigint,
        feeToken?: string,
        securityDeposit?: bigint,
        claimerBounty?: bigint,
        kind?: ChainSwapType,
        extraData?: string,
        successAction?: StarknetSuccessAction
    ) {
        super();
        if(claimer!=null || token!=null || refundHandler!=null || claimHandler!=null ||
            payOut!=null || payIn!=null || reputation!=null || sequence!=null || claimData!=null || refundData!=null ||
            amount!=null || feeToken!=null || securityDeposit!=null || claimerBounty!=null) {
            this.offerer = offererOrData;
            this.claimer = claimer;
            this.token = token;
            this.refundHandler = refundHandler;
            this.claimHandler = claimHandler;
            this.payOut = payOut;
            this.payIn = payIn;
            this.reputation = reputation;
            this.sequence = sequence;
            this.claimData = claimData;
            this.refundData = refundData;
            this.amount = amount;
            this.feeToken = feeToken;
            this.securityDeposit = securityDeposit;
            this.claimerBounty = claimerBounty;
            this.kind = kind;
            this.extraData = extraData;
            this.successAction = successAction;
        } else {
            this.offerer = offererOrData.offerer;
            this.claimer = offererOrData.claimer;
            this.token = offererOrData.token;
            this.refundHandler = offererOrData.refundHandler;
            this.claimHandler = offererOrData.claimHandler;
            this.payOut = offererOrData.payOut;
            this.payIn = offererOrData.payIn;
            this.reputation = offererOrData.reputation;
            this.sequence = offererOrData.sequence==null ? null : BigInt(offererOrData.sequence);
            this.claimData = offererOrData.claimData;
            this.refundData = offererOrData.refundData;
            this.amount = offererOrData.amount==null ? null : BigInt(offererOrData.amount);
            this.feeToken = offererOrData.feeToken;
            this.securityDeposit = offererOrData.securityDeposit==null ? null : BigInt(offererOrData.securityDeposit);
            this.claimerBounty = offererOrData.claimerBounty==null ? null : BigInt(offererOrData.claimerBounty);
            this.kind = offererOrData.kind;
            this.extraData = offererOrData.extraData;
            this.successAction = offererOrData.successAction==null || Array.isArray(offererOrData.successAction) ? null : {
                executionHash: offererOrData.successAction.executionHash,
                executionExpiry: BigInt(offererOrData.successAction.executionExpiry),
                executionFee: BigInt(offererOrData.successAction.executionFee),
            }
        }
    }

    getOfferer(): string {
        return this.offerer;
    }

    setOfferer(newOfferer: string) {
        this.offerer = newOfferer;
        this.payIn = true;
    }

    getClaimer(): string {
        return this.claimer;
    }

    setClaimer(newClaimer: string) {
        this.claimer = newClaimer;
        this.payIn = false;
        this.payOut = true;
        this.reputation = false;
    }

    serialize(): any {
        return {
            type: "strk",
            offerer: this.offerer,
            claimer: this.claimer,
            token: this.token,
            refundHandler: this.refundHandler,
            claimHandler: this.claimHandler,
            payOut: this.payOut,
            payIn: this.payIn,
            reputation: this.reputation,
            sequence: this.sequence==null ? null : this.sequence.toString(10),
            claimData: this.claimData,
            refundData: this.refundData,
            amount: this.amount==null ? null : this.amount.toString(10),
            feeToken: this.feeToken,
            securityDeposit: this.securityDeposit==null ? null : this.securityDeposit.toString(10),
            claimerBounty: this.claimerBounty==null ? null : this.claimerBounty.toString(10),
            kind: this.kind,
            extraData: this.extraData,
            successAction: this.successAction==null ? null : {
                executionHash: this.successAction.executionHash,
                executionExpiry: this.successAction.executionExpiry.toString(10),
                executionFee: this.successAction.executionFee.toString(10)
            }
        }
    }

    getAmount(): bigint {
        return this.amount;
    }

    getToken(): string {
        return this.token;
    }

    isToken(token: string): boolean {
        return this.token.toLowerCase()===token.toLowerCase();
    }

    getType(): ChainSwapType {
        return this.kind;
    }

    getExpiry(): bigint {
        return TimelockRefundHandler.getExpiry(this);
    }

    isPayIn(): boolean {
        return this.payIn;
    }

    isPayOut(): boolean {
        return this.payOut;
    }

    getEscrowHash(): string {
        const amountValue = cairo.uint256("0x"+this.amount.toString(16));
        const securityDepositValue = cairo.uint256("0x"+this.securityDeposit.toString(16));
        const claimerBountyValue = cairo.uint256("0x"+this.claimerBounty.toString(16));
        const elements = [
            this.offerer,
            this.claimer,
            this.token,
            this.refundHandler,
            this.claimHandler,
            this.getFlags(),
            this.claimData,
            this.refundData,
            amountValue.low,
            amountValue.high,
            this.feeToken,
            securityDepositValue.low,
            securityDepositValue.high,
            claimerBountyValue.low,
            claimerBountyValue.high
        ];
        if(this.successAction!=null) {
            elements.push(this.successAction.executionHash);
            elements.push(this.successAction.executionExpiry);
            const feeValue = cairo.uint256("0x"+this.successAction.executionFee.toString(16));
            elements.push(feeValue.low, feeValue.high);
        }

        let escrowHash = hash.computePoseidonHashOnElements(elements);
        if(escrowHash.startsWith("0x")) escrowHash = escrowHash.slice(2);
        return escrowHash.padStart(64, "0");
    }

    getClaimHash(): string {
        let hash = this.claimData;
        if(hash.startsWith("0x")) hash = hash.slice(2);
        return hash.padStart(64, "0");
    }

    getSequence(): bigint {
        return this.sequence;
    }

    getConfirmationsHint(): number {
        if(this.extraData==null) return null;
        if(this.extraData.length!=84) return null;
        return parseInt(this.extraData.slice(80), 16);
    }

    getNonceHint(): bigint {
        if(this.extraData==null) return null;
        if(this.extraData.length!=84) return null;
        return BigInt("0x"+this.extraData.slice(64, 80));
    }

    getTxoHashHint(): string {
        if(this.extraData==null) return null;
        if(this.extraData.length!=84) return null;
        return this.extraData.slice(0, 64);
    }

    getExtraData(): string {
        return this.extraData;
    }

    setExtraData(extraData: string): void {
        this.extraData = extraData;
    }

    getSecurityDeposit() {
        return this.securityDeposit;
    }

    getClaimerBounty() {
        return this.claimerBounty;
    }

    getTotalDeposit() {
        return this.claimerBounty < this.securityDeposit ? this.securityDeposit : this.claimerBounty;
    }

    getDepositToken() {
        return this.feeToken;
    }

    isDepositToken(token: string): boolean {
        if(!token.startsWith("0x")) token = "0x"+token;
        return toHex(this.feeToken)===toHex(token);
    }

    isClaimer(address: string) {
        if(!address.startsWith("0x")) address = "0x"+address;
        return toHex(this.claimer)===toHex(address);
    }

    isOfferer(address: string) {
        if(!address.startsWith("0x")) address = "0x"+address;
        return toHex(this.offerer)===toHex(address);
    }

    isRefundHandler(address: string): boolean {
        if(!address.startsWith("0x")) address = "0x"+address;
        return toHex(this.refundHandler)===toHex(address);
    }

    isClaimHandler(address: string): boolean {
        if(!address.startsWith("0x")) address = "0x"+address;
        return toHex(this.claimHandler)===toHex(address);
    }

    isClaimData(data: string): boolean {
        if(!data.startsWith("0x")) data = "0x"+data;
        return toHex(this.claimData)===toHex(data);
    }

    equals(other: StarknetSwapData): boolean {
        return other.offerer.toLowerCase()===this.offerer.toLowerCase() &&
            other.claimer.toLowerCase()===this.claimer.toLowerCase() &&
            other.token.toLowerCase()===this.token.toLowerCase() &&
            other.refundHandler.toLowerCase()===this.refundHandler.toLowerCase() &&
            other.claimHandler.toLowerCase()===this.claimHandler.toLowerCase() &&
            other.payIn===this.payIn &&
            other.payOut===this.payOut &&
            other.reputation===this.reputation &&
            this.sequence === other.sequence &&
            other.claimData.toLowerCase()===this.claimData.toLowerCase() &&
            other.refundData.toLowerCase()===this.refundData.toLowerCase() &&
            other.amount === this.amount &&
            other.securityDeposit === this.securityDeposit &&
            other.claimerBounty === this.claimerBounty &&
            successActionEquals(other.successAction, this.successAction)
    }

    toEscrowStruct(): StarknetSwapDataType {
        return {
            offerer: this.offerer,
            claimer: this.claimer,
            token: this.token,
            refund_handler: this.refundHandler,
            claim_handler: this.claimHandler,
            flags: this.getFlags(),
            claim_data: this.claimData,
            refund_data: this.refundData,
            amount: cairo.uint256(toBigInt(this.amount)),
            fee_token: this.feeToken,
            security_deposit: cairo.uint256(toBigInt(this.securityDeposit)),
            claimer_bounty: cairo.uint256(toBigInt(this.claimerBounty)),
            success_action: new CairoOption(
                this.successAction==null ? CairoOptionVariant.None : CairoOptionVariant.Some,
                this.successAction==null ? undefined : {
                    hash: this.successAction.executionHash,
                    expiry: this.successAction.executionExpiry,
                    fee: cairo.uint256(this.successAction.executionFee)
                }
            ) as StarknetSwapDataType["success_action"]
        }
    }

    static fromSerializedFeltArray(span: BigNumberish[], claimHandlerImpl: IClaimHandler<any, any>) {
        const offerer = toHex(span.shift());
        const claimer = toHex(span.shift());
        const token = toHex(span.shift());
        const refundHandler = toHex(span.shift());
        const claimHandler = toHex(span.shift());
        const {payOut, payIn, reputation, sequence} = StarknetSwapData.toFlags(span.shift());
        const claimData = toHex(span.shift());
        const refundData = toHex(span.shift());
        const amount = toBigInt({low: span.shift(), high: span.shift()});
        const feeToken = toHex(span.shift());
        const securityDeposit = toBigInt({low: span.shift(), high: span.shift()});
        const claimerBounty = toBigInt({low: span.shift(), high: span.shift()});
        const hasSuccessAction = toBigInt(span.shift()) === 0n;
        let successAction: StarknetSuccessAction = null;
        if(hasSuccessAction) {
            successAction = {
                executionHash: toHex(span.shift()),
                executionExpiry: toBigInt(span.shift()),
                executionFee: toBigInt({low: span.shift(), high: span.shift()})
            }
        }

        return new StarknetSwapData(
            offerer,
            claimer,
            token,
            refundHandler,
            claimHandler,
            payOut,
            payIn,
            reputation,
            sequence,
            claimData,
            refundData,
            amount,
            feeToken,
            securityDeposit,
            claimerBounty,
            claimHandlerImpl.getType(),
            null,
            successAction
        );
    }

    hasSuccessAction(): boolean {
        return this.successAction != null;
    }

}

SwapData.deserializers["strk"] = StarknetSwapData;
