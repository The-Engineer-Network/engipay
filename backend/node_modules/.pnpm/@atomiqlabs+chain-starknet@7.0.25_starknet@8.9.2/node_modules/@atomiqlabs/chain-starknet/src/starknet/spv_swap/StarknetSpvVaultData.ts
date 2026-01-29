import {
    SpvVaultClaimEvent,
    SpvVaultCloseEvent,
    SpvVaultData, SpvVaultDepositEvent, SpvVaultOpenEvent,
    SpvVaultTokenBalance,
    SpvVaultTokenData
} from "@atomiqlabs/base";
import {BigNumberish} from "starknet";
import {toBigInt, toHex} from "../../utils/Utils";
import {Buffer} from "buffer";
import {StarknetSpvWithdrawalData} from "./StarknetSpvWithdrawalData";


export type StarknetSpvVaultDataType = {
    relay_contract: BigNumberish,
    token_0: BigNumberish,
    token_1: BigNumberish,
    token_0_multiplier: BigNumberish,
    token_1_multiplier: BigNumberish,
    utxo: Record<number, boolean | object | BigNumberish>,
    confirmations: BigNumberish,
    withdraw_count: BigNumberish,
    deposit_count: BigNumberish,
    token_0_amount: BigNumberish,
    token_1_amount: BigNumberish
};

export class StarknetSpvVaultData extends SpvVaultData<StarknetSpvWithdrawalData> {

    readonly owner: string;
    readonly vaultId: bigint;

    readonly relayContract: string;
    readonly token0: {
        token: string,
        multiplier: bigint,
        rawAmount: bigint
    }
    readonly token1: {
        token: string,
        multiplier: bigint,
        rawAmount: bigint
    };
    readonly initialUtxo: string;
    utxo: string;
    readonly confirmations: number;
    withdrawCount: number;
    depositCount: number;

    constructor(owner: string, vaultId: bigint, struct: StarknetSpvVaultDataType, initialUtxo?: string);
    constructor(serializedObj: any);
    constructor(ownerOrObj: string | any, vaultId?: bigint, struct?: StarknetSpvVaultDataType, initialUtxo?: string) {
        super();
        if(typeof(ownerOrObj) === "string") {
            this.owner = ownerOrObj;
            this.vaultId = vaultId;
            this.relayContract = toHex(struct.relay_contract);
            this.token0 = {
                token: toHex(struct.token_0),
                multiplier: toBigInt(struct.token_0_multiplier),
                rawAmount: toBigInt(struct.token_0_amount)
            };
            this.token1 = {
                token: toHex(struct.token_1),
                multiplier: toBigInt(struct.token_1_multiplier),
                rawAmount: toBigInt(struct.token_1_amount)
            };
            const txHash = Buffer.from(toBigInt(struct.utxo["0"] as BigNumberish).toString(16).padStart(64, "0"), "hex");
            const vout = toBigInt(struct.utxo["1"] as BigNumberish);
            this.utxo = txHash.reverse().toString("hex")+":"+vout.toString(10);
            this.confirmations = Number(toBigInt(struct.confirmations));
            this.withdrawCount = Number(toBigInt(struct.withdraw_count));
            this.depositCount = Number(toBigInt(struct.deposit_count));
            this.initialUtxo = initialUtxo;
        } else {
            this.owner = ownerOrObj.owner;
            this.vaultId = BigInt(ownerOrObj.vaultId);
            this.relayContract = ownerOrObj.relayContract;
            this.token0 = {
                token: ownerOrObj.token0.token,
                multiplier: BigInt(ownerOrObj.token0.multiplier),
                rawAmount: BigInt(ownerOrObj.token0.rawAmount)
            }
            this.token1 = {
                token: ownerOrObj.token1.token,
                multiplier: BigInt(ownerOrObj.token1.multiplier),
                rawAmount: BigInt(ownerOrObj.token1.rawAmount)
            };
            this.utxo = ownerOrObj.utxo;
            this.confirmations = ownerOrObj.confirmations;
            this.withdrawCount = ownerOrObj.withdrawCount;
            this.depositCount = ownerOrObj.depositCount;
            this.initialUtxo = ownerOrObj.initialUtxo;
        }
    }

