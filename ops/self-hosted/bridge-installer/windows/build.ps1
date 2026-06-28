param(
  [string]$Version = "0.1.0",
  [string]$StagingDir = "",
  [string]$NodeVersion = "22.14.0"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
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

$nodeDir = Get-ChildItem $packDir -Directory | Where-Object { $_.Name -like "node-v*" } | Select-Object -First 1
if (-not $nodeDir) {
  throw "Node.js archive did not contain an expected node-v* directory."
}

Copy-Item (Join-Path $nodeDir.FullName "node.exe") (Join-Path $packDir "node.exe")
Remove-Item $nodeDir.FullName -Recurse -Force

Copy-Item (Join-Path $StagingDir "cli.js") (Join-Path $packDir "cli.js")
Copy-Item (Join-Path $StagingDir "wiseeff-bridge.cmd") (Join-Path $packDir "wiseeff-bridge.cmd")

& iscc "/DSourceDir=$packDir" "/DMyAppVersion=$Version" (Join-Path $PSScriptRoot "WiseEffBridge.iss") "/O$outDir"
Write-Host "Windows installer output: $outDir"
