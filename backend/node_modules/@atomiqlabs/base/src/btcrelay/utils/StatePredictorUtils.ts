import {Buffer} from "buffer";
import {BigIntBufferUtils} from "../../utils/BigIntBufferUtils";

export class StatePredictorUtils {

    static readonly DIFF_ADJUSTMENT_PERIOD = 2016;

    static gtBuffer(a: Buffer, b: Buffer): boolean {
        for(let i=0;i<a.length;i++) {
            if(a[i]>b[i]) return true;
            if(a[i]<b[i]) return false;
        }
        return false;
    }

    static divInPlace(arr: Buffer, divisor: number): void {

        let remainder = 0;

        for(let i=0;i<32;i++) {
            const val = arr[i] + remainder;
            const result = Math.floor(val/divisor);
            remainder = (val % divisor) * 256;
            arr[i] = result;
        }

    }

    static addInPlace(arr: number[], add: number[]): void {

        let remainder = 0;

        for(let i=0;i<32;i++) {
            const pos = 31-i;
            const val = arr[pos] + add[pos] + remainder;
            const byte = val & 0xFF;
            remainder = val >> 8;
            arr[pos] = byte;
        }

    }

    static nbitsToTarget(nbits: number): Buffer {

        const target = Buffer.alloc(32, 0);

        const nSize = (nbits>>24) & 0xFF;

        const nWord = [
            ((nbits >> 16) & 0x7F),
            ((nbits >> 8) & 0xFF),
            ((nbits) & 0xFF)
        ];

        const start = 32-nSize;

        for(let i=0;i<3;i++) {
            if(start+i<32) {
                target[start+i] = nWord[i];
            }
        }

        return target;

    }

    static getDifficulty(nbits: number): Buffer {

        const target = StatePredictorUtils.nbitsToTarget(nbits);

        let start = 0;
        for(let i=0;i<32;i++) {
            if(target[i]>0) {
                start = i;
                break;
            }
        }

        const shift = 32 - start - 3;

        let num = 0;

        for(let i=0;i<3;i++) {
            num |= target[start+i] << ((2-i)*8);
        }

        const arr = Buffer.from("00000000FFFF0000000000000000000000000000000000000000000000000000", "hex");

        StatePredictorUtils.divInPlace(arr, num);

        const result = Buffer.alloc(32, 0);

        for(let i=0;i<32-shift;i++) {
            result[i+shift] = arr[i];
        }

        return result;

    }

    static getChainwork(nbits: number): Buffer {
        const target = StatePredictorUtils.nbitsToTarget(nbits);
        const targetBN = BigIntBufferUtils.fromBuffer(target);
        return BigIntBufferUtils.toBuffer(
            ((~targetBN & 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn) / (targetBN + 1n)) + 1n, "be", 32
        );
    }
}
