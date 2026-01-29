import { Database } from "sqlite";
import { IStorageManager, StorageObject } from "@atomiqlabs/base";
export declare class SqliteStorageManager<T extends StorageObject> implements IStorageManager<T> {
    readonly filename: string;
    db: Database;
    constructor(filename: string);
    init(): Promise<void>;
    data: {
        [p: string]: T;
    };
    loadData(type: {
        new (data: any): T;
    }): Promise<T[]>;
    removeData(hash: string): Promise<void>;
    removeDataArr(keys: string[]): Promise<void>;
    saveData(hash: string, object: T): Promise<void>;
    saveDataArr(values: {
        id: string;
        object: T;
    }[]): Promise<void>;
}
