import {StarknetSwapData} from "../StarknetSwapData";
import {BigNumberish} from "starknet";
import {StarknetTx} from "../../chain/modules/StarknetTransactions";
import {StarknetGas} from "../../chain/modules/StarknetFees";


export interface IHandler<TCommitmentData, TWitnessData> {

    readonly address: string;

    getCommitment(data: TCommitmentData): BigNumberish;

    getWitness(signer: string, data: StarknetSwapData, witnessData: TWitnessData, feeRate?: string): Promise<{
        initialTxns: StarknetTx[],
        witness: BigNumberish[]
    }>;

    getGas(data: StarknetSwapData): StarknetGas;

}
