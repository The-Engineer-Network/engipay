import { StarknetSwapData } from "../../../StarknetSwapData";
import { ChainSwapType } from "@atomiqlabs/base";
import { BigNumberish } from "starknet";
import { StarknetTx } from "../../../../chain/modules/StarknetTransactions";
import { BitcoinCommitmentData, IBitcoinClaimHandler } from "./IBitcoinClaimHandler";
import { BitcoinOutputWitnessData } from "./BitcoinOutputClaimHandler";
import { Buffer } from "buffer";
import { StarknetGas } from "../../../../chain/modules/StarknetFees";
export type BitcoinNoncedOutputCommitmentData = {
    output: Buffer;
    amount: bigint;
    nonce: bigint;
};
export declare class BitcoinNoncedOutputClaimHandler extends IBitcoinClaimHandler<BitcoinNoncedOutputCommitmentData, BitcoinOutputWitnessData> {
    static readonly type: ChainSwapType;
    static readonly gas: StarknetGas;
    protected serializeCommitment(data: BitcoinNoncedOutputCommitmentData & BitcoinCommitmentData): BigNumberish[];
    getWitness(signer: string, swapData: StarknetSwapData, witnessData: BitcoinOutputWitnessData, feeRate?: string): Promise<{
        initialTxns: StarknetTx[];
        witness: BigNumberish[];
    }>;
    getGas(data: StarknetSwapData): StarknetGas;
    getType(): ChainSwapType;
}
