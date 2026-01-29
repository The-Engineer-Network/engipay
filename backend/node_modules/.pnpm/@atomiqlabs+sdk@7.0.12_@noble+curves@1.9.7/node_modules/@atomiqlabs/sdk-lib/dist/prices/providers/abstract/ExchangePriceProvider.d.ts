import { HttpPriceProvider } from "./HttpPriceProvider";
import { CoinType } from "../../abstract/IPriceProvider";
import { MultiChain } from "../../../swaps/swapper/Swapper";
export declare abstract class ExchangePriceProvider<T extends MultiChain> extends HttpPriceProvider<T> {
    /**
     * Fetches the price on the specific exchange pair
     *
     * @param pair
     * @param abortSignal
     * @protected
     */
    protected abstract fetchPair(pair: string, abortSignal?: AbortSignal): Promise<number>;
    protected fetchPrice(token: CoinType, abortSignal?: AbortSignal): Promise<bigint>;
}
