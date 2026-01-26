import {StarknetSwapData} from "../../../StarknetSwapData";
import {ChainSwapType} from "@atomiqlabs/base";
import {BigNumberish} from "starknet";
import {StarknetTx} from "../../../../chain/modules/StarknetTransactions";
import {bufferToU32Array, getLogger} from "../../../../../utils/Utils";
import {BitcoinCommitmentData, BitcoinWitnessData, IBitcoinClaimHandler} from "./IBitcoinClaimHandler";
import {Buffer} from "buffer";
import {StarknetGas} from "../../../../chain/modules/StarknetFees";

export type BitcoinTxIdCommitmentData = {
    txId: string
};

const logger = getLogger("BitcoinTxIdClaimHandler: ");

export class BitcoinTxIdClaimHandler extends IBitcoinClaimHandler<BitcoinTxIdCommitmentData, BitcoinWitnessData> {

    public static readonly type: ChainSwapType = ChainSwapType.CHAIN_TXID;
    public static readonly gas: StarknetGas = {l1DataGas: 0, l2Gas: 10_000 * 40_000, l1Gas: 0};

    protected serializeCommitment(data: BitcoinTxIdCommitmentData & BitcoinCommitmentData): BigNumberish[] {
        return [
            ...bufferToU32Array(Buffer.from(data.txId, "hex").reverse()),
            ...super.serializeCommitment(data)
        ];
    }

    getWitness(
        signer: string,
        swapData: StarknetSwapData,
        witnessData: BitcoinWitnessData,
        feeRate?: string
    ): Promise<{
        initialTxns: StarknetTx[];
        witness: BigNumberish[]
    }> {
        if(!swapData.isClaimHandler(this.address)) throw new Error("Invalid claim handler");

        return this._getWitness(signer, swapData, witnessData, {txId: witnessData.tx.txid});
    }

    getGas(data: StarknetSwapData): StarknetGas {
        return BitcoinTxIdClaimHandler.gas;
    }

    getType(): ChainSwapType {
        return BitcoinTxIdClaimHandler.type;
    }

}
