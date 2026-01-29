import { StarknetSwapData } from "../../../StarknetSwapData";
import { ChainSwapType } from "@atomiqlabs/base";
import { BigNumberish } from "starknet";
import { StarknetTx } from "../../../../chain/modules/StarknetTransactions";
import { BitcoinCommitmentData, BitcoinWitnessData, IBitcoinClaimHandler } from "./IBitcoinClaimHandler";
import { StarknetGas } from "../../../../chain/modules/StarknetFees";
export type BitcoinTxIdCommitmentData = {
    txId: string;
};
export declare class BitcoinTxIdClaimHandler extends IBitcoinClaimHandler<BitcoinTxIdCommitmentData, BitcoinWitnessData> {
    static readonly type: ChainSwapType;
    static readonly gas: StarknetGas;
    protected serializeCommitment(data: BitcoinTxIdCommitmentData & BitcoinCommitmentData): BigNumberish[];
    getWitness(signer: string, swapData: StarknetSwapData, witnessData: BitcoinWitnessData, feeRate?: string): Promise<{
        initialTxns: StarknetTx[];
        witness: BigNumberish[];
    }>;
    getGas(data: StarknetSwapData): StarknetGas;
    getType(): ChainSwapType;
}
