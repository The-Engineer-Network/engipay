"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcProviderWithRetries = exports.Rpc09ChannelWithRetries = exports.Rpc08ChannelWithRetries = void 0;
const starknet_1 = require("starknet");
const Utils_1 = require("../../utils/Utils");
class Rpc08ChannelWithRetries extends starknet_1.RPC08.RpcChannel {
    constructor(options, retryPolicy) {
        super(options);
        this.retryPolicy = retryPolicy;
    }
    fetchEndpoint(method, params) {
        return (0, Utils_1.tryWithRetries)(() => super.fetchEndpoint(method, params), this.retryPolicy, e => {
            if (!e.message.startsWith("RPC: "))
                return false;
            if (e.message.includes("Unsupported method"))
                return true;
            const arr = e.message.split("\n");
            const errorCode = parseInt(arr[arr.length - 1]);
            if (isNaN(errorCode))
                return false;
            if (errorCode < 0)
                return false; //Not defined error, e.g. Rate limit (-32097)
            return true;
        });
    }
}
exports.Rpc08ChannelWithRetries = Rpc08ChannelWithRetries;
class Rpc09ChannelWithRetries extends starknet_1.RPC09.RpcChannel {
    constructor(options, retryPolicy) {
        super(options);
        this.retryPolicy = retryPolicy;
    }
    fetchEndpoint(method, params) {
        return (0, Utils_1.tryWithRetries)(() => super.fetchEndpoint(method, params), this.retryPolicy, e => {
            if (!e.message.startsWith("RPC: "))
                return false;
            if (e.message.includes("Unsupported method"))
                return true;
            const arr = e.message.split("\n");
            const errorCode = parseInt(arr[arr.length - 1]);
            if (isNaN(errorCode))
                return false;
            if (errorCode < 0)
                return false; //Not defined error, e.g. Rate limit (-32097)
            return true;
        });
    }
}
exports.Rpc09ChannelWithRetries = Rpc09ChannelWithRetries;
class RpcProviderWithRetries extends starknet_1.RpcProvider {
    /**
     * Tries to do naive detection of the spec version based on the suffix of nodeUrl, better pass the `specVersion`
     *  in the options!
     *
     * @param options
     * @param retryPolicy
     */
    constructor(options, retryPolicy) {
        if (options.specVersion == null)
            options.specVersion = options.nodeUrl.endsWith("v0_8") ? "0.8.1" : "0.9.0";
        super(options);
        if (this.channel.id === "RPC081") {
            this.channel = new Rpc08ChannelWithRetries({ ...options, waitMode: false }, retryPolicy);
        }
        else if (this.channel.id === "RPC090") {
            this.channel = new Rpc09ChannelWithRetries({ ...options, waitMode: false }, retryPolicy);
        }
    }
}
exports.RpcProviderWithRetries = RpcProviderWithRetries;
