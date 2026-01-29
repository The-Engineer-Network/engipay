"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalStorageManager = void 0;
/**
 * StorageManager using browser's local storage API
 */
var LocalStorageManager = /** @class */ (function () {
    function LocalStorageManager(storageKey) {
        this.rawData = null;
        this.data = {};
        this.storageKey = storageKey;
    }
    LocalStorageManager.prototype.init = function () {
        var completedTxt = window.localStorage.getItem(this.storageKey);
        if (completedTxt != null) {
            this.rawData = JSON.parse(completedTxt);
            if (this.rawData == null)
                this.rawData = {};
        }
        else {
            this.rawData = {};
        }
        return Promise.resolve();
    };
    LocalStorageManager.prototype.saveData = function (hash, object) {
        this.data[hash] = object;
        this.rawData[hash] = object.serialize();
        return this.save();
    };
    LocalStorageManager.prototype.saveDataArr = function (arr) {
        var _this = this;
        arr.forEach(function (e) {
            _this.data[e.id] = e.object;
            _this.rawData[e.id] = e.object.serialize();
        });
        return this.save();
    };
    LocalStorageManager.prototype.removeData = function (hash) {
        if (this.rawData[hash] != null) {
            if (this.data[hash] != null)
                delete this.data[hash];
            delete this.rawData[hash];
            return this.save();
        }
        return Promise.resolve();
    };
    LocalStorageManager.prototype.removeDataArr = function (hashArr) {
        var _this = this;
        hashArr.forEach(function (hash) {
            if (_this.rawData[hash] != null) {
                if (_this.data[hash] != null)
                    delete _this.data[hash];
                delete _this.rawData[hash];
            }
        });
        return this.save();
    };
    LocalStorageManager.prototype.loadData = function (type) {
        var _this = this;
        return Promise.resolve(Object.keys(this.rawData).map(function (e) {
            var deserialized = new type(_this.rawData[e]);
            _this.data[e] = deserialized;
            return deserialized;
        }));
    };
    LocalStorageManager.prototype.save = function () {
        window.localStorage.setItem(this.storageKey, JSON.stringify(this.rawData));
        return Promise.resolve();
    };
    return LocalStorageManager;
}());
exports.LocalStorageManager = LocalStorageManager;
