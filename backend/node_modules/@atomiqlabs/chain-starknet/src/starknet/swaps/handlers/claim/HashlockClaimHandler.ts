import {StarknetSwapData} from "../../StarknetSwapData";
import {bufferToU32Array, toHex, u32ArrayToBuffer} from "../../../../utils/Utils";
import {BigNumberish, hash} from "starknet";
import {ChainSwapType} from "@atomiqlabs/base";
import {Buffer} from "buffer";
import {sha256} from "@noble/hashes/sha2";
import {StarknetTx} from "../../../chain/modules/StarknetTransactions";
import {IClaimHandler} from "./ClaimHandlers";
import {StarknetGas} from "../../../chain/modules/StarknetFees";

export class HashlockClaimHandler implements IClaimHandler<Buffer, string> {

    public readonly address: string;
    public static readonly type: ChainSwapType = ChainSwapType.HTLC;
    public static readonly gas: StarknetGas = {l1DataGas: 0, l2Gas: 16_000_000, l1Gas: 0};

    constructor(address: string) {
        this.address = address;
    }

    getCommitment(data: Buffer): BigNumberish {
        if(data.length!==32) throw new Error("Invalid swap hash");
        return hash.computePoseidonHashOnElements(bufferToU32Array(data));
    }

    public getWitness(signer: string, data: StarknetSwapData, witnessData: string): Promise<{
        initialTxns: StarknetTx[],
        witness: BigNumberish[]
    }> {
        if(!data.isClaimHandler(this.address)) throw new Error("Invalid claim handler");
        if(witnessData.length!==64) throw new Error("Invalid hash secret: string length");
        const buffer = Buffer.from(witnessData, "hex");
        if(buffer.length!==32) throw new Error("Invalid hash secret: buff length");

        const witnessSha256 = Buffer.from(sha256(buffer));
        if(!data.isClaimData(toHex(this.getCommitment(witnessSha256)))) throw new Error("Invalid hash secret: poseidon hash doesn't match");

        const witnessArray = bufferToU32Array(buffer);
        return Promise.resolve({initialTxns: [], witness: witnessArray});
    }

    getGas(): StarknetGas {
        return HashlockClaimHandler.gas;
    }

    getType(): ChainSwapType {
        return HashlockClaimHandler.type;
    }

    parseWitnessResult(result: BigNumberish[]): string {
        return u32ArrayToBuffer(result).toString("hex");
    }

}