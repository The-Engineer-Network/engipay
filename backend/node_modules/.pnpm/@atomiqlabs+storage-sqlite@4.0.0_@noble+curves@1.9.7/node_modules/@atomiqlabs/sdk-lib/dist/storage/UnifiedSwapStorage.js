"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnifiedSwapStorage = void 0;
const Utils_1 = require("../utils/Utils");
const logger = (0, Utils_1.getLogger)("UnifiedSwapStorage: ");
const indexes = [
    { key: "id", type: "string", unique: true, nullable: false },
    { key: "escrowHash", type: "string", unique: true, nullable: true },
    { key: "type", type: "number", unique: false, nullable: false },
    { key: "initiator", type: "string", unique: false, nullable: false },
    { key: "state", type: "number", unique: false, nullable: false },
    { key: "paymentHash", type: "string", unique: false, nullable: true },
];
const compositeIndexes = [
    { keys: ["initiator", "id"], unique: false },
    { keys: ["type", "state"], unique: false },
    { keys: ["type", "paymentHash"], unique: false },
    { keys: ["type", "initiator", "state"], unique: false }
];
class UnifiedSwapStorage {
    constructor(storage, noWeakRefMap) {
        this.weakRefCache = new Map();
        this.storage = storage;
        this.noWeakRefMap = noWeakRefMap;
    }
    init() {
        return this.storage.init(indexes, compositeIndexes);
    }
    /**
     * Params are specified in the following way:
     *  - [[condition1, condition2]] - returns all rows where condition1 AND condition2 is met
     *  - [[condition1], [condition2]] - returns all rows where condition1 OR condition2 is met
     *  - [[condition1, condition2], [condition3]] - returns all rows where (condition1 AND condition2) OR condition3 is met
     * @param params
     * @param reviver
     */
    async query(params, reviver) {
        const rawSwaps = await this.storage.query(params);
        return rawSwaps.map(rawObj => {
            if (!this.noWeakRefMap) {
                const savedRef = this.weakRefCache.get(rawObj.id)?.deref();
                if (savedRef != null)
                    return savedRef;
                logger.debug("query(): Reviving new swap instance: " + rawObj.id);
            }
            const value = reviver(rawObj);
            if (!this.noWeakRefMap)
                this.weakRefCache.set(rawObj.id, new WeakRef(value));
            return value;
        });
    }
    save(value) {
        if (!this.noWeakRefMap)
            this.weakRefCache.set(value.getId(), new WeakRef(value));
        return this.storage.save(value.serialize());
    }
    saveAll(values) {
        if (!this.noWeakRefMap)
            values.forEach(value => this.weakRefCache.set(value.getId(), new WeakRef(value)));
        return this.storage.saveAll(values.map(obj => obj.serialize()));
    }
    remove(value) {
        if (!this.noWeakRefMap)
            this.weakRefCache.delete(value.getId());
        return this.storage.remove(value.serialize());
    }
    removeAll(values) {
        if (!this.noWeakRefMap)
            values.forEach(value => this.weakRefCache.delete(value.getId()));
        return this.storage.removeAll(values.map(obj => obj.serialize()));
    }
}
exports.UnifiedSwapStorage = UnifiedSwapStorage;
