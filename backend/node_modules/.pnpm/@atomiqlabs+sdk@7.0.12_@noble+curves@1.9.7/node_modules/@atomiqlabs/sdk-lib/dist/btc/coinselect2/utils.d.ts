/// <reference types="node" />
/// <reference types="node" />
export type CoinselectAddressTypes = "p2sh-p2wpkh" | "p2wpkh" | "p2wsh" | "p2tr" | "p2pkh";
export type CoinselectTxInput = {
    script?: Buffer;
    txId: string;
    vout: number;
    type?: CoinselectAddressTypes;
    value: number;
    outputScript?: Buffer;
    address?: string;
    cpfp?: {
        txVsize: number;
        txEffectiveFeeRate: number;
    };
};
export type CoinselectTxOutput = {
    script?: Buffer;
    address?: string;
    type?: CoinselectAddressTypes;
    value: number;
};
declare function inputBytes(input: {
    script?: Buffer;
    type?: CoinselectAddressTypes;
}): number;
declare function outputBytes(output: {
    script?: Buffer;
    type?: CoinselectAddressTypes;
}): number;
export declare const DUST_THRESHOLDS: {
    "p2sh-p2wpkh": number;
    p2wpkh: number;
    p2tr: number;
    p2pkh: number;
    p2wsh: number;
};
declare function dustThreshold(output: {
    script?: Buffer;
    type: CoinselectAddressTypes;
}): number;
declare function transactionBytes(inputs: {
    script?: Buffer;
    type?: CoinselectAddressTypes;
}[], outputs: {
    script?: Buffer;
    type?: CoinselectAddressTypes;
}[], changeType: CoinselectAddressTypes): number;
declare function uintOrNaN(v: number): number;
declare function sumForgiving(range: {
    value: number;
}[]): number;
declare function sumOrNaN(range: {
    value: number;
}[]): number;
declare function finalize(inputs: CoinselectTxInput[], outputs: CoinselectTxOutput[], feeRate: number, changeType: CoinselectAddressTypes, cpfpAddFee?: number): {
    inputs?: CoinselectTxInput[];
    outputs?: CoinselectTxOutput[];
    fee: number;
};
export declare const utils: {
    dustThreshold: typeof dustThreshold;
    finalize: typeof finalize;
    inputBytes: typeof inputBytes;
    outputBytes: typeof outputBytes;
    sumOrNaN: typeof sumOrNaN;
    sumForgiving: typeof sumForgiving;
    transactionBytes: typeof transactionBytes;
    uintOrNaN: typeof uintOrNaN;
};
export {};
