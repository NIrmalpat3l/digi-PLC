@echo off
echo =========================================
echo Digi-PLC Standalone Installer Build Script
echo =========================================

cd ..

echo [1/4] Installing dependencies...
call npm install

echo [2/4] Packaging Node.js app into standalone executable...
call npx pkg . --targets node18-win-x64 --output gateway-win.exe

echo [3/4] Compiling C# System Tray Wrapper...
set CSC="C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist %CSC% (
    echo Error: C# Compiler not found at %CSC%
    pause
    exit /b 1
)
cd tools
%CSC% /target:winexe /out:DigiPLCTray.exe DigiPLCTray.cs

echo [4/4] Building Windows Installer with Inno Setup...
set ISCC="C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not exist %ISCC% (
    echo Error: Inno Setup compiler not found at %ISCC%
    echo Please install Inno Setup 6 to complete the build process.
    pause
    exit /b 1
)
%ISCC% installer.iss

echo =========================================
echo Build Complete! 
echo Installer is located in gateway\dist\DigiPLC_Installer.exe
echo =========================================
pause
