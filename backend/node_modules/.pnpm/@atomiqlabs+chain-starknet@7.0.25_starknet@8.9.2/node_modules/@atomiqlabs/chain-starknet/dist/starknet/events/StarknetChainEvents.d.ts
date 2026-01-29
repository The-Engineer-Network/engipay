import { StarknetChainEventsBrowser } from "./StarknetChainEventsBrowser";
import { StarknetSwapContract } from "../swaps/StarknetSwapContract";
import { StarknetChainInterface } from "../chain/StarknetChainInterface";
import { StarknetSpvVaultContract } from "../spv_swap/StarknetSpvVaultContract";
export declare class StarknetChainEvents extends StarknetChainEventsBrowser {
    private readonly directory;
    constructor(directory: string, chainInterface: StarknetChainInterface, starknetSwapContract: StarknetSwapContract, starknetSpvVaultContract: StarknetSpvVaultContract, pollIntervalSeconds?: number);
    /**
     * Retrieves last signature & slot from filesystem
     *
     * @private
     */
    private getLastEventData;
    /**
     * Saves last signature & slot to the filesystem
     *
     * @private
     */
    private saveLastEventData;
    init(): Promise<void>;
}
