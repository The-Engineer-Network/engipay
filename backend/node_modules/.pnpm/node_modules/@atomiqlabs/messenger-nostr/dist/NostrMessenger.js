"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NostrMessenger = void 0;
const base_1 = require("@atomiqlabs/base");
const pure_1 = require("nostr-tools/pure");
const pure_2 = require("nostr-tools/pure");
const MessageDeduplicator_1 = require("./MessageDeduplicator");
const abstract_pool_1 = require("nostr-tools/abstract-pool");
const KINDS = {
    [base_1.BitcoinNetwork.MAINNET]: 28643,
    [base_1.BitcoinNetwork.TESTNET]: 28644,
    [base_1.BitcoinNetwork.TESTNET4]: 28645,
    [base_1.BitcoinNetwork.REGTEST]: 28646,
};
class NostrMessenger {
    constructor(network, relays, options) {
        this.callbacks = [];
        this.messageDeduplicator = new MessageDeduplicator_1.MessageDeduplicator();
        this.stopped = true;
        this.subscribed = false;
        options ??= {};
        options.wsImplementation ??= typeof window !== "undefined" && typeof window.WebSocket !== "undefined" ? window.WebSocket : require("ws");
        this.network = network;
        this.secretKey = (0, pure_1.generateSecretKey)();
        this.relays = relays;
        this.pool = new abstract_pool_1.AbstractSimplePool({
            websocketImplementation: options?.wsImplementation,
            verifyEvent: pure_2.verifyEvent,
            enablePing: true
        });
        this.reconnectTimeout = options?.reconnectTimeout ?? 15 * 1000;
    }
    warmup() {
        return Promise.any(this.relays.map(relay => this.pool.ensureRelay(relay))).then(val => { });
    }
    async broadcast(msg) {
        const signedEvent = (0, pure_1.finalizeEvent)({
            kind: KINDS[this.network],
            created_at: Math.floor(Date.now() / 1000),
            tags: [],
            content: JSON.stringify(msg.serialize())
        }, this.secretKey);
        await Promise.any(this.pool.publish(this.relays, signedEvent));
    }
    init() {
        this.stopped = false;
        return Promise.resolve(undefined);
    }
    stop() {
        this.stopped = true;
        this.pool.destroy();
        return Promise.resolve(undefined);
    }
    async connectRelay(relayUrl) {
        if (this.stopped)
            return;
        let relay;
        try {
            relay = await this.pool.ensureRelay(relayUrl);
        }
        catch (e) {
            console.error("NostrMessenger: connectRelay(" + relayUrl + "): Error on relay connection: ", e);
            this.pool.close([relayUrl]);
            setTimeout(() => this.connectRelay(relayUrl), this.reconnectTimeout);
            return;
        }
        relay.onclose = () => {
            console.error("NostrMessenger: connectRelay(" + relayUrl + "): Connection closed!");
        };
        relay.subscribe([{ kinds: [KINDS[this.network]] }], {
            onevent: (event) => {
                if (this.messageDeduplicator.isDuplicate(event.id))
                    return;
                try {
                    const rawObj = JSON.parse(event.content);
                    const message = base_1.Message.deserialize(rawObj);
                    for (let callback of this.callbacks) {
                        callback(message);
                    }
                }
                catch (e) { }
            },
            onclose: (reason) => {
                console.error("NostrMessenger: connectRelay(" + relayUrl + "): Error on relay subscription: " + reason);
                this.pool.close([relayUrl]);
                setTimeout(() => this.connectRelay(relayUrl), this.reconnectTimeout);
            }
        });
    }
    async initSubscribe() {
        if (this.subscribed)
            return;
        this.subscribed = true;
        await Promise.all(this.relays.map(relay => this.connectRelay(relay)));
    }
    async subscribe(callback) {
        if (this.stopped)
            throw new Error("Already stopped or not initialized!");
        await this.initSubscribe();
        this.callbacks.push(callback);
    }
    unsubscribe(callback) {
        const position = this.callbacks.indexOf(callback);
        if (position === -1)
            return Promise.resolve(false);
        this.callbacks.splice(position, 1);
        return Promise.resolve(true);
    }
}
exports.NostrMessenger = NostrMessenger;
