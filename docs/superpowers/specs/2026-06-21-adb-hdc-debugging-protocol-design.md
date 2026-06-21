# ADB/HDC Debugging Protocol Design

> Chinese: [Chinese](../../zh-CN/superpowers/specs/2026-06-21-adb-hdc-debugging-protocol-design.md)

Date: 2026-06-21
Status: Approved for implementation planning

## Context

WiseEff currently supports production-oriented device debugging through the backend `DebuggingGateway` seam and an HDC gateway adapter. The `/node-debugging` frontend uses the API gateway in API mode, while a local Vite `/api/hdc/*` bridge remains available for non-API development experiments.

The next debugging requirement is to support ADB commands as a first-class backend capability, allow users to switch between HDC and ADB in the frontend, and manage node metadata for HDC and ADB separately.

## Decisions

- Treat ADB/HDC as a debugging connection protocol, not as separate business workflows.
- Add `DebugConnectionProtocol = "hdc" | "adb"` as a domain concept.
- Keep the backend API as the production path. Do not add a new frontend `/api/adb/*` local bridge for this scope.
- Let users choose the protocol per `/node-debugging` session. First-time default remains HDC; the UI may remember the user's last choice.
- Keep one business debug-parameter catalog, with separate per-protocol node bindings for HDC and ADB.
- Execute ADB from the backend server PATH as `adb`, using argument-array process execution, command timeouts, and the same safety model as HDC.
- Do not expose raw node paths in the normal node-debugging workflow. Admin node-management screens own node paths and access modes.

## Goals

- Users can switch between HDC and ADB on `/node-debugging`, detect targets, create sessions, read nodes, write nodes, and rollback through the same governed backend path.
- Admin users can manage HDC and ADB node bindings separately for the same debug parameter.
- ADB reads and writes reuse existing backend permission, lease, snapshot, readback, rollback, audit, metrics, and tracing boundaries.
- Existing HDC behavior and M3/M5 debugging verification continue to pass.
- Parameters without a binding for the selected protocol are visible but cannot be read or written, with a clear disabled reason.

## Non-Goals

- Do not create two independent debug-parameter catalogs.
- Do not let regular users enter arbitrary node paths from `/node-debugging`.
- Do not make the frontend execute device commands directly.
- Do not support frontend-configured or Admin-configured ADB binary paths in this scope.
- Do not require real ADB hardware in default CI. Hardware acceptance belongs in a device-lab smoke.

## Architecture

The backend debugging module should become a protocol-routed gateway system:

- `HdcDebugDeviceGateway` keeps the existing HDC behavior.
- `AdbDebugDeviceGateway` adds ADB target detection, node reads, node writes, and readback verification.
- `DebugDeviceGatewayRegistry` selects an adapter by `protocol`.
- `debugging_sessions` stores the protocol selected when the session was created.
- `node_operations` stores the protocol used for each operation.
- audit metadata includes `protocol`, `targetRef`, `deviceId`, and `parameterId`.

After a session is created, read/write/rollback operations should derive the protocol from the session instead of trusting a protocol field from the frontend.

## Data Model

Add the protocol enum in TypeScript:

```ts
export type DebugConnectionProtocol = "hdc" | "adb";
```

Keep `debugging_parameters` as the business catalog:

- `id`
- `name`
- `key`
- `module`
- `risk`
- `range_label`
- `unit`
- current and target value fields

Add protocol-specific bindings:

```text
debugging_parameter_node_bindings
- id
- organization_id
- project_id
- parameter_id
- protocol text not null
- node_path text not null
- access_mode text not null
- enabled boolean not null default true
- notes text
- metadata jsonb not null default '{}'::jsonb
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- unique (parameter_id, protocol)
```

Add `protocol` to:

- `debugging_targets`
- `debugging_sessions`
- `node_operations`

Snapshot entries should include the protocol and node path used at snapshot time so rollback uses the original adapter and original node binding context.

Existing `debugging_parameters.node_path` and `access_mode` should migrate into `protocol = "hdc"` bindings. Keep the legacy columns for one compatibility release if needed, but the service should move to binding reads.

## Frontend Design

`/node-debugging` gets a protocol segmented control in the page header or topbar:

```text
Connection protocol  [ HDC ] [ ADB ]
```

Behavior:

