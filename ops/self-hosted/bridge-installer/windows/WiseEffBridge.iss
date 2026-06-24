#define MyAppName "WiseEff Bridge"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "WiseEff"
#define MyAppExeName "wiseeff-bridge.exe"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={localappdata}\WiseEff\Bridge
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputBaseFilename=WiseEffBridgeSetup_{#MyAppVersion}
Compression=lzma
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

[Registry]
Root: HKCU; Subkey: "Software\Classes\wiseeff-bridge"; ValueType: string; ValueData: "URL:WiseEff Bridge Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\wiseeff-bridge\URL Protocol"; ValueType: string; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\wiseeff-bridge\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"" --handle-url ""%1"""

[Run]
Filename: "{app}\{#MyAppExeName}"; Parameters: "service install"; Flags: runhidden
Filename: "{app}\{#MyAppExeName}"; Parameters: "service start"; Flags: runhidden

[Icons]
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "start"
