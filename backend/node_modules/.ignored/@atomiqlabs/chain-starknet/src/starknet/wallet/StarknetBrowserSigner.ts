import {StarknetSigner} from "./StarknetSigner";
import {Account} from "starknet";


export class StarknetBrowserSigner extends StarknetSigner {

    constructor(account: Account) {
        super(account, false);
        this.signTransaction = null;
    }

}