const db = require('./db');
const fs = require('fs');
const path = require('path');
const exporter = require('./exporter');

console.log('[Logger Service] Started.');

// Configuration state
let buffer = [];
let flushIntervalMs = 100;
let flushTimer = null;
let isFlushing = false;
let isLogging = false; // Event-driven state

// Attempt to load logger config from profile
function loadConfig(machineId) {
    try {
        const profilePath = path.join(__dirname, '../machines', machineId, 'profile.json');
        if (fs.existsSync(profilePath)) {
            const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
            if (profile.logger) {
                if (profile.logger.flushIntervalMs) {
                    flushIntervalMs = profile.logger.flushIntervalMs;
                    restartFlushTimer();
                }
                
                // Initialize the exporter with profile config
                exporter.init(machineId, profile.logger);
            }
        }
    } catch (e) {
        console.error('[Logger Service] Error loading profile for config:', e.message);
    }
}

// Function to safely flush the buffer
async function flushBuffer() {
    if (isFlushing || buffer.length === 0) return;
    isFlushing = true;

    // Capture the current buffer and clear it for new incoming data
    const batchToInsert = buffer;
    buffer = [];

    try {
        await db.insertBatch(batchToInsert);
    } catch (error) {
        console.error('[Logger Service] Flush failed, dropping batch:', error.message);
    } finally {
        isFlushing = false;
    }
}

function restartFlushTimer() {
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = setInterval(flushBuffer, flushIntervalMs);
}

// Ensure timer is running
restartFlushTimer();

process.on('message', async (msg) => {
    if (msg.type === 'MACHINE_INIT') {
        console.log(`[Logger Service] Received init for machine: ${msg.machineId}`);
        loadConfig(msg.machineId);
    } else if (msg.type === 'UPDATE_CONFIG') {
        exporter.config = { ...exporter.config, ...msg.config };
        console.log(`[Logger Service] Config updated via UI:`, msg.config);
    } else if (msg.type === 'CYCLE_START') {
        console.log('[Logger Service] CYCLE START - Wiping DB and starting log');
        await db.clearDatabase();
        isLogging = true;
    } else if (msg.type === 'CYCLE_STOP') {
        console.log('[Logger Service] CYCLE STOP - Stopping log and exporting');
        isLogging = false;
        await flushBuffer();
        await exporter.runCycleExport();
    } else if (msg.type === 'DATA') {
        if (!isLogging) return; // Only log during active cycle
        
        const { machineId, payload } = msg;
        const timestamp = payload.timestamp || Date.now();
        
        if (payload.values) {
            for (const [point_id, value] of Object.entries(payload.values)) {
                // Ignore undefined, null, or cycle trigger bits
                if (value === undefined || value === null) continue;
                if (point_id === 'cycle_start_momentary_bit' || point_id === 'cycle_stop_momentary_bit') continue;
                
                buffer.push({
                    timestamp,
                    machine_id: machineId,
                    point_id,
                    value: Number(value)
                });
            }
        }
    }
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('[Logger Service] Shutting down, flushing remaining data...');
    if (flushTimer) clearInterval(flushTimer);
    await flushBuffer();
    await db.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    if (flushTimer) clearInterval(flushTimer);
    await flushBuffer();
    await db.close();
    process.exit(0);
});
