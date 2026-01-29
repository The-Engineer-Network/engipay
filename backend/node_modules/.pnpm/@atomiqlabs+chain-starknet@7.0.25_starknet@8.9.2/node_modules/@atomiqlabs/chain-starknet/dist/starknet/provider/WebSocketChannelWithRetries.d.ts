import { WebSocketChannel, WebSocketOptions } from "starknet";
/**
 * An impl of WebSocketChannel which override the default exponential backoff and makes it linear
 * Also adds connection timeouts,
 */
export declare class WebSocketChannelWithRetries extends WebSocketChannel {
    connectionTimeout: any;
    connectionTimeoutMs: number;
    constructor(options: WebSocketOptions & {
        connectionTimeoutMs?: number;
    });
    reconnect(): void;
}
