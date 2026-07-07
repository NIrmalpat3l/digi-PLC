const fs = require('fs');
const path = require('path');
const ModbusRTUDriver = require('../drivers/ModbusRTUDriver');
const ModbusTCPDriver = require('../drivers/ModbusTCPDriver');

class CoreEngine {
    constructor(broadcastCallback) {
        this.broadcastCallback = broadcastCallback;
        this.cache = { status: "disconnected", values: {} };
        this.writeQueue = [];
        this.isProcessingQueue = false;
        
        this.loadMachineProfile();
    }
    
    loadMachineProfile() {
        const registryPath = path.join(__dirname, '../machines/registry.json');
        const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
        
        const machineId = registry.activeMachine;
        const profilePath = path.join(__dirname, '../machines', registry.machines[machineId].profilePath);
        this.profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        
        const pointsPath = path.join(path.dirname(profilePath), 'points.json');
        this.points = JSON.parse(fs.readFileSync(pointsPath, 'utf8'));
        
        this.screenPath = path.join(path.dirname(profilePath), 'screen.json');
        
        if (this.profile.driver === "ModbusRTU") {
            this.driver = new ModbusRTUDriver();
        } else if (this.profile.driver === "ModbusTCP") {
            this.driver = new ModbusTCPDriver();
        } else {
            throw new Error(`Unknown driver: ${this.profile.driver}`);
        }
        
        console.log(`Loaded machine profile: ${this.profile.name}`);
    }
    
    async connect() {
        try {
            console.log(`Connecting via ${this.profile.driver}...`);
            await this.driver.connect(this.profile.connection);
            
            this.cache.status = "connected";
            console.log("PLC connected.");
            this.startPolling();
        } catch (error) {
            console.error("Connection error:", error.message);
            this.cache.status = "disconnected";
            this.broadcastCallback(this.cache);
            await this.driver.disconnect();
            setTimeout(() => this.connect(), 5000);
        }
    }
    
    startPolling() {
        if (this.pollingInterval) clearInterval(this.pollingInterval);
        
        this.pollingInterval = setInterval(async () => {
            if (!this.driver.isOpen || this.isProcessingQueue) return;
            
            this.isProcessingQueue = true;
            try {
                // Group points by type to minimize reads
                const coils = this.points.filter(p => p.modbusType === 'coil');
                const inputs = this.points.filter(p => p.modbusType === 'inputRegister');
                const holdings = this.points.filter(p => p.modbusType === 'holdingRegister');
                
                // Extremely simple strategy: read min to max address for each group
                // Note: Production would optimize this further. For the selec PLC, this is fine.
                await this.pollGroup(coils, this.driver.readCoils.bind(this.driver));
                await this.pollGroup(inputs, this.driver.readInputRegisters.bind(this.driver));
                await this.pollGroup(holdings, this.driver.readHoldingRegisters.bind(this.driver));
                
                this.cache.status = "connected";
                this.cache.timestamp = Date.now();
                this.broadcastCallback(this.cache);
            } catch (error) {
                console.error("Polling error:", error.message);
                this.cache.status = "disconnected";
                clearInterval(this.pollingInterval);
                this.broadcastCallback(this.cache);
                await this.driver.disconnect();
                setTimeout(() => this.connect(), 5000);
            } finally {
                this.isProcessingQueue = false;
                this.processWriteQueue();
            }
        }, this.profile.pollingIntervalMs || 500);
    }
    
