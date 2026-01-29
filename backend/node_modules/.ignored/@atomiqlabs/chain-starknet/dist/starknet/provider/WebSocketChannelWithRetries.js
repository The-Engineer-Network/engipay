"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketChannelWithRetries = void 0;
const starknet_1 = require("starknet");
/**
 * An impl of WebSocketChannel which override the default exponential backoff and makes it linear
 * Also adds connection timeouts,
 */
class WebSocketChannelWithRetries extends starknet_1.WebSocketChannel {
    constructor(options) {
        super(options);
        this.connectionTimeoutMs = options.connectionTimeoutMs ?? 5 * 1000;
        const websocket = this.websocket;
        this.connectionTimeout = setTimeout(() => {
            console.log(`WebSocketChannelWithRetries: ctor(): Connection not opened in ${this.connectionTimeoutMs}ms, closing...`);
            websocket.close();
        }, this.connectionTimeoutMs);
        websocket.addEventListener("open", () => {
            clearTimeout(this.connectionTimeout);
            this._processRequestQueue();
        });
    }
    reconnect() {
        this.reconnectAttempts = 1;
        super.reconnect();
        if (this.connectionTimeout != null)
            clearTimeout(this.connectionTimeout);
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
exports.WebSocketChannelWithRetries = WebSocketChannelWithRetries;
