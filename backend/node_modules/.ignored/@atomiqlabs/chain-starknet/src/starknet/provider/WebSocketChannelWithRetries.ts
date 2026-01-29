import {WebSocketChannel, WebSocketOptions} from "starknet";

/**
 * An impl of WebSocketChannel which override the default exponential backoff and makes it linear
 * Also adds connection timeouts,
 */
export class WebSocketChannelWithRetries extends WebSocketChannel {

    connectionTimeout: any;
    connectionTimeoutMs: number;

    constructor(options: WebSocketOptions & {connectionTimeoutMs?: number}) {
        super(options);
        this.connectionTimeoutMs = options.connectionTimeoutMs ?? 5*1000;

        const websocket = this.websocket;
        this.connectionTimeout = setTimeout(() => {
            console.log(`WebSocketChannelWithRetries: ctor(): Connection not opened in ${this.connectionTimeoutMs}ms, closing...`);
            websocket.close();
        }, this.connectionTimeoutMs);
        websocket.addEventListener("open", () => {
            clearTimeout(this.connectionTimeout);
            (this as any)._processRequestQueue();
        });
    }

    reconnect() {
        (this as any).reconnectAttempts = 1;
        super.reconnect();

        if(this.connectionTimeout!=null) clearTimeout(this.connectionTimeout);

        const websocket = this.websocket;
        this.connectionTimeout = setTimeout(() => {
            console.log(`WebSocketChannelWithRetries: reconnect(): Connection not opened in ${this.connectionTimeoutMs}ms, closing...`);
            websocket.close();
        }, this.connectionTimeoutMs);
        websocket.addEventListener("open", () => {
            clearTimeout(this.connectionTimeout);
        });
    }

}