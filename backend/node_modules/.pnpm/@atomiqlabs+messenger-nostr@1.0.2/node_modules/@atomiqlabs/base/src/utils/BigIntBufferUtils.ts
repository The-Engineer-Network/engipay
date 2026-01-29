import {Buffer} from "buffer";

export const BigIntBufferUtils: {
    toBuffer: (value: bigint, endianness?: "be" | "le", length?: number) => Buffer
    fromBuffer: (value: Buffer, endianness?: "be" | "le") => bigint
} = {
    toBuffer: (value: bigint, endianness: "be" | "le" = "be", length: number) => {
        let values: number[] = Array(length);
        for(let i=0;i<length;i++) {
            values[i] = Number(value & 0xffn);
            value >>= 8n;
        }
        const buff = Buffer.from(values);
        if(endianness==="be") buff.reverse();
        return buff;
    },
    fromBuffer: (value: Buffer, endianness: "be" | "le" = "be") => {
        if(endianness==="le") {
            const dst = Buffer.alloc(value.length);
            value.copy(dst);
            dst.reverse();
            value = dst;
        }
        let accumulator = 0n;
        for(let byte of value) {
            accumulator <<= 8n;
            accumulator |= BigInt(byte);
        }
        return accumulator;
    }
};
