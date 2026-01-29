import {SwapData} from "../swaps/SwapData";
import {ChainEvent} from "./types/ChainEvent";

export type EventListener<T extends SwapData> = (obj: ChainEvent<T>[]) => Promise<boolean>;

export interface ChainEvents<T extends SwapData> {

    init(): Promise<void>;
    registerListener(cbk: EventListener<T>): void;
    unregisterListener(cbk: EventListener<T>): boolean;
    stop(): Promise<void>;

}
