
export class TransactionRevertedError extends Error {

    constructor(msg: string) {
        super(msg);
        // Set the prototype explicitly.
        Object.setPrototypeOf(this, TransactionRevertedError.prototype);
    }

}

