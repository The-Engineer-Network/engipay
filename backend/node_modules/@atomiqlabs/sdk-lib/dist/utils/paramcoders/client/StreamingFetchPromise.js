"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamingFetchPromise = void 0;
const SchemaVerifier_1 = require("../SchemaVerifier");
const RequestError_1 = require("../../../errors/RequestError");
const Utils_1 = require("../../Utils");
const StreamParamEncoder_1 = require("./StreamParamEncoder");
const ResponseParamDecoder_1 = require("./ResponseParamDecoder");
const logger = (0, Utils_1.getLogger)("StreamingFetch: ");
//https://developer.chrome.com/docs/capabilities/web-apis/fetch-streaming-requests#feature_detection
const supportsRequestStreams = (() => {
    try {
        let duplexAccessed = false;
        const request = new Request('https://example.com/', {
            body: new ReadableStream(),
            method: 'POST',
            get duplex() {
                duplexAccessed = true;
                return 'half';
            },
        });
        const hasContentType = request.headers.has('Content-Type');
        return duplexAccessed && !hasContentType;
    }
    catch (e) {
        logger.error("supportsRequestStreams: Error checking environment support for HTTP request stream", e);
        return false;
    }
})();
logger.info("Environment supports request stream: " + supportsRequestStreams);
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
async function streamingFetchPromise(url, body, schema, timeout, signal, streamRequest) {
    if (streamRequest == null)
        streamRequest = supportsRequestStreams;
    if (timeout != null)
        signal = (0, Utils_1.timeoutSignal)(timeout, new Error("Network request timed out"), signal);
    const init = {
        method: "POST",
        headers: {}
    };
    const startTime = Date.now();
    const immediateValues = {};
    const promises = [];
    if (!streamRequest) {
        for (let key in body) {
            if (body[key] instanceof Promise) {
                promises.push(body[key].then((val) => {
                    immediateValues[key] = val;
                }));
            }
            else {
                immediateValues[key] = body[key];
            }
        }
        try {
            await Promise.all(promises);
        }
        catch (e) {
            e._inputPromiseError = true;
            throw e;
        }
        if (signal != null)
            signal.throwIfAborted();
        logger.debug(url + ": Sending request (" + (Date.now() - startTime) + "ms) (non-streaming): ", immediateValues);
        init.body = JSON.stringify(immediateValues);
        init.headers['content-type'] = "application/json";
    }
    else {
        const outputStream = new StreamParamEncoder_1.StreamParamEncoder();
        let hasPromiseInBody = false;
        for (let key in body) {
            if (body[key] instanceof Promise) {
                promises.push(body[key].then((val) => {
                    logger.debug(url + ": Send param (" + (Date.now() - startTime) + "ms) (streaming): ", { [key]: val });
                    return outputStream.writeParams({
                        [key]: val
                    });
                }));
                hasPromiseInBody = true;
            }
            else {
                immediateValues[key] = body[key];
            }
        }
        if (hasPromiseInBody) {
            init.body = outputStream.getReadableStream();
            init.headers['content-type'] = "application/x-multiple-json";
            init.duplex = "half";
            logger.debug(url + ": Sending request (" + (Date.now() - startTime) + "ms) (streaming): ", immediateValues);
            promises.push(outputStream.writeParams(immediateValues));
            const abortController = (0, Utils_1.extendAbortController)(signal);
            signal = abortController.signal;
            Promise.all(promises).then(() => outputStream.end()).catch(e => {
                e._inputPromiseError = true;
                abortController.abort(e);
            });
            signal.addEventListener("abort", () => outputStream.end());
        }
        else {
            logger.debug(url + ": Sending request (" + (Date.now() - startTime) + "ms) (non-streaming): ", immediateValues);
            init.body = JSON.stringify(immediateValues);
            init.headers['content-type'] = "application/json";
        }
    }
    if (signal != null)
        init.signal = signal;
    init.headers['accept'] = "application/x-multiple-json";
    const resp = await fetch(url, init).catch(e => {
        if (init.signal != null && e.name === "AbortError") {
            throw init.signal.reason;
        }
        else {
            if (e.message != null)
                e.message += streamRequest ? " (streaming req)" : " (non streaming req)";
            throw e;
        }
    });
    logger.debug(url + ": Response status (" + (Date.now() - startTime) + "ms) " + (streamRequest ? "(streaming req)" : "(non streaming req)") + ": ", resp.status);
    if (resp.status !== 200) {
        let respTxt;
        try {
            respTxt = await resp.text();
        }
        catch (e) {
            throw new RequestError_1.RequestError(resp.statusText, resp.status);
        }
        throw new RequestError_1.RequestError(respTxt, resp.status);
    }
    if (resp.headers.get("content-type") !== "application/x-multiple-json") {
        const respBody = await resp.json();
        logger.debug(url + ": Response read (" + (Date.now() - startTime) + "ms) (non streaming resp): ", respBody);
        return (0, Utils_1.objectMap)(schema, (schemaValue, key) => {
            const value = respBody[key];
            const result = (0, SchemaVerifier_1.verifyField)(schemaValue, value);
            if (result === undefined) {
                return Promise.reject(new Error("Invalid field value"));
            }
            else {
                return Promise.resolve(result);
            }
        });
    }
    else {
        const decoder = new ResponseParamDecoder_1.ResponseParamDecoder(resp, init.signal);
        return (0, Utils_1.objectMap)(schema, (schemaValue, key) => decoder.getParam(key).catch(e => {
            if ((0, SchemaVerifier_1.isOptionalField)(schemaValue))
                return undefined;
            throw e;
        }).then(value => {
            logger.debug(url + ": Response frame read (" + (Date.now() - startTime) + "ms) (streaming resp): ", { [key]: value });
            const result = (0, SchemaVerifier_1.verifyField)(schemaValue, value);
            if (result === undefined) {
                return Promise.reject(new Error("Invalid field value"));
            }
            else {
                return result;
            }
        }));
    }
}
exports.streamingFetchPromise = streamingFetchPromise;
