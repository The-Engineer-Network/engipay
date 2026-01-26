import { CoinType, CtorCoinTypes } from "../abstract/IPriceProvider";
import { ExchangePriceProvider } from "./abstract/ExchangePriceProvider";
import { MultiChain } from "../../swaps/swapper/Swapper";
export type KrakenResponse = {
    error: string[];
    result: {
        [ticker: string]: {
            a: [string, string, string];
            b: [string, string, string];
            c: [string, string];
            v: [string, string];
            p: [string, string];
            t: [number, number];
            l: [string, string];
            h: [string, string];
            o: string;
        };
    };
};
export declare class KrakenPriceProvider<T extends MultiChain> extends ExchangePriceProvider<T> {
    constructor(coinsMap: CtorCoinTypes<T>, url?: string, httpRequestTimeout?: number);
    protected fetchPair(pair: string, abortSignal?: AbortSignal): Promise<number>;
    protected fetchUsdPrice(abortSignal?: AbortSignal): Promise<number>;
    protected fetchPrice(token: CoinType, abortSignal?: AbortSignal): Promise<bigint>;
}
