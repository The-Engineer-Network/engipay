/**
 * An error on the user side, such as invalid address provided
 */
export class UserError extends Error {

    constructor(msg: string) {
        super(msg);
        // Set the prototype explicitly.
        Object.setPrototypeOf(this, UserError.prototype);
    }

}

