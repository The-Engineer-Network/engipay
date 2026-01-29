import { ChainEvent, ChainType } from "@atomiqlabs/base";
import { ISwap } from "../swaps/ISwap";
import { EventListener } from "@atomiqlabs/base/src/events/ChainEvents";
import { SwapType } from "../swaps/enums/SwapType";
import { UnifiedSwapStorage } from "../storage/UnifiedSwapStorage";
export type SwapEventListener<T extends ChainType, S extends ISwap<T>> = (event: ChainEvent<T["Data"]>, swap: S) => Promise<void>;
export declare class UnifiedSwapEventListener<T extends ChainType> {
    readonly storage: UnifiedSwapStorage<T>;
    readonly events: T["Events"];
    readonly listeners: {
        [key in SwapType]?: {
            listener: SwapEventListener<T, any>;
            reviver: new (obj: any) => ISwap<T>;
        };
    };
    constructor(unifiedStorage: UnifiedSwapStorage<T>, events: T["Events"]);
    processEvents(events: ChainEvent<T["Data"]>[]): Promise<void>;
    listener: EventListener<T["Data"]>;
    start(): Promise<void>;
    stop(): Promise<void>;
    registerListener<S extends ISwap<T>>(type: SwapType, listener: SwapEventListener<T, S>, reviver: new (val: any) => S): void;
    unregisterListener(type: SwapType): boolean;
}
