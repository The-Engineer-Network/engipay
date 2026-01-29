"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentAuthError = void 0;
/**
 * An error when the payment authorization returned by the intermediary is invalid
 */
class PaymentAuthError extends Error {
    constructor(msg, code, data) {
        super(msg);
        this.data = data;
        this.code = code;
        // Set the prototype explicitly.
        Object.setPrototypeOf(this, PaymentAuthError.prototype);
    }
    getCode() {
        return this.code;
    }
    getData() {
        return this.data;
    }
}
exports.PaymentAuthError = PaymentAuthError;
