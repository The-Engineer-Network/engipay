/**
 * An error or inconsistency in the intermediary's returned data, this will blacklist the intermediary
 */
export class IntermediaryError extends Error {

    recoverable: boolean;
    originalStack?: string;

    constructor(msg: string, originalError?: any, recoverable: boolean = false) {
        if(originalError!=null) {
            if(originalError.name!=null) msg += ": "+originalError.name;
            if(originalError.message!=null) msg += ": "+originalError.message;
            if(typeof(originalError)==="string") msg += ": "+originalError;
        }
        super(msg);

        if(originalError?.stack!=null) this.originalStack = originalError.stack;
        this.recoverable = recoverable;
        // Set the prototype explicitly.
        Object.setPrototypeOf(this, IntermediaryError.prototype);
    }

}
