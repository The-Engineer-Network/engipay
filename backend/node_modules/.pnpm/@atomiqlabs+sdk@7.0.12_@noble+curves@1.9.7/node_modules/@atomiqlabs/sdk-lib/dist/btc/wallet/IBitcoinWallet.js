"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isIBitcoinWallet = void 0;
function isIBitcoinWallet(val) {
    return val !== null &&
        typeof (val.sendTransaction) === "function" &&
        typeof (val.fundPsbt) === "function" &&
        typeof (val.signPsbt) === "function" &&
        typeof (val.getFeeRate) === "function" &&
        typeof (val.getTransactionFee) === "function" &&
        typeof (val.getFundedPsbtFee) === "function" &&
        typeof (val.getReceiveAddress) === "function" &&
        typeof (val.getBalance) === "function" &&
        typeof (val.getSpendableBalance) === "function";
}
exports.isIBitcoinWallet = isIBitcoinWallet;
