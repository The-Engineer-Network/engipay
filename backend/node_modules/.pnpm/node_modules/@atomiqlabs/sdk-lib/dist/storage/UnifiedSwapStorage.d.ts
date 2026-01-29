import { ChainType } from "@atomiqlabs/base";
import { IUnifiedStorage } from "./IUnifiedStorage";
import { ISwap } from "../swaps/ISwap";
export type QueryParams = {
    key: string;
    value: any | any[];
};
declare const indexes: readonly [{
    readonly key: "id";
    readonly type: "string";
    readonly unique: true;
    readonly nullable: false;
}, {
    readonly key: "escrowHash";
    readonly type: "string";
    readonly unique: true;
    readonly nullable: true;
}, {
    readonly key: "type";
    readonly type: "number";
    readonly unique: false;
    readonly nullable: false;
}, {
    readonly key: "initiator";
    readonly type: "string";
    readonly unique: false;
    readonly nullable: false;
}, {
    readonly key: "state";
    readonly type: "number";
    readonly unique: false;
    readonly nullable: false;
}, {
    readonly key: "paymentHash";
    readonly type: "string";
    readonly unique: false;
    readonly nullable: true;
}];
export type UnifiedSwapStorageIndexes = typeof indexes;
declare const compositeIndexes: readonly [{
    readonly keys: readonly ["initiator", "id"];
    readonly unique: false;
}, {
    readonly keys: readonly ["type", "state"];
    readonly unique: false;
}, {
    readonly keys: readonly ["type", "paymentHash"];
    readonly unique: false;
}, {
    readonly keys: readonly ["type", "initiator", "state"];
    readonly unique: false;
}];
export type UnifiedSwapStorageCompositeIndexes = typeof compositeIndexes;
export declare class UnifiedSwapStorage<T extends ChainType> {
    readonly storage: IUnifiedStorage<UnifiedSwapStorageIndexes, UnifiedSwapStorageCompositeIndexes>;
    readonly weakRefCache: Map<string, WeakRef<ISwap<T>>>;
    readonly noWeakRefMap: boolean;
    constructor(storage: IUnifiedStorage<UnifiedSwapStorageIndexes, UnifiedSwapStorageCompositeIndexes>, noWeakRefMap?: boolean);
    init(): Promise<void>;
    /**
     * Params are specified in the following way:
     *  - [[condition1, condition2]] - returns all rows where condition1 AND condition2 is met
     *  - [[condition1], [condition2]] - returns all rows where condition1 OR condition2 is met
     *  - [[condition1, condition2], [condition3]] - returns all rows where (condition1 AND condition2) OR condition3 is met
     * @param params
     * @param reviver
     */
    query<S extends ISwap<T>>(params: Array<Array<QueryParams>>, reviver: (obj: any) => S): Promise<Array<S>>;
    save<S extends ISwap<T>>(value: S): Promise<void>;
    saveAll<S extends ISwap<T>>(values: S[]): Promise<void>;
    remove<S extends ISwap<T>>(value: S): Promise<void>;
    removeAll<S extends ISwap<T>>(values: S[]): Promise<void>;
}
export {};
