const path = require('path');
const fs = require('fs');

const os = require('os');

// Determine AppData directory securely
const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME, 'Library', 'Preferences') : path.join(process.env.HOME, '.local', 'share'));

const appDir = path.join(appData, 'DigiPLC');
const dbDir = path.join(appDir, 'db');

// Resolve the correct Desktop path (handling Windows OneDrive syncing)
let desktopPath = path.join(os.homedir(), 'Desktop');
if (fs.existsSync(path.join(os.homedir(), 'OneDrive', 'Desktop'))) {
    desktopPath = path.join(os.homedir(), 'OneDrive', 'Desktop');
}

const datasheetsDir = path.join(desktopPath, 'DigiPLC_Reports');

// Ensure directories exist
if (!fs.existsSync(appDir)) {
    fs.mkdirSync(appDir, { recursive: true });
}
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}
if (!fs.existsSync(datasheetsDir)) {
    fs.mkdirSync(datasheetsDir, { recursive: true });
}

const appConfigPath = path.join(appDir, 'config.json');
if (!fs.existsSync(appConfigPath)) {
    try {
        fs.writeFileSync(appConfigPath, JSON.stringify({ ports: {} }, null, 2), 'utf8');
        console.log(`[Paths] Initialized default config at ${appConfigPath}`);
    } catch (e) {
        console.error('[Paths] Failed to initialize default config:', e.message);
    }
}

module.exports = {
    appDir,
    dbDir,
    datasheetsDir,
    configPath: appConfigPath,
    loggerDbPath: path.join(dbDir, 'logger.db'),
    
    // Helper to read current config safely
    getConfig: () => {
        try {
            return JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
        } catch (e) {
            console.error('[Paths] Error reading config from AppData:', e.message);
            return null;
        }
    },
    
    // Helper to write config safely
    saveConfig: (newConfig) => {
        try {
            fs.writeFileSync(appConfigPath, JSON.stringify(newConfig, null, 2), 'utf8');
            return true;
        } catch (e) {
            console.error('[Paths] Error saving config to AppData:', e.message);
            return false;
        }
    }
};
