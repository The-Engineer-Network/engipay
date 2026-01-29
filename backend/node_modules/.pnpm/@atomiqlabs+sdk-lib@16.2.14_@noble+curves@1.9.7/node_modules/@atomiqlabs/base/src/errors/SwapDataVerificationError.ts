
export class SwapDataVerificationError extends Error {

    constructor(msg: string) {
        super(msg);
        // Set the prototype explicitly.
        Object.setPrototypeOf(this, SwapDataVerificationError.prototype);
    }

}