- The first-time default is HDC.
- The selected protocol can be persisted per user in local storage or user preferences.
- Switching protocol clears the active target and session and asks the user to detect a target again.
- Target detection sends the selected protocol to the backend.
- Once connected, the page displays protocol, target reference, and session state.
- The table remains parameter-centric. It shows the current protocol binding status without showing raw node paths.
- Rows without an enabled binding for the selected protocol disable read/write actions and show a reason.
- `RO`, `WO`, and `RW` continue to drive read/write affordances.

`/debugging-admin` manages per-parameter node bindings:

```text
Parameter: fast-charge current limit
Base fields: name / key / module / risk / range / unit

Node bindings
[ HDC ] nodePath / accessMode / enabled / notes
[ ADB ] nodePath / accessMode / enabled / notes
```

Admin validation:

- `nodePath` is required for an enabled binding.
- `nodePath` must start with `/`.
- `nodePath` must not include control characters.
- `accessMode` must be `RO`, `WO`, or `RW`.
- A parameter may have only HDC, only ADB, both, or neither configured.
- Deleting should generally become `enabled = false` so historical operations keep context.

Admin list views should show protocol coverage labels such as `HDC configured`, `ADB configured`, `dual protocol`, `missing ADB`, and `missing HDC`.

## API Contract

Keep the current route family and extend DTOs:

```text
GET  /api/v1/debugging/devices?projectId=...
GET  /api/v1/debugging/parameters?projectId=...&protocol=adb
POST /api/v1/debugging/targets/detect
POST /api/v1/debugging/sessions
GET  /api/v1/debugging/sessions/:sessionId
GET  /api/v1/debugging/sessions/:sessionId/events
POST /api/v1/debugging/nodes/read
POST /api/v1/debugging/nodes/write
POST /api/v1/debugging/snapshots/:snapshotId/rollback
```

Target detection request:

```json
{
  "projectId": "project-1",
  "deviceId": "device-1",
  "protocol": "adb"
}
```

Session creation request:

```json
{
  "projectId": "project-1",
  "deviceId": "device-1",
  "targetId": "adb:emulator-5554",
  "protocol": "adb"
}
```

Node read request:

```json
{
  "sessionId": "session-1",
  "parameterId": "debug-param-1"
}
```

Node write request:

```json
{
  "sessionId": "session-1",
  "parameterId": "debug-param-1",
  "value": "42",
  "confirmationToken": "confirm-high-risk-write"
}
```

The frontend should stop sending `nodePath` for API-mode read/write. The backend resolves `nodePath` from `(parameterId, session.protocol)`.

Parameter listing should support two views:

- Without `protocol`, return parameters with all bindings for Admin management.
- With `protocol`, return parameters plus the selected binding state for `/node-debugging`.

## Service Flow

### Detect Targets

1. Validate `protocol`.
2. Check `debugging:read` and project access.
3. Select the gateway from `DebugDeviceGatewayRegistry`.
4. Run protocol-specific detection.
5. Upsert targets with `protocol`.
6. Write debug event and audit metadata with protocol and target count.

ADB detection uses `adb devices`, parses attached device serials, and creates target ids such as `adb:<serial>`.

### Create Session

1. Validate `projectId`, `deviceId`, `targetId`, and `protocol`.
2. Check target exists and `target.protocol === input.protocol`.
3. Check device and target project ownership.
4. Create a session with `protocol`.
5. Write session-created event and audit metadata.

### Read Node

1. Check `debugging:read`.
2. Load active session and derive `protocol`.
3. Load enabled node binding for `(parameterId, protocol)`.
4. Validate that the binding is readable.
5. Load session target.
6. Select the gateway by session protocol and read the binding node path.
7. Persist `node_operations.protocol`.
8. Write audit metadata.

### Write Node

1. Check `debugging:write`.
2. Load active session and derive `protocol`.
3. Load enabled node binding for `(parameterId, protocol)`.
4. Validate writable access mode, range, and high-risk confirmation.
5. Acquire the existing device lease.
6. Read previous value through the session protocol.
7. Create a snapshot entry with protocol and node path.
8. Write through the protocol gateway.
9. Run readback for `RW` bindings.
10. Persist operation, snapshot, debug event, and audit evidence.

### Rollback

1. Load snapshot and session.
2. Use the original session protocol and snapshot-entry protocol.
3. Require confirmation token and device lease.
4. Write previous values through the matching protocol gateway.
5. Persist rollback operations and mark snapshot status.
6. Write audit evidence.

Rollback must not use HDC to roll back an ADB snapshot, or ADB to roll back an HDC snapshot.

## ADB Gateway

The ADB adapter should follow the existing HDC adapter shape:

