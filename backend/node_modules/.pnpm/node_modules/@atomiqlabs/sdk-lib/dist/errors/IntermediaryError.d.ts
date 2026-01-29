/**
 * An error or inconsistency in the intermediary's returned data, this will blacklist the intermediary
 */
export declare class IntermediaryError extends Error {
    recoverable: boolean;
    originalStack?: string;
    constructor(msg: string, originalError?: any, recoverable?: boolean);
}
