"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpvVaultData = void 0;
class SpvVaultData {
    static deserialize(data) {
        if (SpvVaultData.deserializers[data.type] != null) {
            return new SpvVaultData.deserializers[data.type](data);
        }
    }
    calculateStateAfter(priorWithdrawalTxs) {
        const balances = [...this.getBalances()];
        let withdrawalCount = this.getWithdrawalCount();
        let utxo = this.getUtxo();
        for (let withdrawalTx of priorWithdrawalTxs) {
            if (withdrawalTx.getSpentVaultUtxo() !== utxo)
                throw new Error("Invalid transaction, doesn't spend prior vault UTXO!");
            withdrawalTx.getTotalOutput().forEach((value, i) => {
                if (balances[i] == null)
                    throw new Error("Tried to withdraw non-existing token!");
                balances[i].rawAmount -= value;
                if (balances[i].rawAmount < 0n)
                    throw new Error("Prior transaction withdrew more than available in vault");
            });
            utxo = withdrawalTx.getCreatedVaultUtxo();
            withdrawalCount++;
        }
        balances.forEach(balance => {
            balance.scaledAmount = balance.rawAmount * balance.multiplier;
        });
        return {
            withdrawalCount,
            balances
        };
    }
}
exports.SpvVaultData = SpvVaultData;
SpvVaultData.deserializers = {};
