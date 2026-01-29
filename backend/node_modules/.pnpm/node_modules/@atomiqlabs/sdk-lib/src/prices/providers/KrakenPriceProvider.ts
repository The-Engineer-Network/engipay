import {CoinType, CtorCoinTypes} from "../abstract/IPriceProvider";
import {ExchangePriceProvider} from "./abstract/ExchangePriceProvider";
import {httpGet} from "../../utils/Utils";
import {MultiChain} from "../../swaps/swapper/Swapper";

export type KrakenResponse = {
    error: string[];
    result: {
        [ticker: string]: {
            a: [string, string, string],
            b: [string, string, string],
            c: [string, string],
            v: [string, string],
            p: [string, string],
            t: [number, number],
            l: [string, string],
            h: [string, string],
            o: string
        }
    }
};

export class KrakenPriceProvider<T extends MultiChain> extends ExchangePriceProvider<T> {

    constructor(coinsMap: CtorCoinTypes<T>, url: string = "https://api.kraken.com/0", httpRequestTimeout?: number) {
        super(coinsMap, url, httpRequestTimeout);
    }

    protected async fetchPair(pair: string, abortSignal?: AbortSignal) {
        const response = await httpGet<KrakenResponse>(
            this.url+"/public/Ticker?pair="+pair,
            this.httpRequestTimeout,
            abortSignal
        );

        return parseFloat(response.result[pair].c[0]);
    }

    protected async fetchUsdPrice(abortSignal?: AbortSignal): Promise<number> {
        const response = await httpGet<KrakenResponse>(
            this.url+"/public/Ticker?pair=XBTUSDC",
            this.httpRequestTimeout,
            abortSignal
        );

        return parseFloat(response.result["XBTUSDC"].c[0])/100000000;
    }

    protected async fetchPrice(token: CoinType, abortSignal?: AbortSignal): Promise<bigint> {
        const pairs: string[] = token.coinId.split(";");

        const response = await httpGet<KrakenResponse>(
            this.url+"/public/Ticker?pair="+pairs.map(val => val.startsWith("!") ? val.substring(1) : val).join(","),
            this.httpRequestTimeout,
            abortSignal
        );

        const prices: number[] = pairs.map(pair => {
            let invert = pair.startsWith("!");
            if(invert) pair = pair.substring(1);
            const value = parseFloat(response.result[pair].c[0]);
            return invert ? 1/value : value;
        });

        const price = prices.reduce((previousValue, currentValue) => previousValue * currentValue, 1);

        return BigInt(Math.floor(price*100000000000000));
    }

}
