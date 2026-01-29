import {StarknetTx} from "../../../chain/modules/StarknetTransactions";
import {StarknetSwapData} from "../../StarknetSwapData";
import {bigNumberishToBuffer} from "../../../../utils/Utils";
import {BigNumberish} from "starknet";
import {IHandler} from "../IHandler";
import {StarknetGas} from "../../../chain/modules/StarknetFees";

export class TimelockRefundHandler implements IHandler<bigint, never> {

    public readonly address: string;
    public static readonly gas: StarknetGas = {l1DataGas: 0, l2Gas: 4_000_000, l1Gas: 0};

    constructor(address: string) {
        this.address = address;
    }

    public getCommitment(data: bigint): BigNumberish {
        return data;
    }

    public getWitness(signer: string, data: StarknetSwapData): Promise<{
        initialTxns: StarknetTx[],
        witness: BigNumberish[]
    }> {
        const expiry = TimelockRefundHandler.getExpiry(data);
        const currentTimestamp = BigInt(Math.floor(Date.now()/1000));
        if(expiry > currentTimestamp) throw new Error("Not expired yet!");
        return Promise.resolve({initialTxns: [], witness: []});
    }

    getGas(): StarknetGas {
        return TimelockRefundHandler.gas;
    }

    public static getExpiry(data: StarknetSwapData): bigint {
        return bigNumberishToBuffer(data.refundData, 32).readBigUInt64BE(24).valueOf();
    }

}