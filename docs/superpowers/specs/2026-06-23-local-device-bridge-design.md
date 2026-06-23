# Local Device Bridge Design

> Chinese: [Chinese](../../zh-CN/superpowers/specs/2026-06-23-local-device-bridge-design.md)

Date: 2026-06-23
Status: Approved for implementation planning

## Context

WiseEff device debugging currently executes `adb` and `hdc` on the machine where the API server runs. Users who access a remotely deployed WiseEff instance from their browser cannot debug phones connected over USB to their own PC.

The product already has:

- a governed debugging API (`detect`, `session`, `read`, `write`, `snapshot`, `rollback`, audit),
- protocol-routed HDC/ADB gateway adapters on the server,
- a local Vite HDC bridge for non-API development only,
- and a separate AI Agent feature that must not be confused with this work.

This design adds a **Local Device Bridge** (not an AI agent): a user-installed CLI daemon on the engineer's computer that maintains an outbound WebSocket to the deployed WiseEff server and executes `adb`/`hdc` locally while the server keeps full governance.

## Terminology

| Term | Meaning |
| --- | --- |
| **Device Bridge** | Local CLI daemon that executes `adb`/`hdc` on the user's PC |
| **Remote debugging service** | Existing WiseEff debugging API and governance layer |
| **AI Agent** | Existing conversational/tooling feature; out of scope here |

## Decisions

- Keep **full remote governance**: auth, permissions, sessions, device leases, pre-write snapshots, rollback confirmation, and audit remain on the server.
- Support **both ADB and HDC** in the bridge RPC surface.
- Use an **outbound WebSocket** from the bridge to the deployed server.
- Ship the bridge as a **CLI daemon** with minimal user configuration.
- Bind **one bridge per machine per user**; a user may register multiple machines.
- Select the execution bridge by **parallel detect across online bridges** and only surface bridges that actually found devices.
- Issue **independent bridge credentials** via short-lived pairing codes; do not reuse browser login tokens in the bridge.
- Serve bridge installers from the **same deployed WiseEff origin**; do not require GitHub or other public download hosts for end users.
- Prioritize **Windows compatibility first** for v1 packaging, install flow, daemon lifecycle, and frontend install guidance.

## Goals

- A user on Windows can open the remotely hosted `/node-debugging` page, install the bridge from the same WiseEff domain, pair once, and debug a USB-connected phone on their PC.
- Read/write/rollback continue through the existing debugging API and retain leases, snapshots, audit, and permission checks.
- Multiple online bridges for one user are supported; the UI auto-discovers the bridge that actually sees a device.
- Operators can bundle bridge artifacts into self-hosted releases without depending on external download infrastructure.

## Non-Goals

- Browser-direct device command execution.
- Arbitrary shell execution from the bridge.
- Frontend-configured `adb`/`hdc` binary paths.
- Replacing server-hosted HDC lab mode or the simulator gateway.
- Auto-update inside the bridge binary in v1.
- macOS/Linux parity packaging before Windows v1 is stable.

## Architecture

Recommended approach: **server gateway delegation**.

The debugging service keeps the same business flow. When a session is marked `execution_mode = bridge`, the server does not spawn local `adb`/`hdc`. Instead it sends RPC commands over the user's connected bridge WebSocket, then persists operations, snapshots, and audit after the bridge returns.

```text
Browser -> HTTPS -> Debugging API (governance)
Device Bridge -> WSS -> Bridge Connection Pool -> RPC -> adb/hdc on user PC
```

### Components

1. **Device Bridge CLI**
   - Commands: `pair`, `start`, `status`
   - Executes `adb`/`hdc` locally using shared argv/timeout/shell-quoting rules extracted from server gateway code
   - Maintains outbound WSS, heartbeat, and RPC handling
   - Exposes localhost health only for frontend install/pairing detection

2. **Bridge Registry (server)**
   - Persists bridge registrations and hashed bridge tokens
   - Tracks online connections in memory: `bridgeId -> WebSocket`
   - Publishes same-origin download manifest for bridge artifacts

3. **Debugging Service extension**
   - Adds `execution_mode` and `bridge_id` to sessions
   - Parallel detect across online bridges for the authenticated user
   - Read/write/rollback delegate to bridge RPC when session execution mode is `bridge`

4. **Frontend pairing and install UX**
   - Detects local bridge health on `127.0.0.1`
   - Shows same-origin download and Windows-first install commands
   - Creates pairing codes and shows post-pair "connect local device" flow

## Windows-First Delivery

v1 packaging and UX must treat Windows as the primary supported client platform.

### Windows v1 requirements

- Primary artifact: `wiseeff-bridge_<version>_windows_amd64.zip`
- Optional later artifact: signed Windows installer (`.msi` or `.exe`), not required for first release
- Bridge config path: `%LOCALAPPDATA%\WiseEff\bridge.json`
- Local health endpoint default: `http://127.0.0.1:18787/health`
- `start` supports:
  - foreground console mode for first-time validation
  - `--service install` / `--service start` for persistent background execution on Windows
