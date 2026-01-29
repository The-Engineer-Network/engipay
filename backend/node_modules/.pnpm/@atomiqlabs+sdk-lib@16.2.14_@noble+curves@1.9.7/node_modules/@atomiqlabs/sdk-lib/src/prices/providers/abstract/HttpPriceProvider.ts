import {CtorCoinTypes, IPriceProvider} from "../../abstract/IPriceProvider";
import {MultiChain} from "../../../swaps/swapper/Swapper";

export abstract class HttpPriceProvider<T extends MultiChain> extends IPriceProvider<T> {

    url: string;
    httpRequestTimeout?: number;

    protected constructor(coinsMap: CtorCoinTypes<T>, url: string, httpRequestTimeout?: number) {
        super(coinsMap);
        this.url = url;
        this.httpRequestTimeout = httpRequestTimeout;
    }

}