import {SCToken, TokenAmount} from "../Tokens";
import {ChainType} from "@atomiqlabs/base";

export function isSwapWithGasDrop(swap: any): swap is ISwapWithGasDrop<any> {
    return swap!=null && typeof(swap.getGasDropOutput)==="function";
}

export interface ISwapWithGasDrop<T extends ChainType> {
    getGasDropOutput(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
}
