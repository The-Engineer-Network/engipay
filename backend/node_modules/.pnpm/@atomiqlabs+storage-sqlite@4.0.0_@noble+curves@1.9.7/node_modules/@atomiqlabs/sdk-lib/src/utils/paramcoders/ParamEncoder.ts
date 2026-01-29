import {Buffer} from "buffer";

export class ParamEncoder {

    private readonly writeFN: (data: Buffer) => Promise<void>;
    private readonly endFN: () => Promise<void>;

    constructor(write: (data: Buffer) => Promise<void>, end: () => Promise<void>) {
        this.writeFN = write;
        this.endFN = end;
    }

    /**
     * Write a set of parameters to the underlying sink
     *
     * @param data
     */
    writeParams(data: {[key: string]: any}): Promise<void> {
        const serialized: Buffer = Buffer.from(JSON.stringify(data));

        const frameLengthBuffer = Buffer.alloc(4);
        frameLengthBuffer.writeUint32LE(serialized.length);

        return this.writeFN(Buffer.concat([
            frameLengthBuffer,
            serialized
        ]));
    }

    /**
     * Cancels the underlying sink and encoder
     */
    end(): Promise<void> {
        return this.endFN();
    }

}