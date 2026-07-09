const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const CoreEngine = require('./core/engine');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws/live" });

let currentMachineId = 'selec_twix1'; // Default for now

// Run Logger in the main process to fix pkg native module errors with child_process
const LoggerService = require('./logger/index_module.js');
const logger = new LoggerService();
logger.init(currentMachineId);

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

    // 2. Publish to Logger Service
    if (cacheData.status === 'connected') {
        try {
            logger.handleData(currentMachineId, cacheData);
        } catch (err) {
            console.error('Logger Broadcast Error:', err.message);
        }
    }
}

// Initialize the generic core engine
const engine = new CoreEngine(broadcastCache);

// API Endpoint for COM Ports
app.get('/api/ports', async (req, res) => {
    try {
        const { SerialPort } = require('serialport');
        const ports = await SerialPort.list();
        res.json(ports);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/ports/save', (req, res) => {
    try {
        const { port } = req.body;
        const paths = require('./core/paths');
        const appConfig = paths.getConfig() || { ports: {} };
        appConfig.ports = appConfig.ports || {};
        appConfig.ports[currentMachineId] = port;
        paths.saveConfig(appConfig);
        
        engine.profile.connection.port = port;
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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
        try {
            if (pointId === 'cycle_start_momentary_bit' && value === true) {
                logger.handleCycleStart();
                engine.cache.system_cycle_running = true;
            } else if (pointId === 'cycle_stop_momentary_bit' && value === true) {
                logger.handleCycleStop();
                engine.cache.system_cycle_running = false;
            }
        } catch (err) {
            console.error('Logger Cycle Intercept Error:', err.message);
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
        logger.updateConfig({ downsampleBucketSec: Number(downsampleBucketSec) });
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
                    logger.updateConfig({ downsampleBucketSec: Number(data.value) });
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
