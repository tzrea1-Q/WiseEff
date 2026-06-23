# Local Device Bridge Runbook

> Chinese: [Chinese](../zh-CN/runbooks/local-device-bridge.md)

This runbook covers WiseEff Local Device Bridge Phase 1 operations for self-hosted environments, including pairing, connectivity checks, and conditional acceptance execution.

## Scope

- Phase 1 supports Windows-first bridge pairing and runtime.
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

## Artifact And Manifest Checks

1. Confirm bridge artifacts exist under `DEVICE_BRIDGE_ARTIFACT_ROOT`.
2. Verify manifest endpoint:
   - `GET /api/v1/device-bridges/releases`
3. Confirm Windows AMD64 item exists and uses same-origin relative URL:
   - `/downloads/device-bridge/<version>/windows/amd64/...zip`

## Pairing Flow

1. Authenticated user requests a pairing code:
   - `POST /api/v1/device-bridges/pairing-codes`
2. Bridge CLI exchanges the code:
   - `POST /api/v1/device-bridges/pair`
3. Bridge stores returned `bridgeToken` and opens:
   - `WSS /api/v1/device-bridges/ws` with `Authorization: Bridge <token>`
4. Operator verifies bridge ownership/listing:
   - `GET /api/v1/device-bridges/mine`

## Debugging Execution Checks

Use `/api/v1/debugging/*` to verify bridge-backed behavior:

- target detect includes bridge-prefixed target ids (`bridge:<bridgeId>:...`)
- session creation persists `execution_mode=bridge`
- high-risk write without confirmation returns validation failure
- high-risk write with `confirm-high-risk-write` succeeds and creates snapshot metadata

## Conditional Acceptance Run

Run only when local bridge lab is available:

```bash
DEVICE_BRIDGE_LAB_AVAILABLE=true \
DEVICE_BRIDGE_SERVER_URL=https://<your-wiseeff-origin> \
npm run acceptance:e2e -- e2e/acceptance/local-device-bridge.acceptance.spec.ts
```

This spec remains skipped unless `DEVICE_BRIDGE_LAB_AVAILABLE=true`.

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
- **Write rejected**: verify role has `debugging:write` and include `confirm-high-risk-write` for high-risk parameters.
- **Rollback denied/conflict**: inspect active lease/session ownership and snapshot state.
