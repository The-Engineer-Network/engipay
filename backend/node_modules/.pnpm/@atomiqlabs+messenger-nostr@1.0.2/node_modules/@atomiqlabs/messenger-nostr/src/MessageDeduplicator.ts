
export class MessageDeduplicator {
    maxSize: number;
    buffer: Array<string>;
    nextIndex: number;
    idSet: Set<string>;

    constructor(maxSize: number = 10000) {
        this.maxSize = maxSize;
        this.buffer = new Array(maxSize);
        this.nextIndex = 0;
        this.idSet = new Set();
    }

    isDuplicate(eventId: string) {
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