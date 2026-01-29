import {isOptionalField, RequestSchema, RequestSchemaResultPromise, verifyField} from "../SchemaVerifier";
import {RequestError} from "../../../errors/RequestError";
import {extendAbortController, getLogger, objectMap, timeoutSignal} from "../../Utils";
import {StreamParamEncoder} from "./StreamParamEncoder";
import {ResponseParamDecoder} from "./ResponseParamDecoder";


export type RequestBody = {
    [key: string]: Promise<any> | any
}

const logger = getLogger("StreamingFetch: ");

//https://developer.chrome.com/docs/capabilities/web-apis/fetch-streaming-requests#feature_detection
const supportsRequestStreams: boolean = (() => {
    try {
        let duplexAccessed = false;

        const request = new Request('https://example.com/', {
            body: new ReadableStream(),
            method: 'POST',
            get duplex() {
                duplexAccessed = true;
                return 'half';
            },
        } as any);
        const hasContentType = request.headers.has('Content-Type');

        return duplexAccessed && !hasContentType;
    } catch (e) {
        logger.error("supportsRequestStreams: Error checking environment support for HTTP request stream", e);
        return false;
    }
})();

logger.info("Environment supports request stream: "+supportsRequestStreams);

/**
 * Sends a POST request to the specified URL in a streaming request/response mode
 *
 * @param url URL to send the request to
 * @param body An object containing properties that should be sent to the server, can be Promise or any
 * @param schema Schema of the response that should be received from the server
 * @param timeout Timeout in millseconds for the request to succeed & all its response properties to resolve
 * @param signal Abort signal
 * @param streamRequest Whether the request should be streamed or not
 * @throws {RequestError} When the response code is not 200
 */
export async function streamingFetchPromise<T extends RequestSchema>(
    url: string,
    body: RequestBody,
    schema: T,
    timeout?: number,
    signal?: AbortSignal,
    streamRequest?: boolean
): Promise<RequestSchemaResultPromise<T>> {
    if(streamRequest==null) streamRequest = supportsRequestStreams;
    if(timeout!=null) signal = timeoutSignal(timeout, new Error("Network request timed out"), signal);

    const init: RequestInit = {
        method: "POST",
        headers: {}
    };

    const startTime = Date.now();

    const immediateValues: any = {};
    const promises: Promise<any>[] = [];

    if(!streamRequest) {
        for(let key in body) {
            if(body[key] instanceof Promise) {
                promises.push(body[key].then((val) => {
                    immediateValues[key] = val;
                }));
            } else {
                immediateValues[key] = body[key];
            }
        }

        try {
            await Promise.all(promises);
        } catch (e) {
            e._inputPromiseError = true;
            throw e;
        }

        if(signal!=null) signal.throwIfAborted();

        logger.debug(url+": Sending request ("+(Date.now()-startTime)+"ms) (non-streaming): ", immediateValues);
        init.body = JSON.stringify(immediateValues);
        init.headers['content-type'] = "application/json";
    } else {
        const outputStream = new StreamParamEncoder();

        let hasPromiseInBody = false;
        for(let key in body) {
            if(body[key] instanceof Promise) {
                promises.push(body[key].then((val) => {
                    logger.debug(url+": Send param ("+(Date.now()-startTime)+"ms) (streaming): ", {[key]: val});
                    return outputStream.writeParams({
                        [key]: val
                    });
                }));
                hasPromiseInBody = true;
            } else {
                immediateValues[key] = body[key];
            }
        }

        if(hasPromiseInBody) {
            init.body = outputStream.getReadableStream();
            init.headers['content-type'] = "application/x-multiple-json";
            (init as any).duplex = "half";

            logger.debug(url+": Sending request ("+(Date.now()-startTime)+"ms) (streaming): ", immediateValues);
            promises.push(outputStream.writeParams(immediateValues));

            const abortController = extendAbortController(signal);
            signal = abortController.signal;

            Promise.all(promises).then(() => outputStream.end()).catch(e => {
                e._inputPromiseError = true;
                abortController.abort(e);
            });

            signal.addEventListener("abort", () => outputStream.end());
        } else {
            logger.debug(url+": Sending request ("+(Date.now()-startTime)+"ms) (non-streaming): ", immediateValues);
            init.body = JSON.stringify(immediateValues);
            init.headers['content-type'] = "application/json";
        }
    }

    if(signal!=null) init.signal = signal;
    init.headers['accept'] = "application/x-multiple-json";

    const resp = await fetch(url, init).catch(e => {
        if(init.signal!=null && e.name==="AbortError") {
            throw init.signal.reason;
        } else {
            if(e.message!=null) e.message += streamRequest ? " (streaming req)" : " (non streaming req)"
            throw e;
        }
    });

    logger.debug(url+": Response status ("+(Date.now()-startTime)+"ms) "+(streamRequest ? "(streaming req)" : "(non streaming req)")+": ", resp.status);

    if(resp.status!==200) {
        let respTxt: string;
        try {
            respTxt = await resp.text();
        } catch (e) {
            throw new RequestError(resp.statusText, resp.status);
        }
        throw new RequestError(respTxt, resp.status);
    }

    if(resp.headers.get("content-type")!=="application/x-multiple-json") {
        const respBody = await resp.json();

        logger.debug(url+": Response read ("+(Date.now()-startTime)+"ms) (non streaming resp): ", respBody);

        return objectMap(schema, (schemaValue, key) => {
            const value = respBody[key];

            const result = verifyField(schemaValue, value);
            if(result===undefined) {
                return Promise.reject(new Error("Invalid field value"));
            } else {
                return Promise.resolve(result);
            }
        }) as any;
    } else {
        const decoder = new ResponseParamDecoder(resp, init.signal);

        return objectMap(schema, (schemaValue, key) => decoder.getParam(key).catch(e => {
            if(isOptionalField(schemaValue)) return undefined;
            throw e;
        }).then(value => {
            logger.debug(url+": Response frame read ("+(Date.now()-startTime)+"ms) (streaming resp): ", {[key]: value});
            const result = verifyField(schemaValue, value);
            if(result===undefined) {
                return Promise.reject(new Error("Invalid field value"));
            } else {
                return result;
            }
        })) as any;
    }
}