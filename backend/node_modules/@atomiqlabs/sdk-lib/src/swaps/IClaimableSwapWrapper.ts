import {ISwap} from "./ISwap";
import {IClaimableSwap} from "./IClaimableSwap";


export interface IClaimableSwapWrapper<T extends ISwap & IClaimableSwap = ISwap & IClaimableSwap> {

    claimableSwapStates: T["state"][];

}