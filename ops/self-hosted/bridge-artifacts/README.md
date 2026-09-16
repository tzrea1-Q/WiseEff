# Device Bridge Artifacts

> Chinese: [Chinese](README.zh-CN.md)

This directory holds versioned `wiseeff-bridge` CLI bundles for same-origin download from a self-hosted WiseEff deployment.

## Layout

```text
bridge-artifacts/
  <version>/
    manifest.json
    windows/amd64/wiseeff-bridge_<version>_windows_amd64.zip
    darwin/arm64/wiseeff-bridge_<version>_darwin_arm64.zip
    linux/amd64/wiseeff-bridge_<version>_linux_amd64.zip
```

Each version directory must include `manifest.json`. The API reads the latest version directory through `DEVICE_BRIDGE_ARTIFACT_ROOT` and returns relative `downloadUrl` values such as `/downloads/device-bridge/0.1.1/windows/amd64/wiseeff-bridge_0.1.1_windows_amd64.zip`. `manifest.json` also stores `sourceFingerprint`; `npm run bridge:package:check` fails when Bridge runtime source changed without rebuilding this directory.

## Build And Publish

Build the Windows bundle from the repository root:

```bash
npm run bridge:build
```

Update `manifest.json` with the real SHA-256 for each artifact before publishing. Place additional platform zips under the matching `<version>/<platform>/<arch>/` path.

## Self-Hosted Serving

The Caddy proxy in [compose.yaml](../compose.yaml) mounts this directory read-only at `/bridge-artifacts` and serves:

```text
GET /downloads/device-bridge/<version>/<platform>/<arch>/<artifact>
```

Metadata for the frontend download panel comes from `GET /api/v1/device-bridges/releases`. Keep artifact files and manifest entries in sync so same-origin links resolve.
