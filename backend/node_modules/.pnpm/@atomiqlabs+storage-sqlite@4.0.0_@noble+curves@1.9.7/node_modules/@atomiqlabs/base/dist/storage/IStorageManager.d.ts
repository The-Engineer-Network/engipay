import { StorageObject } from "./StorageObject";
export interface IStorageManager<T extends StorageObject> {
    data: {
        [key: string]: T;
    };
    init(): Promise<void>;
    saveData(hash: string, object: T): Promise<void>;
    removeData(hash: string): Promise<void>;
    loadData(type: new (data: any) => T): Promise<T[]>;
    removeDataArr?(keys: string[]): Promise<void>;
    saveDataArr?(values: {
        id: string;
        object: T;
    }[]): Promise<void>;
}
