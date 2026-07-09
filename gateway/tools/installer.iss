[Setup]
AppName=Digi-PLC Gateway
AppVersion=1.0.0
DefaultDirName={autopf}\DigiPLC
DefaultGroupName=Digi-PLC
UninstallDisplayIcon={app}\DigiPLCTray.exe
Compression=lzma2
SolidCompression=yes
OutputDir=..\dist
OutputBaseFilename=DigiPLC_Installer

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"
Name: "startup"; Description: "Launch automatically when Windows starts"; GroupDescription: "Startup Options:"

[Files]
Source: "..\gateway-win.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "DigiPLCTray.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Digi-PLC Gateway"; Filename: "{app}\DigiPLCTray.exe"
Name: "{group}\Uninstall Digi-PLC"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Digi-PLC Gateway"; Filename: "{app}\DigiPLCTray.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "DigiPLCGateway"; ValueData: """{app}\DigiPLCTray.exe"""; Tasks: startup; Flags: uninsdeletevalue

[Run]
Filename: "{app}\DigiPLCTray.exe"; Description: "Launch Digi-PLC Gateway now"; Flags: nowait postinstall skipifsilent
