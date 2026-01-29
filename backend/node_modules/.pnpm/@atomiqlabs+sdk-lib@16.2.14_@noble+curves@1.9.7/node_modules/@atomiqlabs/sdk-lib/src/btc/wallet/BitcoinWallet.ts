import {coinSelect, maxSendable, CoinselectAddressTypes, CoinselectTxInput} from "../coinselect2";
import {BTC_NETWORK} from "@scure/btc-signer/utils"
import {p2wpkh, OutScript, Transaction, p2tr, Address} from "@scure/btc-signer";
import {IBitcoinWallet} from "./IBitcoinWallet";
import {Buffer} from "buffer";
import {getLogger, randomBytes} from "../../utils/Utils";
import {toCoinselectAddressType, toOutputScript} from "../../utils/BitcoinUtils";
import {BitcoinRpcWithAddressIndex} from "../BitcoinRpcWithAddressIndex";

export type BitcoinWalletUtxo = {
    vout: number,
    txId: string,
    value: number,
    type: CoinselectAddressTypes,
    outputScript: Buffer,
    address: string,
    cpfp?: {
        txVsize: number,
        txEffectiveFeeRate: number
    },
    confirmed: boolean
};

export function identifyAddressType(address: string, network: BTC_NETWORK): CoinselectAddressTypes {
    switch(Address(network).decode(address).type) {
        case "pkh":
            return "p2pkh";
        case "wpkh":
            return "p2wpkh";
        case "tr":
            return "p2tr";
        case "sh":
            return "p2sh-p2wpkh";
        case "wsh":
            return "p2wsh";
        default:
            return null;
    }
}

const logger = getLogger("BitcoinWallet: ");

export abstract class BitcoinWallet implements IBitcoinWallet {

    rpc: BitcoinRpcWithAddressIndex<any>;
    network: BTC_NETWORK;
    feeMultiplier: number;
    feeOverride: number;

    constructor(mempoolApi: BitcoinRpcWithAddressIndex<any>, network: BTC_NETWORK, feeMultiplier: number = 1.25, feeOverride?: number) {
        this.rpc = mempoolApi;
        this.network = network;
        this.feeMultiplier = feeMultiplier;
        this.feeOverride = feeOverride;
    }

    async getFeeRate(): Promise<number> {
        if(this.feeOverride!=null) {
            return this.feeOverride;
        }
        return Math.floor((await this.rpc.getFeeRate())*this.feeMultiplier);
    }

    protected _sendTransaction(rawHex: string): Promise<string> {
        return this.rpc.sendRawTransaction(rawHex);
    }

    protected _getBalance(address: string): Promise<{ confirmedBalance: bigint; unconfirmedBalance: bigint }> {
        return this.rpc.getAddressBalances(address);
    }

    protected async _getUtxoPool(
        sendingAddress: string,
        sendingAddressType: CoinselectAddressTypes
    ): Promise<BitcoinWalletUtxo[]> {
        const utxos = await this.rpc.getAddressUTXOs(sendingAddress);

        let totalSpendable = 0;

        const outputScript = toOutputScript(this.network, sendingAddress);

        const utxoPool: BitcoinWalletUtxo[] = [];

        for(let utxo of utxos) {
            const value = Number(utxo.value);
            totalSpendable += value;
            utxoPool.push({
                vout: utxo.vout,
                txId: utxo.txid,
                value: value,
                type: sendingAddressType,
                outputScript: outputScript,
                address: sendingAddress,
                cpfp: !utxo.confirmed ? await this.rpc.getCPFPData(utxo.txid).then((result) => {
                    if(result.effectiveFeePerVsize==null) return null;
                    return {
                        txVsize: result.adjustedVsize,
                        txEffectiveFeeRate: result.effectiveFeePerVsize
                    }
                }) : null,
                confirmed: utxo.confirmed
            })
        }

        logger.debug("_getUtxoPool(): Total spendable value: "+totalSpendable+" num utxos: "+utxoPool.length);

        return utxoPool;
    }

