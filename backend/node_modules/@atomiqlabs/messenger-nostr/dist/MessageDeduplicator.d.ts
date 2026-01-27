export declare class MessageDeduplicator {
    maxSize: number;
    buffer: Array<string>;
    nextIndex: number;
    idSet: Set<string>;
    constructor(maxSize?: number);
    isDuplicate(eventId: string): boolean;
}
