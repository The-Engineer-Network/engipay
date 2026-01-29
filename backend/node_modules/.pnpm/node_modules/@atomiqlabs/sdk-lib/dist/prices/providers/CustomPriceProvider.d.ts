import { CoinType, CtorCoinTypes, IPriceProvider } from "../abstract/IPriceProvider";
import { MultiChain } from "../../swaps/swapper/Swapper";
export type CustomPriceFunction = (tickers: string[], abortSignal?: AbortSignal) => Promise<number[]>;
export declare class CustomPriceProvider<T extends MultiChain> extends IPriceProvider<T> {
    readonly getUsdPriceFn: CustomPriceFunction;
    constructor(coinsMap: CtorCoinTypes<T>, getUsdPriceFn: CustomPriceFunction);
    protected fetchPrice(token: CoinType, abortSignal?: AbortSignal): Promise<bigint>;
    protected fetchUsdPrice(abortSignal?: AbortSignal): Promise<number>;
}
