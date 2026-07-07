const ModbusRTU = require("modbus-serial");
const DriverInterface = require("./DriverInterface");

class ModbusRTUDriver extends DriverInterface {
    constructor() {
        super();
        this.client = new ModbusRTU();
    }
    
    async connect(config) {
        await this.client.connectRTUBuffered(config.port, {
            baudRate: config.baudRate,
            parity: config.parity || "none",
            stopBits: config.stopBits || 1,
            dataBits: config.dataBits || 8
        });
        this.client.setID(config.unitId || 1);
        this.client.setTimeout(config.timeout || 2000);
    }
    
    async disconnect() {
        if (this.client.isOpen) {
            this.client.close();
        }
    }
    
    async readCoils(address, length) { return await this.client.readCoils(address, length); }
    async readInputRegisters(address, length) { return await this.client.readInputRegisters(address, length); }
    async readHoldingRegisters(address, length) { return await this.client.readHoldingRegisters(address, length); }
    async writeCoil(address, value) { return await this.client.writeCoil(address, value); }
    async writeRegisters(address, values) { return await this.client.writeRegisters(address, values); }
    
    get isOpen() { return this.client.isOpen; }
}
module.exports = ModbusRTUDriver;
