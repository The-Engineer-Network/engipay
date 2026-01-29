"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Lockable = void 0;
class Lockable {
    constructor() {
        this.lockedTill = 0;
        this.lockNonce = 0;
    }
    lock(timeoutSeconds) {
        if (this.isLocked()) {
            return null;
        }
        this.lockedTill = Date.now() + (timeoutSeconds * 1000);
        this.lockNonce++;
        const lockNonce = this.lockNonce;
        return () => {
            if (this.lockNonce !== lockNonce) {
                return false;
            }
            this.lockedTill = 0;
            return true;
        };
    }
    isLocked() {
        return this.lockedTill > Date.now();
    }
}
exports.Lockable = Lockable;
