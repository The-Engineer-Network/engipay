"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetSpvWithdrawalData = void 0;
const base_1 = require("@atomiqlabs/base");
const buffer_1 = require("buffer");
const starknet_1 = require("starknet");
const Utils_1 = require("../../utils/Utils");
const StarknetSpvVaultContract_1 = require("./StarknetSpvVaultContract");
class StarknetSpvWithdrawalData extends base_1.SpvWithdrawalTransactionData {
    fromOpReturnData(data) {
        return StarknetSpvVaultContract_1.StarknetSpvVaultContract.fromOpReturnData(data);
    }
    isRecipient(address) {
        return this.getRecipient().toLowerCase() === address.toLowerCase();
    }
    getTxHash() {
        return BigInt("0x" + buffer_1.Buffer.from(this.btcTx.txid, "hex").reverse().toString("hex"));
    }
    getFrontingAmount() {
        return [this.rawAmounts[0] + this.getExecutionFee()[0], this.rawAmounts[1]];
    }
    serialize() {
        return {
            type: "STARKNET",
            ...super.serialize()
        };
    }
    serializeToStruct() {
        const callerFee = this.getCallerFee();
        const frontingFee = this.getFrontingFee();
        const executionFee = this.getExecutionFee();
        return {
            recipient: this.recipient,
            amount: starknet_1.cairo.tuple(this.rawAmounts[0], this.rawAmounts[1]),
            caller_fee: starknet_1.cairo.tuple(callerFee[0], callerFee[1]),
            fronting_fee: starknet_1.cairo.tuple(frontingFee[0], frontingFee[1]),
            execution_handler_fee_amount_0: executionFee[0],
            execution_hash: (0, Utils_1.toBigInt)(this.executionHash) ?? 0n,
            execution_expiry: BigInt(this.executionExpiry)
        };
    }
    serializeToFelts() {
        const callerFee = this.getCallerFee();
        const frontingFee = this.getFrontingFee();
        const executionFee = this.getExecutionFee();
        return [
            this.recipient,
            this.rawAmounts[0],
            this.rawAmounts[1],
            callerFee[0],
            callerFee[1],
            frontingFee[0],
            frontingFee[1],
            executionFee[0],
            (0, Utils_1.toBigInt)(this.executionHash) ?? 0n,
            BigInt(this.executionExpiry)
        ];
    }
    getFrontingId() {
        const txHashU256 = starknet_1.cairo.uint256(base_1.BigIntBufferUtils.fromBuffer(buffer_1.Buffer.from(this.btcTx.txid, "hex"), "le"));
        let frontingId = starknet_1.hash.computePoseidonHashOnElements([
            txHashU256.low,
            txHashU256.high,
            ...this.serializeToFelts()
        ]);
        if (frontingId.startsWith("0x"))
            frontingId = frontingId.slice(2);
        return frontingId.padStart(64, "0");
    }
}
exports.StarknetSpvWithdrawalData = StarknetSpvWithdrawalData;
base_1.SpvWithdrawalTransactionData.deserializers["STARKNET"] = StarknetSpvWithdrawalData;
