"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetSpvVaultData = void 0;
const base_1 = require("@atomiqlabs/base");
const Utils_1 = require("../../utils/Utils");
const buffer_1 = require("buffer");
const StarknetSpvWithdrawalData_1 = require("./StarknetSpvWithdrawalData");
class StarknetSpvVaultData extends base_1.SpvVaultData {
    constructor(ownerOrObj, vaultId, struct, initialUtxo) {
        super();
        if (typeof (ownerOrObj) === "string") {
            this.owner = ownerOrObj;
            this.vaultId = vaultId;
            this.relayContract = (0, Utils_1.toHex)(struct.relay_contract);
            this.token0 = {
                token: (0, Utils_1.toHex)(struct.token_0),
                multiplier: (0, Utils_1.toBigInt)(struct.token_0_multiplier),
                rawAmount: (0, Utils_1.toBigInt)(struct.token_0_amount)
            };
            this.token1 = {
                token: (0, Utils_1.toHex)(struct.token_1),
                multiplier: (0, Utils_1.toBigInt)(struct.token_1_multiplier),
                rawAmount: (0, Utils_1.toBigInt)(struct.token_1_amount)
            };
            const txHash = buffer_1.Buffer.from((0, Utils_1.toBigInt)(struct.utxo["0"]).toString(16).padStart(64, "0"), "hex");
            const vout = (0, Utils_1.toBigInt)(struct.utxo["1"]);
            this.utxo = txHash.reverse().toString("hex") + ":" + vout.toString(10);
            this.confirmations = Number((0, Utils_1.toBigInt)(struct.confirmations));
            this.withdrawCount = Number((0, Utils_1.toBigInt)(struct.withdraw_count));
            this.depositCount = Number((0, Utils_1.toBigInt)(struct.deposit_count));
            this.initialUtxo = initialUtxo;
        }
        else {
            this.owner = ownerOrObj.owner;
            this.vaultId = BigInt(ownerOrObj.vaultId);
            this.relayContract = ownerOrObj.relayContract;
            this.token0 = {
                token: ownerOrObj.token0.token,
                multiplier: BigInt(ownerOrObj.token0.multiplier),
                rawAmount: BigInt(ownerOrObj.token0.rawAmount)
            };
            this.token1 = {
                token: ownerOrObj.token1.token,
                multiplier: BigInt(ownerOrObj.token1.multiplier),
                rawAmount: BigInt(ownerOrObj.token1.rawAmount)
            };
            this.utxo = ownerOrObj.utxo;
            this.confirmations = ownerOrObj.confirmations;
            this.withdrawCount = ownerOrObj.withdrawCount;
            this.depositCount = ownerOrObj.depositCount;
            this.initialUtxo = ownerOrObj.initialUtxo;
        }
    }
    getBalances() {
        return [
            { ...this.token0, scaledAmount: this.token0.rawAmount * this.token0.multiplier },
            { ...this.token1, scaledAmount: this.token1.rawAmount * this.token1.multiplier }
        ];
    }
    getConfirmations() {
        return this.confirmations;
    }
    getOwner() {
        return this.owner;
    }
    getTokenData() {
        return [this.token0, this.token1];
    }
    getUtxo() {
        return this.isOpened() ? this.utxo : this.initialUtxo;
    }
    getVaultId() {
        return this.vaultId;
    }
    getWithdrawalCount() {
        return this.withdrawCount;
    }
    isOpened() {
        return this.utxo !== "0000000000000000000000000000000000000000000000000000000000000000:0";
    }
    serialize() {
        return {
            type: "STARKNET",
            owner: this.owner,
            vaultId: this.vaultId.toString(10),
            relayContract: this.relayContract,
            token0: {
                token: this.token0.token,
                multiplier: this.token0.multiplier.toString(10),
                rawAmount: this.token0.rawAmount.toString(10)
            },
            token1: {
                token: this.token1.token,
                multiplier: this.token1.multiplier.toString(10),
                rawAmount: this.token1.rawAmount.toString(10)
            },
            utxo: this.utxo,
            confirmations: this.confirmations,
            withdrawCount: this.withdrawCount,
            depositCount: this.depositCount,
            initialUtxo: this.initialUtxo
        };
    }
    updateState(withdrawalTxOrEvent) {
        if (withdrawalTxOrEvent instanceof base_1.SpvVaultClaimEvent) {
            if (withdrawalTxOrEvent.withdrawCount <= this.withdrawCount)
                return;
            this.token0.rawAmount -= withdrawalTxOrEvent.amounts[0];
            this.token1.rawAmount -= withdrawalTxOrEvent.amounts[1];
            this.withdrawCount = withdrawalTxOrEvent.withdrawCount;
            this.utxo = withdrawalTxOrEvent.btcTxId + ":0";
        }
        if (withdrawalTxOrEvent instanceof base_1.SpvVaultCloseEvent) {
            this.token0.rawAmount = 0n;
            this.token1.rawAmount = 0n;
            this.utxo = "0000000000000000000000000000000000000000000000000000000000000000:0";
        }
        if (withdrawalTxOrEvent instanceof base_1.SpvVaultOpenEvent) {
            if (this.isOpened())
                return;
            this.utxo = withdrawalTxOrEvent.btcTxId + ":" + withdrawalTxOrEvent.vout;
        }
        if (withdrawalTxOrEvent instanceof base_1.SpvVaultDepositEvent) {
            if (withdrawalTxOrEvent.depositCount <= this.depositCount)
                return;
            this.token0.rawAmount += withdrawalTxOrEvent.amounts[0];
            this.token1.rawAmount += withdrawalTxOrEvent.amounts[1];
            this.depositCount = withdrawalTxOrEvent.depositCount;
        }
        if (withdrawalTxOrEvent instanceof StarknetSpvWithdrawalData_1.StarknetSpvWithdrawalData) {
            if (withdrawalTxOrEvent.getSpentVaultUtxo() !== this.utxo)
                return;
            const amounts = withdrawalTxOrEvent.getTotalOutput();
            this.token0.rawAmount -= amounts[0];
            this.token1.rawAmount -= amounts[1];
            this.withdrawCount++;
            this.utxo = withdrawalTxOrEvent.btcTx.txid + ":0";
        }
    }
    getDepositCount() {
        return this.depositCount;
    }
}
exports.StarknetSpvVaultData = StarknetSpvVaultData;
base_1.SpvVaultData.deserializers["STARKNET"] = StarknetSpvVaultData;
