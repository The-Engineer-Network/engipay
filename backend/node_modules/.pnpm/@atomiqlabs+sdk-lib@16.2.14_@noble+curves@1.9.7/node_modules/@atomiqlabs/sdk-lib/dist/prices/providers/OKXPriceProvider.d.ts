import { CtorCoinTypes } from "../abstract/IPriceProvider";
import { ExchangePriceProvider } from "./abstract/ExchangePriceProvider";
import { MultiChain } from "../../swaps/swapper/Swapper";
export type OKXResponse = {
    code: string;
    msg: string;
    data: [
        {
            instId: string;
            idxPx: string;
            high24h: string;
            sodUtc0: string;
            open24h: string;
            low24h: string;
            sodUtc8: string;
            ts: string;
        }
    ];
};
export declare class OKXPriceProvider<T extends MultiChain> extends ExchangePriceProvider<T> {
    constructor(coinsMap: CtorCoinTypes<T>, url?: string, httpRequestTimeout?: number);
    fetchPair(pair: string, abortSignal?: AbortSignal): Promise<number>;
    protected fetchUsdPrice(abortSignal?: AbortSignal): Promise<number>;
}
