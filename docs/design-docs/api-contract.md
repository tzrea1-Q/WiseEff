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
- Parameters: parameter listing, detail, history, drafts, submission rounds, change requests, imports, dashboard aggregation (`/parameters/dashboard/summary`, `/parameters/dashboard/hotspots`), org module tree CRUD (`/parameter-modules`), and per-project parameter file hosting with sync and conflict resolution (`/projects/:projectId/parameter-files*`).
- Logs: upload/file records, analysis records, runs, rerun, archive, feedback.
- Product feedback: Internal Beta sidebar feedback submission, admin triage, and attachment content.
- Jobs: status and progress events.
- Debugging: devices, target detection, sessions, node reads/writes, snapshots, rollback.
- Agent: Xiaoze AG-UI run, proactive suggest, and thread persistence under `/api/v1/agent/xiaoze`.
- Audit: audit event listing and detail.
- Operations: liveness, readiness, metrics, pilot/release readiness.

## Log and Debugging Scope

M2 log upload/list and M3 debugging runtime/catalog APIs are scoped by authenticated `organization_id`. They do not accept `projectId` query parameters or body fields. Log records may include optional `relatedParameterId` as a soft link to M1 definitions.

## Debugging Parameter Semantics

`GET /api/v1/debugging/parameters?protocol=adb` returns enabled, non-archived organization catalog rows with an enabled selected-protocol binding. Authorization uses org-level debugging permissions only.

Read/write node APIs resolve protocol-specific `nodePath` from `debug_node_bindings` when `nodeId` is provided (preferred) or from legacy `debugging_parameter_node_bindings` when `parameterId` is provided. The request does not need to send a raw node path for catalog-backed nodes.

### Runtime Node Catalog (Option A)

`GET /api/v1/debugging/nodes?protocol=hdc|adb` returns enabled, non-archived logical nodes that have an **enabled binding for the requested protocol**. Nodes missing or with a disabled binding for that protocol are omitted from runtime lists. Admin list APIs return full logical nodes with all bindings so `/debugging-admin` can show HDC/ADB coverage labels.

### Debugging Admin Catalog

`/api/v1/debugging/admin/*` is reserved for Admin catalog governance and requires `debugging:admin`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/debugging/admin/nodes` | List logical debug nodes, including disabled or archived rows when `includeArchived=true`. Optional `moduleId` + `includeDescendants` subtree filter. |
| `POST` | `/api/v1/debugging/admin/nodes` | Create a logical debug node and optional initial bindings. |
| `PATCH` | `/api/v1/debugging/admin/nodes/:nodeId` | Update logical node metadata. |
| `PUT` | `/api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol` | Upsert the HDC or ADB binding for a logical node. |
| `PATCH` | `/api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol` | Update the HDC or ADB binding for a logical node. |
| `POST` | `/api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol/archive` | Disable one protocol binding without affecting the logical node or other protocols. |
| `GET` | `/api/v1/debugging/admin/modules` | List org debug node module tree nodes. |
| `POST` | `/api/v1/debugging/admin/modules` | Create a debug module (`name`, optional `parentId`). |
| `PATCH` | `/api/v1/debugging/admin/modules/:moduleId` | Update debug module metadata. |
| `POST` | `/api/v1/debugging/admin/modules/:moduleId/move` | Reparent a debug module (cycle → `409`). |
| `DELETE` | `/api/v1/debugging/admin/modules/:moduleId` | Delete when no child modules or assigned nodes remain (`409` otherwise). |
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

## Parameter Module Tree

Org-scoped parameter modules are a hierarchical taxonomy independent from the debugging module tree. List routes require `parameter:view`; create/update/move/delete require `admin:access` (`canAdminParameters`). Deletes reject non-empty modules (`409 CONFLICT` when child modules or assigned parameters remain). Move rejects cycles (`409 CONFLICT`).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/parameter-modules` | List org parameter module tree nodes. |
| `POST` | `/api/v1/parameter-modules` | Create a module (`name`, optional `parentId`). |
| `PATCH` | `/api/v1/parameter-modules/:moduleId` | Update module metadata (`name`, `description`, `scope`, `sortOrder`). |
| `POST` | `/api/v1/parameter-modules/:moduleId/move` | Reparent a module (`parentId`, nullable for root). |
| `DELETE` | `/api/v1/parameter-modules/:moduleId` | Delete an empty leaf module. |

`GET /api/v1/parameters` accepts `moduleId` and optional `includeDescendants` (defaults to including descendants). Parameter DTOs expose `moduleId` and `modulePath` (materialized name segments).

## Parameter Dashboard

