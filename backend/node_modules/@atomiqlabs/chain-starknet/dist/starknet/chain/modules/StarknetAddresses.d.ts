import { StarknetModule } from "../StarknetModule";
export declare class StarknetAddresses extends StarknetModule {
    /**
     * Checks whether an address is a valid starknet address
     *
     * @param value
     * @param lenient
     */
    static isValidAddress(value: string, lenient?: boolean): boolean;
}
