import {StarknetSwapData} from "../../../StarknetSwapData";
import {ChainSwapType} from "@atomiqlabs/base";
import {BigNumberish, hash} from "starknet";
import {StarknetTx} from "../../../../chain/modules/StarknetTransactions";
import {bufferToByteArray, getLogger, poseidonHashRange, toBigInt} from "../../../../../utils/Utils";
import {BitcoinCommitmentData, IBitcoinClaimHandler} from "./IBitcoinClaimHandler";
import {BitcoinOutputWitnessData} from "./BitcoinOutputClaimHandler";
import {Transaction} from "@scure/btc-signer";
import {Buffer} from "buffer";
import {StarknetGas} from "../../../../chain/modules/StarknetFees";

export type BitcoinNoncedOutputCommitmentData = {
    output: Buffer,
    amount: bigint,
    nonce: bigint
};

const logger = getLogger("BitcoinNoncedOutputClaimHandler: ");

function getTransactionNonce(btcTx: Transaction): bigint {
    const locktimeSub500M = BigInt(btcTx.lockTime - 500000000);
    if(locktimeSub500M < 0n) throw new Error("Locktime too low!");
    const nSequence = BigInt(btcTx.getInput(0).sequence);
    return (locktimeSub500M << 24n) | (nSequence & 0x00FFFFFFn);
}

export class BitcoinNoncedOutputClaimHandler extends IBitcoinClaimHandler<BitcoinNoncedOutputCommitmentData, BitcoinOutputWitnessData> {

    public static readonly type: ChainSwapType = ChainSwapType.CHAIN_NONCED;
    public static readonly gas: StarknetGas = {l1DataGas: 0, l2Gas: 10_000*40_000, l1Gas: 0};

    protected serializeCommitment(data: BitcoinNoncedOutputCommitmentData & BitcoinCommitmentData): BigNumberish[] {
        return [
            hash.computePoseidonHashOnElements([toBigInt(data.nonce), toBigInt(data.amount), poseidonHashRange(data.output)]),
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
            amount: out.amount,
            nonce: getTransactionNonce(parsedBtcTx)
        });

        witness.push(...bufferToByteArray(Buffer.from(witnessData.tx.hex, "hex")));
        witness.push(BigInt(witnessData.vout));

        return {initialTxns, witness};
    }

    getGas(data: StarknetSwapData): StarknetGas {
        return BitcoinNoncedOutputClaimHandler.gas;
    }

    getType(): ChainSwapType {
        return BitcoinNoncedOutputClaimHandler.type;
    }

}
