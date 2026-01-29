"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignatureVerificationError = void 0;
class SignatureVerificationError extends Error {
    constructor(msg) {
        super(msg);
        // Set the prototype explicitly.
        Object.setPrototypeOf(this, SignatureVerificationError.prototype);
    }
}
exports.SignatureVerificationError = SignatureVerificationError;
