"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParamEncoder = void 0;
const buffer_1 = require("buffer");
class ParamEncoder {
    constructor(write, end) {
        this.writeFN = write;
        this.endFN = end;
    }
    /**
     * Write a set of parameters to the underlying sink
     *
     * @param data
     */
    writeParams(data) {
        const serialized = buffer_1.Buffer.from(JSON.stringify(data));
        const frameLengthBuffer = buffer_1.Buffer.alloc(4);
        frameLengthBuffer.writeUint32LE(serialized.length);
        return this.writeFN(buffer_1.Buffer.concat([
            frameLengthBuffer,
            serialized
        ]));
    }
    /**
     * Cancels the underlying sink and encoder
     */
    end() {
        return this.endFN();
    }
}
exports.ParamEncoder = ParamEncoder;
