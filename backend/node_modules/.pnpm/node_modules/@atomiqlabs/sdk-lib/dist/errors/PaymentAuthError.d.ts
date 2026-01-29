/**
 * An error when the payment authorization returned by the intermediary is invalid
 */
export declare class PaymentAuthError extends Error {
    code: number;
    data: any;
    constructor(msg: string, code?: number, data?: any);
    getCode(): number;
    getData(): any;
}
