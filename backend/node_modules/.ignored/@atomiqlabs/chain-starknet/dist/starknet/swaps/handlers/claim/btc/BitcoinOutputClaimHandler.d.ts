import { StarknetSwapData } from "../../../StarknetSwapData";
import { ChainSwapType } from "@atomiqlabs/base";
import { BigNumberish } from "starknet";
import { StarknetTx } from "../../../../chain/modules/StarknetTransactions";
import { BitcoinCommitmentData, BitcoinWitnessData, IBitcoinClaimHandler } from "./IBitcoinClaimHandler";
import { Buffer } from "buffer";
import { StarknetGas } from "../../../../chain/modules/StarknetFees";
export type BitcoinOutputCommitmentData = {
    output: Buffer;
    amount: bigint;
};
export type BitcoinOutputWitnessData = BitcoinWitnessData & {
    vout: number;
};
export declare class BitcoinOutputClaimHandler extends IBitcoinClaimHandler<BitcoinOutputCommitmentData, BitcoinOutputWitnessData> {
    static readonly type: ChainSwapType;
    static readonly gas: StarknetGas;
    protected serializeCommitment(data: BitcoinOutputCommitmentData & BitcoinCommitmentData): BigNumberish[];
    getWitness(signer: string, swapData: StarknetSwapData, witnessData: BitcoinOutputWitnessData, feeRate?: string): Promise<{
        initialTxns: StarknetTx[];
        witness: BigNumberish[];
    }>;
    getGas(data: StarknetSwapData): StarknetGas;
    getType(): ChainSwapType;
}
