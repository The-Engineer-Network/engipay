import {IClaimHandler} from "../ClaimHandlers";
import {StarknetSwapData} from "../../../StarknetSwapData";
import {ChainSwapType, RelaySynchronizer} from "@atomiqlabs/base";
import {BigNumberish, hash} from "starknet";
import {StarknetBtcStoredHeader} from "../../../../btcrelay/headers/StarknetBtcStoredHeader";
import {StarknetTx} from "../../../../chain/modules/StarknetTransactions";
import {StarknetBtcRelay} from "../../../../btcrelay/StarknetBtcRelay";
import {bufferToU32Array, getLogger, u32ArrayToBuffer} from "../../../../../utils/Utils";
import {StarknetGas} from "../../../../chain/modules/StarknetFees";

export type BitcoinCommitmentData = {
    btcRelay: StarknetBtcRelay<any>,
    confirmations: number
}

export type BitcoinWitnessData = {
    tx: { blockhash: string, confirmations: number, txid: string, hex: string, height: number },
    requiredConfirmations: number,
    commitedHeader?: StarknetBtcStoredHeader,
    btcRelay?: StarknetBtcRelay<any>,
    synchronizer?: RelaySynchronizer<StarknetBtcStoredHeader, StarknetTx, any>
};

const logger = getLogger("IBitcoinClaimHandler: ");

export abstract class IBitcoinClaimHandler<C, W extends BitcoinWitnessData> implements IClaimHandler<C & BitcoinCommitmentData, W> {

    public readonly address: string;

    constructor(address: string) {
        this.address = address;
    }

    public static readonly address = "";
    public static readonly type: ChainSwapType = ChainSwapType.CHAIN_TXID;
    public static readonly gas: StarknetGas = {l1DataGas: 0, l2Gas: 10_000 * 40_000, l1Gas: 0};

    protected serializeCommitment(data: BitcoinCommitmentData): BigNumberish[] {
        return [
            data.confirmations,
            data.btcRelay.contract.address
        ]
    }

    getCommitment(data: C & BitcoinCommitmentData): BigNumberish {
        return hash.computePoseidonHashOnElements(this.serializeCommitment(data));
    }

    protected async _getWitness(
        signer: string,
        swapData: StarknetSwapData,
        {tx, btcRelay, commitedHeader, synchronizer, requiredConfirmations}: BitcoinWitnessData,
        commitment: C,
        feeRate?: string
    ): Promise<{
        initialTxns: StarknetTx[];
        witness: BigNumberish[]
    }> {
        const serializedData: BigNumberish[] = this.serializeCommitment({
            ...commitment,
            btcRelay,
            confirmations: requiredConfirmations
        });
        const commitmentHash = hash.computePoseidonHashOnElements(serializedData);

        if(!swapData.isClaimData(commitmentHash)) throw new Error("Invalid commit data");

        const merkleProof = await btcRelay.bitcoinRpc.getMerkleProof(tx.txid, tx.blockhash);
        logger.debug("getWitness(): merkle proof computed: ", merkleProof);

        const txs: StarknetTx[] = [];
        if(commitedHeader==null) {
            const headers = await StarknetBtcRelay.getCommitedHeadersAndSynchronize(
                signer, btcRelay,
                [{blockheight: tx.height, requiredConfirmations, blockhash: tx.blockhash}],
                txs, synchronizer, feeRate
            );
            if(headers==null) throw new Error("Cannot fetch committed header!");
            commitedHeader = headers[tx.blockhash];
        }

        serializedData.push(...commitedHeader.serialize());
        serializedData.push(merkleProof.merkle.length, ...merkleProof.merkle.map(bufferToU32Array).flat());
        serializedData.push(merkleProof.pos);

        return {initialTxns: txs, witness: serializedData};
    }

    abstract getWitness(signer: string, data: StarknetSwapData, witnessData: W, feeRate?: string): Promise<{
        initialTxns: StarknetTx[];
        witness: BigNumberish[]
    }>;

    abstract getGas(data: StarknetSwapData): StarknetGas;

    abstract getType(): ChainSwapType;

    parseWitnessResult(result: BigNumberish[]): string {
        return u32ArrayToBuffer(result).toString("hex");
    }

}
