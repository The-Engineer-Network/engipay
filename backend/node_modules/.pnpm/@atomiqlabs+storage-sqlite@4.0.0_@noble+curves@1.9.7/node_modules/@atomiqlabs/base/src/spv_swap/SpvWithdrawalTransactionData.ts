import {BtcTx} from "../btc/rpc/BitcoinRpc";
import {Buffer} from "buffer";
import {StorageObject} from "../storage/StorageObject";

export type ExecutionData = {
    executionHash: string,
    executionExpiry: number
};

export abstract class SpvWithdrawalTransactionData implements StorageObject {

    static deserializers: {
        [type: string]: new (serialized: any) => any,
    } = {};

    static deserialize<T extends SpvWithdrawalTransactionData>(data: any): T {
        if (SpvWithdrawalTransactionData.deserializers[data.type] != null) {
            return new SpvWithdrawalTransactionData.deserializers[data.type](data) as unknown as T;
        }
    }

    protected abstract fromOpReturnData(data: Buffer): {recipient: string, rawAmounts: bigint[], executionHash: string};

    readonly recipient: string;
    readonly rawAmounts: bigint[];

    readonly callerFeeRate: bigint;
    readonly executionFeeRate: bigint;
    readonly frontingFeeRate: bigint;

    readonly executionHash: string;
    readonly executionExpiry: number;

    readonly btcTx: BtcTx;

    constructor(btcTx: BtcTx) {
        if(btcTx.ins.length<2) throw new Error("Need at least 2 inputs");
        if(btcTx.outs.length<2) throw new Error("Need at least 2 outputs");

        const nSequence0 = BigInt(btcTx.ins[0].sequence);
        const nSequence1 = BigInt(btcTx.ins[1].sequence);

        if((nSequence0 & 0x80000000n) != 0x80000000n) throw new Error("nSequence0 high bit not set!");
        if((nSequence1 & 0x80000000n) != 0x80000000n) throw new Error("nSequence0 high bit not set!");
        const callerFeeRate: bigint = nSequence0 & 0xFFFFFn;
        const executionFeeRate: bigint = nSequence1 & 0xFFFFFn;
        const frontingFeeRate: bigint = ((nSequence0 >> 10n) & 0b1111_1111_1100_0000_0000n) | ((nSequence1 >> 20n) & 0b11_1111_1111n);

        const executionExpiry = btcTx.locktime + 1_000_000_000;
        if(executionExpiry >= Math.pow(2, 32)) throw new Error("Execution expiry overflow");

        const opReturnOutput = btcTx.outs[1];
        //Parse script
        const opReturnData = Buffer.from(opReturnOutput.scriptPubKey.hex, "hex");
        if(opReturnData.length===0) throw new Error("Output 1 empty script");
        if(opReturnData.at(0)!==0x6a) throw new Error("Output 1 is not OP_RETURN");
        if(opReturnData.at(1)===0) throw new Error("Output 1 OP_RETURN followed by OP_0");
        let data: Buffer;
        if(opReturnData.at(1) === 0x4c) { //OP_PUSHDATA1
            const dataLength = opReturnData.at(2);
            data = opReturnData.subarray(3, 3+dataLength);
            if(data.length !== dataLength) throw new Error("Output 1 OP_RETURN data length mismatch!");
        } else if(opReturnData.at(1) <= 0x4b) { //OP_PUSH<length>
            const dataLength = opReturnData.at(1);
            data = opReturnData.subarray(2, 2+dataLength);
            if(data.length !== dataLength) throw new Error("Output 1 OP_RETURN data length mismatch!");
        } else {
            throw new Error("Output 1 invalid push opcode");
        }

        //Parse OP_RETURN data
        const res = this.fromOpReturnData(data);

        this.recipient = res.recipient;
        this.rawAmounts = res.rawAmounts;

        this.callerFeeRate = callerFeeRate;
        this.frontingFeeRate = frontingFeeRate;
        this.executionFeeRate = executionFeeRate;

        this.executionHash = res.executionHash;
        this.executionExpiry = executionExpiry;

        this.btcTx = btcTx;
    }

    serialize(): any {
        return this.btcTx;
    }

    getRecipient(): string {
        return this.recipient;
    }

    abstract isRecipient(address: string): boolean;

    abstract getFrontingId(): string;

    getOutputWithoutFees(): bigint[] {
        return this.rawAmounts;
    }

    getCallerFee(): bigint[] {
        return this.rawAmounts.map(val => val * this.callerFeeRate / 100_000n);
    }

    getFrontingFee(): bigint[] {
        return this.rawAmounts.map(val => val * this.frontingFeeRate / 100_000n);
    }

    getExecutionFee(): bigint[] {
        return [this.rawAmounts[0] * this.executionFeeRate / 100_000n];
    }

    getTotalOutput(): bigint[] {
        const amounts = [...this.getOutputWithoutFees()];
        const callerFee = this.getCallerFee();
        if(callerFee!=null) callerFee.forEach((fee, i) => {
            if(fee==null || fee===0n) return;
            if(amounts[i]==null) throw new Error("Caller fee token out of bounds");
            amounts[i] += fee;
        });
        const frontingFee = this.getFrontingFee();
        if(frontingFee!=null) frontingFee.forEach((fee, i) => {
            if(fee==null || fee===0n) return;
            if(amounts[i]==null) throw new Error("Fronting fee token out of bounds");
            amounts[i] += fee;
        });
        const executionFee = this.getExecutionFee();
        if(executionFee!=null) executionFee.forEach((fee, i) => {
            if(fee==null || fee===0n) return;
            if(amounts[i]==null) throw new Error("Execution fee token out of bounds");
            amounts[i] += fee;
        });
        amounts.forEach((val, index) => {
            if(val >= 2n**64n) throw new Error("Token "+index+" amount out of bounds");
        })
        return amounts;
    }

    getExecutionData(): ExecutionData | null {
        if(this.executionHash==null) return null;
        return {
            executionHash: this.executionHash,
            executionExpiry: this.executionExpiry
        }
    }

    getTxId(): string {
        return this.btcTx.txid;
    }

    getSpentVaultUtxo(): string {
        const in0 = this.btcTx.ins[0];
        return in0.txid+":"+in0.vout;
    }

    getCreatedVaultUtxo(): string {
        return this.getTxId()+":0";
    }

    getNewVaultScript(): Buffer {
        return Buffer.from(this.btcTx.outs[0].scriptPubKey.hex, "hex");
    }

    getNewVaultBtcAmount(): number {
        return this.btcTx.outs[0].value;
    }

}