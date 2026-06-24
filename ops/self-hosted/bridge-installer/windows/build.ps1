param(
  [string]$Version = "0.1.0",
  [string]$StagingDir = "",
  [string]$NodeVersion = "22.14.0"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $StagingDir) {
  $StagingDir = Join-Path $root "ops/self-hosted/bridge-installer/staging"
}

$iscc = Get-Command iscc -ErrorAction SilentlyContinue
if (-not $iscc) {
  throw "Inno Setup compiler (iscc) not found on PATH."
}

$outDir = Join-Path $root "ops/self-hosted/bridge-artifacts/$Version/windows/amd64"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$nodeZip = Join-Path $env:TEMP "node-v$NodeVersion-win-x64.zip"
if (-not (Test-Path $nodeZip)) {
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $nodeZip
}

$packDir = Join-Path $env:TEMP "wiseeff-bridge-win-pack"
Remove-Item -Recurse -Force $packDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $packDir | Out-Null
Expand-Archive -Path $nodeZip -DestinationPath $packDir -Force
Copy-Item (Join-Path $StagingDir "cli.js") (Join-Path $packDir "cli.js")
Copy-Item (Join-Path $StagingDir "wiseeff-bridge.cmd") (Join-Path $packDir "wiseeff-bridge.cmd")

@'
const { spawn } = require("node:child_process");
const path = require("node:path");
const nodeExe = path.join(__dirname, "node.exe");
const cliPath = path.join(__dirname, "cli.js");
const child = spawn(nodeExe, [cliPath, ...process.argv.slice(2)], { stdio: "inherit", windowsHide: false });
child.on("exit", (code) => process.exit(code ?? 0));
'@ | Set-Content -Encoding UTF8 (Join-Path $packDir "wiseeff-bridge.exe.js")

# Launcher exe stub: invoke via node.exe + cli.js through cmd wrapper renamed below
Copy-Item (Join-Path $packDir "wiseeff-bridge.cmd") (Join-Path $packDir "wiseeff-bridge.exe")

& iscc "/DSourceDir=$packDir" "/DMyAppVersion=$Version" (Join-Path $PSScriptRoot "WiseEffBridge.iss") "/O$outDir"
Write-Host "Windows installer output: $outDir"
