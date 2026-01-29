/// <reference types="node" />
import { Buffer } from "buffer";
export declare const BigIntBufferUtils: {
    toBuffer: (value: bigint, endianness?: "be" | "le", length?: number) => Buffer;
    fromBuffer: (value: Buffer, endianness?: "be" | "le") => bigint;
};
