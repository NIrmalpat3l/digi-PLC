const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const CoreEngine = require('./core/engine');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws/live" });

let currentMachineId = 'selec_twix1'; // Default for now

// Fork the decoupled Logger Service
const loggerProcess = fork(path.join(__dirname, 'logger', 'index.js'));
loggerProcess.send({ type: 'MACHINE_INIT', machineId: currentMachineId });

// Clean up logger process on exit
process.on('exit', () => loggerProcess.kill());

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Broadcast function
function broadcastCache(cacheData) {
    // 1. Broadcast to WebSocket UI clients
    const dataString = JSON.stringify(cacheData);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(dataString);
        }
    });

    // 2. Publish to decoupled Logger Service via IPC
    if (cacheData.status === 'connected') {
        loggerProcess.send({
            type: 'DATA',
            machineId: currentMachineId,
            payload: cacheData
        });
    }
}

// Initialize the generic core engine
const engine = new CoreEngine(broadcastCache);

// API Endpoint to serve the screen config
app.get('/api/config', (req, res) => {
    try {
        const screenConfig = JSON.parse(fs.readFileSync(engine.screenPath, 'utf8'));
        res.json(screenConfig);
    } catch (e) {
        res.status(500).json({ error: "Failed to load screen config" });
    }
});

// API Endpoint to write data
app.post('/api/write', async (req, res) => {
    // Basic auth check
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer my_super_secret_key_change_in_production`) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { pointId, value } = req.body;
    if (!pointId || value === undefined) {
        return res.status(400).json({ success: false, error: 'Missing parameters' });
    }

    try {
        await engine.queueWrite(pointId, value);
        
        // Intercept cycle commands for the logger
        if (pointId === 'cycle_start_momentary_bit' && value === true) {
            loggerProcess.send({ type: 'CYCLE_START' });
            engine.cache.system_cycle_running = true;
        } else if (pointId === 'cycle_stop_momentary_bit' && value === true) {
            loggerProcess.send({ type: 'CYCLE_STOP' });
            engine.cache.system_cycle_running = false;
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API Endpoint to update logger settings
app.post('/api/settings', (req, res) => {
    const { downsampleBucketSec } = req.body;
    if (downsampleBucketSec !== undefined) {
        loggerProcess.send({ type: 'UPDATE_CONFIG', config: { downsampleBucketSec: Number(downsampleBucketSec) } });
    }
    res.json({ success: true });
});

wss.on('connection', (ws) => {
    console.log("New WebSocket client connected");
    ws.send(JSON.stringify(engine.cache));
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'UPDATE_SETTING') {
                engine.cache[data.settingKey] = data.value;
                if (data.settingKey === 'downsampleBucketSec') {
                    loggerProcess.send({ type: 'UPDATE_CONFIG', config: { downsampleBucketSec: Number(data.value) } });
                }
            }
        } catch (e) {
            console.error("WebSocket message error:", e.message);
        }
    });
    
    ws.on('close', () => {
        console.log("WebSocket client disconnected");
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Gateway API running on http://0.0.0.0:${PORT}`);
    console.log(`WebSocket server running on ws://0.0.0.0:${PORT}/ws/live`);
    
    // Start engine connection after server boots
    engine.connect();
});
