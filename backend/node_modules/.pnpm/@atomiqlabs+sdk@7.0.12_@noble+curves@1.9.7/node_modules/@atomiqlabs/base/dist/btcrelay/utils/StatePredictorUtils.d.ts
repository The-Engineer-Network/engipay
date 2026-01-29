/// <reference types="node" />
import { Buffer } from "buffer";
export declare class StatePredictorUtils {
    static readonly DIFF_ADJUSTMENT_PERIOD = 2016;
    static gtBuffer(a: Buffer, b: Buffer): boolean;
    static divInPlace(arr: Buffer, divisor: number): void;
    static addInPlace(arr: number[], add: number[]): void;
    static nbitsToTarget(nbits: number): Buffer;
    static getDifficulty(nbits: number): Buffer;
    static getChainwork(nbits: number): Buffer;
}
