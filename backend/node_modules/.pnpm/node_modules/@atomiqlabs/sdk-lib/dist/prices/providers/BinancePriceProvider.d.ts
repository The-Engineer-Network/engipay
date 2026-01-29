import { CtorCoinTypes } from "../abstract/IPriceProvider";
import { ExchangePriceProvider } from "./abstract/ExchangePriceProvider";
import { MultiChain } from "../../swaps/swapper/Swapper";
export type BinanceResponse = {
    symbol: string;
    price: string;
};
export declare class BinancePriceProvider<T extends MultiChain> extends ExchangePriceProvider<T> {
    constructor(coinsMap: CtorCoinTypes<T>, url?: string, httpRequestTimeout?: number);
    protected fetchPair(pair: string, abortSignal?: AbortSignal): Promise<number>;
    protected fetchUsdPrice(abortSignal?: AbortSignal): Promise<number>;
}
