# Local Device Bridge Runbook

> Chinese: [Chinese](../zh-CN/runbooks/local-device-bridge.md)

This runbook covers WiseEff Local Device Bridge Phase 1–2 operations for self-hosted environments, including pairing, HDC/ADB RPC, Windows service lifecycle, connectivity checks, and conditional acceptance execution.

## Scope

- Phase 1–2 supports Windows and macOS bridge pairing and runtime; Windows additionally supports optional service install.
- Bridge RPC supports both `adb` and `hdc` protocols on the engineer's PC; the server keeps governance unchanged.
- Bridge-backed session execution is governed by backend debugging permissions, lease checks, confirmations, snapshot/rollback, and audit.
- This runbook focuses on local/self-hosted operator workflows, not managed cloud rollout.

## Required Environment Variables

Server/runtime env:

```text
DEVICE_BRIDGE_ARTIFACT_ROOT=ops/self-hosted/bridge-artifacts
DEVICE_BRIDGE_PAIRING_TTL_SECONDS=300
DEVICE_BRIDGE_TOKEN_TTL_DAYS=90
DEVICE_BRIDGE_WS_PATH=/api/v1/device-bridges/ws
```

Conditional acceptance env:

```text
DEVICE_BRIDGE_LAB_AVAILABLE=true
DEVICE_BRIDGE_SERVER_URL=https://<your-wiseeff-origin>
```

Optional acceptance helpers:

```text
DEVICE_BRIDGE_LAB_USER_ID=u-xu-yun
DEVICE_BRIDGE_LAB_ENABLE_WRITE=false
DEVICE_BRIDGE_LAB_WRITE_VALUE=3150
DEVICE_BRIDGE_LAB_CONFIRM_WRITE=confirm-high-risk-write
```

Optional HDC device-lab acceptance (requires a real paired bridge with `hdc` on PATH and a connected device):

```text
DEVICE_BRIDGE_HDC_AVAILABLE=true
```

## Artifact And Manifest Checks

1. Confirm bridge artifacts exist under `DEVICE_BRIDGE_ARTIFACT_ROOT`.
2. Verify manifest endpoint:
   - `GET /api/v1/device-bridges/releases`
3. Confirm release items exist for the operator platform and use same-origin relative URLs:
   - Windows installer (primary): `/downloads/device-bridge/<version>/windows/amd64/WiseEffBridgeSetup_<version>.exe`
   - macOS installer (primary): `/downloads/device-bridge/<version>/darwin/<arch>/WiseEffBridge_<version>_darwin_<arch>.pkg`
   - Portable archives remain available for advanced/CLI workflows (`artifactKind: "portable"`).

## Primary Operator Path (Phase A — Zero Friction)

1. Open `/node-debugging` while signed in.
2. Click **安装 Bridge** to download the platform-matched installer (Windows or macOS).
3. Run the installer with default options. It registers `wiseeff-bridge://`, installs Bridge under the user profile, and starts the background service/LaunchAgent.
4. Return to `/node-debugging` and click **连接本地设备**. The page creates a pairing code and opens `wiseeff-bridge://connect?server=<origin>&code=<6-digit>`.
5. Bridge runs `connect` locally (pair if needed, then start). Health at `http://127.0.0.1:18787/health` should report `connected: true` within 30 seconds.
6. Insert the USB device, authorize debugging, and click **重新检测设备**.

Fallback: expand **高级 · 命令行方式** for `wiseeff-bridge connect`, `pair`, and `start` commands, or launch Bridge from the tray/menu bar.

Build installers on a build machine:

```bash
npm run bridge:build
npm run build:bridge-installers
```

See `ops/self-hosted/bridge-installer/README.md` for Inno Setup / pkgbuild prerequisites.

## macOS Install (Portable — Advanced)

1. Download the matching macOS artifact from `/node-debugging` or `GET /api/v1/device-bridges/releases`.
2. Extract the archive:

```bash
tar -xzf wiseeff-bridge_<version>_darwin_arm64.tar.gz
chmod +x wiseeff-bridge
```

3. Pair and start:

```bash
./wiseeff-bridge pair --server https://<your-wiseeff-origin> --code <6-digit-code>
./wiseeff-bridge start
```

Notes:

