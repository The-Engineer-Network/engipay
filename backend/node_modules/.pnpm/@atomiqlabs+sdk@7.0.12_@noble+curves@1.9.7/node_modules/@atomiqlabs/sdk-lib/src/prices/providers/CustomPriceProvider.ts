import {CoinType, CtorCoinTypes, IPriceProvider} from "../abstract/IPriceProvider";
import {MultiChain} from "../../swaps/swapper/Swapper";

export type CustomPriceFunction = (tickers: string[], abortSignal?: AbortSignal) => Promise<number[]>;

export class CustomPriceProvider<T extends MultiChain> extends IPriceProvider<T> {

    readonly getUsdPriceFn: CustomPriceFunction;

    constructor(coinsMap: CtorCoinTypes<T>, getUsdPriceFn: CustomPriceFunction) {
        super(coinsMap);
        this.getUsdPriceFn = getUsdPriceFn;
    }

    protected async fetchPrice(token: CoinType, abortSignal?: AbortSignal): Promise<bigint> {
        const [btcPrice, tokenPrice] = await this.getUsdPriceFn(["BTC",token.coinId], abortSignal);
        const priceInBtc = tokenPrice / btcPrice;
        return BigInt(Math.floor(priceInBtc*100_000_000*1_000_000));
    }

    protected async fetchUsdPrice(abortSignal?: AbortSignal): Promise<number> {
        const [btcPrice] = await this.getUsdPriceFn(["BTC"], abortSignal);
        return btcPrice / 100_000_000;
    }

}
