"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CannotInitializeATAError = void 0;
class CannotInitializeATAError extends Error {
    constructor(msg) {
        super(msg);
        // Set the prototype explicitly.
        Object.setPrototypeOf(this, CannotInitializeATAError.prototype);
    }
}
exports.CannotInitializeATAError = CannotInitializeATAError;
