import { SCToken, TokenAmount } from "../Tokens";
import { ChainType } from "@atomiqlabs/base";
export declare function isSwapWithGasDrop(swap: any): swap is ISwapWithGasDrop<any>;
export interface ISwapWithGasDrop<T extends ChainType> {
    getGasDropOutput(): TokenAmount<T["ChainId"], SCToken<T["ChainId"]>>;
}
