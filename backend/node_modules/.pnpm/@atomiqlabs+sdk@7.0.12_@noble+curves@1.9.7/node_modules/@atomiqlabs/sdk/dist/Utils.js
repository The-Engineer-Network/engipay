"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.timeoutSignal = exports.fromHumanReadableString = exports.toHumanReadableString = void 0;
const sdk_lib_1 = require("@atomiqlabs/sdk-lib");
function toHumanReadableString(amount, currencySpec) {
    if (amount == null)
        return null;
    return (0, sdk_lib_1.toDecimal)(amount, currencySpec.decimals, undefined, currencySpec.displayDecimals);
}
exports.toHumanReadableString = toHumanReadableString;
function fromHumanReadableString(amount, currencySpec) {
    if (amount === "" || amount == null)
        return null;
    return (0, sdk_lib_1.fromDecimal)(amount, currencySpec.decimals);
}
exports.fromHumanReadableString = fromHumanReadableString;
/**
 * Returns an abort signal that aborts after a specified timeout in milliseconds
 *
 * @param timeout Milliseconds to wait
 * @param abortReason Abort with this abort reason
 * @param abortSignal Abort signal to extend
 */
function timeoutSignal(timeout, abortReason, abortSignal) {
    if (timeout == null)
        return abortSignal;
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(abortReason || new Error("Timed out")), timeout);
    if (abortSignal != null) {
        abortSignal.addEventListener("abort", () => {
            clearTimeout(timeoutHandle);
            abortController.abort(abortSignal.reason);
        });
    }
    return abortController.signal;
}
exports.timeoutSignal = timeoutSignal;
