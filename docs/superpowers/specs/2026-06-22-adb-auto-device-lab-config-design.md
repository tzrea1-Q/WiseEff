# ADB Auto Device-Lab Configuration Design

> Chinese: [Chinese](../../zh-CN/superpowers/specs/2026-06-22-adb-auto-device-lab-config-design.md)

Date: 2026-06-22
Status: Approved for implementation planning

## Context

The first ADB device-lab acceptance design assumed that debugging parameters were project-scoped. That assumption is wrong for the product model:

- Parameter management remains project-scoped.
- Parameter debugging uses one shared debugging parameter library.
- Every project can run debugging operations against parameters from that shared library.
- The current project still matters as the operation context for authorization, sessions, operations, audit, and evidence.

The current ADB lab also requires operators to provide `ADB_SMOKE_PROJECT_ID`, `ADB_SMOKE_DEVICE_ID`, `ADB_SMOKE_TARGET_REF`, `ADB_SMOKE_PARAMETER_ID`, and `ADB_SMOKE_NODE_PATH`. This is too manual when a single ADB device is already connected. The lab should discover the connected target and derive the rest from the existing debugging catalog.

This spec supersedes the manual project-scoped configuration assumptions in `2026-06-21-adb-real-device-full-chain-test-design.md`.

## Decisions

- Use a shared debugging parameter library for ADB/HDC debugging parameters and protocol node bindings.
- Keep project id as the runtime context for sessions, operations, audit, and evidence.
- Introduce an explicit default ADB smoke binding marker in the shared binding catalog.
- Auto-configure the ADB device-lab read-only path when exactly one ready ADB device and exactly one default enabled ADB smoke binding are available.
- Do not auto-create or mutate bindings during the lab.
- Do not auto-enable write mode. Writes remain explicit and require operator-provided write value and confirmation tokens.

## Goals

- Let an operator connect one ADB device and run the read-only ADB lab without manually specifying target serial, device id, parameter id, or node path.
- Remove project filtering from the debugging parameter and binding library while preserving project-scoped operation records.
- Make the selected smoke parameter deterministic and auditable through an explicit catalog marker.
- Fail safely when discovery is ambiguous: multiple ready devices, no default smoke binding, multiple defaults, no ADB device inventory row, or multiple matching device inventory rows.
- Preserve compact/redacted evidence.

## Non-Goals

- Do not change parameter management scoping.
- Do not let the frontend expose raw node path editing to normal operators.
- Do not auto-create device inventory, parameter definitions, or node bindings as part of the lab run.
- Do not infer a safe smoke parameter by sorting all enabled bindings.
- Do not run writes without explicit `ADB_SMOKE_ENABLE_WRITE=true`, `ADB_SMOKE_WRITE_VALUE`, `ADB_SMOKE_CONFIRM_WRITE`, and `ADB_SMOKE_CONFIRM_ROLLBACK`.

## Domain Model

Debugging catalog data becomes organization-scoped rather than project-scoped:

- `debugging_parameters` represent shared debug parameters for an organization.
- `debugging_parameter_node_bindings` represent protocol-specific node paths for those shared parameters.
- Project-scoped runtime tables remain project-scoped:
  - `debugging_sessions`
  - `debug_device_leases`
  - `node_operations`
  - `debugging_snapshots`
  - `debugging_events`
  - `audit_events`

Implementation should keep backward compatibility during migration. A practical path is:

- allow catalog `project_id` columns to become nullable,
- treat `project_id is null` as the shared catalog scope,
- update catalog reads to include shared rows for any project context,
- migrate or seed the default ADB smoke binding as a shared row,
- keep existing project-scoped catalog rows readable during transition where needed.

## Default ADB Smoke Binding

Add an explicit marker to `debugging_parameter_node_bindings`. The exact storage shape can be a boolean column such as `is_smoke_default`, or a small profile field such as `smoke_profile = 'adb-readonly-default'`. The implementation should prefer the simplest shape that supports these rules:

- The default applies to protocol `adb`.
- The binding must be `enabled = true`.
- The binding must be read-safe. For automatic read-only lab selection, `access_mode` must allow read.
- There must be at most one default ADB smoke binding per organization.
- If no default exists, the lab fails with a redacted diagnostic.
- If more than one default exists, the lab fails with a redacted diagnostic.

