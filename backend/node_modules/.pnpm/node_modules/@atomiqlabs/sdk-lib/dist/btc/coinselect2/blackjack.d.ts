import { CoinselectAddressTypes, CoinselectTxInput, CoinselectTxOutput } from "./utils";
export declare function blackjack(utxos: CoinselectTxInput[], outputs: CoinselectTxOutput[], feeRate: number, type: CoinselectAddressTypes, requiredInputs?: CoinselectTxInput[]): {
    inputs?: CoinselectTxInput[];
    outputs?: CoinselectTxOutput[];
    fee: number;
};
