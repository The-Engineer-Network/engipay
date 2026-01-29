import {IParamReader} from "./IParamReader";
import {Buffer} from "buffer";


export class ParamDecoder implements IParamReader {

    frameHeader: Buffer = null;
    frameData: Buffer[] = [];
    frameDataLength: number = 0;

    closed: boolean = false;

    params: {
        [key: string]: {
            promise: Promise<any>,
            resolve: (data: any) => void,
            reject: (err: any) => void
        }
    } = {};

    /**
     * Called when a frame is fully ready such that it can be parsed
     *
     * @param data Frame data
     * @private
     */
    private onFrameRead(data: Buffer) {
        const obj = JSON.parse(data.toString());
        for(let key in obj) {
            if(this.params[key]==null) {
                this.params[key] = {
                    promise: Promise.resolve(obj[key]),
                    resolve: null,
                    reject: null
                };
            } else {
                if(this.params[key].resolve!=null) {
                    this.params[key].resolve(obj[key]);
                    this.params[key].resolve = null;
                    this.params[key].reject = null;
                }
            }
        }
    }

    /**
     * Called when data is read from the underlying source
     *
     * @param data Data that has been read from the underlying source
     * @protected
     */
    protected onData(data: Buffer): void {
        let leavesBuffer = data;
        while(leavesBuffer!=null && leavesBuffer.length>0) {
            if(this.frameHeader==null) {
                if(leavesBuffer.length<=4) {
                    this.frameHeader = leavesBuffer;
                    leavesBuffer = null;
                } else {
                    this.frameHeader = leavesBuffer.subarray(0, 4);
                    leavesBuffer = leavesBuffer.subarray(4);
                }
            } else if(this.frameHeader.length<4) {
                const requiredLen = 4-this.frameHeader.length;
                if(leavesBuffer.length<=requiredLen) {
                    this.frameHeader = Buffer.concat([this.frameHeader, leavesBuffer]);
                    leavesBuffer = null;
                } else {
                    this.frameHeader = Buffer.concat([this.frameHeader, leavesBuffer.subarray(0, requiredLen)]);
                    leavesBuffer = leavesBuffer.subarray(requiredLen);
                }
            }
            if(leavesBuffer==null) continue;
            if(this.frameHeader==null || this.frameHeader.length<4) continue;

            const frameLength = this.frameHeader.readUint32LE();
            const requiredLen = frameLength-this.frameDataLength;

            if(leavesBuffer.length<=requiredLen) {
                this.frameData.push(leavesBuffer);
                this.frameDataLength += leavesBuffer.length;

                leavesBuffer = null;
            } else {
                this.frameData.push(leavesBuffer.subarray(0, requiredLen));
                this.frameDataLength += requiredLen;

                leavesBuffer = leavesBuffer.subarray(requiredLen);
            }

            if(frameLength===this.frameDataLength) {
                //Message read success
                this.onFrameRead(Buffer.concat(this.frameData));
                this.frameHeader = null;
                this.frameData = [];
                this.frameDataLength = 0;
            }
        }
    }

    /**
     * Called when the underlying source ends/closes/cancels
     * @protected
     */
    protected onEnd(): void {
        for(let key in this.params) {
            if(this.params[key].reject!=null) {
                this.params[key].reject(new Error("EOF before field seen!"));
            }
        }
        this.closed = true;
    }

    /**
     * Called when an error happens with the underlying stream
     *
     * @param e Error
     * @protected
     */
    protected onError(e: any): void {
        for(let key in this.params) {
            if(this.params[key].reject!=null) {
                this.params[key].reject(e);
            }
        }
        this.closed = true;
    }

    getParam<T>(key: string): Promise<T> {
        if(this.params[key]==null) {
            if(this.closed) return Promise.reject(new Error("Stream already closed without param received!"));
            let resolve: (data: any) => void;
            let reject: (err: any) => void;
            const promise = new Promise((_resolve, _reject) => {
                resolve = _resolve
                reject = _reject;
            });
            this.params[key] = {
                resolve,
                reject,
                promise
            }
        }
        return this.params[key].promise;
    }

}