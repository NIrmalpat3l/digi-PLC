@echo off
:: Navigate to the absolute path of the gateway folder
cd /d "D:\PLC_System\gateway"

:: Check if node is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    exit /b
)

:: Open the browser after a short 2-second delay to ensure server is up
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:3001/"

:: Run the server
node server.js
