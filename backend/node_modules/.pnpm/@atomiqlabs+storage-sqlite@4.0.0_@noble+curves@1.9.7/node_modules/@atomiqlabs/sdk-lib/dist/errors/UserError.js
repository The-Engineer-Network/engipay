"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserError = void 0;
/**
 * An error on the user side, such as invalid address provided
 */
class UserError extends Error {
    constructor(msg) {
        super(msg);
        // Set the prototype explicitly.
        Object.setPrototypeOf(this, UserError.prototype);
    }
}
exports.UserError = UserError;
