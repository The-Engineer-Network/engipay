import {StarknetSwapContract} from "./StarknetSwapContract";
import {TypedContractV2} from "starknet";
import {EscrowManagerAbi} from "./EscrowManagerAbi";
import {StarknetChainInterface} from "../chain/StarknetChainInterface";
import {StarknetContractModule} from "../contract/StarknetContractModule";

export class StarknetSwapModule extends StarknetContractModule<typeof EscrowManagerAbi> {

    readonly contract: StarknetSwapContract;
    readonly swapContract: TypedContractV2<typeof EscrowManagerAbi>;

    constructor(chainInterface: StarknetChainInterface, contract: StarknetSwapContract) {
        super(chainInterface, contract);
        this.swapContract = contract.contract;
    }

}
