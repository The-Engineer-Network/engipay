import { Call } from "starknet";
import { StarknetChainInterface } from "./StarknetChainInterface";
import { StarknetTx } from "./modules/StarknetTransactions";
import { StarknetGas } from "./modules/StarknetFees";
export declare class StarknetAction {
    gas: StarknetGas;
    readonly mainSigner: string;
    private readonly root;
    private readonly instructions;
    private feeRate;
    constructor(mainSigner: string, root: StarknetChainInterface, instructions?: Call[] | Call, gasLimit?: StarknetGas, feeRate?: string);
    private estimateFeeRate;
    addIx(instruction: Call, gasLimit?: StarknetGas): void;
    add(action: StarknetAction): this;
    addAction(action: StarknetAction, index?: number): this;
    tx(feeRate?: string): Promise<StarknetTx>;
    addToTxs(txs: StarknetTx[], feeRate?: string): Promise<void>;
    ixsLength(): number;
}
