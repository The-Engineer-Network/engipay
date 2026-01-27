import {IStorageManager, StorageObject} from "@atomiqlabs/base";

/**
 * StorageManager using browser's local storage API
 */
export class LocalStorageManager<T extends StorageObject> implements IStorageManager<T> {

    storageKey: string;

    rawData: {
        [hash: string]: any
    } = null;
    data: {
        [hash: string]: T
    } = {};

    constructor(storageKey: string) {
        this.storageKey = storageKey;
    }

    init(): Promise<void> {
        const completedTxt = window.localStorage.getItem(this.storageKey);
        if(completedTxt!=null) {
            this.rawData = JSON.parse(completedTxt);
            if(this.rawData==null) this.rawData = {};
        } else {
            this.rawData = {};
        }
        return Promise.resolve();
    }

    saveData(hash: string, object: T): Promise<void> {
        this.data[hash] = object;
        this.rawData[hash] = object.serialize();

        return this.save();
    }

    saveDataArr(arr: {id: string, object: T}[]): Promise<void> {
        arr.forEach(e => {
            this.data[e.id] = e.object;
            this.rawData[e.id] = e.object.serialize();
        })

        return this.save();
    }

    removeData(hash: string): Promise<void> {
        if(this.rawData[hash]!=null) {
            if(this.data[hash]!=null) delete this.data[hash];
            delete this.rawData[hash];
            return this.save();
        }
        return Promise.resolve();
    }

    removeDataArr(hashArr: string[]): Promise<void> {
        hashArr.forEach(hash => {
            if(this.rawData[hash]!=null) {
                if(this.data[hash]!=null) delete this.data[hash];
                delete this.rawData[hash];
            }
        });
        return this.save();
    }

    loadData(type: new (data: any) => T): Promise<T[]> {
        return Promise.resolve(
            Object.keys(this.rawData).map(e => {
                const deserialized = new type(this.rawData[e]);
                this.data[e] = deserialized;
                return deserialized;
            })
        );
    }

    private save(): Promise<void> {
        window.localStorage.setItem(this.storageKey, JSON.stringify(this.rawData));
        return Promise.resolve();
    }
}
