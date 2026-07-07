const ModbusRTU = require("modbus-serial");
const config = require("./config.json");

class ModbusClient {
    constructor(broadcastCallback) {
        this.client = new ModbusRTU();
        this.connected = false;
        this.pollingInterval = null;
        
        // Cache to hold the latest values read from PLC
        this.cache = {
            status: "disconnected",
            coils: {},
            inputRegisters: {}
        };
        
        // Queue for write commands to avoid colliding with polling
        this.writeQueue = [];
        this.isProcessingQueue = false;
        this.broadcastCallback = broadcastCallback;
    }

    async connect() {
        try {
            console.log(`Connecting to Modbus at ${config.serial.port}...`);
            await this.client.connectRTUBuffered(config.serial.port, {
                baudRate: config.serial.baudRate,
                parity: config.serial.parity,
                stopBits: config.serial.stopBits,
                dataBits: config.serial.dataBits
            });
            this.client.setID(config.serial.unitId);
            this.client.setTimeout(2000);
            
            this.connected = true;
            this.cache.status = "connected";
            console.log("Modbus connected.");
            
            this.startPolling();
        } catch (error) {
            console.error("Modbus connection error:", error.message);
            this.connected = false;
            this.cache.status = "disconnected";
            this.broadcastCallback(this.cache);
            if (this.client.isOpen) {
                this.client.close();
            }
            // Retry after 5 seconds
            setTimeout(() => this.connect(), 5000);
        }
    }

    startPolling() {
        if (this.pollingInterval) clearInterval(this.pollingInterval);
        this.pollingInterval = setInterval(async () => {
            if (!this.connected || this.isProcessingQueue) return;
            
            this.isProcessingQueue = true; // Lock
            try {
                // Poll Coils (Outputs)
                const coilAddressStart = Math.min(...Object.values(config.registers.coils));
                const maxCoilAddress = Math.max(...Object.values(config.registers.coils));
                
                const coil1 = await this.client.readCoils(config.registers.coils.output1, 1);
                const coil2 = await this.client.readCoils(config.registers.coils.output2, 1);
                const coil3 = await this.client.readCoils(config.registers.coils.output3, 1);
                const coil4 = await this.client.readCoils(config.registers.coils.output4, 1);
                
                this.cache.coils = {
                    output1: coil1.data[0],
                    output2: coil2.data[0],
                    output3: coil3.data[0],
                    output4: coil4.data[0],
                };

                const irStart = Math.min(...Object.values(config.registers.input));
                const irCount = 14;
                let irData;
                
                try {
                    irData = await this.client.readInputRegisters(irStart, irCount);
                    this.cache.inputRegisters = {
                        output1OnTime: this.read32(irData.data, config.registers.input.output1OnTime - irStart),
                        delayTime: this.read32(irData.data, config.registers.input.delayTime - irStart),
                        output2OnTime: this.read32(irData.data, config.registers.input.output2OnTime - irStart),
                        output3OnTime: this.read32(irData.data, config.registers.input.output3OnTime - irStart),
                        output4OnTime: this.read32(irData.data, config.registers.input.output4OnTime - irStart),
                    };
                } catch (err) {
                    console.warn(`Input registers (FC04) failed: ${err.message}`);
                }
                
                const hrData = await this.client.readHoldingRegisters(irStart, irCount);
                this.cache.holdingRegisters = {
                    output1OnTime: this.read32(hrData.data, config.registers.holding.output1OnTime - irStart),
                    delayTime: this.read32(hrData.data, config.registers.holding.delayTime - irStart),
                    output2OnTime: this.read32(hrData.data, config.registers.holding.output2OnTime - irStart),
                    output3OnTime: this.read32(hrData.data, config.registers.holding.output3OnTime - irStart),
                    output4OnTime: this.read32(hrData.data, config.registers.holding.output4OnTime - irStart),
                };

                this.cache.status = "connected";
                this.broadcastCallback(this.cache); // Broadcast updated cache
                
            } catch (error) {
                console.error("Polling error:", error.message);
                this.connected = false;
                this.cache.status = "disconnected";
                clearInterval(this.pollingInterval);
                this.broadcastCallback(this.cache);
                if (this.client.isOpen) {
                    this.client.close();
                }
                setTimeout(() => this.connect(), 5000);
            } finally {
                this.isProcessingQueue = false; // Unlock
                this.processWriteQueue();
            }
        }, config.polling.intervalMs);
    }

    read32(dataArray, offset) {
        const buffer = Buffer.alloc(4);
        if (config.modbus.wordOrder === "BE") {
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
        if (config.modbus.wordOrder === "BE") {
            word1 = buffer.readUInt16BE(0);
            word2 = buffer.readUInt16BE(2);
        } else {
            word2 = buffer.readUInt16BE(0);
            word1 = buffer.readUInt16BE(2);
        }
        return [word1, word2];
    }

    // Public API to enqueue writes
    queueWrite(command) {
        return new Promise((resolve, reject) => {
            this.writeQueue.push({ command, resolve, reject });
            if (!this.isProcessingQueue) {
                this.processWriteQueue();
            }
        });
    }

    async processWriteQueue() {
        if (this.isProcessingQueue || this.writeQueue.length === 0 || !this.connected) return;
        
        this.isProcessingQueue = true;
        const item = this.writeQueue.shift();
        
        try {
            const { type, point, value } = item.command;
            
            if (type === 'coil') {
                const address = config.registers.coils[point];
                if (address === undefined) throw new Error("Invalid coil point");
                
                await this.client.writeCoil(address, value);
                console.log(`Wrote Coil ${point} to ${value}`);
                
                // If this is a momentary push button (Cycle Start/Stop)
                if ((point === 'cycleStart' || point === 'cycleStop') && value === true) {
                    await new Promise(r => setTimeout(r, config.modbus.pulseDurationMs));
                    await this.client.writeCoil(address, false);
                    console.log(`Momentary pulse finished for ${point}`);
                }
            } else if (type === 'holding') {
                const address = config.registers.holding[point];
                if (address === undefined) throw new Error("Invalid holding register point");
                
                const words = this.write32(value);
                await this.client.writeRegisters(address, words);
                console.log(`Wrote 32-bit register ${point} to ${value}`);
            }
            
            item.resolve({ success: true });
        } catch (error) {
            console.error("Write error:", error.message);
            item.reject(error);
        } finally {
            this.isProcessingQueue = false;
            // Check if more to process
            if (this.writeQueue.length > 0) {
                this.processWriteQueue();
            }
        }
    }
}

module.exports = ModbusClient;