The default marker is catalog governance data. The acceptance test may read it, but must not create, update, or repair it.

## Auto-Configuration Flow

The read-only ADB lab should support this minimal environment:

```bash
DEBUG_DEVICE_GATEWAY_MODE=adb
ADB_DEVICE_LAB_AVAILABLE=true
ADB_SMOKE_PROJECT_ID=aurora
```

`ADB_SMOKE_PROJECT_ID` remains required as operation context, not as catalog filter. The rest is discovered:

1. Run `adb devices`.
2. Require exactly one ready target with state `device`.
3. Use that serial as `targetRef`.
4. Find the WiseEff debugging device inventory row for transport `adb`.
5. If exactly one eligible ADB device row exists, use it as `deviceId`.
6. If no eligible row or multiple eligible rows exist, fail safely with redacted candidates.
7. Find the shared default enabled ADB smoke binding.
8. Use its `parameterId` and server-side `nodePath`.
9. Start `/node-debugging?project=$ADB_SMOKE_PROJECT_ID` and switch to ADB.
10. Use request API calls with explicit `projectId`, discovered `deviceId`, discovered `targetRef`, and discovered `parameterId`.
11. Let the backend resolve the node path from the persisted binding.

Optional overrides may remain for diagnostics or local transition, but they must not be required for the normal single-device/default-binding case:

- `ADB_SMOKE_DEVICE_ID`
- `ADB_SMOKE_TARGET_REF`
- `ADB_SMOKE_PARAMETER_ID`
- `ADB_SMOKE_NODE_PATH`

If overrides are present, they should be validated against discovered data and existing bindings rather than silently trusted.

## Safety Rules

- Single-device preflight remains mandatory.
- Auto-configuration only selects existing enabled ADB bindings.
- The selected default binding must not be created or mutated by the lab.
- Read-only mode must not call write or rollback APIs.
- Write mode remains opt-in and requires explicit write value and confirmation tokens.
- Evidence must continue to use shape/status/equality summaries and must not publish raw ADB serials, raw node paths, raw read/write values, or raw operation/session/snapshot/request/audit identifiers.

## Error Handling

All failure messages should be actionable but redacted:

- no `adb` binary on PATH,
- no ready ADB device,
- multiple ready ADB devices,
- no ADB debugging device inventory row,
- multiple ADB debugging device inventory rows,
- no default ADB smoke binding,
- multiple default ADB smoke bindings,
- default binding disabled,
- default binding not readable,
- discovered/overridden target mismatch,
- missing project context,
- backend read failure.

Diagnostics should report counts, protocol, access-mode category, enabled/default status, and identifier shapes rather than raw ids or node paths.

## Testing

Add or update tests for:

- repository selection of shared debugging parameters and shared protocol bindings across project contexts,
- uniqueness and retrieval of the default ADB smoke binding,
- service/API list behavior showing the shared debugging catalog for any project,
- ADB lab config resolution with a single ready device and one default ADB smoke binding,
- failure on multiple ready devices,
- failure on missing or multiple default smoke bindings,
- failure on no or multiple ADB device inventory rows,
- write mode still requiring explicit confirmation env vars,
- evidence and diagnostics redaction.

The hardware-gated acceptance flow should still skip unless `ADB_DEVICE_LAB_AVAILABLE=true`.

## Documentation Impact

Update:

- `docs/runbooks/adb-device-lab.md`
- `docs/zh-CN/runbooks/adb-device-lab.md`
- `docs/developer/environment-variables.md`
- `docs/zh-CN/developer/environment-variables.md`
- `docs/design-docs/domain-model.md`
- `docs/zh-CN/design-docs/domain-model.md`
- `docs/design-docs/api-contract.md`
- `docs/zh-CN/design-docs/api-contract.md`
- `docs/generated/db-schema.md`

The docs must state clearly that debugging parameters are shared across projects, while debugging operations remain project-contextual.

## Acceptance Criteria

- With one connected ADB device, one ADB device inventory row, and one shared default read-safe ADB smoke binding, the lab can run the read-only path without manual target/device/parameter/node env vars.
- The generated evidence identifies auto-configuration by shape summaries and records that the selected binding was existing and enabled.
- With ambiguous discovery, the lab fails before device read and emits redacted actionable diagnostics.
- Project-specific operation, audit, and session records still use the provided project context.
- Existing write-mode safety remains intact.
