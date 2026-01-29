"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteUnifiedStorage = void 0;
const sqlite_1 = require("sqlite");
const sqlite3_1 = require("sqlite3");
const sqliteTypes = {
    number: "INTEGER",
    string: "TEXT",
    boolean: "BOOLEAN"
};
class SqliteUnifiedStorage {
    constructor(filename) {
        this.filename = filename;
    }
    async init(indexes, compositeIndexes) {
        this.db = await (0, sqlite_1.open)({
            filename: this.filename,
            driver: sqlite3_1.Database
        });
        const columns = [];
        const dbIndexes = [];
        this.indexedColumns = [];
        indexes.forEach(val => {
            if (val.key === "id")
                return;
            this.indexedColumns.push(val.key);
            columns.push(`
                ${val.key} ${sqliteTypes[val.type]} ${val.nullable ? "NULL" : "NOT NULL"}
            `);
            dbIndexes.push(`
                CREATE${val.unique ? " UNIQUE" : ""} INDEX IF NOT EXISTS idx_${val.key} ON swaps(${val.key});
            `);
        });
        const dbCompositeIndexes = [];
        compositeIndexes.forEach(val => {
            dbCompositeIndexes.push(`
                CREATE${val.unique ? " UNIQUE" : ""} INDEX IF NOT EXISTS idx_${val.keys.join("_")} ON swaps(${val.keys.join(", ")});
            `);
        });
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS swaps (id VARCHAR(255) PRIMARY KEY, ${columns.join(", ")}, data TEXT NOT NULL);
            
            ${dbIndexes.join("\n")}
            ${dbCompositeIndexes.join("\n")}
        `);
    }
    async query(params) {
        const orQuery = [];
        const values = {};
        let counter = 0;
        for (let orParams of params) {
            const andQuery = [];
            for (let andParam of orParams) {
                if (!this.indexedColumns.includes(andParam.key) && andParam.key !== "id")
                    throw new Error(`Tried to query based on non-indexed column: ${andParam.key}!`);
                if (Array.isArray(andParam.value)) {
                    const tags = andParam.value.map(value => {
                        const tag = "@" + andParam.key + counter.toString(10).padStart(8, "0");
                        values[tag] = value;
                        counter++;
                        return tag;
                    });
                    andQuery.push(andParam.key + " IN (" + tags.join(", ") + ")");
                }
                else {
                    const tag = "@" + andParam.key + counter.toString(10).padStart(8, "0");
                    andQuery.push(andParam.key + " = " + tag);
                    values[tag] = andParam.value;
                    counter++;
                }
            }
            orQuery.push("(" + andQuery.join(" AND ") + ")");
        }
        const queryToSend = "SELECT * FROM swaps WHERE " + orQuery.join(" OR ");
        const stmt = await this.db.prepare(queryToSend);
        const resources = (await stmt.all(values)).map(val => JSON.parse(val.data));
        return resources;
    }
    async remove(value) {
        const stmt = await this.db.prepare(`
            DELETE FROM swaps WHERE id = @id;
        `);
        await stmt.run({
            "@id": value.id
        });
    }
    async removeAll(values) {
        for (let value of values) {
            await this.remove(value);
        }
    }
    async save(value) {
        const stmt = await this.db.prepare(`
            INSERT INTO swaps (id, ${this.indexedColumns.join(", ")}, data)
            VALUES (@id, ${this.indexedColumns.map(x => "@" + x).join(", ")}, @data)
            ON CONFLICT(id) DO UPDATE SET ${this.indexedColumns.map(x => x + " = @" + x).join(", ")}, data = @data;
        `);
        const stmtKeys = {
            "@id": value.id,
            "@data": JSON.stringify(value),
        };
        this.indexedColumns.forEach(key => stmtKeys["@" + key] = value[key]);
        await stmt.run(stmtKeys);
    }
    async saveAll(values) {
        for (let val of values) {
            await this.save(val);
        }
    }
}
exports.SqliteUnifiedStorage = SqliteUnifiedStorage;
