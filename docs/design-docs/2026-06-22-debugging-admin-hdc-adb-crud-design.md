# Debugging Admin HDC/ADB Catalog CRUD Design

> Chinese: [Chinese](../zh-CN/design-docs/2026-06-22-debugging-admin-hdc-adb-crud-design.md)

Date: 2026-06-22
Status: **Superseded** by the node-only catalog contract in [`domain-model.md`](domain-model.md#node-registry-vs-parameter-reload-td-032)

This file preserves the 2026-06-22 parameter-catalog design as historical evidence. The product now governs `debug_nodes` / `debug_node_bindings`; legacy parameter Admin HTTP/client routes are retired while their tables and history remain intact.

## Context

WiseEff node debugging now supports HDC and ADB as protocol-aware runtime paths. `/node-debugging` can switch protocols and consumes backend parameter DTOs with protocol bindings. The backend already has `debugging_parameter_node_bindings`, selected bindings, and protocol-aware session/read/write flows.

The debugging management page has not caught up. `/debugging-admin` still edits the old frontend `configDraft.debugParameters` shape, exposes a single `nodePath` and `accessMode`, and disables editing in API mode. That leaves the admin surface unable to govern the HDC/ADB binding catalog that the runtime now depends on.

This design upgrades `/debugging-admin` into a backend-backed debugging catalog management console.

## Decisions

- Manage the full debugging parameter catalog, not only bindings for pre-existing parameters.
- Make the backend database the source of truth in API mode.
- Add Admin CRUD APIs for debug parameters and HDC/ADB node bindings.
- Save directly to the database. Changes take effect after `/node-debugging` refreshes its parameter list.
- Treat delete as archive or disable by default, not hard delete.
- Keep `/node-debugging` on the existing runtime `GET /api/v1/debugging/parameters?protocol=...` path.
- Keep mock/config-draft behavior available for frontend-only demos and tests, but do not use it as the API-mode admin source.

## Goals

- Admin users can create, edit, archive, and restore debugging parameters.
- Admin users can create, edit, enable, disable, and archive HDC and ADB bindings independently for each parameter.
- `/node-debugging` and `/debugging-admin` read from the same backend catalog in API mode.
- Runtime parameter lists only expose executable enabled parameters and selected protocol bindings.
- Admin lists can show full governance state, including archived parameters and missing protocol bindings.
- Historical operations, audit records, snapshots, and rollback evidence remain understandable after a parameter is archived.

## Non-Goals

- Do not add a draft, review, or publish workflow in this scope.
- Do not hard-delete parameters as the normal admin action.
- Do not let `/node-debugging` accept arbitrary raw node paths from normal users.
- Do not merge HDC and ADB into one binding row.
- Do not make catalog edits perform device reads or writes.
- Do not implement active device-side node detection as part of the first admin CRUD scope.

## Architecture

`/debugging-admin` becomes a debugging catalog management console.

In API mode, the page talks to new backend Admin APIs under `/api/v1/debugging/admin/*`. Those APIs manage two related resources:

- `debugging_parameters`: business-level debug parameter metadata.
- `debugging_parameter_node_bindings`: protocol-specific HDC and ADB node bindings.

The backend remains the source of truth. Admin save operations write to the database immediately, then the frontend refreshes the admin list. `/node-debugging` is intentionally decoupled from the admin page state and continues to refresh through the runtime parameter endpoint.

The runtime and admin read paths stay separate:

- Runtime: only enabled, executable parameters for the selected protocol.
- Admin: full catalog view, including archived parameters, disabled bindings, and missing bindings.

## Data Model

Existing protocol bindings are kept:

```text
debugging_parameter_node_bindings
- id
- organization_id
- project_id
- parameter_id
- protocol
- node_path
- access_mode
- enabled
- is_smoke_default
- notes
- created_at
- updated_at
```

The parameter catalog needs an explicit archive or enable state. The preferred minimal addition is:

```text
debugging_parameters
- enabled boolean not null default true
- archived_at timestamptz null
- archived_by text null
- archive_reason text null
```

`enabled=false` controls runtime availability. `archived_at` and related fields preserve governance context for admin history and audit. If implementation needs a smaller migration, `enabled` is the required field and the archive metadata can follow in the same or next migration.

Legacy `debugging_parameters.node_path` and `access_mode` may remain as compatibility columns during transition. New admin writes should treat `bindings[]` as authoritative.

## Admin API Contract

Add backend routes separate from the runtime debugging API:

```text
GET  /api/v1/debugging/admin/parameters
POST /api/v1/debugging/admin/parameters
PATCH /api/v1/debugging/admin/parameters/:parameterId
POST /api/v1/debugging/admin/parameters/:parameterId/archive
POST /api/v1/debugging/admin/parameters/:parameterId/restore
PUT  /api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol
PATCH /api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol
POST /api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol/archive
```

`GET /api/v1/debugging/admin/parameters` supports:

- `projectId`
- `module`
- `risk`
- `protocol`
- `coverage`
- `includeArchived=true`

Create and update requests manage parameter metadata:

```json
{
  "projectId": null,
  "name": "Fast charge current limit",
  "key": "debug.fast_charge.current_limit",
  "description": "Upper current limit used during fast charging.",
  "module": "Charging Policy",
  "risk": "High",
  "unit": "mA",
  "range": "0-5000",
  "minValue": 0,
  "maxValue": 5000,
  "currentValue": "3000",
  "targetValue": "3000",
  "sortOrder": 10,
  "enabled": true,
  "bindings": [
    {
      "protocol": "hdc",
      "nodePath": "/sys/class/power_supply/battery/input_current_limit",
      "accessMode": "RW",
      "enabled": true,
      "notes": "Primary HDC path."
    },
    {
      "protocol": "adb",
      "nodePath": "/sys/class/power_supply/battery/input_current_limit",
      "accessMode": "RO",
      "enabled": true,
      "notes": "ADB smoke-safe read path."
    }
  ]
}
```

Binding upsert requests manage one protocol binding at a time:

```json
{
  "nodePath": "/sys/class/power_supply/battery/input_current_limit",
  "accessMode": "RW",
  "enabled": true,
  "notes": "Primary HDC path."
}
```

## Permissions and Audit

Catalog governance should be distinct from device writes. The preferred permission is `debugging:admin`.

If the current permission matrix cannot add that permission in the first implementation pass, use admin role checks plus `debugging:write` as the temporary guard, but keep service names, tests, and error messages clear that this is catalog administration rather than node write execution.

Admin mutations should write audit events with:

- action type,
- parameter id,
- affected protocol when a binding changes,
- before/after shape summaries,
- actor user id,
- organization id,
- project id when applicable.

Audit metadata should avoid exposing raw node paths where existing security policy requires redaction.

## Frontend Design

`/debugging-admin` uses a two-pane workbench:

- Left pane: parameter catalog list.
- Right pane: selected parameter editor.

The list supports search and filters for:

- module,
- risk,
- enabled or archived state,
- protocol coverage,
- project/shared scope.

Rows show parameter name, key, module, risk, and coverage labels:

- `HDC configured`
- `ADB configured`
- `dual protocol`
- `missing HDC`
- `missing ADB`
- `archived`

The editor has two sections:

1. Parameter metadata: name, key, description, module, risk, value type or range fields, unit, current value, target value, sort order, enabled state.
2. Protocol node bindings: HDC and ADB tabs or side-by-side panels. Each protocol edits `nodePath`, `accessMode`, `enabled`, and `notes`.

Primary actions:

- Create parameter.
- Save parameter.
- Archive parameter.
- Restore parameter.
- Add HDC binding.
- Add ADB binding.
- Disable or archive one protocol binding.

After a successful save, the page refreshes the admin list and shows that the change will be visible in `/node-debugging` after refresh.

## Frontend Data Flow

API mode:

1. Load `GET /api/v1/debugging/admin/parameters?includeArchived=true`.
2. Build the list and coverage labels from returned `bindings[]`.
3. Keep form changes in a local dirty draft.
4. On save, call parameter create/update and binding upsert/update APIs.
5. On success, refetch the admin list.
6. On failure, keep the dirty draft and show field-level or page-level errors.

Mock mode:

- Keep the existing `configDraft` path for local demos and tests.
- Add simulated HDC/ADB binding fields where useful.
- Make mock behavior visibly local so it is not confused with backend persistence.

Compatibility:

- Existing `nodePath` and `accessMode` remain usable as legacy fallback.
- New admin UI reads and writes `bindings[]` first.
- Runtime DTO mapping continues to expose `selectedBinding`, `bindingStatus`, and `selectedProtocol`.

## Validation and Error Handling

Backend validation is authoritative:

- `key` is unique in its organization and project/shared scope.
- Enabled binding `nodePath` is required.
- `nodePath` must start with `/`.
- `nodePath` must not contain control characters.
- `accessMode` must be `RO`, `RW`, or `WO`.
- `protocol` must be `hdc` or `adb`.
- Archive and restore operations must be idempotent.
- Runtime list endpoints filter out archived parameters and disabled bindings.

Frontend error handling:

- Permission failures show an explicit non-editable state.
- Field validation failures attach to the relevant inputs.
- Conflict errors explain which key or binding conflicts.
- Partial save failures do not apply optimistic UI changes as committed state.
- `/node-debugging` should show a protocol-specific missing-binding message when a parameter has no binding for the selected protocol.

## Testing

Backend tests:

- repository create/update/archive/restore parameter,
- repository upsert/update/archive binding,
- service permission denial for non-admin catalog mutations,
- route validation for parameter metadata and bindings,
- runtime parameter list excludes archived parameters,
- runtime parameter list excludes disabled selected-protocol bindings,
- admin list includes archived parameters when requested,
- unique key and unique `(parameter_id, protocol)` conflict handling.

Frontend tests:

- Admin client maps parameter and binding DTOs.
- Page loads admin catalog in API mode.
- Create parameter with HDC and ADB bindings.
- Edit one protocol binding without overwriting the other.
- Archive and restore parameter.
- Disable one protocol binding and update coverage labels.
- API validation errors stay on the form.
- Mock mode continues to work for local demos.

Browser verification:

- Visit `/debugging-admin`.
- Verify desktop `1440x900`, tablet `768x1024`, and mobile `390x844`.
- Exercise create, edit, archive, restore, HDC binding edit, and ADB binding edit.
- Visit `/node-debugging?project=aurora`.
- Verify HDC and ADB protocol refresh behavior after admin changes.
- Check console errors and relevant network requests.

## Documentation Impact

Update these docs during implementation:

- `docs/design-docs/api-contract.md`
- `docs/zh-CN/design-docs/api-contract.md`
- `docs/design-docs/domain-model.md`
- `docs/zh-CN/design-docs/domain-model.md`
- `docs/FRONTEND.md`
- `docs/zh-CN/FRONTEND.md`
- `docs/developer/environment-variables.md` if admin API configuration changes
- `docs/zh-CN/developer/environment-variables.md` if admin API configuration changes
- `docs/generated/db-schema.md`

## Acceptance Criteria

- API-mode `/debugging-admin` can create, edit, archive, and restore debugging parameters through backend APIs.
- API-mode `/debugging-admin` can manage HDC and ADB bindings independently.
- Save operations persist to the backend and become visible to `/node-debugging` after refresh.
- Archived parameters no longer appear in runtime debugging lists but remain visible in admin when requested.
- Disabled protocol bindings do not make that protocol executable in `/node-debugging`.
- Historical operations and audit records remain understandable after archive operations.
- Existing HDC and ADB runtime debugging tests continue to pass.