- Install docs and frontend copy must include:
  - PowerShell download/unblock/extract example using the deployed origin
  - `adb`/`hdc` PATH guidance for Windows
  - USB driver / device-authorization troubleshooting links in product docs

### Secondary platforms in v1

- macOS and Linux bridge binaries may be published in the same manifest, but they are not blocking for the first release gate.
- Frontend should still list non-Windows artifacts when present, without prioritizing them in the primary call to action.

## Pairing and Bridge Token Security

### Pairing flow

1. User opens `/node-debugging` and clicks **Connect local device**.
2. Frontend checks `http://127.0.0.1:18787/health`.
3. If no bridge is installed, frontend loads `GET /api/v1/device-bridges/releases` and shows a same-origin Windows download button plus copyable install commands.
4. Frontend creates a pairing code via `POST /api/v1/device-bridges/pairing-codes`.
5. User runs `wiseeff-bridge pair --server https://<same-origin> --code <code>` or opens a custom URL scheme handler.
6. Bridge exchanges the pairing code for `bridgeId` + bridge token and stores them locally.
7. User runs `wiseeff-bridge start`; bridge opens WSS to the server.
8. Frontend refreshes `GET /api/v1/device-bridges/mine` and proceeds to detect.

### Pairing code rules

- 6-digit numeric code
- TTL: 5 minutes
- One-time use
- Bound to creating `userId`

### Bridge token rules

- Issued only through pairing-code exchange
- Stored hashed in the database
- Scopes: `device-bridge:connect`, `device-bridge:execute`
- Cannot call non-bridge admin or business APIs
- Default lifetime: 90 days with rotation on re-pair
- Revocable per bridge from user settings

### Security boundaries

- Browser user bearer tokens must never be written into bridge config.
- Write requests still require the user's normal API auth and `debugging:write`.
- The bridge only executes server-authorized RPC after server-side lease and snapshot checks.
- Audit records both the user actor and the executing bridge.

## Same-Origin Bridge Distribution

End users must download bridge artifacts from the WiseEff deployment they are already using.

### Download surfaces

- Metadata API: `GET /api/v1/device-bridges/releases`
- Static files: `GET /downloads/device-bridge/<version>/<platform>/<arch>/<artifact>`

The API returns relative `downloadUrl` values so the browser stays on the same origin.

### Operator packaging

```text
ops/self-hosted/bridge-artifacts/
  0.1.0/
    manifest.json
    windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip
    darwin/arm64/...
    linux/amd64/...
```

Preferred v1 hosting:

- mount `bridge-artifacts` into the reverse proxy
- serve `/downloads/device-bridge/*` as read-only static files
- keep `manifest.json` as the source of truth for version and SHA-256

Object-store hosting remains a valid later option for multi-node deployments.

### Version compatibility

- Bridge reports `clientVersion` during WSS hello.
- Server exposes `recommendedVersion` and `minCompatibleVersion`.
- Outdated bridges receive `BRIDGE_VERSION_UNSUPPORTED` and the frontend points users to the same-origin download page.

## WebSocket RPC Protocol

### Connection

```text
WSS /api/v1/device-bridges/ws
Authorization: Bridge <bridgeToken>
```

Server hello:

```json
{
  "type": "bridge.hello",
  "bridgeId": "br_...",
  "serverTime": "2026-06-23T12:00:00.000Z",
  "heartbeatIntervalMs": 15000
}
```

### RPC methods (v1)

| Method | Purpose |
| --- | --- |
| `bridge.getCapabilities` | Report adb/hdc availability and versions |
| `debug.detectTargets` | Run `adb devices` or `hdc list targets` |
| `debug.readNode` | Read a bound node path |
| `debug.writeNode` | Write a bound node path with optional readback |

The server resolves `nodePath` from parameter bindings before RPC. The bridge must not accept arbitrary path writes outside RPC payloads authorized by the server.

### Execution rules

- Default timeouts: detect 5s, read/write 10s
- Serialize device commands per `bridgeId`
- Parallel detect is allowed across different bridges, not across concurrent writes on one bridge
- Bridge disconnect during write marks the operation failed; valid snapshots remain retryable

## Session and Target Model

### `debugging_sessions` additions

```text
execution_mode text not null default 'server'  -- 'server' | 'bridge'
bridge_id text null
bridge_machine_label text null
```

Rules:

- `execution_mode = bridge` requires `bridge_id`
- bridge selection is fixed for the session lifetime
- changing PCs requires ending the session and detecting again

### Parallel bridge detect

`POST /api/v1/debugging/targets/detect`:

1. Enumerate online bridges for the authenticated user.
2. Issue `debug.detectTargets` RPC to each bridge with `allSettled`.
3. Drop offline, timed-out, or empty-target bridges.
4. Return only targets from bridges that found devices.

