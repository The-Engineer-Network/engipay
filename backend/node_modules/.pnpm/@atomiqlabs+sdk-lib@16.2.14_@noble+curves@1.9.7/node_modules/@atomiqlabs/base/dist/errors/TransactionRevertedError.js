"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionRevertedError = void 0;
class TransactionRevertedError extends Error {
    constructor(msg) {
        super(msg);
        // Set the prototype explicitly.
        Object.setPrototypeOf(this, TransactionRevertedError.prototype);
    }
}
exports.TransactionRevertedError = TransactionRevertedError;
