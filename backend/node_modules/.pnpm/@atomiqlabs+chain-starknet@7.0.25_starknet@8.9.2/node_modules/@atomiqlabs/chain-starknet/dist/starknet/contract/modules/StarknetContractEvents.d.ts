import { Abi } from "abi-wan-kanabi";
import { EventToPrimitiveType, ExtractAbiEventNames } from "abi-wan-kanabi/dist/kanabi";
import { StarknetEvent, StarknetEvents } from "../../chain/modules/StarknetEvents";
import { StarknetContractBase } from "../StarknetContractBase";
import { StarknetChainInterface } from "../../chain/StarknetChainInterface";
export type StarknetAbiEvent<TAbi extends Abi, TEventName extends ExtractAbiEventNames<TAbi>> = {
    name: TEventName;
    params: EventToPrimitiveType<TAbi, TEventName>;
    txHash: string;
    blockHash: string;
    blockNumber: number;
    keys: string[];
    data: string[];
};
export declare class StarknetContractEvents<TAbi extends Abi> extends StarknetEvents {
    readonly contract: StarknetContractBase<TAbi>;
    readonly abi: TAbi;
    constructor(chainInterface: StarknetChainInterface, contract: StarknetContractBase<TAbi>, abi: TAbi);
    toStarknetAbiEvents<T extends ExtractAbiEventNames<TAbi>>(blockEvents: StarknetEvent[]): StarknetAbiEvent<TAbi, T>[];
    toFilter<T extends ExtractAbiEventNames<TAbi>>(events: T[], keys: (string | string[])[]): string[][];
    /**
     * Returns the events occuring in a range of starknet block as identified by the contract and keys,
     *  returns pending events if no startHeight & endHeight is passed
     *
     * @param events
     * @param keys
     * @param startBlockHeight
     * @param endBlockHeight
     */
    getContractBlockEvents<T extends ExtractAbiEventNames<TAbi>>(events: T[], keys: (string | string[])[], startBlockHeight?: number, endBlockHeight?: number): Promise<StarknetAbiEvent<TAbi, T>[]>;
    /**
     * Runs a search backwards in time, processing the events for a specific topic public key
     *
     * @param events
     * @param keys
     * @param processor called for every event, should return a value if the correct event was found, or null
     *  if the search should continue
     * @param abortSignal
     */
    findInContractEvents<T, TEvent extends ExtractAbiEventNames<TAbi>>(events: TEvent[], keys: (string | string[])[], processor: (event: StarknetAbiEvent<TAbi, TEvent>) => Promise<T>, abortSignal?: AbortSignal): Promise<T>;
    /**
     * Runs a search forwards in time, processing the events for a specific topic public key
     *
     * @param events
     * @param keys
     * @param processor called for every event, should return a value if the correct event was found, or null
     *  if the search should continue
     * @param startHeight
     * @param abortSignal
     */
    findInContractEventsForward<T, TEvent extends ExtractAbiEventNames<TAbi>>(events: TEvent[], keys: (string | string[])[], processor: (event: StarknetAbiEvent<TAbi, TEvent>) => Promise<T>, startHeight?: number, abortSignal?: AbortSignal): Promise<T>;
}
