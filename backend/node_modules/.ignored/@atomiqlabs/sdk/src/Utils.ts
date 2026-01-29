import {toDecimal, fromDecimal, Token} from "@atomiqlabs/sdk-lib";

export function toHumanReadableString(amount: bigint, currencySpec: Token): string {
    if(amount==null) return null;
    return toDecimal(amount, currencySpec.decimals, undefined, currencySpec.displayDecimals);
}

export function fromHumanReadableString(amount: string, currencySpec: Token): bigint {
    if(amount==="" || amount==null) return null;
    return fromDecimal(amount, currencySpec.decimals);
}

/**
 * Returns an abort signal that aborts after a specified timeout in milliseconds
 *
 * @param timeout Milliseconds to wait
 * @param abortReason Abort with this abort reason
 * @param abortSignal Abort signal to extend
 */
export function timeoutSignal(timeout: number, abortReason?: any, abortSignal?: AbortSignal): AbortSignal {
    if(timeout==null) return abortSignal;
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(abortReason || new Error("Timed out")), timeout);
    if(abortSignal!=null) {
        abortSignal.addEventListener("abort", () => {
            clearTimeout(timeoutHandle);
            abortController.abort(abortSignal.reason);
        });
    }
    return abortController.signal;
}
