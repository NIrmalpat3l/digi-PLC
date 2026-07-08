@echo off
echo Starting setup...

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js could not be found. Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

for /f "delims=" %%i in ('node -v') do set NODE_VER=%%i
echo Node.js is installed. Version: %NODE_VER%

:: Setup Gateway
echo.
echo Setting up Gateway...
cd gateway
if not exist "node_modules\" (
    echo Installing Gateway dependencies...
    call npm install
) else (
    echo Gateway dependencies are already installed. Skipping...
)
cd ..

echo.
echo Setup complete! You can now start the applications.
pause
