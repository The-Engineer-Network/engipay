import {ParamDecoder} from "../ParamDecoder";
import {Buffer} from "buffer";
import {getLogger} from "../../Utils";

const logger = getLogger("ResponseParamDecoder: ");

export class ResponseParamDecoder extends ParamDecoder {

    private readonly reader?: ReadableStreamDefaultReader<Uint8Array>;
    private readonly abortSignal?: AbortSignal;

    constructor(resp: Response, abortSignal?: AbortSignal) {
        super();

        this.abortSignal = abortSignal;

        try {
            //Read from stream
            this.reader = resp.body.getReader();
            this.readResponse();
        } catch (e) {
            //Read in one piece
            resp.arrayBuffer().then(respBuffer => {
                super.onData(Buffer.from(respBuffer));
                super.onEnd();
            }).catch(e => {
                super.onError(e);
            });
        }

        if(abortSignal!=null) abortSignal.addEventListener("abort", () => {
            super.onError(abortSignal.reason);
            if(!this.reader.closed) this.reader.cancel(abortSignal.reason);
        });
    }

    /**
     * Keeps reading the response until the reader closes
     * @private
     */
    private async readResponse() {
        while(true) {
            const readResp = await this.reader.read().catch(e => {
                logger.error("readResponse(): Error reading response: ",e);
                return null;
            });
            if(this.abortSignal!=null && this.abortSignal.aborted) return;
            if(readResp==null || readResp.done) {
                super.onEnd();
                return;
            }
            super.onData(Buffer.from(readResp.value));
        }
    }
}