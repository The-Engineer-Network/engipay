import { RPC08, RPC09, RpcProvider, RpcProviderOptions } from "starknet";
export declare class Rpc08ChannelWithRetries extends RPC08.RpcChannel {
    readonly retryPolicy?: {
        maxRetries?: number;
        delay?: number;
        exponential?: boolean;
    };
    constructor(options?: RpcProviderOptions, retryPolicy?: {
        maxRetries?: number;
        delay?: number;
        exponential?: boolean;
    });
    protected fetchEndpoint(method: any, params?: any): Promise<any>;
}
export declare class Rpc09ChannelWithRetries extends RPC09.RpcChannel {
    readonly retryPolicy?: {
        maxRetries?: number;
        delay?: number;
        exponential?: boolean;
    };
    constructor(options?: RpcProviderOptions, retryPolicy?: {
        maxRetries?: number;
        delay?: number;
        exponential?: boolean;
    });
    protected fetchEndpoint(method: any, params?: any): Promise<any>;
}
export declare class RpcProviderWithRetries extends RpcProvider {
    /**
     * Tries to do naive detection of the spec version based on the suffix of nodeUrl, better pass the `specVersion`
     *  in the options!
     *
     * @param options
     * @param retryPolicy
     */
    constructor(options?: RpcProviderOptions, retryPolicy?: {
        maxRetries?: number;
        delay?: number;
        exponential?: boolean;
    });
}
