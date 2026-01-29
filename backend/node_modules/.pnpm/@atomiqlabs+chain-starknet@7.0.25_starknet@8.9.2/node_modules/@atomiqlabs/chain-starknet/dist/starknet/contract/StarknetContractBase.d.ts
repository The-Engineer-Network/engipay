import { StarknetChainInterface } from "../chain/StarknetChainInterface";
import { TypedContractV2 } from "starknet";
import { Abi } from "abi-wan-kanabi";
import { StarknetContractEvents } from "./modules/StarknetContractEvents";
/**
 * Base class providing program specific utilities
 */
export declare class StarknetContractBase<T extends Abi> {
    contract: TypedContractV2<T>;
    readonly Events: StarknetContractEvents<T>;
    readonly Chain: StarknetChainInterface;
    constructor(chainInterface: StarknetChainInterface, contractAddress: string, contractAbi: T);
}
