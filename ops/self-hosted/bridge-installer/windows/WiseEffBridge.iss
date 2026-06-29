#define MyAppName "WiseEff Bridge"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "WiseEff"
#define MyAppLauncher "wiseeff-bridge.cmd"
#define MyAppNodeExe "node.exe"
#define MyAppCli "cli.js"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={localappdata}\WiseEff\Bridge
UsePreviousAppDir=yes
DisableProgramGroupPage=yes
OutputBaseFilename=WiseEffBridgeSetup_{#MyAppVersion}
Compression=lzma
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

[Registry]
Root: HKCU; Subkey: "Software\Classes\wiseeff-bridge"; ValueType: string; ValueData: "URL:WiseEff Bridge Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\wiseeff-bridge"; ValueName: "URL Protocol"; ValueType: string; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\wiseeff-bridge\DefaultIcon"; ValueType: string; ValueData: "{app}\{#MyAppNodeExe}"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\wiseeff-bridge\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppNodeExe}"" ""{app}\{#MyAppCli}"" --handle-url ""%1"""
Root: HKLM; Subkey: "Software\Classes\wiseeff-bridge"; ValueType: string; ValueData: "URL:WiseEff Bridge Protocol"; Flags: uninsdeletekey
Root: HKLM; Subkey: "Software\Classes\wiseeff-bridge"; ValueName: "URL Protocol"; ValueType: string; ValueData: ""; Flags: uninsdeletevalue
Root: HKLM; Subkey: "Software\Classes\wiseeff-bridge\DefaultIcon"; ValueType: string; ValueData: "{app}\{#MyAppNodeExe}"; Flags: uninsdeletevalue
Root: HKLM; Subkey: "Software\Classes\wiseeff-bridge\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppNodeExe}"" ""{app}\{#MyAppCli}"" --handle-url ""%1"""

[Run]
Filename: "{cmd}"; Parameters: "/c ""{app}\{#MyAppLauncher}"" register"; Flags: waituntilterminated runhidden; StatusMsg: "Registering URL scheme..."
Filename: "{cmd}"; Parameters: "/c ""{app}\{#MyAppLauncher}"" service install"; Flags: waituntilterminated runhidden; StatusMsg: "Installing background service..."
Filename: "{cmd}"; Parameters: "/c ""{app}\{#MyAppLauncher}"" service start"; Flags: waituntilterminated runhidden; StatusMsg: "Starting background service..."
Filename: "{cmd}"; Parameters: "/c reg query HKCU\Software\Classes\wiseeff-bridge\shell\open\command"; Flags: waituntilterminated runhidden; StatusMsg: "Verifying URL scheme registration..."

[UninstallRun]
Filename: "{cmd}"; Parameters: "/c ""{app}\{#MyAppLauncher}"" service uninstall"; Flags: waituntilterminated runhidden; RunOnceId: "UninstallService"
Filename: "{cmd}"; Parameters: "/c ""{app}\{#MyAppLauncher}"" unregister"; Flags: waituntilterminated runhidden; RunOnceId: "UnregisterUrlScheme"

[Icons]
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppLauncher}"; Parameters: "start"

[Code]
var
  InstallLogPath: String;

procedure AppendInstallLog(const Message: String);
begin
  if InstallLogPath = '' then
    InstallLogPath := ExpandConstant('{localappdata}\WiseEff\bridge-install.log');
  SaveStringToFile(InstallLogPath, Message + #13#10, True);
end;

procedure StopWiseEffBridgeService();
var
  ResultCode: Integer;
begin
  if Exec('sc.exe', 'stop WiseEffBridge', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    AppendInstallLog('Stopped WiseEffBridge service');
  if Exec('sc.exe', 'delete WiseEffBridge', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    AppendInstallLog('Deleted WiseEffBridge service');
end;

procedure UnregisterUrlScheme();
var
  ResultCode: Integer;
begin
  if Exec('reg.exe', 'delete HKCU\Software\Classes\wiseeff-bridge /f', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    AppendInstallLog('Removed wiseeff-bridge URL scheme registry (HKCU)');
  if Exec('reg.exe', 'delete HKLM\Software\Classes\wiseeff-bridge /f', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    AppendInstallLog('Removed wiseeff-bridge URL scheme registry (HKLM)');
end;

procedure RemoveLegacyDir(const SubDir: String);
var
  ResultCode: Integer;
  TargetDir, AppDir: String;
begin
  TargetDir := ExpandConstant('{localappdata}\WiseEff\' + SubDir);
  AppDir := RemoveBackslashUnlessRoot(ExpandConstant('{app}'));
  if CompareText(TargetDir, AppDir) = 0 then
  begin
    AppendInstallLog('Skipping active install dir: ' + TargetDir);
    Exit;
  end;
  if DirExists(TargetDir) then
  begin
    AppendInstallLog('Removing legacy dir: ' + TargetDir);
    Exec('cmd.exe', '/c rmdir /s /q "' + TargetDir + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  AppendInstallLog('=== WiseEff Bridge install prepare ===');
  StopWiseEffBridgeService();
  UnregisterUrlScheme();
  RemoveLegacyDir('Bridge-install-fix-test');
  RemoveLegacyDir('Bridge-test-verify');
  RemoveLegacyDir('device-bridge');
  RemoveLegacyDir('Bridge');
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    AppendInstallLog('Installed to: ' + ExpandConstant('{app}'));
end;
