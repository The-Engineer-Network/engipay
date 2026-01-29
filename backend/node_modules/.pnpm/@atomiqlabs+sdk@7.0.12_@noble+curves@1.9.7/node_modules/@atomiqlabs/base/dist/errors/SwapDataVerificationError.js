"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapDataVerificationError = void 0;
class SwapDataVerificationError extends Error {
    constructor(msg) {
        super(msg);
        // Set the prototype explicitly.
        Object.setPrototypeOf(this, SwapDataVerificationError.prototype);
    }
}
exports.SwapDataVerificationError = SwapDataVerificationError;
