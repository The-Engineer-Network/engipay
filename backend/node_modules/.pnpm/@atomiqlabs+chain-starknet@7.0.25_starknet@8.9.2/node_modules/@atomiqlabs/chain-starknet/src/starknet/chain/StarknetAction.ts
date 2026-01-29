import {Call} from "starknet";
import {StarknetChainInterface} from "./StarknetChainInterface";
import {StarknetTx} from "./modules/StarknetTransactions";
import {StarknetGas, starknetGasAdd} from "./modules/StarknetFees";

export class StarknetAction {

    gas: StarknetGas;
    readonly mainSigner: string;
    private readonly root: StarknetChainInterface;
    private readonly instructions: Call[];
    private feeRate: string;

    constructor(
        mainSigner: string,
        root: StarknetChainInterface,
        instructions: Call[] | Call = [],
        gasLimit?: StarknetGas,
        feeRate?: string
    ) {
        this.mainSigner = mainSigner;
        this.root = root;
        this.instructions = Array.isArray(instructions) ? instructions : [instructions];
        this.gas = {
            l1Gas: gasLimit?.l1Gas ?? 0,
            l2Gas: gasLimit?.l2Gas ?? 0,
            l1DataGas: gasLimit?.l1DataGas ?? 0,
        };
        this.feeRate = feeRate;
    }

    private estimateFeeRate(): Promise<string> {
        return this.root.Fees.getFeeRate();
    }

    public addIx(instruction: Call, gasLimit?: StarknetGas) {
        this.instructions.push(instruction);
        this.gas = starknetGasAdd(this.gas, gasLimit);
    }

    public add(action: StarknetAction): this {
        return this.addAction(action);
    }

    public addAction(action: StarknetAction, index: number = this.instructions.length): this {
        if(action.mainSigner!==this.mainSigner) throw new Error("Actions need to have the same signer!");
        if(this.gas.l1Gas==null && action.gas.l1Gas!=null) this.gas.l1Gas = action.gas.l1Gas;
        if(this.gas.l2Gas==null && action.gas.l2Gas!=null) this.gas.l2Gas = action.gas.l2Gas;
        if(this.gas.l1DataGas==null && action.gas.l1DataGas!=null) this.gas.l1DataGas = action.gas.l1DataGas;
        if(this.gas.l1Gas!=null && action.gas.l1Gas!=null) this.gas.l1Gas += action.gas.l1Gas;
        if(this.gas.l2Gas!=null && action.gas.l2Gas!=null) this.gas.l2Gas += action.gas.l2Gas;
        if(this.gas.l1DataGas!=null && action.gas.l1DataGas!=null) this.gas.l1DataGas += action.gas.l1DataGas;
        this.instructions.splice(index, 0, ...action.instructions);
        if(this.feeRate==null) this.feeRate = action.feeRate;
        return this;
    }

    public async tx(feeRate?: string): Promise<StarknetTx> {
        if(feeRate==null) feeRate = this.feeRate;
        if(feeRate==null) feeRate = await this.estimateFeeRate();

        return {
            type: "INVOKE",
            tx: this.instructions,
            details: {
                ...this.root.Fees.getFeeDetails(this.gas, feeRate),
                walletAddress: this.mainSigner,
                cairoVersion: "1",
                chainId: this.root.starknetChainId,
                nonce: null,
                accountDeploymentData: [],
                skipValidate: false
            }
        };
    }

    public async addToTxs(txs: StarknetTx[], feeRate?: string): Promise<void> {
        txs.push(await this.tx(feeRate));
    }

    public ixsLength(): number {
        return this.instructions.length;
    }

}
