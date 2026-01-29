export declare class Lockable {
    private lockedTill;
    private lockNonce;
    lock(timeoutSeconds: number): (() => boolean) | null;
    isLocked(): boolean;
}
