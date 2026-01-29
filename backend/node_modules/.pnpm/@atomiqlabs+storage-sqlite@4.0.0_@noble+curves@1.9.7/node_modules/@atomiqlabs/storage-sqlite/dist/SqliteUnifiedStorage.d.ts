import { IUnifiedStorage, QueryParams, UnifiedStoredObject } from "@atomiqlabs/sdk-lib";
import { Database } from "sqlite";
import { UnifiedSwapStorageCompositeIndexes, UnifiedSwapStorageIndexes } from "@atomiqlabs/sdk-lib/dist/storage/UnifiedSwapStorage";
export declare class SqliteUnifiedStorage implements IUnifiedStorage<UnifiedSwapStorageIndexes, UnifiedSwapStorageCompositeIndexes> {
    readonly filename: string;
    db: Database;
    indexedColumns: string[];
    constructor(filename: string);
    init(indexes: UnifiedSwapStorageIndexes, compositeIndexes: UnifiedSwapStorageCompositeIndexes): Promise<void>;
    query(params: Array<Array<QueryParams>>): Promise<Array<UnifiedStoredObject>>;
    remove(value: UnifiedStoredObject): Promise<void>;
    removeAll(values: UnifiedStoredObject[]): Promise<void>;
    save(value: UnifiedStoredObject): Promise<void>;
    saveAll(values: UnifiedStoredObject[]): Promise<void>;
}
