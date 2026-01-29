import { CoinType, CtorCoinTypes } from "../abstract/IPriceProvider";
import { HttpPriceProvider } from "./abstract/HttpPriceProvider";
import { MultiChain } from "../../swaps/swapper/Swapper";
export type CoinPaprikaResponse<Currency extends string> = {
    quotes: {
        [curr in Currency]: {
            price: number;
        };
    };
};
export declare class CoinPaprikaPriceProvider<T extends MultiChain> extends HttpPriceProvider<T> {
    constructor(coinsMap: CtorCoinTypes<T>, url?: string, httpRequestTimeout?: number);
    fetchPrice(token: CoinType, abortSignal?: AbortSignal): Promise<bigint>;
    protected fetchUsdPrice(abortSignal?: AbortSignal): Promise<number>;
}
