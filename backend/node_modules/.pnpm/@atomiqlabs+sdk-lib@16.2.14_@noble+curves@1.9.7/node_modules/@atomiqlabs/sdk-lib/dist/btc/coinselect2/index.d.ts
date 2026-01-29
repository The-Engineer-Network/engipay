/// <reference types="node" />
/// <reference types="node" />
import { CoinselectAddressTypes, CoinselectTxInput, CoinselectTxOutput, DUST_THRESHOLDS } from "./utils";
export { CoinselectAddressTypes, CoinselectTxInput, CoinselectTxOutput, DUST_THRESHOLDS };
export declare function coinSelect(utxos: CoinselectTxInput[], outputs: CoinselectTxOutput[], feeRate: number, type: CoinselectAddressTypes, requiredInputs?: CoinselectTxInput[]): {
    inputs?: CoinselectTxInput[];
    outputs?: CoinselectTxOutput[];
    fee: number;
};
export declare function maxSendable(utxos: CoinselectTxInput[], output: {
    script: Buffer;
    type: CoinselectAddressTypes;
}, feeRate: number, requiredInputs?: CoinselectTxInput[], additionalOutputs?: {
    script: Buffer;
    value: number;
}[]): {
    value: number;
    fee: number;
};
