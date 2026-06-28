# WiseEff Bridge Installer Build

Build graphical installers for Windows x64 and macOS (arm64 / amd64).

## Prerequisites

- Node.js 22+ and `npm ci`
- `npm run bridge:build` (portable CLI bundle)
- **Windows:** [Inno Setup 6](https://jrsoftware.org/isinfo.php) (`iscc` on PATH), PowerShell
- **macOS:** `pkgbuild`, `bash`

## Commands

```bash
npm run bridge:build
npm run build:bridge-installers
```

Outputs land under `ops/self-hosted/bridge-artifacts/0.1.0/` and update `manifest.json` with `artifactKind: "installer"` entries.

## URL scheme registration

- Windows registry: `wiseeff-bridge://` → `wiseeff-bridge.cmd --handle-url "%1"`
- macOS `Info.plist`: `CFBundleURLSchemes` = `wiseeff-bridge`
- macOS `.pkg` postinstall registers `~/Library/LaunchAgents/com.wiseeff.bridge.plist` for the installing user and loads it via `launchctl`
- macOS **portable** (`.tar.gz`): run `wiseeff-bridge register` after extract to register `wiseeff-bridge://` via `~/.wiseeff/WiseEffBridgeLauncher.app`; run `wiseeff-bridge unregister` to remove

## Notes

- Installers bundle a pinned Node runtime plus the esbuild CLI bundle.
- Builds are unsigned; Gatekeeper / SmartScreen warnings are expected in pilot.
- `adb` / `hdc` are not bundled (Phase B/C).

> Chinese: [README.zh-CN.md](./README.zh-CN.md)
