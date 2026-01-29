import {ParamEncoder} from "../ParamEncoder";
import {Buffer} from "buffer";


export class StreamParamEncoder extends ParamEncoder {

    private readonly stream: TransformStream<Buffer>;
    private closed: boolean = false;

    constructor() {
        let stream = new TransformStream<Buffer>();
        let writeStream = stream.writable.getWriter();
        writeStream.closed.then(() => this.closed = true);
        super(writeStream.write.bind(writeStream), () => {
            if(this.closed) return Promise.resolve();
            this.closed = true;
            return writeStream.close();
        });
        this.stream = stream;
    }

    /**
     * Returns the readable stream to be passed to the fetch API
     */
    getReadableStream(): ReadableStream<Buffer> {
        return this.stream.readable;
    }

}