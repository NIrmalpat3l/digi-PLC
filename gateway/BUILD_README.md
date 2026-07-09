# Building the Digi-PLC Standalone Installer

This project has been configured to build into a standalone Windows installer (`.exe`) so it can be deployed to client machines without requiring Node.js, Python, or Git to be installed.

## Prerequisites for Building
To build a new version of the installer, the development machine must have:
1. **Node.js** (v18+)
2. **Inno Setup 6** (Installed at `C:\Program Files (x86)\Inno Setup 6`) - [Download Here](https://jrsoftware.org/isdl.php)

*(Note: The C# compiler `csc.exe` is already built into Windows and requires no installation).*

## How to Build

1. Open a terminal.
2. Navigate to `gateway/tools`.
3. Run the automated script:
   ```cmd
   build_installer.bat
   ```

## What the Build Script Does
1. **Installs Node Dependencies**: Runs `npm install`.
2. **Packages Node.js**: Uses `pkg` to freeze the `gateway` code, along with `public/`, `machines/`, and `config.json` into a single standalone executable (`gateway-win.exe`).
3. **Compiles System Tray**: Compiles `DigiPLCTray.cs` into `DigiPLCTray.exe`. This acts as a silent wrapper that launches the Node server in the background and places an icon in the Windows System Tray.
4. **Compiles the Installer**: Uses Inno Setup (`installer.iss`) to bundle `gateway-win.exe` and `DigiPLCTray.exe` into a standard Windows Setup Wizard (`DigiPLC_Installer.exe`).

## Where is the Output?
The final installer will be generated in `gateway/dist/DigiPLC_Installer.exe`. 
You can copy this file to the client's laptop and double-click it to install!
