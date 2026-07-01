# WiseEff API Contract Design

> Chinese: [Chinese](../zh-CN/design-docs/api-contract.md)

Date: 2026-05-25

## Principles

WiseEff uses REST + JSON under the `/api/v1` prefix. The frontend talks to the backend through application ports and HTTP DTO mapping rather than page-owned fetch logic.

Rules:

- All writes require authentication, authorization, validation, audit, and idempotency where practical.
- List endpoints support pagination, sorting, and filtering.
- Errors use a structured envelope with request IDs.
- Long-running work exposes job status or event streams.
- OpenAPI contract freshness is checked in CI.

## Endpoint Groups

- Auth and users: `/me`, user listing, user creation, activation, role replacement.
- Projects and modules: project metadata and module lookup.
- Parameters: parameter listing, detail, history, drafts, submission rounds, change requests, imports.
- Logs: upload/file records, analysis records, runs, rerun, archive, feedback.
- Jobs: status and progress events.
- Debugging: devices, target detection, sessions, node reads/writes, snapshots, rollback.
- Agent: Xiaoze AG-UI run, proactive suggest, and thread persistence under `/api/v1/agent/xiaoze`.
- Audit: audit event listing and detail.
- Operations: liveness, readiness, metrics, pilot/release readiness.

## Debugging Parameter Semantics

`GET /api/v1/debugging/parameters?projectId=:projectId&protocol=adb` returns enabled, non-archived shared debugging catalog rows plus legacy rows owned by the requested project. The `projectId` query parameter authorizes and contextualizes the request; it is not the ownership boundary for shared debugging catalog rows.

Read/write node APIs resolve protocol-specific `nodePath` from `debug_node_bindings` when `nodeId` is provided (preferred) or from legacy `debugging_parameter_node_bindings` when `parameterId` is provided. The request does not need to send a raw node path for catalog-backed nodes.

### Runtime Node Catalog (Option A)

`GET /api/v1/debugging/nodes?projectId=:projectId&protocol=hdc|adb` returns enabled, non-archived logical nodes that have an **enabled binding for the requested protocol**. Nodes missing or with a disabled binding for that protocol are omitted from runtime lists. Admin list APIs return full logical nodes with all bindings so `/debugging-admin` can show HDC/ADB coverage labels.

### Debugging Admin Catalog

`/api/v1/debugging/admin/*` is reserved for Admin catalog governance and requires `debugging:admin`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/debugging/admin/nodes` | List logical debug nodes, including disabled or archived rows when `includeArchived=true`. |
| `POST` | `/api/v1/debugging/admin/nodes` | Create a logical debug node and optional initial bindings. |
| `PATCH` | `/api/v1/debugging/admin/nodes/:nodeId` | Update logical node metadata. |
| `PUT` | `/api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol` | Upsert the HDC or ADB binding for a logical node. |
| `PATCH` | `/api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol` | Update the HDC or ADB binding for a logical node. |
| `POST` | `/api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol/archive` | Disable one protocol binding without affecting the logical node or other protocols. |
| `GET` | `/api/v1/debugging/admin/parameters` | List the legacy debugging catalog, including disabled or archived rows when `includeArchived=true`. |
| `POST` | `/api/v1/debugging/admin/parameters` | Create a debugging parameter and optional HDC/ADB bindings. |
| `PATCH` | `/api/v1/debugging/admin/parameters/:parameterId` | Update debugging parameter metadata. |
| `POST` | `/api/v1/debugging/admin/parameters/:parameterId/archive` | Archive a parameter without deleting historical references. |
| `POST` | `/api/v1/debugging/admin/parameters/:parameterId/restore` | Restore an archived parameter. |
| `PUT` | `/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol` | Upsert the HDC or ADB node binding (legacy catalog). |
| `PATCH` | `/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol` | Update the HDC or ADB node binding (legacy catalog). |
| `POST` | `/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol/archive` | Disable one protocol binding (legacy catalog). |

Runtime `/api/v1/debugging/parameters?protocol=...` (legacy) returns only enabled, non-archived parameters with an enabled selected-protocol binding. Admin list APIs can return missing or archived bindings so coverage labels remain visible.

Runtime and admin debugging parameter DTOs include optional value metadata:

- `valueKind`: `scalar | complex` (defaults to `scalar` for legacy rows)
- `valueFormat`: `raw | json | dts | line-list | kv-list`
- `normalizationMode`: `exact | trim | line-ending-normalized | json-canonical`
- `maxValueBytes`: positive integer cap for write payload size

Admin `POST`/`PATCH` validates combinations: scalar defaults to `raw`/`trim`; `json-canonical` requires `valueFormat=json`; complex JSON targets must parse. Node write requests keep `value: string`; the service resolves format, normalization, digest, preview, and comparison from parameter metadata.

Node operation DTOs may include `valueKind`, `valueFormat`, `normalizationMode`, `valuePreview`, and value digests for complex writes without returning full large payloads in list views.

## Governance

The backend remains the contract owner. Frontend DTOs must map explicitly and tests must fail on drift. New endpoints should be added to the OpenAPI artifact and reviewed for authz, audit, error envelope, pagination, and evidence impact.

Run:

```bash
npm run contract:check
```
