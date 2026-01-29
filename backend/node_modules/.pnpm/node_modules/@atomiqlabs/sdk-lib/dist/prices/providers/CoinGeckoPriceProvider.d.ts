import { CoinType, CtorCoinTypes } from "../abstract/IPriceProvider";
import { HttpPriceProvider } from "./abstract/HttpPriceProvider";
import { MultiChain } from "../../swaps/swapper/Swapper";
export type CoinGeckoResponse<Currency extends string> = {
    [coinId: string]: {
        [c in Currency]: number;
    };
};
export declare class CoinGeckoPriceProvider<T extends MultiChain> extends HttpPriceProvider<T> {
    constructor(coinsMap: CtorCoinTypes<T>, url?: string, httpRequestTimeout?: number);
    protected fetchPrice(token: CoinType, abortSignal?: AbortSignal): Promise<bigint>;
    protected fetchUsdPrice(abortSignal?: AbortSignal): Promise<number>;
}
