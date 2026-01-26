import {getLogger, toBigInt, toHex} from "../../../utils/Utils";
import {Provider} from "starknet";
import {StarknetTokens} from "./StarknetTokens";

const MAX_FEE_AGE = 5000;

export type StarknetFeeRate = {
    l1GasCost: bigint;
    l2GasCost: bigint;
    l1DataGasCost: bigint;
};

export type StarknetGas = {
    l1Gas: number,
    l2Gas: number,
    l1DataGas: number
};

export function starknetGasMul(gas: StarknetGas, scalar: number): StarknetGas {
    return {l1Gas: gas.l1Gas * scalar, l2Gas: gas.l2Gas * scalar, l1DataGas: gas.l1DataGas * scalar};
}

export function starknetGasAdd(a: StarknetGas, b: StarknetGas): StarknetGas {
    return {l1Gas: a.l1Gas + b.l1Gas, l2Gas: a.l2Gas + b.l2Gas, l1DataGas: a.l1DataGas + b.l1DataGas};
}

export class StarknetFees {

    private readonly logger = getLogger("StarknetFees: ");

    private readonly feeDA: "L1" | "L2";
    private readonly nonceDA: "L1" | "L2";
    private readonly provider: Provider;
    private readonly maxFeeRate: StarknetFeeRate;
    private readonly feeMultiplierPPM: bigint;

    private blockFeeCache: {
        timestamp: number,
        feeRate: Promise<StarknetFeeRate>
    } = null;

    constructor(
        provider: Provider,
        maxFeeRate: StarknetFeeRate = {l1GasCost: 20_000_000_000_000_000n, l2GasCost: 4_000_000_000_000_000n, l1DataGasCost: 10_000_000_000_000_000n},
        feeMultiplier: number = 1.25,
        da?: {fee?: "L1" | "L2", nonce?: "L1" | "L2"}
    ) {
        this.provider = provider;
        this.maxFeeRate = maxFeeRate;
        this.feeDA = da?.fee ?? "L1";
        this.nonceDA = da?.nonce ?? "L1";
        this.feeMultiplierPPM = BigInt(Math.floor(feeMultiplier*1000000));
    }

    /**
     * Gets starknet fee rate
     *
     * @private
     * @returns {Promise<StarknetFeeRate>} L1 gas price denominated in Wei
     */
    private async _getFeeRate(): Promise<StarknetFeeRate> {
        const block = await this.provider.getBlock("latest");

        let l1GasCost = toBigInt(block.l1_gas_price.price_in_fri) * this.feeMultiplierPPM / 1000000n;
        let l1DataGasCost = toBigInt(block.l1_data_gas_price.price_in_fri) * this.feeMultiplierPPM / 1000000n;
        let l2GasCost = toBigInt(block.l2_gas_price.price_in_fri) * this.feeMultiplierPPM / 1000000n;

        this.logger.debug("_getFeeRate(): L1 fee rate: ",[l1GasCost.toString(10), l1DataGasCost.toString(10), l2GasCost.toString(10)]);

        return {
            l1GasCost, l2GasCost, l1DataGasCost
        };
    }

    /**
     * Gets the gas price with caching, format: <gas price in Wei>;<transaction version: v1/v3>
     *
     * @private
     */
    public async getFeeRate(): Promise<string> {
        if(this.blockFeeCache==null || Date.now() - this.blockFeeCache.timestamp > MAX_FEE_AGE) {
            let obj = {
                timestamp: Date.now(),
                feeRate: null
            };
            obj.feeRate = this._getFeeRate().catch(e => {
                if(this.blockFeeCache===obj) this.blockFeeCache=null;
                throw e;
            });
            this.blockFeeCache = obj;
        }

        let {l1GasCost, l2GasCost, l1DataGasCost} = await this.blockFeeCache.feeRate;
        if(l1GasCost>this.maxFeeRate.l1GasCost) l1GasCost = this.maxFeeRate.l1GasCost;
        if(l2GasCost>this.maxFeeRate.l2GasCost) l2GasCost = this.maxFeeRate.l2GasCost;
        if(l1DataGasCost>this.maxFeeRate.l1DataGasCost) l1DataGasCost = this.maxFeeRate.l1DataGasCost;

        const fee = l1GasCost.toString(10)+","+l2GasCost.toString(10)+","+l1DataGasCost.toString(10)+";v3";

        this.logger.debug("getFeeRate(): calculated fee: "+fee);

        return fee;
    }

    public getDefaultGasToken(): string {
        return StarknetTokens.ERC20_STRK;
    }

    public static extractFromFeeRateString(feeRate: string): {l1GasCost: bigint, l2GasCost: bigint, l1DataGasCost: bigint} {
        const arr = feeRate.split(";");
        const [l1GasCostStr, l2GasCostStr, l1DataGasCostStr] = arr[0].split(",");
        return {
            l1GasCost: BigInt(l1GasCostStr),
            l2GasCost: BigInt(l2GasCostStr),
            l1DataGasCost: BigInt(l1DataGasCostStr)
        };
    }

    /**
     * Calculates the total gas fee paid for a given gas limit at a given fee rate
     *
     * @param gas
     * @param feeRate
     */
    public static getGasFee(gas: {l1DataGas: number, l2Gas: number, l1Gas: number}, feeRate: string): bigint {
        if(feeRate==null) return 0n;

        const {l1GasCost, l2GasCost, l1DataGasCost} = StarknetFees.extractFromFeeRateString(feeRate);

        return (BigInt(gas.l1Gas) * l1GasCost) +
            (BigInt(gas.l2Gas) * l2GasCost) +
            (BigInt(gas.l1DataGas) * l1DataGasCost);
    }

    public static getGasToken(feeRate: string): string {
        if(feeRate==null) return null;

        const arr = feeRate.split(";");
        const txVersion = arr[1] as "v1" | 'v3';

        return txVersion==="v1" ? StarknetTokens.ERC20_ETH : StarknetTokens.ERC20_STRK;
    }

    getFeeDetails(gas: {l1DataGas: number, l2Gas: number, l1Gas: number}, feeRate: string) {
        if(feeRate==null) return null;

        const {l1GasCost, l2GasCost, l1DataGasCost} = StarknetFees.extractFromFeeRateString(feeRate);

        return {
            version: "0x3" as const,
            resourceBounds: {
                l1_gas: {max_amount: BigInt(gas.l1Gas), max_price_per_unit: l1GasCost},
                l2_gas: {max_amount: BigInt(gas.l2Gas), max_price_per_unit: l2GasCost},
                l1_data_gas: {max_amount: BigInt(gas.l1DataGas), max_price_per_unit: l1DataGasCost}
            },
            tip: 0n,
            paymasterData: [],
            nonceDataAvailabilityMode: this.nonceDA,
            feeDataAvailabilityMode: this.feeDA
        }
    }

}