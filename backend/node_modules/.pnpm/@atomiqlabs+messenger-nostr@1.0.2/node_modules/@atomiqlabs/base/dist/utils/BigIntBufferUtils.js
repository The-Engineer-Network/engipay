"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BigIntBufferUtils = void 0;
const buffer_1 = require("buffer");
exports.BigIntBufferUtils = {
    toBuffer: (value, endianness = "be", length) => {
        let values = Array(length);
        for (let i = 0; i < length; i++) {
            values[i] = Number(value & 0xffn);
            value >>= 8n;
        }
        const buff = buffer_1.Buffer.from(values);
        if (endianness === "be")
            buff.reverse();
        return buff;
    },
    fromBuffer: (value, endianness = "be") => {
        if (endianness === "le") {
            const dst = buffer_1.Buffer.alloc(value.length);
            value.copy(dst);
            dst.reverse();
            value = dst;
        }
        let accumulator = 0n;
        for (let byte of value) {
            accumulator <<= 8n;
            accumulator |= BigInt(byte);
        }
        return accumulator;
    }
};