    protected async _getPsbt(
        sendingAccounts: {
            pubkey: string,
            address: string,
            addressType: CoinselectAddressTypes,
        }[],
        recipient: string,
        amount: number,
        feeRate?: number
    ): Promise<{psbt: Transaction, fee: number, inputAddressIndexes: {[address: string]: number[]}}> {
        const psbt = new Transaction({PSBTVersion: 0});
        psbt.addOutput({
            amount: BigInt(amount),
            script: toOutputScript(this.network, recipient)
        });
        return this._fundPsbt(sendingAccounts, psbt, feeRate);
    }

    protected async _fundPsbt(
        sendingAccounts: {
            pubkey: string,
            address: string,
            addressType: CoinselectAddressTypes,
        }[],
        psbt: Transaction,
        feeRate?: number
    ): Promise<{psbt: Transaction, fee: number, inputAddressIndexes: {[address: string]: number[]}}> {
        if(feeRate==null) feeRate = await this.getFeeRate();

        const utxoPool: BitcoinWalletUtxo[] = (await Promise.all(sendingAccounts.map(acc => this._getUtxoPool(acc.address, acc.addressType)))).flat();

        logger.debug("_fundPsbt(): fee rate: "+feeRate+" utxo pool: ", utxoPool);

        const accountPubkeys = {};
        sendingAccounts.forEach(acc => accountPubkeys[acc.address] = acc.pubkey);

        const requiredInputs: CoinselectTxInput[] = [];
        for(let i=0;i<psbt.inputsLength;i++) {
            const input = psbt.getInput(i);
            let amount: bigint = input.witnessUtxo!=null ? input.witnessUtxo.amount : input.nonWitnessUtxo.outputs[input.index].amount;
            let script: Uint8Array = input.witnessUtxo!=null ? input.witnessUtxo.script : input.nonWitnessUtxo.outputs[input.index].script;
            requiredInputs.push({
                txId: Buffer.from(input.txid).toString('hex'),
                vout: input.index,
                value: Number(amount),
                type: toCoinselectAddressType(script)
            })
        }

        const targets: {value: number, script: Buffer}[] = [];
        for(let i=0;i<psbt.outputsLength;i++) {
            const output = psbt.getOutput(i);
            targets.push({
                value: Number(output.amount),
                script: Buffer.from(output.script)
            })
        }
        logger.debug("_fundPsbt(): Coinselect targets: ", targets);

        let coinselectResult = coinSelect(utxoPool, targets, feeRate, sendingAccounts[0].addressType, requiredInputs);
        logger.debug("_fundPsbt(): Coinselect result: ", coinselectResult);

        if(coinselectResult.inputs==null || coinselectResult.outputs==null) {
            return {
                psbt: null,
                fee: coinselectResult.fee,
                inputAddressIndexes: null
            };
        }

        // Remove in/outs that are already in the PSBT
        coinselectResult.inputs.splice(0, psbt.inputsLength);
        coinselectResult.outputs.splice(0, psbt.outputsLength);

        const inputAddressIndexes: {[address: string]: number[]} = {};
        coinselectResult.inputs.forEach((input, index) => {
            inputAddressIndexes[input.address] ??= [];
            inputAddressIndexes[input.address].push(index);
        });

        const formattedInputs = await Promise.all(coinselectResult.inputs.map(async (input) => {
            switch(input.type) {
                case "p2tr":
                    const parsed = p2tr(Buffer.from(accountPubkeys[input.address], "hex"));
                    return {
                        txid: input.txId,
                        index: input.vout,
                        witnessUtxo: {
                            script: input.outputScript,
                            amount: BigInt(input.value)
                        },
                        tapInternalKey: parsed.tapInternalKey,
                        tapMerkleRoot: parsed.tapMerkleRoot,
                        tapLeafScript: parsed.tapLeafScript
                    };
                case "p2wpkh":
                    return {
                        txid: input.txId,
                        index: input.vout,
                        witnessUtxo: {
                            script: input.outputScript,
                            amount: BigInt(input.value)
                        },
                        sighashType: 0x01
                    };
                case "p2sh-p2wpkh":
                    return {
                        txid: input.txId,
                        index: input.vout,
                        witnessUtxo: {
                            script: input.outputScript,
                            amount: BigInt(input.value)
                        },
                        redeemScript: p2wpkh(Buffer.from(accountPubkeys[input.address], "hex"), this.network).script,
                        sighashType: 0x01
                    };
                case "p2pkh":
                    return {
                        txid: input.txId,
                        index: input.vout,
                        nonWitnessUtxo: (await this.rpc.getTransaction(input.txId)).raw,
                        sighashType: 0x01
                    };
            }
        }));

        formattedInputs.forEach(input => psbt.addInput(input));

        coinselectResult.outputs.forEach(output => {
            if(output.script==null && output.address==null) {
                //Change output
                psbt.addOutput({
                    script: toOutputScript(this.network, sendingAccounts[0].address),
                    amount: BigInt(Math.floor(output.value))
                });
            } else {
                psbt.addOutput({
                    script: output.script ?? toOutputScript(this.network, output.address),
                    amount: BigInt(output.value)
                });
            }
        });

        return {
            psbt,
            fee: coinselectResult.fee,
            inputAddressIndexes
        };
    }

