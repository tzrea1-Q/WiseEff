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
- Agent: sessions, messages, tool runs, approvals, rejection.
- Audit: audit event listing and detail.
- Operations: liveness, readiness, metrics, pilot/release readiness.

## Debugging Parameter Semantics

`GET /api/v1/debugging/parameters?projectId=:projectId&protocol=adb` returns enabled, non-archived shared debugging catalog rows plus legacy rows owned by the requested project. The `projectId` query parameter authorizes and contextualizes the request; it is not the ownership boundary for shared debugging catalog rows.

Read/write node APIs resolve protocol-specific `nodePath` from `debugging_parameter_node_bindings` when `parameterId` is provided. The request does not need to send a raw node path for catalog parameters.

### Debugging Admin Catalog

`/api/v1/debugging/admin/*` is reserved for Admin catalog governance and requires `debugging:admin`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/debugging/admin/parameters` | List the full debugging catalog, including disabled or archived rows when `includeArchived=true`. |
| `POST` | `/api/v1/debugging/admin/parameters` | Create a debugging parameter and optional HDC/ADB bindings. |
| `PATCH` | `/api/v1/debugging/admin/parameters/:parameterId` | Update debugging parameter metadata. |
| `POST` | `/api/v1/debugging/admin/parameters/:parameterId/archive` | Archive a parameter without deleting historical references. |
| `POST` | `/api/v1/debugging/admin/parameters/:parameterId/restore` | Restore an archived parameter. |
| `PUT` | `/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol` | Upsert the HDC or ADB node binding. |
| `PATCH` | `/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol` | Update the HDC or ADB node binding. |
| `POST` | `/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol/archive` | Disable one protocol binding. |

Runtime `/api/v1/debugging/parameters?protocol=...` returns only enabled, non-archived parameters with an enabled selected-protocol binding. Admin list APIs can return missing or archived bindings so `/debugging-admin` can show HDC/ADB coverage labels.

## Governance

The backend remains the contract owner. Frontend DTOs must map explicitly and tests must fail on drift. New endpoints should be added to the OpenAPI artifact and reviewed for authz, audit, error envelope, pagination, and evidence impact.

Run:

```bash
npm run contract:check
```
