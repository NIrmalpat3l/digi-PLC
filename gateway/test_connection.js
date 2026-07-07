const ModbusRTU = require("modbus-serial");

// CONFIGURATION - UPDATE THESE FOR YOUR SYSTEM
const SERIAL_PORT = "COM3"; // Change to your actual COM port (e.g. COM1, COM3, /dev/ttyUSB0)
const BAUD_RATE = 19200; // Updated per PLC manual
const PARITY = "none";
const STOP_BITS = 1;
const DATA_BITS = 8;
const UNIT_ID = 1; // Default slave ID

// TEST ADDRESSES
const COIL_ADDRESS = 1; // Output-1
const REGISTER_ADDRESS = 1537; // Output-1 On time (SET) - 32 bit unsigned (2 registers)

const client = new ModbusRTU();

async function testConnection() {
    try {
        console.log(`Connecting to PLC on ${SERIAL_PORT} at ${BAUD_RATE} baud...`);
        
        await client.connectRTUBuffered(SERIAL_PORT, {
            baudRate: BAUD_RATE,
            parity: PARITY,
            stopBits: STOP_BITS,
            dataBits: DATA_BITS
        });
        
        client.setID(UNIT_ID);
        client.setTimeout(2000);
        console.log("Connected successfully!");

        console.log(`Reading Coil ${COIL_ADDRESS}...`);
        const coilData = await client.readCoils(COIL_ADDRESS, 1);
        console.log(`Coil ${COIL_ADDRESS} state:`, coilData.data);

        console.log(`Reading 32-bit Register at ${REGISTER_ADDRESS} (2 consecutive 16-bit registers)...`);
        const registerData = await client.readHoldingRegisters(REGISTER_ADDRESS, 2);
        console.log(`Raw Register Data:`, registerData.data);
        
        // Typical 32-bit conversion. Note: Word order needs testing. 
        // This is Big-Endian Word, Big-Endian Byte.
        // It might be different on your PLC.
        const buffer = Buffer.alloc(4);
        buffer.writeUInt16BE(registerData.data[0], 0);
        buffer.writeUInt16BE(registerData.data[1], 2);
        const value32 = buffer.readUInt32BE(0);
        console.log(`32-bit Value (Big-Endian): ${value32}`);

        // Try other common word orders for debugging
        const bufferLE = Buffer.alloc(4);
        bufferLE.writeUInt16BE(registerData.data[1], 0); // Swap words
        bufferLE.writeUInt16BE(registerData.data[0], 2);
        const value32LE = bufferLE.readUInt32BE(0);
        console.log(`32-bit Value (Word-Swapped): ${value32LE}`);

    } catch (e) {
        console.error("Modbus Error:", e.message);
    } finally {
        client.close();
        console.log("Connection closed.");
    }
}

testConnection();
