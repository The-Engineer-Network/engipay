/// <reference types="node" />
/// <reference types="node" />
import { Buffer } from "buffer";
type Constructor<T = any> = new (...args: any[]) => T;
export type LoggerType = {
    debug: (msg: string, ...args: any[]) => void;
    info: (msg: string, ...args: any[]) => void;
    warn: (msg: string, ...args: any[]) => void;
    error: (msg: string, ...args: any[]) => void;
};
export declare function getLogger(prefix: string): LoggerType;
/**
 * Returns a promise that resolves when any of the passed promises resolves, and rejects if all the underlying
 *  promises fail with an array of errors returned by the respective promises
 *
 * @param promises
 */
export declare function promiseAny<T>(promises: Promise<T>[]): Promise<T>;
/**
 * Maps a JS object to another JS object based on the translation function, the translation function is called for every
 *  property (value/key) of the old object and returns the new value of for this property
 *
 * @param obj
 * @param translator
 */
export declare function objectMap<InputObject extends {
    [key in string]: any;
}, OutputObject extends {
    [key in keyof InputObject]: any;
}>(obj: InputObject, translator: <InputKey extends Extract<keyof InputObject, string>>(value: InputObject[InputKey], key: InputKey) => OutputObject[InputKey]): {
    [key in keyof InputObject]: OutputObject[key];
};
/**
 * Maps the entries from the map to the array using the translator function
 *
 * @param map
 * @param translator
 */
export declare function mapToArray<K, V, Output>(map: Map<K, V>, translator: (key: K, value: V) => Output): Output[];
/**
 * Creates a new abort controller that will abort if the passed abort signal aborts
 *
 * @param abortSignal
 */
export declare function extendAbortController(abortSignal?: AbortSignal): AbortController;
/**
 * Runs the passed function multiple times if it fails
 *
 * @param func A callback for executing the action
 * @param func.retryCount Count of the current retry, starting from 0 for original request and increasing
 * @param retryPolicy Retry policy
 * @param retryPolicy.maxRetries How many retries to attempt in total
 * @param retryPolicy.delay How long should the delay be
 * @param retryPolicy.exponential Whether to use exponentially increasing delays
 * @param errorAllowed A callback for determining whether a given error is allowed, and we should therefore not retry
 * @param abortSignal
 * @returns Result of the action executing callback
 */
export declare function tryWithRetries<T>(func: (retryCount?: number) => Promise<T>, retryPolicy?: {
    maxRetries?: number;
    delay?: number;
    exponential?: boolean;
}, errorAllowed?: ((e: any) => boolean) | Constructor<Error> | Constructor<Error>[], abortSignal?: AbortSignal): Promise<T>;
/**
 * Mimics fetch API byt adds a timeout to the request
 *
 * @param input
 * @param init
 */
export declare function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit & {
    timeout?: number;
}): Promise<Response>;
/**
 * Sends an HTTP GET request through a fetch API, handles non 200 response codes as errors
 * @param url Send request to this URL
 * @param timeout Timeout (in milliseconds) for the request to conclude
 * @param abortSignal
 * @param allowNon200 Whether to allow non-200 status code HTTP responses
 * @throws {RequestError} if non 200 response code was returned or body cannot be parsed
 */
export declare function httpGet<T>(url: string, timeout?: number, abortSignal?: AbortSignal, allowNon200?: boolean): Promise<T>;
/**
 * Sends an HTTP POST request through a fetch API, handles non 200 response codes as errors
 * @param url Send request to this URL
 * @param body A HTTP request body to send to the server
 * @param timeout Timeout (in milliseconds) for the request to conclude
 * @param abortSignal
 * @throws {RequestError} if non 200 response code was returned
 */
export declare function httpPost<T>(url: string, body: any, timeout?: number, abortSignal?: AbortSignal): Promise<T>;
/**
 * Returns a promise that resolves after given amount seconds
 *
 * @param timeout how many milliseconds to wait for
 * @param abortSignal
 */
export declare function timeoutPromise(timeout: number, abortSignal?: AbortSignal): Promise<void>;
/**
 * Returns an abort signal that aborts after a specified timeout in milliseconds
 *
 * @param timeout Milliseconds to wait
 * @param abortReason Abort with this abort reason
 * @param abortSignal Abort signal to extend
 */
export declare function timeoutSignal(timeout: number, abortReason?: any, abortSignal?: AbortSignal): AbortSignal;
export declare function bigIntMin(a: bigint, b: bigint): bigint;
export declare function bigIntMax(a: bigint, b: bigint): bigint;
export declare function bigIntCompare(a: bigint, b: bigint): -1 | 0 | 1;
export declare function randomBytes(bytesLength: number): Buffer;
export {};
