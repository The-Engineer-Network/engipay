"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bigIntMax = exports.findLastIndex = exports.parseInitFunctionCalldata = exports.poseidonHashRange = exports.bufferToByteArray = exports.bufferToBytes31Span = exports.bytes31SpanToBuffer = exports.toBigInt = exports.bigNumberishToBuffer = exports.u32ReverseEndianness = exports.bufferToU32Array = exports.u32ArrayToBuffer = exports.calculateHash = exports.toHex = exports.tryWithRetries = exports.getLogger = exports.onceAsync = exports.timeoutPromise = exports.isUint256 = void 0;
const starknet_types_08_1 = require("@starknet-io/starknet-types-08");
const starknet_1 = require("starknet");
const buffer_1 = require("buffer");
const StarknetSwapData_1 = require("../starknet/swaps/StarknetSwapData");
function isUint256(val) {
    return val.low != null && val.high != null;
}
exports.isUint256 = isUint256;
function timeoutPromise(timeoutMillis, abortSignal) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, timeoutMillis);
        if (abortSignal != null)
            abortSignal.addEventListener("abort", () => {
                clearTimeout(timeout);
                reject(new Error("Aborted"));
            });
    });
}
exports.timeoutPromise = timeoutPromise;
function onceAsync(executor) {
    let promise;
    return () => {
        if (promise == null) {
            promise = executor();
            return promise;
        }
        else {
            return promise.catch(() => promise = executor());
        }
    };
}
exports.onceAsync = onceAsync;
function getLogger(prefix) {
    return {
        // @ts-ignore
        debug: (msg, ...args) => global.atomiqLogLevel >= 3 && console.debug(prefix + msg, ...args),
        // @ts-ignore
        info: (msg, ...args) => global.atomiqLogLevel >= 2 && console.info(prefix + msg, ...args),
        // @ts-ignore
        warn: (msg, ...args) => (global.atomiqLogLevel == null || global.atomiqLogLevel >= 1) && console.warn(prefix + msg, ...args),
        // @ts-ignore
        error: (msg, ...args) => (global.atomiqLogLevel == null || global.atomiqLogLevel >= 0) && console.error(prefix + msg, ...args)
    };
}
exports.getLogger = getLogger;
const logger = getLogger("Utils: ");
async function tryWithRetries(func, retryPolicy, errorAllowed, abortSignal) {
    retryPolicy = retryPolicy || {};
    retryPolicy.maxRetries = retryPolicy.maxRetries || 5;
    retryPolicy.delay = retryPolicy.delay || 500;
    retryPolicy.exponential = retryPolicy.exponential == null ? true : retryPolicy.exponential;
    let err = null;
    for (let i = 0; i < retryPolicy.maxRetries; i++) {
        try {
            const resp = await func();
            return resp;
        }
        catch (e) {
            if (errorAllowed != null && errorAllowed(e))
                throw e;
            err = e;
            logger.error("tryWithRetries(): error on try number: " + i, e);
        }
        if (abortSignal != null && abortSignal.aborted)
            throw new Error("Aborted");
        if (i !== retryPolicy.maxRetries - 1) {
            await timeoutPromise(retryPolicy.exponential ? retryPolicy.delay * Math.pow(2, i) : retryPolicy.delay, abortSignal);
        }
    }
    throw err;
}
exports.tryWithRetries = tryWithRetries;
function toHex(value, length = 64) {
    if (value == null)
        return null;
    if (typeof (value) === "string")
        value = BigInt(value);
    switch (typeof (value)) {
        case "number":
        case "bigint":
            return "0x" + value.toString(16).padStart(length, "0");
    }
    return "0x" + value.toString("hex").padStart(length, "0");
}
exports.toHex = toHex;
function calculateHash(tx) {
    const commonData = {
        version: tx.details.version,
        maxFee: tx.details.maxFee,
        chainId: tx.details.chainId,
        nonce: tx.details.nonce,
        accountDeploymentData: tx.details.version === "0x3" ? tx.details.accountDeploymentData : null,
        nonceDataAvailabilityMode: tx.details.version === "0x3" ? starknet_types_08_1.EDAMode[tx.details.nonceDataAvailabilityMode] : null,
        feeDataAvailabilityMode: tx.details.version === "0x3" ? starknet_types_08_1.EDAMode[tx.details.feeDataAvailabilityMode] : null,
        resourceBounds: tx.details.version === "0x3" ? tx.details.resourceBounds : null,
        tip: tx.details.version === "0x3" ? tx.details.tip : null,
        paymasterData: tx.details.version === "0x3" ? tx.details.paymasterData : null
    };
    switch (tx.type) {
        case "INVOKE":
            const invokeData = starknet_1.CallData.compile(tx.signed.calldata);
            return tx.txId = starknet_1.hash.calculateInvokeTransactionHash({
                senderAddress: tx.details.walletAddress,
                compiledCalldata: invokeData,
                ...commonData
            });
        case "DEPLOY_ACCOUNT":
            const deployAccountData = starknet_1.CallData.compile(tx.signed.constructorCalldata);
            return tx.txId = starknet_1.hash.calculateDeployAccountTransactionHash({
                contractAddress: tx.tx.contractAddress,
                classHash: tx.signed.classHash,
                compiledConstructorCalldata: deployAccountData,
                salt: tx.signed.addressSalt,
                ...commonData
            });
        default:
            throw new Error("Unsupported tx type!");
    }
}
exports.calculateHash = calculateHash;
function u32ArrayToBuffer(arr) {
    const buffer = buffer_1.Buffer.alloc(4 * arr.length);
    for (let i = 0; i < arr.length; i++) {
        buffer.writeUInt32BE(Number(arr[i]), i * 4);
    }
    return buffer;
}
exports.u32ArrayToBuffer = u32ArrayToBuffer;
function bufferToU32Array(buffer) {
    const result = [];
    for (let i = 0; i < buffer.length; i += 4) {
        result.push(buffer.readUInt32BE(i));
    }
    return result;
}
exports.bufferToU32Array = bufferToU32Array;
function u32ReverseEndianness(value) {
    const valueBN = BigInt(value);
    return Number(((valueBN & 0xffn) << 24n) |
        ((valueBN & 0xff00n) << 8n) |
        ((valueBN >> 8n) & 0xff00n) |
        ((valueBN >> 24n) & 0xffn));
}
exports.u32ReverseEndianness = u32ReverseEndianness;
function bigNumberishToBuffer(value, length) {
    if (isUint256(value)) {
        return buffer_1.Buffer.concat([bigNumberishToBuffer(value.high, 16), bigNumberishToBuffer(value.low, 16)]);
    }
    if (typeof (value) === "string") {
        if (value.startsWith("0x")) {
            value = value.slice(2);
        }
        else {
            value = BigInt(value).toString(16);
        }
    }
    else {
        value = value.toString(16);
    }
    if (length != null)
        value = value.padStart(length * 2, "0");
    const buff = buffer_1.Buffer.from(value, "hex");
    if (buff.length > length)
        return buff.slice(buff.length - length);
    return buff;
}
exports.bigNumberishToBuffer = bigNumberishToBuffer;
function toBigInt(value) {
    if (value == null)
        return null;
    if (isUint256(value)) {
        return (toBigInt(value.high) << 128n) | toBigInt(value.low);
    }
    if (typeof (value) === "string") {
        if (!value.startsWith("0x"))
            value = "0x" + value;
        return BigInt(value);
    }
    if (typeof (value) === "bigint") {
        return value;
    }
    return BigInt(value);
}
exports.toBigInt = toBigInt;
function bytes31SpanToBuffer(span, length) {
    const buffers = [];
    const numFullBytes31 = Math.floor(length / 31);
    const additionalBytes = length - (numFullBytes31 * 31);
    const requiredSpanLength = numFullBytes31 + (additionalBytes === 0 ? 0 : 1);
    if (span.length < requiredSpanLength)
        throw new Error("Not enough bytes in the felt array!");
    let i = 0;
    for (; i < numFullBytes31; i++) {
        buffers.push(bigNumberishToBuffer(span[i], 31));
    }
    if (additionalBytes !== 0)
        buffers.push(bigNumberishToBuffer(span[i], additionalBytes));
    return buffer_1.Buffer.concat(buffers);
}
exports.bytes31SpanToBuffer = bytes31SpanToBuffer;
function bufferToBytes31Span(buffer, startIndex = 0, endIndex = buffer.length) {
    const values = [];
    for (let i = startIndex + 31; i < endIndex; i += 31) {
        values.push(BigInt("0x" + buffer.slice(i - 31, i).toString("hex")));
    }
    if (endIndex > startIndex + (values.length * 31))
        values.push(BigInt("0x" + buffer.slice(startIndex + (values.length * 31), endIndex).toString("hex")));
    return values;
}
exports.bufferToBytes31Span = bufferToBytes31Span;
function bufferToByteArray(buffer, startIndex = 0, endIndex = buffer.length) {
    const values = [];
    for (let i = startIndex + 31; i < endIndex; i += 31) {
        values.push(BigInt("0x" + buffer.slice(i - 31, i).toString("hex")));
    }
    let pendingWord = BigInt(0);
    let pendingWordLen = BigInt(endIndex - (startIndex + (values.length * 31)));
    if (pendingWordLen !== BigInt(0)) {
        pendingWord = BigInt("0x" + buffer.slice(startIndex + (values.length * 31), endIndex).toString("hex"));
    }
    return [
        BigInt(values.length),
        ...values,
        pendingWord,
        pendingWordLen
    ];
}
exports.bufferToByteArray = bufferToByteArray;
function poseidonHashRange(buffer, startIndex = 0, endIndex = buffer.length) {
    return starknet_1.hash.computePoseidonHashOnElements(bufferToBytes31Span(buffer, startIndex, endIndex));
}
exports.poseidonHashRange = poseidonHashRange;
function parseInitFunctionCalldata(calldata, claimHandler) {
    const escrow = StarknetSwapData_1.StarknetSwapData.fromSerializedFeltArray(calldata, claimHandler);
    const signatureLen = Number(toBigInt(calldata.shift()));
    const signature = calldata.splice(0, signatureLen);
    const timeout = toBigInt(calldata.shift());
    const extraDataLen = Number(toBigInt(calldata.shift()));
    const extraData = calldata.splice(0, extraDataLen);
    if (calldata.length !== 0)
        throw new Error("Calldata not read fully!");
    return { escrow, signature, timeout, extraData };
}
exports.parseInitFunctionCalldata = parseInitFunctionCalldata;
function findLastIndex(array, callback) {
    for (let i = array.length - 1; i >= 0; i--) {
        if (callback(array[i], i))
            return i;
    }
    return -1;
}
exports.findLastIndex = findLastIndex;
function bigIntMax(a, b) {
    return a > b ? a : b;
}
exports.bigIntMax = bigIntMax;
