import {open, Database} from "sqlite";
import {Database as sqlite3Database} from "sqlite3";
import {IStorageManager, StorageObject} from "@atomiqlabs/base";

export class SqliteStorageManager<T extends StorageObject> implements IStorageManager<T> {

    readonly filename: string;
    db: Database;

    constructor(filename: string) {
        this.filename = filename;
    }

    async init(): Promise<void> {
        this.db = await open({
            filename: this.filename,
            driver: sqlite3Database
        })
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS store (
                id VARCHAR(255) PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
    }

    data: { [p: string]: T };

    async loadData(type: { new(data: any): T }): Promise<T[]> {
        const resources = await this.db.all(`SELECT * FROM store`);
        this.data = {};
        const allData: T[] = [];
        resources.forEach(({id, value}) => {
            const obj = new type(value);
            this.data[id] = obj;
            allData.push(obj);
        });
        return allData;
    }

    async removeData(hash: string): Promise<void> {
        const stmt = await this.db.prepare(`
            DELETE FROM store WHERE id = @id;
        `);
        await stmt.run({
            "@id": hash
        });
    }

    async removeDataArr(keys: string[]): Promise<void> {
        const values: {[name: string]: string} = {};
        const tags = keys.map((value, index) => {
            const tag = "@id"+index.toString(10).padStart(8, "0");
            values[tag] = value;
            return tag;
        });
        const stmt = await this.db.prepare(`
            DELETE FROM store WHERE id IN (${tags.join(", ")});
        `);
        await stmt.run(values);
    }

    async saveData(hash: string, object: T): Promise<void> {
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

    async saveDataArr(values: { id: string; object: T }[]): Promise<void> {
        for(let val of values) {
            await this.saveData(val.id, val.object);
        }
    }

}
