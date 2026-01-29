import {
    RPC08, RPC09,
    RpcProvider,
    RpcProviderOptions
} from "starknet";
import {tryWithRetries} from "../../utils/Utils";

export class Rpc08ChannelWithRetries extends RPC08.RpcChannel {

    readonly retryPolicy?: {
        maxRetries?: number, delay?: number, exponential?: boolean
    };

    constructor(options?: RpcProviderOptions, retryPolicy?: {
        maxRetries?: number, delay?: number, exponential?: boolean
    }) {
        super(options);
        this.retryPolicy = retryPolicy;
    }

    protected fetchEndpoint(method: any, params?: any): Promise<any> {
        return tryWithRetries(() => super.fetchEndpoint(method, params), this.retryPolicy, e => {
            if(!e.message.startsWith("RPC: ")) return false;
            if(e.message.includes("Unsupported method")) return true;
            const arr = e.message.split("\n");
            const errorCode = parseInt(arr[arr.length-1]);
            if(isNaN(errorCode)) return false;
            if(errorCode < 0) return false; //Not defined error, e.g. Rate limit (-32097)
            return true;
        });
    }

}

export class Rpc09ChannelWithRetries extends RPC09.RpcChannel {

    readonly retryPolicy?: {
        maxRetries?: number, delay?: number, exponential?: boolean
    };

    constructor(options?: RpcProviderOptions, retryPolicy?: {
        maxRetries?: number, delay?: number, exponential?: boolean
    }) {
        super(options);
        this.retryPolicy = retryPolicy;
    }

    protected fetchEndpoint(method: any, params?: any): Promise<any> {
        return tryWithRetries(() => super.fetchEndpoint(method, params), this.retryPolicy, e => {
            if(!e.message.startsWith("RPC: ")) return false;
            if(e.message.includes("Unsupported method")) return true;
            const arr = e.message.split("\n");
            const errorCode = parseInt(arr[arr.length-1]);
            if(isNaN(errorCode)) return false;
            if(errorCode < 0) return false; //Not defined error, e.g. Rate limit (-32097)
            return true;
        });
    }

}

export class RpcProviderWithRetries extends RpcProvider {

    /**
     * Tries to do naive detection of the spec version based on the suffix of nodeUrl, better pass the `specVersion`
     *  in the options!
     *
     * @param options
     * @param retryPolicy
     */
    constructor(options?: RpcProviderOptions, retryPolicy?: {
        maxRetries?: number, delay?: number, exponential?: boolean
    }) {
        if(options.specVersion==null) options.specVersion = options.nodeUrl.endsWith("v0_8") ? "0.8.1" : "0.9.0";
        super(options);
        if(this.channel.id==="RPC081") {
            this.channel = new Rpc08ChannelWithRetries({ ...options, waitMode: false }, retryPolicy);
        } else if(this.channel.id==="RPC090") {
            this.channel = new Rpc09ChannelWithRetries({ ...options, waitMode: false }, retryPolicy);
        }
    }

}
