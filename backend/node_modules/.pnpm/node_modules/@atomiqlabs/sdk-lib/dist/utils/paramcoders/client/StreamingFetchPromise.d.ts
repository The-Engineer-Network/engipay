import { RequestSchema, RequestSchemaResultPromise } from "../SchemaVerifier";
export type RequestBody = {
    [key: string]: Promise<any> | any;
};
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
export declare function streamingFetchPromise<T extends RequestSchema>(url: string, body: RequestBody, schema: T, timeout?: number, signal?: AbortSignal, streamRequest?: boolean): Promise<RequestSchemaResultPromise<T>>;
