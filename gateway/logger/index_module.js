const db = require('./db');
const fs = require('fs');
const path = require('path');
const exporter = require('./exporter');

class LoggerService {
    constructor() {
        this.buffer = [];
        this.flushIntervalMs = 100;
        this.flushTimer = null;
        this.isFlushing = false;
        this.isLogging = false; // Event-driven state
    }

    init(machineId) {
        console.log(`[Logger Service] Received init for machine: ${machineId}`);
        this.loadConfig(machineId);
        this.restartFlushTimer();
    }

    loadConfig(machineId) {
        try {
            const profilePath = path.join(__dirname, '../machines', machineId, 'profile.json');
            if (fs.existsSync(profilePath)) {
                const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
                if (profile.logger) {
                    if (profile.logger.flushIntervalMs) {
                        this.flushIntervalMs = profile.logger.flushIntervalMs;
                        this.restartFlushTimer();
                    }
                    // Initialize the exporter with profile config
                    exporter.init(machineId, profile.logger);
                }
            }
        } catch (e) {
            console.error('[Logger Service] Error loading profile for config:', e.message);
        }
    }

    async flushBuffer() {
        if (this.isFlushing || this.buffer.length === 0) return;
        this.isFlushing = true;

        const batchToInsert = this.buffer;
        this.buffer = [];

        try {
            await db.insertBatch(batchToInsert);
        } catch (error) {
            console.error('[Logger Service] Flush failed, dropping batch:', error.message);
        } finally {
            this.isFlushing = false;
        }
    }

    restartFlushTimer() {
        if (this.flushTimer) clearInterval(this.flushTimer);
        this.flushTimer = setInterval(() => this.flushBuffer(), this.flushIntervalMs);
    }

    updateConfig(config) {
        exporter.config = { ...exporter.config, ...config };
        console.log(`[Logger Service] Config updated via UI:`, config);
    }

    async handleCycleStart() {
        console.log('[Logger Service] CYCLE START - Wiping DB and starting log');
        await db.clearDatabase();
        this.isLogging = true;
    }

    async handleCycleStop() {
        console.log('[Logger Service] CYCLE STOP - Stopping log and exporting');
        this.isLogging = false;
        await this.flushBuffer();
        await exporter.runCycleExport();
    }

    handleData(machineId, payload) {
        if (!this.isLogging) return; // Only log during active cycle
        
        const timestamp = payload.timestamp || Date.now();
        
        if (payload.values) {
            for (const [point_id, value] of Object.entries(payload.values)) {
                // Ignore undefined, null, or cycle trigger bits
                if (value === undefined || value === null) continue;
                if (point_id === 'cycle_start_momentary_bit' || point_id === 'cycle_stop_momentary_bit') continue;
                
                this.buffer.push({
                    timestamp,
                    machine_id: machineId,
                    point_id,
                    value: Number(value)
                });
            }
        }
    }
}

module.exports = LoggerService;
