import { StarknetSigner } from "./StarknetSigner";
import { Account } from "starknet";
export declare class StarknetBrowserSigner extends StarknetSigner {
    constructor(account: Account);
}