    async pollGroup(points, readFunc) {
        if (points.length === 0) return;
        
        // Sort points by address
        const sortedPoints = [...points].sort((a, b) => a.address - b.address);
        
        let chunks = [];
        let currentChunk = [sortedPoints[0]];
        
        for (let i = 1; i < sortedPoints.length; i++) {
            const p = sortedPoints[i];
            const prev = currentChunk[currentChunk.length - 1];
            // If address is within 10 of the previous, group it
            if (p.address - prev.address <= 10) {
                currentChunk.push(p);
            } else {
                chunks.push(currentChunk);
                currentChunk = [p];
            }
        }
        chunks.push(currentChunk);
        
        for (const chunk of chunks) {
            const start = chunk[0].address;
            const end = Math.max(...chunk.map(p => p.address + (p.dataType === '32bit' ? 1 : 0)));
            const count = (end - start) + 1;
            
            try {
                const result = await readFunc(start, count);
                for (const point of chunk) {
                    const offset = point.address - start;
                    if (point.dataType === '32bit') {
                        this.cache.values[point.id] = this.read32(result.data, offset);
                    } else if (point.dataType === '16bit') {
                        this.cache.values[point.id] = result.data[offset];
                    } else if (point.dataType === 'bool') {
                        this.cache.values[point.id] = result.data[offset];
                    }
                }
            } catch (err) {
                console.warn(`Failed to read group starting at ${start}: ${err.message}`);
            }
        }
    }
    
    read32(dataArray, offset) {
        if (dataArray[offset] === undefined || dataArray[offset+1] === undefined) return 0;
        const buffer = Buffer.alloc(4);
        if (this.profile.wordOrder === "BE") {
            buffer.writeUInt16BE(dataArray[offset], 0);
            buffer.writeUInt16BE(dataArray[offset + 1], 2);
        } else {
            buffer.writeUInt16BE(dataArray[offset + 1], 0);
            buffer.writeUInt16BE(dataArray[offset], 2);
        }
        return buffer.readUInt32BE(0);
    }
    
    write32(value) {
        const buffer = Buffer.alloc(4);
        buffer.writeUInt32BE(value, 0);
        let word1, word2;
        if (this.profile.wordOrder === "BE") {
            word1 = buffer.readUInt16BE(0);
            word2 = buffer.readUInt16BE(2);
        } else {
            word2 = buffer.readUInt16BE(0);
            word1 = buffer.readUInt16BE(2);
        }
        return [word1, word2];
    }
    
    queueWrite(pointId, value) {
        return new Promise((resolve, reject) => {
            const point = this.points.find(p => p.id === pointId);
            if (!point) return reject(new Error("Unknown point: " + pointId));
            
            this.writeQueue.push({ point, value, resolve, reject });
            if (!this.isProcessingQueue) {
                this.processWriteQueue();
            }
        });
    }
    
    async processWriteQueue() {
        if (this.isProcessingQueue || this.writeQueue.length === 0 || !this.driver.isOpen) return;
        
        this.isProcessingQueue = true;
        const item = this.writeQueue.shift();
        
        try {
            const p = item.point;
            
            if (p.modbusType === 'coil') {
                await this.driver.writeCoil(p.address, item.value);
                console.log(`[WRITE LOG] Point: ${p.id} | Value: ${item.value}`);
                
                if (p.behavior === 'momentary' && item.value === true) {
                    await new Promise(r => setTimeout(r, this.profile.pulseDurationMs || 300));
                    await this.driver.writeCoil(p.address, false);
                    console.log(`Momentary pulse finished for ${p.id}`);
                }
            } else if (p.modbusType === 'holdingRegister') {
                if (p.dataType === '32bit') {
                    const words = this.write32(item.value);
                    await this.driver.writeRegisters(p.address, words);
                } else {
                    await this.driver.writeRegisters(p.address, [item.value]);
                }
                console.log(`[WRITE LOG] Point: ${p.id} | Value: ${item.value}`);
            } else {
                throw new Error(`Cannot write to input register: ${p.id}`);
            }
            
            item.resolve({ success: true });
        } catch (error) {
            console.error("Write error:", error.message);
            item.reject(error);
        } finally {
            this.isProcessingQueue = false;
            if (this.writeQueue.length > 0) {
                this.processWriteQueue();
            }
        }
    }
}

module.exports = CoreEngine;
