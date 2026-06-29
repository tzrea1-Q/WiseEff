#define MyAppName "WiseEff Bridge"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "WiseEff"
#define MyAppLauncher "wiseeff-bridge.cmd"

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
Root: HKCU; Subkey: "Software\Classes\wiseeff-bridge\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppLauncher}"" --handle-url ""%1"""

[Run]
Filename: "{cmd}"; Parameters: "/c ""{app}\{#MyAppLauncher}"" register"; Flags: runhidden; StatusMsg: "Registering URL scheme..."
Filename: "{cmd}"; Parameters: "/c ""{app}\{#MyAppLauncher}"" service install"; Flags: runhidden; StatusMsg: "Installing background service..."
Filename: "{cmd}"; Parameters: "/c ""{app}\{#MyAppLauncher}"" service start"; Flags: runhidden; StatusMsg: "Starting background service..."
Filename: "{cmd}"; Parameters: "/c reg query HKCU\Software\Classes\wiseeff-bridge\shell\open\command"; Flags: runhidden; StatusMsg: "Verifying URL scheme registration..."

[UninstallRun]
Filename: "{cmd}"; Parameters: "/c ""{app}\{#MyAppLauncher}"" unregister"; Flags: runhidden; RunOnceId: "UnregisterUrlScheme"

[Icons]
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppLauncher}"; Parameters: "start"
