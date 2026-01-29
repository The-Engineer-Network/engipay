import { ChainSwapType } from "@atomiqlabs/base";
import { IHandler } from "../IHandler";
import { BigNumberish } from "starknet";
import { StarknetGas } from "../../../chain/modules/StarknetFees";
export interface IClaimHandler<C, W> extends IHandler<C, W> {
    getType(): ChainSwapType;
    parseWitnessResult(result: BigNumberish[]): string;
}
export type ClaimHandlerType = {
    gas: StarknetGas;
    type: ChainSwapType;
} & (new (address: string) => IClaimHandler<any, any>);
export declare const claimHandlersList: ClaimHandlerType[];
