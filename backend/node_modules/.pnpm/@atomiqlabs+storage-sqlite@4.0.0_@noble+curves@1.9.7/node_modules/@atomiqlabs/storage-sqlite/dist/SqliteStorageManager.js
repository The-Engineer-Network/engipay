"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteStorageManager = void 0;
const sqlite_1 = require("sqlite");
const sqlite3_1 = require("sqlite3");
class SqliteStorageManager {
    constructor(filename) {
        this.filename = filename;
    }
    async init() {
        this.db = await (0, sqlite_1.open)({
            filename: this.filename,
            driver: sqlite3_1.Database
        });
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS store (
                id VARCHAR(255) PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
    }
    async loadData(type) {
        const resources = await this.db.all(`SELECT * FROM store`);
        this.data = {};
        const allData = [];
        resources.forEach(({ id, value }) => {
            const obj = new type(value);
            this.data[id] = obj;
            allData.push(obj);
        });
        return allData;
    }
    async removeData(hash) {
        const stmt = await this.db.prepare(`
            DELETE FROM store WHERE id = @id;
        `);
        await stmt.run({
            "@id": hash
        });
    }
    async removeDataArr(keys) {
        const values = {};
        const tags = keys.map((value, index) => {
            const tag = "@id" + index.toString(10).padStart(8, "0");
            values[tag] = value;
            return tag;
        });
        const stmt = await this.db.prepare(`
            DELETE FROM store WHERE id IN (${tags.join(", ")});
        `);
        await stmt.run(values);
    }
    async saveData(hash, object) {
        const stmt = await this.db.prepare(`
            INSERT INTO store (id, value)
            VALUES (@id, @value)
            ON CONFLICT(id) DO UPDATE SET 
                value = @value;
        `);
        await stmt.run({
            "@id": hash,
            "@value": JSON.stringify(object.serialize()),
        });
    }
    async saveDataArr(values) {
        for (let val of values) {
            await this.saveData(val.id, val.object);
        }
    }
}
exports.SqliteStorageManager = SqliteStorageManager;
