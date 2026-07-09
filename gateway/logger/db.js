const sqlite3 = require('sqlite3').verbose();
const paths = require('../core/paths');

const DB_PATH = paths.loggerDbPath;

class LoggerDB {
    constructor() {
        this.db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('[Logger DB] Error opening database:', err.message);
                throw err;
            }
            console.log('[Logger DB] Connected to SQLite database at', DB_PATH);
            this.init();
        });
    }

    init() {
        this.db.serialize(() => {
            // Enable WAL mode for high concurrency
            this.db.run('PRAGMA journal_mode = WAL;', (err) => {
                if (err) console.error('[Logger DB] Error enabling WAL mode:', err.message);
                else console.log('[Logger DB] WAL mode enabled.');
            });

            // Use synchronous = NORMAL for better performance with WAL
            this.db.run('PRAGMA synchronous = NORMAL;');

            // Create raw_readings table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS raw_readings (
                    timestamp INTEGER NOT NULL,
                    machine_id TEXT NOT NULL,
                    point_id TEXT NOT NULL,
                    value NUMERIC
                )
            `);

            // Create index for fast range queries
            this.db.run(`
                CREATE INDEX IF NOT EXISTS idx_ts_machine ON raw_readings (timestamp, machine_id)
            `);

            // Create export_meta table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS export_meta (
                    machine_id TEXT PRIMARY KEY,
                    last_exported_ts INTEGER
                )
            `);
        });
    }

    // Insert batched readings within a single transaction
    insertBatch(batch) {
        return new Promise((resolve, reject) => {
            if (!batch || batch.length === 0) return resolve();

            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION;');

                const stmt = this.db.prepare('INSERT INTO raw_readings (timestamp, machine_id, point_id, value) VALUES (?, ?, ?, ?)');
                for (const reading of batch) {
                    stmt.run(reading.timestamp, reading.machine_id, reading.point_id, reading.value);
                }
                stmt.finalize();

                this.db.run('COMMIT;', (err) => {
                    if (err) {
                        console.error('[Logger DB] Error committing batch:', err.message);
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        });
    }

    // Get readings after a certain timestamp for a specific machine
    getReadingsAfter(machineId, timestamp) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT timestamp, point_id, value FROM raw_readings WHERE machine_id = ? AND timestamp > ? ORDER BY timestamp ASC',
                [machineId, timestamp],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    // Get the last exported timestamp for a machine
    getLastExportedTimestamp(machineId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT last_exported_ts FROM export_meta WHERE machine_id = ?',
                [machineId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.last_exported_ts : 0);
                }
            );
        });
    }

    // Update the last exported timestamp
    updateLastExportedTimestamp(machineId, timestamp) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO export_meta (machine_id, last_exported_ts) VALUES (?, ?) ON CONFLICT(machine_id) DO UPDATE SET last_exported_ts = ?',
                [machineId, timestamp, timestamp],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    clearDatabase() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('DELETE FROM raw_readings;', (err) => {
                    if (err) return reject(err);
                });
                this.db.run('DELETE FROM export_meta;', (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        });
    }

    close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}

module.exports = new LoggerDB();