- The archive contains `cli.js` and a `wiseeff-bridge` launcher script that runs `node cli.js`.
- Bridge config is stored at `~/.wiseeff/bridge.json`.
- macOS does not use the Windows `service` commands; keep the bridge running in a terminal session, or use `launchd`/a process manager in your own ops environment.
- Install `adb` and/or `hdc` on the Mac and authorize the USB device before detecting targets in `/node-debugging`.

## Pairing Flow

1. Authenticated user requests a pairing code:
   - `POST /api/v1/device-bridges/pairing-codes`
2. Bridge CLI exchanges the code:
   - `POST /api/v1/device-bridges/pair`
3. Bridge stores returned `bridgeToken` and opens:
   - `WSS /api/v1/device-bridges/ws` with `Authorization: Bridge <token>`
4. Operator verifies bridge ownership/listing:
   - `GET /api/v1/device-bridges/mine`

## HDC And ADB Bridge RPC

The bridge CLI executes `adb` and `hdc` locally using the same argv, timeout, and shell-quoting rules as the server gateway adapters.

- `bridge.getCapabilities` reports whether `adb` and `hdc` binaries are available on the bridge host.
- `debug.detectTargets` accepts `protocol=adb` or `protocol=hdc` and returns targets from the selected protocol.
- `debug.readNode` / `debug.writeNode` route through the same protocol and target ref as server-hosted debugging.

Operator checks:

1. Confirm `hdc` or `adb` is on PATH in the same shell context used to start the bridge.
2. Pair and start the bridge, then verify `GET /api/v1/device-bridges/mine` shows the bridge online.
3. Call `POST /api/v1/debugging/targets/detect` with `protocol=hdc` or `protocol=adb` and confirm bridge-prefixed target ids (`bridge:<bridgeId>:...`).

## Debugging Execution Checks

Use `/api/v1/debugging/*` to verify bridge-backed behavior:

- target detect includes bridge-prefixed target ids (`bridge:<bridgeId>:...`)
- session creation persists `execution_mode=bridge`
- high-risk write without confirmation returns validation failure
- high-risk write with `confirm-high-risk-write` succeeds and creates snapshot metadata
- when multiple online bridges return targets, the UI requires explicit target selection before session create

## Conditional Acceptance Run

Run only when local bridge lab is available:

```bash
DEVICE_BRIDGE_LAB_AVAILABLE=true \
DEVICE_BRIDGE_SERVER_URL=https://<your-wiseeff-origin> \
npm run acceptance:e2e -- e2e/acceptance/local-device-bridge.acceptance.spec.ts
```

This spec remains skipped unless `DEVICE_BRIDGE_LAB_AVAILABLE=true`.

A separate HDC device-lab stub in the same file runs only when `DEVICE_BRIDGE_HDC_AVAILABLE=true` and a real paired bridge with HDC is available. CI keeps this path skipped; use it for manual hardware-lab evidence.

## Windows Service (Phase 2)

Run these commands from an elevated terminal on Windows after pairing the bridge.

Install registers a background service named `WiseEffBridge` using `sc.exe`. The CLI writes a small wrapper script under `%LOCALAPPDATA%\\WiseEff\\device-bridge\\start-service.cmd` that runs `node <cli.js> start`.

```powershell
wiseeff-bridge service install
wiseeff-bridge service start
wiseeff-bridge service stop
wiseeff-bridge service uninstall
```

Notes:

- Pair the bridge before starting the service (`wiseeff-bridge pair ...`).
- Service install/start/stop/uninstall are Windows-only; other platforms exit with a clear unsupported message.
- Uninstall stops the service, deletes the Windows service entry, and removes the wrapper script when present.

## Troubleshooting

- **Manifest missing Windows artifact**: check `DEVICE_BRIDGE_ARTIFACT_ROOT` and artifact layout.
- **Bridge websocket rejected**: verify token TTL/scopes and server clock skew.
- **Detect returns only server targets**: confirm bridge is online (`/device-bridges/mine`) and connected to WS path.
- **HDC detect empty but device is connected**: confirm `hdc list targets` works in the bridge host shell and the bridge was restarted after PATH changes.
- **ADB/HDC capability false in bridge health**: install the platform tools on the bridge host and restart the bridge process or Windows service.
- **Multiple bridges, wrong machine selected**: use machine labels in `/node-debugging` bridge management and the multi-bridge target picker before creating a session.
- **Write rejected**: verify role has `debugging:write` and include `confirm-high-risk-write` for high-risk parameters.
- **Rollback denied/conflict**: inspect active lease/session ownership and snapshot state.
