/// <reference types="node" />
/// <reference types="node" />
import { IParamReader } from "./IParamReader";
import { Buffer } from "buffer";
export declare class ParamDecoder implements IParamReader {
    frameHeader: Buffer;
    frameData: Buffer[];
    frameDataLength: number;
    closed: boolean;
    params: {
        [key: string]: {
            promise: Promise<any>;
            resolve: (data: any) => void;
            reject: (err: any) => void;
        };
    };
    /**
     * Called when a frame is fully ready such that it can be parsed
     *
     * @param data Frame data
     * @private
     */
    private onFrameRead;
    /**
     * Called when data is read from the underlying source
     *
     * @param data Data that has been read from the underlying source
     * @protected
     */
    protected onData(data: Buffer): void;
    /**
     * Called when the underlying source ends/closes/cancels
     * @protected
     */
    protected onEnd(): void;
    /**
     * Called when an error happens with the underlying stream
     *
     * @param e Error
     * @protected
     */
    protected onError(e: any): void;
    getParam<T>(key: string): Promise<T>;
}
