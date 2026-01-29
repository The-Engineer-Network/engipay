import { IClaimHandler } from "../ClaimHandlers";
import { StarknetSwapData } from "../../../StarknetSwapData";
import { ChainSwapType, RelaySynchronizer } from "@atomiqlabs/base";
import { BigNumberish } from "starknet";
import { StarknetBtcStoredHeader } from "../../../../btcrelay/headers/StarknetBtcStoredHeader";
import { StarknetTx } from "../../../../chain/modules/StarknetTransactions";
import { StarknetBtcRelay } from "../../../../btcrelay/StarknetBtcRelay";
import { StarknetGas } from "../../../../chain/modules/StarknetFees";
export type BitcoinCommitmentData = {
    btcRelay: StarknetBtcRelay<any>;
    confirmations: number;
};
export type BitcoinWitnessData = {
    tx: {
        blockhash: string;
        confirmations: number;
        txid: string;
        hex: string;
        height: number;
    };
    requiredConfirmations: number;
    commitedHeader?: StarknetBtcStoredHeader;
    btcRelay?: StarknetBtcRelay<any>;
    synchronizer?: RelaySynchronizer<StarknetBtcStoredHeader, StarknetTx, any>;
};
export declare abstract class IBitcoinClaimHandler<C, W extends BitcoinWitnessData> implements IClaimHandler<C & BitcoinCommitmentData, W> {
    readonly address: string;
    constructor(address: string);
    static readonly address = "";
    static readonly type: ChainSwapType;
    static readonly gas: StarknetGas;
    protected serializeCommitment(data: BitcoinCommitmentData): BigNumberish[];
    getCommitment(data: C & BitcoinCommitmentData): BigNumberish;
    protected _getWitness(signer: string, swapData: StarknetSwapData, { tx, btcRelay, commitedHeader, synchronizer, requiredConfirmations }: BitcoinWitnessData, commitment: C, feeRate?: string): Promise<{
        initialTxns: StarknetTx[];
        witness: BigNumberish[];
    }>;
    abstract getWitness(signer: string, data: StarknetSwapData, witnessData: W, feeRate?: string): Promise<{
        initialTxns: StarknetTx[];
        witness: BigNumberish[];
    }>;
    abstract getGas(data: StarknetSwapData): StarknetGas;
    abstract getType(): ChainSwapType;
    parseWitnessResult(result: BigNumberish[]): string;
}
