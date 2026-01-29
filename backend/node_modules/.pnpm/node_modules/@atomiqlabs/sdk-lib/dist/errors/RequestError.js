"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutOfBoundsError = exports.RequestError = void 0;
/**
 * An error returned by the intermediary in a http response
 */
class RequestError extends Error {
    constructor(msg, httpCode) {
        try {
            const parsed = JSON.parse(msg);
            if (parsed.msg != null)
                msg = parsed.msg;
        }
        catch (e) { }
        super(msg);
        // Set the prototype explicitly.
        Object.setPrototypeOf(this, RequestError.prototype);
        this.httpCode = httpCode;
    }
    static parse(msg, httpCode) {
        try {
            const parsed = JSON.parse(msg);
            msg = parsed.msg;
            if (parsed.code === 20003 || parsed.code === 20004) {
                return new OutOfBoundsError(parsed.msg, httpCode, BigInt(parsed.data.min), BigInt(parsed.data.max));
            }
        }
        catch (e) { }
        return new RequestError(msg, httpCode);
    }
}
exports.RequestError = RequestError;
/**
 * An error indicating out of bounds (amount too high or too low) on swap initialization
 */
class OutOfBoundsError extends RequestError {
    constructor(msg, httpCode, min, max) {
        super(msg, httpCode);
        this.max = max;
        this.min = min;
        Object.setPrototypeOf(this, OutOfBoundsError.prototype);
    }
}
exports.OutOfBoundsError = OutOfBoundsError;
