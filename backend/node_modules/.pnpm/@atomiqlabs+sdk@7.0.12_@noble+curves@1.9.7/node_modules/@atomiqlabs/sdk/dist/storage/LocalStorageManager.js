"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalStorageManager = void 0;
/**
 * StorageManager using browser's local storage API
 */
class LocalStorageManager {
    constructor(storageKey) {
        this.rawData = null;
        this.data = {};
        this.storageKey = storageKey;
    }
    init() {
        const completedTxt = window.localStorage.getItem(this.storageKey);
        if (completedTxt != null) {
            this.rawData = JSON.parse(completedTxt);
            if (this.rawData == null)
                this.rawData = {};
        }
        else {
            this.rawData = {};
        }
        return Promise.resolve();
    }
    saveData(hash, object) {
        this.data[hash] = object;
        this.rawData[hash] = object.serialize();
        return this.save();
    }
    saveDataArr(arr) {
        arr.forEach(e => {
            this.data[e.id] = e.object;
            this.rawData[e.id] = e.object.serialize();
        });
        return this.save();
    }
    removeData(hash) {
        if (this.rawData[hash] != null) {
            if (this.data[hash] != null)
                delete this.data[hash];
            delete this.rawData[hash];
            return this.save();
        }
        return Promise.resolve();
    }
    removeDataArr(hashArr) {
        hashArr.forEach(hash => {
            if (this.rawData[hash] != null) {
                if (this.data[hash] != null)
                    delete this.data[hash];
                delete this.rawData[hash];
            }
        });
        return this.save();
    }
    loadData(type) {
        return Promise.resolve(Object.keys(this.rawData).map(e => {
            const deserialized = new type(this.rawData[e]);
            this.data[e] = deserialized;
            return deserialized;
        }));
    }
    save() {
        window.localStorage.setItem(this.storageKey, JSON.stringify(this.rawData));
        return Promise.resolve();
    }
}
exports.LocalStorageManager = LocalStorageManager;
