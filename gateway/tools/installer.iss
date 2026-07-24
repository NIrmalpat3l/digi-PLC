[Setup]
AppName=Digi-PLC Gateway
AppVersion=1.0.0
DefaultDirName={autopf}\DigiPLC
DefaultGroupName=Digi-PLC
UninstallDisplayIcon={app}\DigiPLCTray.exe
#ifexist "icon.ico"
SetupIconFile=icon.ico
#endif
Compression=lzma2
SolidCompression=yes
OutputDir=..\dist
OutputBaseFilename=DigiPLC_Installer

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "..\gateway-win.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "DigiPLCTray.exe"; DestDir: "{app}"; Flags: ignoreversion
#ifexist "icon.ico"
Source: "icon.ico"; DestDir: "{app}"; Flags: ignoreversion
#endif
Source: "vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall ignoreversion

[Icons]
Name: "{group}\Digi-PLC Gateway"; Filename: "{app}\DigiPLCTray.exe"
Name: "{group}\Uninstall Digi-PLC"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Digi-PLC Gateway"; Filename: "{app}\DigiPLCTray.exe"; Tasks: desktopicon

[Registry]

[Run]
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/install /quiet /norestart"; StatusMsg: "Installing Microsoft Visual C++ Redistributable (Required for Graphics)..."; Flags: waituntilterminated
Filename: "{app}\DigiPLCTray.exe"; Description: "Launch Digi-PLC Gateway now"; Flags: nowait postinstall skipifsilent
