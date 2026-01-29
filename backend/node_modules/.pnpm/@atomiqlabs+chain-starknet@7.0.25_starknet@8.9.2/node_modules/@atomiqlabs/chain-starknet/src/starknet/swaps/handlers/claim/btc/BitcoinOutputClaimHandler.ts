import {StarknetSwapData} from "../../../StarknetSwapData";
import {ChainSwapType} from "@atomiqlabs/base";
import {BigNumberish, hash} from "starknet";
import {StarknetTx} from "../../../../chain/modules/StarknetTransactions";
import {bufferToByteArray, getLogger, poseidonHashRange, toBigInt} from "../../../../../utils/Utils";
import {BitcoinCommitmentData, BitcoinWitnessData, IBitcoinClaimHandler} from "./IBitcoinClaimHandler";
import {Transaction} from "@scure/btc-signer";
import {Buffer} from "buffer";
import {StarknetGas} from "../../../../chain/modules/StarknetFees";

export type BitcoinOutputCommitmentData = {
    output: Buffer,
    amount: bigint
};

export type BitcoinOutputWitnessData = BitcoinWitnessData & {
    vout: number
};

const logger = getLogger("BitcoinOutputClaimHandler: ");

export class BitcoinOutputClaimHandler extends IBitcoinClaimHandler<BitcoinOutputCommitmentData, BitcoinOutputWitnessData> {

    public static readonly type: ChainSwapType = ChainSwapType.CHAIN;
    public static readonly gas: StarknetGas = {l1DataGas: 0, l2Gas: 10_000 * 40_000, l1Gas: 0};

    protected serializeCommitment(data: BitcoinOutputCommitmentData & BitcoinCommitmentData): BigNumberish[] {
        return [
            hash.computePoseidonHashOnElements([toBigInt(data.amount), poseidonHashRange(data.output)]),
            ...super.serializeCommitment(data)
        ];
    }

    async getWitness(
        signer: string,
        swapData: StarknetSwapData,
        witnessData: BitcoinOutputWitnessData,
        feeRate?: string
    ): Promise<{
        initialTxns: StarknetTx[];
        witness: BigNumberish[]
    }> {
        if(!swapData.isClaimHandler(this.address)) throw new Error("Invalid claim handler");

        const parsedBtcTx = Transaction.fromRaw(Buffer.from(witnessData.tx.hex, "hex"));
        const out = parsedBtcTx.getOutput(witnessData.vout);

        const {initialTxns, witness} = await this._getWitness(signer, swapData, witnessData, {
            output: Buffer.from(out.script),
            amount: out.amount
        });

        witness.push(...bufferToByteArray(Buffer.from(witnessData.tx.hex, "hex")));
        witness.push(BigInt(witnessData.vout));

        return {initialTxns, witness};
    }

    getGas(data: StarknetSwapData): StarknetGas {
        return BitcoinOutputClaimHandler.gas;
    }

    getType(): ChainSwapType {
        return BitcoinOutputClaimHandler.type;
    }

}
