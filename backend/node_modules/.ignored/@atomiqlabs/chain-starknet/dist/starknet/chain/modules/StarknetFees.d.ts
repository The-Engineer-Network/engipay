import { Provider } from "starknet";
export type StarknetFeeRate = {
    l1GasCost: bigint;
    l2GasCost: bigint;
    l1DataGasCost: bigint;
};
export type StarknetGas = {
    l1Gas: number;
    l2Gas: number;
    l1DataGas: number;
};
export declare function starknetGasMul(gas: StarknetGas, scalar: number): StarknetGas;
export declare function starknetGasAdd(a: StarknetGas, b: StarknetGas): StarknetGas;
export declare class StarknetFees {
    private readonly logger;
    private readonly feeDA;
    private readonly nonceDA;
    private readonly provider;
    private readonly maxFeeRate;
    private readonly feeMultiplierPPM;
    private blockFeeCache;
    constructor(provider: Provider, maxFeeRate?: StarknetFeeRate, feeMultiplier?: number, da?: {
        fee?: "L1" | "L2";
        nonce?: "L1" | "L2";
    });
    /**
     * Gets starknet fee rate
     *
     * @private
     * @returns {Promise<StarknetFeeRate>} L1 gas price denominated in Wei
     */
    private _getFeeRate;
    /**
     * Gets the gas price with caching, format: <gas price in Wei>;<transaction version: v1/v3>
     *
     * @private
     */
    getFeeRate(): Promise<string>;
    getDefaultGasToken(): string;
    static extractFromFeeRateString(feeRate: string): {
        l1GasCost: bigint;
        l2GasCost: bigint;
        l1DataGasCost: bigint;
    };
    /**
     * Calculates the total gas fee paid for a given gas limit at a given fee rate
     *
     * @param gas
     * @param feeRate
     */
    static getGasFee(gas: {
        l1DataGas: number;
        l2Gas: number;
        l1Gas: number;
    }, feeRate: string): bigint;
    static getGasToken(feeRate: string): string;
    getFeeDetails(gas: {
        l1DataGas: number;
        l2Gas: number;
        l1Gas: number;
    }, feeRate: string): {
        version: "0x3";
        resourceBounds: {
            l1_gas: {
                max_amount: bigint;
                max_price_per_unit: bigint;
            };
            l2_gas: {
                max_amount: bigint;
                max_price_per_unit: bigint;
            };
            l1_data_gas: {
                max_amount: bigint;
                max_price_per_unit: bigint;
            };
        };
        tip: bigint;
        paymasterData: any[];
        nonceDataAvailabilityMode: "L1" | "L2";
        feeDataAvailabilityMode: "L1" | "L2";
    };
}