Suggested target id format:

```text
bridge:{bridgeId}:{protocol}:{targetRef}
```

### Coexistence with server-hosted mode

| Scenario | `execution_mode` |
| --- | --- |
| Self-hosted/server USB lab | `server` |
| Engineer USB on local Windows PC | `bridge` |
| Simulator | `server` + simulator gateway |

## Frontend UX

### Connect-local-device states

| State | UI |
| --- | --- |
| No local bridge | Windows download CTA + PowerShell install snippet |
| Bridge installed, not paired | pairing code + `wiseeff-bridge pair ...` |
| Bridge paired, not running | `wiseeff-bridge start` helper |
| Bridge online, no device | "Bridge connected, no device found" troubleshooting |
| One bridge + one target | auto-create session |
| Multiple bridges with targets | show bridge label + target, user confirms |

### Windows-first copy

Primary install panel on `/node-debugging` must default to Windows download and commands. macOS/Linux instructions belong in a secondary expandable section.

### User bridge management

Add a lightweight settings surface:

- list registered bridges
- rename machine label
- revoke bridge token
- view last seen and supported protocols

## Data Model

### `device_bridges`

```text
id text primary key
organization_id text not null
user_id text not null
machine_label text not null
platform text not null            -- windows | darwin | linux
arch text not null
client_version text null
capabilities jsonb not null default '{}'::jsonb
created_at timestamptz not null default now()
last_seen_at timestamptz null
revoked_at timestamptz null
```

### `device_bridge_tokens`

```text
id text primary key
bridge_id text not null references device_bridges(id)
token_hash text not null
scopes text[] not null
expires_at timestamptz not null
revoked_at timestamptz null
created_at timestamptz not null default now()
last_used_at timestamptz null
```

### `device_bridge_pairing_codes`

```text
id text primary key
organization_id text not null
user_id text not null
code_hash text not null
expires_at timestamptz not null
consumed_at timestamptz null
created_at timestamptz not null default now()
```

## Error Handling

| Condition | Behavior |
| --- | --- |
| No online bridge | Show install/start instructions |
| Bridge online, no device | Show USB/driver/HDC or ADB authorization help |
| Detect timeout on one bridge | Omit that bridge, continue with others |
| Bridge disconnect mid-write | Operation fails; snapshot remains valid for retry |
| Expired bridge token | WSS rejected; frontend asks user to re-pair |
| Revoked bridge | Disconnect and invalidate active bridge sessions |
| `adb`/`hdc` missing on Windows | `bridge.getCapabilities` reports unavailable; disable protocol with reason |
| Corporate network blocks WSS | Document required allowlist; no HTTP polling fallback in v1 |

## Testing Strategy

### Automated

- Server unit tests for pairing-code issue/consume, token hashing, and RPC timeout normalization
- Debugging service tests for parallel bridge detect aggregation and `execution_mode = bridge` routing
- Contract tests for `/device-bridges/releases` manifest shape and same-origin relative URLs
- Shared command-runner tests reused by bridge and server gateway packages

### Manual / lab

- Windows 10/11 AMD64 acceptance:
  - download from deployed origin
  - pair
  - start as foreground process
  - ADB detect/read/write with governed confirmation
  - HDC detect/read when `hdc` is installed
- Multi-bridge scenario: two Windows PCs online, only the PC with USB device appears in detect results
- Revoke bridge token and confirm active session failure is auditable

## Phased Delivery

### Phase 1 — Windows bridge MVP

- Bridge CLI for Windows AMD64
- Same-origin artifact manifest + static downloads
- Pairing, WSS RPC, bridge registry
- `/node-debugging` Windows install panel
- ADB end-to-end with full governance

### Phase 2 — HDC + hardening

- HDC RPC support on Windows bridge
- Windows service install/start commands
- bridge management UI (rename/revoke)
- multi-bridge parallel detect polish

### Phase 3 — secondary platforms

- macOS/Linux bridge artifacts
- optional signed Windows installer
- optional object-store-backed artifact hosting

## Documentation Impact

- `docs/FRONTEND.md` and Chinese companion: local bridge connect flow
- `docs/SECURITY.md` and Chinese companion: bridge token boundary
- `docs/developer/environment-variables.md`: bridge release manifest paths and Windows service notes
- `ops/self-hosted/README.md`: bridge artifact bundling and Caddy `/downloads` routing
- `docs/design-docs/domain-model.md`: `device_bridges` and bridge-backed sessions

## References

- `docs/superpowers/specs/2026-06-21-adb-hdc-debugging-protocol-design.md`
- `docs/design-docs/2026-05-15-node-debugging-design.md`
- `docs/zh-CN/design-docs/deployment-operations.md`
- `server/modules/debugging/adbGateway.ts`
- `server/modules/debugging/hdcGateway.ts`
