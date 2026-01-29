"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageDeduplicator = void 0;
class MessageDeduplicator {
    constructor(maxSize = 10000) {
        this.maxSize = maxSize;
        this.buffer = new Array(maxSize);
        this.nextIndex = 0;
        this.idSet = new Set();
    }
    isDuplicate(eventId) {
        if (this.idSet.has(eventId)) {
            return true;
        }
        const oldId = this.buffer[this.nextIndex];
        if (oldId !== undefined) {
            this.idSet.delete(oldId);
        }
        this.buffer[this.nextIndex] = eventId;
        this.idSet.add(eventId);
        this.nextIndex = (this.nextIndex + 1) % this.maxSize;
        return false;
    }
}
exports.MessageDeduplicator = MessageDeduplicator;