    protected async _getSpendableBalance(
        sendingAccounts: {
            address: string,
            addressType: CoinselectAddressTypes,
        }[],
        psbt?: Transaction,
        feeRate?: number
    ): Promise<{
        balance: bigint,
        feeRate: number,
        totalFee: number
    }> {
        feeRate ??= await this.getFeeRate();

        const utxoPool: BitcoinWalletUtxo[] = (await Promise.all(sendingAccounts.map(acc => this._getUtxoPool(acc.address, acc.addressType)))).flat();

        const requiredInputs: CoinselectTxInput[] = [];
        if(psbt!=null) for(let i=0;i<psbt.inputsLength;i++) {
            const input = psbt.getInput(i);
            let amount: bigint = input.witnessUtxo!=null ? input.witnessUtxo.amount : input.nonWitnessUtxo.outputs[input.index].amount;
            let script: Uint8Array = input.witnessUtxo!=null ? input.witnessUtxo.script : input.nonWitnessUtxo.outputs[input.index].script;
            requiredInputs.push({
                txId: Buffer.from(input.txid).toString('hex'),
                vout: input.index,
                value: Number(amount),
                type: toCoinselectAddressType(script)
            })
        }

        const additionalOutputs: {value: number, script: Buffer}[] = [];
        if(psbt!=null) for(let i=0;i<psbt.outputsLength;i++) {
            const output = psbt.getOutput(i);
            additionalOutputs.push({
                value: Number(output.amount),
                script: Buffer.from(output.script)
            })
        }

        const target = OutScript.encode({
            type: "wsh",
            hash: randomBytes(32)
        });

        let coinselectResult = maxSendable(utxoPool, {script: Buffer.from(target), type: "p2wsh"}, feeRate, requiredInputs, additionalOutputs);

        logger.debug("_getSpendableBalance(): Max spendable result: ", coinselectResult);

        return {
            feeRate: feeRate,
            balance: BigInt(Math.floor(coinselectResult.value)),
            totalFee: coinselectResult.fee
        }
    }

    abstract sendTransaction(address: string, amount: bigint, feeRate?: number): Promise<string>;
    abstract fundPsbt(psbt: Transaction, feeRate?: number): Promise<Transaction>;
    abstract signPsbt(psbt: Transaction, signInputs: number[]): Promise<Transaction>;

    abstract getTransactionFee(address: string, amount: bigint, feeRate?: number): Promise<number>;
    abstract getFundedPsbtFee(psbt: Transaction, feeRate?: number): Promise<number>;

    abstract getReceiveAddress(): string;
    abstract getBalance(): Promise<{
        confirmedBalance: bigint,
        unconfirmedBalance: bigint
    }>;
    abstract getSpendableBalance(psbt?: Transaction, feeRate?: number): Promise<{
        balance: bigint,
        feeRate: number,
        totalFee: number
    }>;


}