Read-only aggregation endpoints for `/parameter-home`. Both routes require parameter view permission (`canViewParameters`) and scope results to the authenticated organization. Optional `projectId` narrows aggregates to one managed project; omit it for org-wide totals.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/parameters/dashboard/summary` | KPIs, update trend buckets, per-project risk buckets, and workbench signals for the selected window (`7d`, `30d`, `180d`). |
| `GET` | `/api/v1/parameters/dashboard/hotspots` | Ranked hotspot leaderboard for the selected window and dimension (`overall`, `module`, `project`, `parameter`). |

Query parameters:

- `summary`: `window` (default `30d`), optional `projectId`
- `hotspots`: `window` (default `30d`), `dimension` (default `overall`), optional `projectId`

Response envelopes:

- `summary` returns `{ item: DashboardSummary }`
- `hotspots` returns `{ items: DashboardHotspot[] }`

`DashboardHotspot.scoreBreakdown` is deterministic server-side scoring (frequency, risk, impact, workflow, drift). Frontend presentation helpers in `src/hotspotPresentation.ts` map breakdown dominance to action templates but do not compute business aggregates.

## Product Feedback

Internal Beta feedback is organization-scoped and separate from log-analysis feedback. Any active authenticated user can submit feedback from the sidebar `FeedbackDialog`; admin triage and attachment reads require `admin:access`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/product-feedback` | Create product feedback with optional image attachments. Returns `201 { item }`. |
| `GET` | `/api/v1/product-feedback` | Admin list with optional `status`, `feedbackType`, `q`, `pagePath`, `createdFrom`, `createdTo`, `cursor`, and `limit` filters. |
| `GET` | `/api/v1/product-feedback/:id` | Admin detail for one feedback record and ordered attachments. |
| `PATCH` | `/api/v1/product-feedback/:id` | Admin triage update for `status` and/or `adminNote`. |
| `GET` | `/api/v1/product-feedback/:id/attachments/:attachmentId/content` | Admin image content response for one attachment. |

Create body:

```json
{
  "pagePath": "/parameters",
  "pageTitle": "项目参数用户工作台",
  "feedbackType": "experience",
  "description": "The submit button is hard to find on mobile.",
  "attachments": [
    {
      "fileName": "mobile-layout.png",
      "contentType": "image/png",
      "contentBase64": "iVBORw0KGgo="
    }
  ]
}
```

`feedbackType` is one of `experience`, `data`, `export_submit`, or `feature`. `status` is `open`, `in_progress`, or `closed`; the service allows `open -> in_progress -> closed` and rejects updates after `closed`. Attachments accept `image/png`, `image/jpeg`, and `image/webp`, with up to 5 images, 5 MB per image, and 15 MB total.

## Project Parameter Files

Per-project DTS/JSON files are hosted internally with immutable version history. Upload bodies use JSON `contentBase64` (not multipart). P1 file size cap is 2 MB. Parameter list/detail DTOs expose optional `sourceFileName` and `sourceNodePath` on bound project values.

View routes require `canViewParameters`; upload, version upload, sync, and conflict resolve require `canAdminParameters`. Conflict resolve also enforces `canReviewParameters` in the service layer.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/parameter-files` | List hosted files with current version metadata. |
| `POST` | `/api/v1/projects/:projectId/parameter-files` | Upload a new file or first version. Returns `201 { item, version }`. |
| `POST` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions` | Upload the next file version. Returns `201 { item }` (version DTO). |
| `GET` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions` | List version history for one file. |
| `GET` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/content` | Download raw file bytes for one version. |
| `POST` | `/api/v1/projects/:projectId/parameter-files/:fileId/sync` | Diff the current or requested version against DB and upsert `file_sync` drafts. Returns `{ item: syncSummary }`. |
| `GET` | `/api/v1/projects/:projectId/parameter-file-conflicts` | List open file/UI draft conflicts for the project. |
| `POST` | `/api/v1/projects/:projectId/parameter-file-conflicts/:conflictId/resolve` | Resolve one conflict. Body: `{ "resolution": "file" \| "ui" }`. |

Upload body:

```json
{
  "fileName": "battery.dtsi",
  "contentBase64": "YmF0dGVyeSB7IHRlbXBf..."
}
```

Sync body (optional):

```json
{
  "versionId": "ppfv_123"
}
```

When `versionId` is omitted, sync uses the file's `currentVersionId`. Versions with `origin=writeback` skip automatic draft generation during sync.

Audit actions: `parameter-file-upload`, `parameter-file-sync`, `parameter-file-conflict-open`, `parameter-file-conflict-resolve`, `parameter-writeback-to-file`.

## Governance

The backend remains the contract owner. Frontend DTOs must map explicitly and tests must fail on drift. New endpoints should be added to the OpenAPI artifact and reviewed for authz, audit, error envelope, pagination, and evidence impact.

Run:

```bash
npm run contract:check
```
