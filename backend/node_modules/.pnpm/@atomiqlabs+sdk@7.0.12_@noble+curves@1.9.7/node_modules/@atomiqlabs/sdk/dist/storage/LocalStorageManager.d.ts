import { IStorageManager, StorageObject } from "@atomiqlabs/base";
/**
 * StorageManager using browser's local storage API
 */
export declare class LocalStorageManager<T extends StorageObject> implements IStorageManager<T> {
    storageKey: string;
    rawData: {
        [hash: string]: any;
    };
    data: {
        [hash: string]: T;
    };
    constructor(storageKey: string);
    init(): Promise<void>;
    saveData(hash: string, object: T): Promise<void>;
    saveDataArr(arr: {
        id: string;
        object: T;
    }[]): Promise<void>;
    removeData(hash: string): Promise<void>;
    removeDataArr(hashArr: string[]): Promise<void>;
    loadData(type: new (data: any) => T): Promise<T[]>;
    private save;
}
