import { ParamDecoder } from "../ParamDecoder";
export declare class ResponseParamDecoder extends ParamDecoder {
    private readonly reader?;
    private readonly abortSignal?;
    constructor(resp: Response, abortSignal?: AbortSignal);
    /**
     * Keeps reading the response until the reader closes
     * @private
     */
    private readResponse;
}
