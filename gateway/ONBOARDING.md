# PLC Gateway Onboarding Guide

This guide explains how to onboard a new PLC into the HMI Gateway without touching the core Node.js codebase.

## 1. Convert Excel Register Map
Save the PLC's register map as an Excel file (e.g., `NewPLC.xlsx`) in the parent directory.
The Excel file must have standard columns: `Description`, `Data type`, `Modbus adress`, and `Prefix`.

Update `tools/convertExcel.js` to point to the new file, then run:
```bash
node tools/convertExcel.js
```
This will automatically parse the addresses, infer 32-bit vs 16-bit, detect Coil vs Register, handle 0-indexing mapping, and generate a `points.json` file.

## 2. Create Machine Profile
Create a new directory under `machines/` (e.g., `machines/new_plc/`).
Move the generated `points.json` into this folder.

Create a `profile.json` in this folder:
```json
{
    "id": "new_plc",
    "name": "New PLC Name",
    "driver": "ModbusRTU", // or "ModbusTCP"
    "connection": {
        "port": "COM4",
        "baudRate": 9600
        // Or for TCP: "host": "192.168.1.100", "port": 502
    },
    "pollingIntervalMs": 500,
    "pulseDurationMs": 300,
    "wordOrder": "LE"
}
```

## 3. Create Screen UI Schema
Create `screen.json` in the same directory. Use the `id` fields from `points.json` to map controls:
```json
{
    "layout": [
        {
            "panel": "CONTROLS",
            "cssClass": "operations-panel",
            "components": [
                {
                    "group": "cycle-controls",
                    "items": [
                        { "type": "momentary-button", "pointId": "machine_start", "label": "START", "confirm": true }
                    ]
                }
            ]
        }
    ]
}
```
Available UI component types: `momentary-button`, `toggle`, `set-value-display`.

## 4. Activate Profile
Edit `machines/registry.json` and change the `activeMachine` to match your new folder:
```json
{
    "activeMachine": "new_plc",
    "machines": {
        "new_plc": {
            "name": "New PLC Name",
            "profilePath": "./new_plc/profile.json"
        }
    }
}
```

## 5. Launch
Run `Launch_HMI.vbs`. The backend will automatically instantiate the correct driver, configure the polling loop specifically for your points, and the frontend will dynamically render the UI. No code updates required!