    getBalances(): SpvVaultTokenBalance[] {
        return [
            {...this.token0, scaledAmount: this.token0.rawAmount * this.token0.multiplier},
            {...this.token1, scaledAmount: this.token1.rawAmount * this.token1.multiplier}
        ];
    }

    getConfirmations(): number {
        return this.confirmations;
    }

    getOwner(): string {
        return this.owner;
    }

    getTokenData(): SpvVaultTokenData[] {
        return [this.token0, this.token1];
    }

    getUtxo(): string {
        return this.isOpened() ? this.utxo : this.initialUtxo;
    }

    getVaultId(): bigint {
        return this.vaultId;
    }

    getWithdrawalCount(): number {
        return this.withdrawCount;
    }

    isOpened(): boolean {
        return this.utxo!=="0000000000000000000000000000000000000000000000000000000000000000:0";
    }

    serialize(): any {
        return {
            type: "STARKNET",
            owner: this.owner,
            vaultId: this.vaultId.toString(10),
            relayContract: this.relayContract,
            token0: {
                token: this.token0.token,
                multiplier: this.token0.multiplier.toString(10),
                rawAmount: this.token0.rawAmount.toString(10)
            },
            token1: {
                token: this.token1.token,
                multiplier: this.token1.multiplier.toString(10),
                rawAmount: this.token1.rawAmount.toString(10)
            },
            utxo: this.utxo,
            confirmations: this.confirmations,
            withdrawCount: this.withdrawCount,
            depositCount: this.depositCount,
            initialUtxo: this.initialUtxo
        }
    }

    updateState(withdrawalTxOrEvent: SpvVaultClaimEvent | SpvVaultCloseEvent | SpvVaultOpenEvent | SpvVaultDepositEvent | StarknetSpvWithdrawalData): void {
        if(withdrawalTxOrEvent instanceof SpvVaultClaimEvent) {
            if(withdrawalTxOrEvent.withdrawCount <= this.withdrawCount) return;
            this.token0.rawAmount -= withdrawalTxOrEvent.amounts[0];
            this.token1.rawAmount -= withdrawalTxOrEvent.amounts[1];
            this.withdrawCount = withdrawalTxOrEvent.withdrawCount;
            this.utxo = withdrawalTxOrEvent.btcTxId+":0";
        }
        if(withdrawalTxOrEvent instanceof SpvVaultCloseEvent) {
            this.token0.rawAmount = 0n;
            this.token1.rawAmount = 0n;
            this.utxo = "0000000000000000000000000000000000000000000000000000000000000000:0";
        }
        if(withdrawalTxOrEvent instanceof SpvVaultOpenEvent) {
            if(this.isOpened()) return;
            this.utxo = withdrawalTxOrEvent.btcTxId+":"+withdrawalTxOrEvent.vout;
        }
        if(withdrawalTxOrEvent instanceof SpvVaultDepositEvent) {
            if(withdrawalTxOrEvent.depositCount <= this.depositCount) return;
            this.token0.rawAmount += withdrawalTxOrEvent.amounts[0];
            this.token1.rawAmount += withdrawalTxOrEvent.amounts[1];
            this.depositCount = withdrawalTxOrEvent.depositCount;
        }
        if(withdrawalTxOrEvent instanceof StarknetSpvWithdrawalData) {
            if(withdrawalTxOrEvent.getSpentVaultUtxo()!==this.utxo) return;
            const amounts = withdrawalTxOrEvent.getTotalOutput();
            this.token0.rawAmount -= amounts[0];
            this.token1.rawAmount -= amounts[1];
            this.withdrawCount++;
            this.utxo = withdrawalTxOrEvent.btcTx.txid+":0";
        }
    }

    getDepositCount(): number {
        return this.depositCount;
    }

}

SpvVaultData.deserializers["STARKNET"] = StarknetSpvVaultData;
