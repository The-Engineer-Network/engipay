import {Abi} from "abi-wan-kanabi";
import {StarknetContractBase} from "./StarknetContractBase";
import {StarknetChainInterface} from "../chain/StarknetChainInterface";
import {StarknetModule} from "../chain/StarknetModule";


export class StarknetContractModule<TAbi extends Abi> extends StarknetModule {

    readonly contract: StarknetContractBase<TAbi>;

    constructor(chainInterface: StarknetChainInterface, contract: StarknetContractBase<TAbi>) {
        super(chainInterface)
        this.contract = contract;
    }

}
