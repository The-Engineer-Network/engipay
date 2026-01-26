/// <reference types="node" />
/// <reference types="node" />
import { Buffer } from "buffer";
export declare class ParamEncoder {
    private readonly writeFN;
    private readonly endFN;
    constructor(write: (data: Buffer) => Promise<void>, end: () => Promise<void>);
    /**
     * Write a set of parameters to the underlying sink
     *
     * @param data
     */
    writeParams(data: {
        [key: string]: any;
    }): Promise<void>;
    /**
     * Cancels the underlying sink and encoder
     */
    end(): Promise<void>;
}
