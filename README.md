# Universal SCADA PLC Gateway - Architecture & Scaling Guide

This document serves as the master reference for understanding the structure, theme, and workflow of the PLC Gateway system. Its primary purpose is to allow AI agents or human developers to rapidly understand the underlying architecture so they can adapt the software to new PLCs (Programmable Logic Controllers) or scale the system.

---

## 1. System Theme & Vision

The system is a **Universal SCADA HMI** (Supervisory Control and Data Acquisition - Human Machine Interface). 
- **Aesthetic**: It features a dark, industrial theme with modern typography (IBM Plex Sans/Mono) and clear status indicators (e.g., LED connection dots). 
- **Design Philosophy**: The UI is entirely **dynamic**. The frontend does not hardcode buttons or input fields for a specific PLC. Instead, the UI is driven by configuration files.

---

## 2. Underlying Architecture

The system is built on a **Node.js (Express)** backend with a **Vanilla Web (HTML/CSS/JS)** frontend.

### Core Components
1. **`gateway/server.js` (The Hub)**
   - Hosts the Express HTTP server and serves the static frontend (`public/`).
   - Manages a WebSocket server (`/ws/live`) to stream live PLC data to the frontend UI.
   - Intercepts API write requests (`/api/write`) and forwards them to the PLC engine.
2. **`gateway/core/engine.js` (The Engine)**
   - Handles the continuous polling of the Modbus PLC.
   - Caches the current state of all registers and coils.
   - Executes write queues when the user interacts with the UI.
3. **`gateway/logger/index_module.js` (The Logger)**
   - Listens to cycle start/stop commands and logs the data automatically into an `.xlsx` file.
4. **`gateway/public/` (The Frontend)**
   - `index.html`: The structural shell.
   - `app.js`: Connects to the WebSocket, parses the dynamic screen configuration, and builds the DOM (buttons, toggles, tables) on the fly.

---

## 3. How PLCs are Defined (The `machines` directory)

To make the system scalable, **all PLC-specific logic is abstracted into the `machines/` directory.**
For example, the current PLC is located in `gateway/machines/selec_twix1/`. 

To adapt the software to a **new kind of PLC**, you do **not** need to rewrite the core engine. You simply create a new directory inside `machines/` and provide three specific JSON files:

### A. `profile.json` (Connection Settings)
Defines the communication parameters.
```json
{
    "id": "new_plc_model",
    "driver": "ModbusRTU",
    "connection": {
        "baudRate": 19200, ...
    },
    "pollingIntervalMs": 100
}
```

### B. `points.json` (Register Mapping)
Defines every variable the gateway needs to read/write. 
- **`id`**: Unique string identifier (used by the frontend and logger).
- **`modbusType`**: `coil`, `holdingRegister`, or `inputRegister`.
- **`address`**: The zero-indexed Modbus address.
- **`behavior`**: `momentary` (for buttons that toggle on then off automatically) or `standard`.

```json
{
    "id": "pump_1_start",
    "name": "Pump 1 Start",
    "modbusType": "coil",
    "dataType": "bool",
    "behavior": "momentary",
    "address": 10
}
```

### C. `screen.json` (Dynamic UI Layout)
Tells the frontend how to draw the interface. The UI is split into **panels** and **components**.
You link UI elements directly to the `id` from `points.json`.

```json
{
    "layout": [
        {
            "panel": "PUMP CONTROLS",
            "cssClass": "operations-panel",
            "components": [
                {
                    "group": "pump-buttons",
                    "items": [
                        { "type": "momentary-button", "pointId": "pump_1_start", "label": "START PUMP", "color": "run", "confirm": true }
                    ]
                }
            ]
        }
    ]
}
```
*Supported UI Types include: `momentary-button`, `toggle`, `set-value-display`, `software-setting`.*

---

## 4. The Data Workflow

1. **Boot**: `server.js` loads the selected machine profile from the `machines/` folder.
2. **Poll**: `engine.js` connects via Serial/Modbus and polls all addresses defined in `points.json`.
3. **Cache & Broadcast**: As data arrives, it is saved in a local cache object. The server broadcasts this JSON cache to all connected WebSocket clients.
4. **UI Render**: The frontend (`app.js`) fetches `screen.json` to draw the layout, and continuously updates the DOM based on the WebSocket JSON stream.
5. **Control**: When a user clicks a button, the UI POSTs to `/api/write` with the `pointId`. The `engine.js` translates `pointId` back to the raw Modbus address and writes it to the PLC.

## 5. Adding a New PLC (Agent Instructions)

If tasked with adding a new PLC structure:
1. Create a new folder: `gateway/machines/<new_plc_id>/`
2. Write `profile.json` based on the new serial/TCP requirements.
3. Translate the client's memory map into `points.json` using the standard schema.
4. Design the layout in `screen.json` grouping related controls and monitors.
5. Update `server.js` or the global config to point `currentMachineId` to the new folder.
6. The system will automatically adapt without touching HTML or backend logic.
