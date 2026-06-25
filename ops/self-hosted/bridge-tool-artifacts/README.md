# Bridge tool artifacts

Pinned **ADB platform-tools** and **HarmonyOS HDC** binaries for same-origin download by the local Device Bridge.

## Layout

```text
bridge-tool-artifacts/
  0.1.0/
    manifest.json
    windows/amd64/adb-platform-tools.zip
    darwin/arm64/adb-platform-tools.zip
    darwin/amd64/adb-platform-tools.zip
    windows/amd64/hdc.zip
    ...
```

Each version directory must include `manifest.json`. The API reads it through `DEVICE_BRIDGE_TOOL_ARTIFACT_ROOT` and returns relative `downloadUrl` values such as `/downloads/device-bridge-tools/0.1.0/windows/amd64/adb-platform-tools.zip`.

## Licensing

Pin Google `platform-tools` and HarmonyOS `hdc` versions approved for redistribution in your deployment. Do not fetch arbitrary upstream URLs at runtime.

## Build / publish

1. Download approved upstream zips for each platform/arch/protocol pair listed in `manifest.json`.
2. Place files under `<version>/<platform>/<arch>/`.
3. Run `npm run bridge-tool-artifacts:build` (or `npx tsx scripts/build-bridge-tool-artifacts.ts`) to refresh placeholder SHA256 entries after files are present.
4. Deploy with WiseEff self-hosted stack; Caddy serves `/downloads/device-bridge-tools/*` from the mounted volume.

## API

```http
GET /api/v1/device-bridges/tool-releases
GET /downloads/device-bridge-tools/<version>/<platform>/<arch>/<artifact>
```

The local bridge installs into a private directory (not system PATH):

- Windows: `%LOCALAPPDATA%\WiseEff\tools\`
- macOS: `~/Library/Application Support/WiseEff/tools/`
- Linux: `~/.wiseeff/tools/`
