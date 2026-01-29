"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toTokenAmount = exports.toDecimal = exports.fromDecimal = exports.isToken = exports.isSCToken = exports.BitcoinTokens = exports.isBtcToken = void 0;
function isBtcToken(obj) {
    return typeof (obj) === "object" &&
        obj.chain === "BTC" &&
        typeof (obj.lightning) === "boolean" &&
        typeof (obj.ticker) === "string" &&
        typeof (obj.decimals) === "number" &&
        typeof (obj.name) === "string";
}
exports.isBtcToken = isBtcToken;
exports.BitcoinTokens = {
    BTC: {
        chain: "BTC",
        lightning: false,
        ticker: "BTC",
        decimals: 8,
        name: "Bitcoin (on-chain L1)"
    },
    BTCLN: {
        chain: "BTC",
        lightning: true,
        ticker: "BTC",
        decimals: 8,
        name: "Bitcoin (lightning L2)"
    }
};
function isSCToken(obj) {
    return typeof (obj) === "object" &&
        obj.chain === "SC" &&
        typeof (obj.chainId) === "string" &&
        typeof (obj.address) === "string" &&
        typeof (obj.ticker) === "string" &&
        typeof (obj.decimals) === "number" &&
        typeof (obj.name) === "string";
}
exports.isSCToken = isSCToken;
function isToken(obj) {
    return isBtcToken(obj) || isSCToken(obj);
}
exports.isToken = isToken;
function fromDecimal(amount, decimalCount) {
    if (amount.includes(".")) {
        const [before, after] = amount.split(".");
        if (decimalCount < 0) {
            return BigInt(before.substring(0, before.length + decimalCount));
        }
        if (after.length > decimalCount) {
            //Cut the last digits
            return BigInt((before === "0" ? "" : before) + after.substring(0, decimalCount));
        }
        return BigInt((before === "0" ? "" : before) + after.padEnd(decimalCount, "0"));
    }
    else {
        if (decimalCount < 0) {
            return BigInt(amount.substring(0, amount.length + decimalCount));
        }
        else {
            return BigInt(amount + "0".repeat(decimalCount));
        }
    }
}
exports.fromDecimal = fromDecimal;
function toDecimal(amount, decimalCount, cut, displayDecimals) {
    if (decimalCount <= 0) {
        return amount.toString(10) + "0".repeat(-decimalCount);
    }
    const amountStr = amount.toString(10).padStart(decimalCount + 1, "0");
    const splitPoint = amountStr.length - decimalCount;
    const decimalPart = amountStr.substring(splitPoint, amountStr.length);
    let cutTo = decimalPart.length;
    if (cut && cutTo > 0) {
        for (let i = decimalPart.length - 1; i--; i >= 0) {
            if (decimalPart.charAt(i) === "0") {
                cutTo = i;
            }
            else
                break;
        }
        if (cutTo === 0)
            cutTo = 1;
    }
    if (displayDecimals === 0)
        return amountStr.substring(0, splitPoint);
    if (displayDecimals != null && cutTo > displayDecimals)
        cutTo = displayDecimals;
    return amountStr.substring(0, splitPoint) + "." + decimalPart.substring(0, cutTo);
}
exports.toDecimal = toDecimal;
function toTokenAmount(amount, token, prices) {
    if (amount == null)
        return {
            rawAmount: null,
            amount: null,
            _amount: null,
            token,
            usdValue: () => Promise.resolve(null),
            toString: () => "??? " + token.ticker
        };
    let amountStr = toDecimal(amount, token.decimals, undefined, token.displayDecimals);
    return {
        rawAmount: amount,
        amount: amountStr,
        _amount: parseFloat(amountStr),
        token,
        usdValue: (abortSignal, preFetchedUsdPrice) => prices.getUsdValue(amount, token, abortSignal, preFetchedUsdPrice),
        toString: () => amountStr + " " + token.ticker
    };
}
exports.toTokenAmount = toTokenAmount;
