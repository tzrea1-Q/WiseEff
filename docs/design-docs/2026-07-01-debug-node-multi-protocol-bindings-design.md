# Debug Node Multi-Protocol Bindings Design

Date: 2026-07-01  
Status: **Implemented**

## Summary

Split protocol-specific device paths out of `debug_nodes` into `debug_node_bindings`. Logical nodes are protocol-agnostic; HDC and ADB paths are governed as separate binding rows keyed by `(node_id, protocol)`.

## Decisions

| Decision | Choice | Status |
| --- | --- | --- |
| Logical node identity | `debug_nodes` holds name, description, sort order, enabled/archive | Implemented |
| Protocol paths | `debug_node_bindings` holds `protocol`, `node_path`, `access_mode`, `enabled` | Implemented |
| Runtime catalog filter | **Option A:** inner-join enabled binding for requested protocol | Implemented |
| Admin UX | Node editor for metadata; bindings dialog for HDC/ADB paths | Implemented |
| Legacy catalog | `debugging_parameters` + bindings retained for audit/history | Implemented |

## Data Model

### `debug_nodes` (logical)

- Protocol-agnostic adjustable node metadata
- Scoped by organization; optional `project_id` for shared vs project-owned nodes
- `enabled` / `archived_at` govern runtime visibility independently of bindings

### `debug_node_bindings`

- One row per `(node_id, protocol)` where protocol is `hdc` or `adb`
- Stores `node_path`, `access_mode`, `enabled`, optional `notes`
- Disabling one protocol binding does not disable the logical node or the other protocol binding

Migration `0028_debug_node_bindings.sql` backfills bindings from legacy protocol-scoped `debug_nodes` rows and drops protocol/path columns from `debug_nodes`.

## API Surface

### Runtime

- `GET /api/v1/debugging/nodes?projectId=&protocol=` — returns logical nodes with an enabled binding for the selected protocol (Option A filter)
- Node read/write resolves `nodePath` from `debug_node_bindings` when `nodeId` is supplied

### Admin

- `GET/POST/PATCH /api/v1/debugging/admin/nodes` — logical node CRUD
- `PUT/PATCH /api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol` — upsert binding
- `POST /api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol/archive` — disable one protocol binding

## Frontend

- `/debugging-admin`: `DebugNodeLibraryTable` shows coverage chips; `DebugNodeEditorDialog` edits metadata; `DebugNodeBindingsDialog` edits per-protocol paths
- `/node-debugging`: hydrates from `listRuntimeNodes`; writes use `nodeId`

## Seed and Smoke

- `scripts/seed-m3-debugging.ts` seeds logical nodes plus HDC bindings (and legacy parameter rows for compatibility)
- `e2e/debugging.api.spec.ts` exercises simulator read/write/rollback against seeded logical nodes

## Out of Scope (unchanged)

- Hard delete of nodes or bindings
- Arbitrary raw node path entry on `/node-debugging` for catalog nodes
- Merging HDC and ADB into a single binding row
