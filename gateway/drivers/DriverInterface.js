class DriverInterface {
    async connect(config) { throw new Error("connect() not implemented"); }
    async disconnect() { throw new Error("disconnect() not implemented"); }
    async readCoils(address, length) { throw new Error("readCoils() not implemented"); }
    async readInputRegisters(address, length) { throw new Error("readInputRegisters() not implemented"); }
    async readHoldingRegisters(address, length) { throw new Error("readHoldingRegisters() not implemented"); }
    async writeCoil(address, value) { throw new Error("writeCoil() not implemented"); }
    async writeRegisters(address, values) { throw new Error("writeRegisters() not implemented"); }
    get isOpen() { return false; }
}
module.exports = DriverInterface;