- command: `adb`
- timeout: reuse the debugging gateway timeout default unless the implementation plan chooses a separate constant.
- process execution: `spawn(command, args, { shell: false })`
- target detection: `adb devices`
- read: `adb -s <serial> shell cat <nodePath>`
- write: `adb -s <serial> shell sh -c ...`
- result normalization: timeout, non-zero exit, stderr, stdout, duration, readback mismatch.

Safety rules:

- The frontend never controls the ADB binary path.
- The Admin UI controls only node bindings, not command templates.
- `nodePath` must come from an enabled binding and pass validation.
- Values and paths must be passed safely through the shell layer used after `adb shell`.
- Unit tests must cover values with spaces and shell-sensitive characters.

## Errors

Add or standardize these error cases:

- `PROTOCOL_UNSUPPORTED`: backend has no enabled adapter for the requested protocol.
- `DEBUG_BINDING_NOT_CONFIGURED`: selected parameter has no binding for the session protocol.
- `DEBUG_BINDING_DISABLED`: selected protocol binding is disabled.
- `DEVICE_UNAVAILABLE`: target is offline, unavailable, or command execution failed.
- `DEVICE_GATEWAY_TIMEOUT`: command timeout.
- `DEBUG_READBACK_MISMATCH`: write completed but readback did not match.
- `VALIDATION_FAILED`: invalid protocol, node path, access mode, range, or value.

UI copy should map these to actionable Chinese messages without exposing raw node paths to regular users.

## Migration

1. Add the binding table and protocol columns.
2. Backfill `debugging_targets.protocol`, `debugging_sessions.protocol`, and `node_operations.protocol` to `hdc`.
3. Backfill `debugging_parameter_node_bindings` from existing `debugging_parameters.node_path` and `access_mode` as HDC bindings.
4. Update seed data to include HDC bindings and optional sample ADB bindings.
5. Keep existing HDC behavior passing before enabling ADB UI controls.

## Testing

Backend tests:

- protocol registry selects the correct adapter.
- ADB gateway parses `adb devices`.
- ADB gateway handles read, write, readback success, readback mismatch, timeout, non-zero exit, and missing command.
- binding repository covers configured, missing, disabled, and invalid binding states.
- service read/write/rollback use session protocol and reject protocol mismatches.
- audit metadata includes protocol.

Frontend tests:

- protocol switch clears current target and session.
- selected protocol is passed to target detection.
- rows without a selected-protocol binding disable read/write actions.
- Admin can edit HDC and ADB bindings separately.
- normal `/node-debugging` does not render raw node paths.

E2E and acceptance:

- Existing simulator and HDC M3/M5 tests continue to pass.
- Add an ADB device-lab smoke gated by environment variables, analogous to the HDC device-lab smoke.
- Default CI uses mocked gateway tests and API contract tests, not real hardware.

Frontend-visible changes require Playwright browser verification for desktop `1440x900`, tablet `768x1024`, and mobile `390x844`, including snapshots, screenshots, console error checks, protocol switching, target detection states, disabled rows, and Admin binding editing.

## Documentation

Update these docs during implementation:

- `docs/FRONTEND.md`: describe protocol switching and binding-aware node debugging.
- `docs/SECURITY.md`: state that ADB and HDC both go through backend gateway, authz, lease, snapshot, rollback, and audit boundaries.
- `docs/design-docs/domain-model.md`: add protocol and node-binding concepts.
- `docs/design-docs/api-contract.md`: document protocol fields and binding-aware read/write requests.
- `docs/generated/db-schema.md`: regenerate schema summary.
- `docs/runbooks/adb-device-lab.md`: add real-device evidence procedure.
- Chinese equivalents for developer-facing docs that humans are expected to read.

## Phased Delivery

1. Data model and API contract: add protocol and binding structures while preserving HDC behavior.
2. ADB backend adapter: implement `AdbDebugDeviceGateway` and registry with mock-runner tests.
3. Service binding flow: move read/write/rollback to session protocol and binding lookup.
4. Frontend protocol switching and Admin binding management.
5. Device-lab acceptance and documentation updates.

## Success Criteria

- `/node-debugging` lets users choose HDC or ADB, detect a target, and create a matching protocol session.
- The same debug parameter can have separate HDC and ADB node bindings.
- ADB reads and writes go through backend permissions, leases, snapshots, rollback, audit, metrics, and tracing.
- Rows missing a binding for the selected protocol are disabled with a clear reason.
- Existing HDC functionality and M3/M5 verification do not regress.
