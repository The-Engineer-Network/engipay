import {StarknetChainInterface} from "../chain/StarknetChainInterface";
import {Contract, TypedContractV2} from "starknet";
import {Abi} from "abi-wan-kanabi";
import {StarknetContractEvents} from "./modules/StarknetContractEvents";

/**
 * Base class providing program specific utilities
 */
export class StarknetContractBase<T extends Abi> {

    contract: TypedContractV2<T>;

    public readonly Events: StarknetContractEvents<T>;
    public readonly Chain: StarknetChainInterface;

    constructor(
        chainInterface: StarknetChainInterface,
        contractAddress: string,
        contractAbi: T
    ) {
        this.Chain = chainInterface;
        this.contract = new Contract({
            abi: contractAbi,
            address: contractAddress,
            providerOrAccount: chainInterface.provider
        }).typedv2(contractAbi);
        this.Events = new StarknetContractEvents(chainInterface, this, contractAbi);
    }

}
