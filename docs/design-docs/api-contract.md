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
- Parameters: parameter listing, detail, history, drafts, submission rounds, change requests, imports, dashboard aggregation (`/parameters/dashboard/summary`, `/parameters/dashboard/hotspots`), org module tree CRUD (`/parameter-modules`), per-project parameter file hosting with sync and conflict resolution (`/projects/:projectId/parameter-files*`), structured DTS read/search (`.../structure`, `/projects/:projectId/dts-search`), and per-project DTS config sets, release baselines, validation gate, and lossless export (`/projects/:projectId/config-sets*`, `/projects/:projectId/baselines/:baselineId/*`).
- Semantic parameter topology (v2): parameter specs, spec review tasks, source/effective topology, project bindings, identity mapping tasks, and fail-closed config-revision validate under `/api/v2/*` (see below). Legacy flat parameter IDs are retired at cutover with `410 legacy-parameter-id-retired`.
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
| `POST` | `/api/v1/parameter-modules` | Create a module (`name`, optional `parentId`, optional `kind` ∈ `business` \| `driver-group` \| `node-type`, optional `compatibles[]` required when `kind=driver-group`, optional `sourceKey` for node-type). Admin create always persists `origin=curated`. Parent kind rules: business under null/business; driver-group and node-type under business; node-type may nest under node-type. `kind=driver-group` reuses register-or-claim semantics (create curated group + exact mappings, or claim an existing compatible mapping). |
| `PATCH` | `/api/v1/parameter-modules/:moduleId` | Update module metadata (`name`, `description`, `scope`, `sortOrder`). |
| `POST` | `/api/v1/parameter-modules/:moduleId/move` | Reparent a module (`parentId`, nullable for root). |
| `DELETE` | `/api/v1/parameter-modules/:moduleId` | Delete an empty leaf module. |

`GET /api/v1/parameters` accepts `moduleId` and optional `includeDescendants` (defaults to including descendants). Parameter DTOs expose `moduleId` and `modulePath` (materialized name segments).

## Parameter Import

Admin-only (`canAdminParameters` / `admin:access`) batch import and full-DTS parse:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/parameter-import/parse-dts` | Parse a full `.dts` UTF-8 source via server CST (`parseDts`/`resolveDts`). Rejects `/include/` with `details.code=dts-include-unsupported`. |
| `POST` | `/api/v1/parameter-import-batches` | Create an import preview batch. Optional `reviewMetadata` (skip reasons / notes) is written into `batch-import` audit metadata when present. |
| `POST` | `/api/v1/parameter-import-batches/:batchId/apply` | Apply selected preview items. Optional `reviewMetadata` merges into the apply audit metadata. |

`POST /api/v1/parameter-import/parse-dts` body:

```json
{ "sourceName": "board.dts", "content": "/dts-v1/;\n&demo { chip@6E { status = \"ok\"; }; };\n" }
```

Response rows include `name`, `module`, `sourceNodePath`, `rawText`, `normalizedValue`, and `valueType`. `module`/`name` follow `nodePathToParameterIdentity` on `sourceNodePath` (`nodePath/prop`). Default content size limit is 2MB.

Optional `reviewMetadata` on create/apply:

```json
{
  "reviewMetadata": {
    "skippedRows": [{ "rowKey": "demo/chip@6E/status", "name": "status", "module": "demo/chip@6E", "reason": "skipped in wizard" }],
    "notes": "wizard skipped 1 row(s)"
  }
}
```

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
| `POST` | `/api/v1/projects/:projectId/parameter-files` | Upload a new file or first version. Returns `201 { item, version, unsupportedConstructs?, driverSummary? }`. For DTS uploads, `driverSummary` compares file compatibles to registered mappings (`matchedRegistered` / `newUnregistered`). |
| `POST` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions` | Upload the next file version. Returns `201 { item }` (version DTO) plus optional `unsupportedConstructs` / `driverSummary` as above. |
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

### Structured read and DTS search (P3)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/structure` | Read the persisted structural model for one file version from `dts_*` (no re-parse). Returns `{ nodes }`; each node includes typed `properties` (`valueType`, `rawText`, `normalizedValue`) and `phandleRefs`. Requires `parameter:view`. |
| `GET` | `/api/v1/projects/:projectId/dts-search` | Search current file versions' `dts_*` rows. Query: `q` (required), `by` = `path`\|`address`\|`label`\|`compatible`\|`value` (default `path`). Returns `{ hits }`. Requires `parameter:view`. |
| `POST` | `/api/v1/projects/:projectId/dts-structured-edits/submit` | Submit one or more structured DTS property edits as a parameter submission round. Body: `{ edits: [{ fileId, nodePath, propertyName, rawText, reason? }], reason?, assignees? }`. Maps each edit to a `project_parameter_value` via `source_file_name`/`source_node_path`, creates drafts, and submits CRs whose `targetValue` is `rawText` (not `normalizedValue`). Returns `201 { item }` (submission round with CR items). Requires `parameter:edit`; sensitive-node rules apply (`parameter:edit-critical` for critical paths; agent writes to critical nodes denied). Audit: `parameter-structured-edit-submit`. |

### Change-request impact extensions (P3)

`GET /api/v1/parameter-change-requests` (and related detail payloads) expose `impact[]` with kinds `module` \| `test` \| `parameter` \| `phandle` \| `compatible` \| `config-set`. When the project value is structurally bound, the server appends phandle / compatible / config-set peers; otherwise it keeps the legacy template.

Sensitive-node guards apply on submit/merge/writeback paths: missing `parameter:edit-critical` → `403`; agent writes to `critical` rules → `403` with `requireHuman: true` and audit `parameter-sensitive-node-denied`.

## Config Sets, Release Baselines, and the Validation Gate (P2)

Board-level config sets aggregate a project's parameter files into one buildable unit; release baselines snapshot a config set for compare/rollback/release; the validation gate runs `dtc` before a baseline can be released. `GET /api/v1/projects/:projectId/config-sets` requires `parameter:view` so the user topology workspace can load it. Config Set mutations, baselines, export, and release remain Admin-only.

`GET /api/v1/projects/:projectId/parameter-workflow-assignees` requires `parameter:edit` and returns `{ item: { hardwareCommitters, softwareCommitters, softwareUsers } }`. Candidates are active users proven by caller-organization plus exact-project role bindings. Admin-only, inactive, guest, cross-project, and cross-organization users are excluded; submission revalidates every selected id server-side.

`POST /api/v1/parameter-submission-rounds` has three non-overlapping item shapes. Legacy flat submissions use `{ parameterId, targetValue, reason }` **only before semantic cutover**. Post-cutover binding submissions use `{ draftId, projectParameterBindingId, parameterSpecId, action, targetValue, reason }` (optional `editSubjectKind: binding`). Node-enablement submissions use `{ draftId, editSubjectKind: "node-enablement", logicalNodeId, action, targetValue, reason }`. Binding items must not also send `parameterId`; `action` is `set|delete`, `set` requires a non-empty target, and `delete` requires `targetValue: ""`. Enablement and binding drafts may share one submission round when they share the same working tip. The server locks the exact user-owned draft plus candidate/evidence rows, verifies organization/project/Config Set, binding/spec/action/value/reason and write locks, then atomically promotes the candidate `draft -> pending_approval`. Migration `0063` persists `candidateConfigRevisionId` on both returned submission items and change requests; submit audit metadata carries the same ID. Merge locks and revalidates that exact `pending_approval` candidate and its set-value or delete-tombstone proof before history/writeback. Missing identity, changed status/value/action proof, or a historical request that predates `0063` returns `409` without success history/audit. Cross-project or missing drafts return `404`; stale locks return `409`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/config-sets` | List config sets for a project. |
| `POST` | `/api/v1/projects/:projectId/config-sets` | Create a config set. Body: `{ name, description?, derivedFromId? }`. Returns `201 { item }`. Duplicate `name` in the same project is `409`. |
| `POST` | `/api/v1/projects/:projectId/config-sets/:configSetId/files` | Add a parameter file as a config-set member. Body: `{ fileId, role, sortOrder? }` (`role` is `base`\|`overlay`\|`charging`\|`thermal`\|`misc`). Returns `201 { item }`. A file already owned by another config set is `409`. |
| `DELETE` | `/api/v1/projects/:projectId/config-sets/:configSetId/files/:fileId` | Remove a file from the config set. Returns `200 {}`. |
| `GET` | `/api/v1/projects/:projectId/config-sets/:configSetId/baselines` | List baselines for a config set. |
| `POST` | `/api/v1/projects/:projectId/config-sets/:configSetId/baselines` | Snapshot the config set's current member versions into a new `draft` baseline. Body: `{ name, notes? }`. Returns `201 { item }`. A member with no current version, or a duplicate baseline name, is `409`. |
| `GET` | `/api/v1/projects/:projectId/baselines/:baselineId/compare` | Compare the baseline's pinned versions against the config set's current versions. Returns `200 { item: { baselineId, members } }`; each member reports `unchanged`\|`version_changed`\|`file_added`\|`file_removed`, and `version_changed` DTS members include a `structuralDiff` (node/property level, type-aware). |
| `POST` | `/api/v1/projects/:projectId/baselines/:baselineId/rollback` | Atomically repoint every drifted member back to its pinned version (never deletes history; drifted members get a new `origin=rollback` version). Returns `200 { item: { baselineId, restored } }`. |
| `POST` | `/api/v1/projects/:projectId/baselines/:baselineId/release` | Run the validation gate against current member contents, then mark the baseline `released` if the gate allows it. Returns `200 { item: baseline, gate }`. **Blocked by the gate → `409`** with `error.details = { code: 'dts-validation-failed', diagnostics, mode, compiler }`. |
| `GET` | `/api/v1/projects/:projectId/config-sets/:configSetId/export` | Export a lossless bundle: `serializeDts(parseDts(source))` per DTS member. Returns `200 { manifest, files }`; `manifest.validation` carries the gate result computed at export time (export never blocks on a failing gate, unlike release). |

Validation gate result shape (`gate` / `manifest.validation`):

```json
{
  "ok": true,
  "mode": "warn",
  "requiresConfirmation": true,
  "compiler": "dtc",
  "diagnostics": [{ "file": "board.dts", "line": 12, "severity": "error", "message": "syntax error" }]
}
```

`mode` is `block` (default), `warn`, or `off` (`DTS_VALIDATION_MODE`; see `docs/developer/environment-variables.md`). `compiler` is `dtc` or `unavailable` (no `dtc` binary on `PATH`). `requiresConfirmation` is `true` whenever the result was not a hard `dtc` pass (`warn` mode, or `block`/`off` with an unavailable compiler that fell back to a soft pass).

Audit kinds and actions: `config-set` (`created`, `updated`, `member_changed`), `baseline` (`created`, `rolled_back`, `released`), `validation.gate` (`run`), `export` (`file`, `config-set`).

## Semantic Parameter Topology (`/api/v2`)

Additive semantic surface used by the topology/schema program. Production remains fail-closed on identity, dt-schema, `dtc`, and `fdtoverlay`. After the maintenance cutover, legacy flat parameter definition/value IDs return `410` with `details.code=legacy-parameter-id-retired` (lookup via migration evidence) — not a compatibility projection.

**ParameterSpec identity (ADR-0013 / ADR-0014):** Stable catalog identity is owner scope + `attributionSubjectId` (driver registration or node-type definition) + `property_key`. List/detail DTO `lifecycle` reflects definition-level `definition_lifecycle` (`draft` \| `active` \| `deprecated`). Versioned content lives in `parameter_spec_versions` (`version_status`: `draft` \| `active` \| `superseded`); `currentVersionId` / `currentVersion` point at the active content row when present. Org definitions override platform for the same subject + key.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v2/parameter-specs` | List parameter specs by stable subject + property identity. Each item includes `attributionSubjectId`, `lifecycle` (definition layer), `currentVersionId` / `currentVersion`, `propertyKey`, and `attributionModules: Array<{ id, name, kind }>` — distinct attribution units (driver groups and node-type units) observed via bindings, server-computed. Empty `attributionModules` means not yet observed. Filters: `?q=&sourceKind=&lifecycle=&driverModule=&propertyKey=`. The spec layer does not re-run compatible or node-type matching (ADR-0010). |
| `POST` | `/api/v2/parameter-specs` | Admin create org-owned **draft** definition for `attributionSubjectId` + `propertyKey` (driver-registration or node-type-definition subject only). Body requires `reason`; optional `displayName`, `description`, `documentation`, `valueShape`, `constraints`, `units`, `exampleValue`. Rejects structural property keys (ADR-0003) → `400`. Duplicate subject+key in org → `409`. Org override of platform twin requires `overridePlatform: true` → `409` with `confirmRequired` when omitted. Returns `{ item }` (`201`). Audit: `spec-draft-created`. |
| `GET` | `/api/v2/parameter-specs/:specId` | Spec detail: definition `lifecycle`, version pointers, `attributionSubjectId`, example/default/policy metadata (`exampleValue` illustrative only). When an open cutover run exists, includes optional `cutover` summary (`status`, version pointers, impact counts). |
| `PATCH` | `/api/v2/parameter-specs/:specId` | Admin in-place content update on **active** (or platform-global) definitions — not for drafts (`409`; use activate). Body: `documentation`, `reason`, optional `valueShape`, `constraints`, `displayName`, `description`, `units`, `exampleValue`, `policyTarget`. Updates the current `parameter_spec_version` row. Audit: `spec-updated`. |
| `GET` | `/api/v2/parameter-spec-review-tasks` | Org-scoped, paginated, status-filtered spec review queue (`?status=&limit=&cursor=`). |
| `POST` | `/api/v2/parameter-specs/:specId/activate` | Admin activates a **draft** **org-owned** spec, or records a semantic successor when called on **active** with changed content (ADR-0014). Body requires full `valueShape`, `constraints`, `documentation`, `reason`; optional `displayName`, `description`, `coverageClaim` (required for subject-bound drafts without an existing claim). **`coverageClaim.kind` must be `overlay-property`** in this release (`pinned-schema-property` is deferred). Platform-global drafts (`organization_id IS NULL`) → `403`. Cross-org → `404`. Incomplete/conflicting shapes → `400`/`409`. Deprecated specs → `409`. **Staged cutover:** content change on an active definition inserts a draft successor version and a `parameter_spec_version_cutover_run`. When no bindings reference the current version tip, cutover **auto-finalizes** (supersedes old version, activates successor). When tip bindings exist, the run stays `preparing` with pending cutover items until prepare/finalize. Audit: `spec-activated` (and cutover finalize audit when auto-finalized). |
| `GET` | `/api/v2/parameter-specs/:specId/cutover` | Open cutover impact for the spec (`{ item: cutoverSummary }`). No open run → `404`. View authz. |
| `POST` | `/api/v2/parameter-specs/:specId/cutover/prepare` | Admin marks pending cutover binding items `ready` (reuses base revision id; no second revision row). Optional body `{ reason? }`. Run → `ready` when all items ready. Audit: `spec-version-cutover-prepared`. |
| `POST` | `/api/v2/parameter-specs/:specId/cutover/finalize` | Admin finalizes after prepare: updates binding revision `parameter_spec_version_id`, supersedes old version, activates successor. Body `{ reason }`. Pending/incompatible items → `409`. Audit: `spec-version-cutover-finalized`. |
| `POST` | `/api/v2/parameter-specs/:specId/deprecate` | Admin soft-deprecate at the **definition** layer (`definition_lifecycle → deprecated`; current version stays readable for parse/release). Org-owned: org Admin; platform-global → `403` for organization Admin; **`platform-admin` may deprecate platform-global definitions** (ADR-0011 amended). Body `{ reason }`. `409` when lifecycle is not `draft` or `active`. Audit: `spec-deprecated`. |
| `POST` | `/api/v2/parameter-specs/:specId/restore` | Admin restore a deprecated definition: org-owned by org Admin, or platform-global by **`platform-admin`**. Restore lands on `active` when `activated_at` is set, otherwise `draft`. Body `{ reason }`. `409` unless currently `deprecated`. Audit: `spec-restored`. |
| `POST` | `/api/v2/parameter-spec-review-tasks/:taskId/resolve` | Admin resolve/dismiss a spec review task (`parameterSpecId` must be org-owned or global, **or** `createSpec: true` for unmatched tasks). Server validates tenant ownership of project/revision/occurrence/logical-node evidence via scoped join before applying decisions — raw evidence IDs alone are not trusted. `createSpec: true` creates an org-owned **draft** spec (typed shape from occurrence AST) and returns `draftCreated` with a message to activate before resolve. Only **active**+complete specs may resolve/release. Resolve applies occurrence→spec→binding + reusable matcher override (scoped by compatible + **node locator fingerprint** + property key) in one transaction. Library resolve with a different property key requires explicit `confirmPropertyMismatch: true` or the server rejects with a mismatch error. Dismiss is fail-closed: no binding is created and release/validate still blocks dismissed properties. Audit: `parameter-topology-governance` / `spec-review-resolved`. |
| `GET` | `/api/v2/projects/:projectId/config-sets/:configSetId/revisions/:revisionId/topology` | Source or effective tree (`?view=source\|effective`). Each node may include derived `enablement` (`selfEnabled`, `override`, `reachable`, blocking ancestor labels) — not a parameter binding. |
| `GET` | `/api/v2/projects/:projectId/parameter-bindings` | Stable project bindings (spec + logical node + effective value). |
| `GET` | `/api/v2/identity-mapping-tasks` | List identity mapping tasks (`?projectId=&status=` where `status` is `open` \| `resolved` \| `dismissed` \| `new_identity`). Items include `taskKind` (`identity-ambiguity` \| `singleton-cardinality`), candidates, and evidence. |
| `POST` | `/api/v2/identity-mapping-tasks/:taskId/resolve` | Admin resolve/dismiss/declare new identity. Body `{ decision: resolved \| dismissed \| new-identity, reason, selectedLogicalNodeId?, confirmAllCandidates? }`. `resolved` requires `selectedLogicalNodeId` in candidates. `new-identity` with multiple candidates requires `confirmAllCandidates: true`. `singleton-cardinality` tasks reject identity decisions (`409` `singleton-cardinality-conflict`) — fix registration/topology instead. `dismissed` and open `singleton-cardinality` remain **release blockers**; `resolved` and `new_identity` clear blocking. Audit: `identity-mapping-resolved` / `identity-mapping-dismissed` / `identity-mapping-new-identity`. |
| `POST` | `/api/v2/identity-mapping-tasks/:taskId/reopen` | Admin reopen a `dismissed` or `new_identity` `identity-ambiguity` task (`{ reason }`). Re-asserts revision `needs_mapping`. Applied `resolved` mappings use protected re-resolve, not reopen (`409`). Audit: `identity-mapping-reopened`. |
| `POST` | `/api/v2/projects/:projectId/config-revisions/:revisionId/validate` | Fail-closed toolchain validate for publish readiness. Failed re-validation **revokes** a previously `validated` revision (does not leave a stale validated marker). Open identity-mapping, **dismissed** identity-mapping, **singleton-cardinality** mapping blockers, or dismissed-but-unmatched spec-review blockers fail closed. Config revisions are never `published` — releasing is the release baseline (ADR-0012). |
| `POST` | `/api/v2/projects/:projectId/parameter-bindings/:bindingId/drafts` | Typed binding draft with `action: set|delete` and **exact-occurrence** Config Set writeback: locks binding revision, occurrence, file version, checksum, and CST span (schema enforced; **base** binding revision immutable; set values land on the **candidate** revision). Delete returns `rawText: ""`, persists a candidate tombstone effect, and deliberately creates no replacement candidate binding revision. Stale revision/occurrence identity → `409`. Post-cutover semantic merge fail-closes without `objectStore`, project scope, write lock, or real DTC toolchain — no `WISEEFF_WRITEBACK_SKIP_TOOLCHAIN` production path. Post-cutover drafts must not create shadow `project_parameter_values` / `parameter_definitions` rows. |
| `POST` | `/api/v2/projects/:projectId/node-enablement-drafts` | Node enablement draft on the shared working-tip pipeline. Body: `{ logicalNodeId, baseRevisionId, target: force-enabled\|force-disabled\|unstated, reason, acknowledgeNonstandard?, spellingOverride? }`. Writes or deletes DTS `status` on the locked overlay file; shares candidate revision coordination with binding drafts (mixed tips → `409 mixed-working-tips`). Requires `parameter:edit`; `dts_sensitive_node_rules` apply. Audit: `parameter-topology-governance` / `enablement-changed`. |
| `GET` | `/api/v2/projects/:projectId/bindings/:bindingId/history` | Phase-2 binding revision history. Returns `{ items: [{ id, changedAt, fromRawValue?, toRawValue? }] }` ordered newest→oldest, derived from `project_parameter_binding_revisions` only (adjacent revision raw values mapped into from→to). Never reads the legacy flat `parameter_history_entries`. Actor/reason are not exposed because `project_parameter_binding_revisions` carries no per-revision actor or reason column. |
| `GET` | `/api/v2/projects/:projectId/bindings/:bindingId/compare` | Phase-2 cross-project compare. Returns `{ items: [{ projectId, projectName, rawValue, moduleName?, driverModule? }] }` for other projects in the same organization that share the binding's `parameter_spec_id` + `module_id`; the source project is excluded. |
| `GET` | `/api/v2/parameter-modules` | Org module registry: `{ item: { modules, mappings } }`. Module DTO fields include `kind`, `origin`, `sourceKey`, `attributionSubjectId` (driver-group / node-type catalog subject), `effectiveImportance`, `parameterCount` (plus `name`, `parentId`, `sortOrder`, `importance`). Module CRUD stays on v1. |
| `GET` | `/api/v2/parameter-modules/discovery-hints` | Observed unmapped `compatible` values from bindings (`{ item: { compatibles: [{ compatible, bindingCount, projectCount, suggestedGroupName }], total } }`), excluding dismissed and scaffolding labels. |
| `POST` | `/api/v2/parameter-modules/discovery-hints/dismissals` | Admin dismiss a compatible from the queue (`{ compatible, reason? }`); returns refreshed hints. Audit: `parameter-module-compatible-dismissed`. |
| `DELETE` | `/api/v2/parameter-modules/discovery-hints/dismissals/:compatible` | Admin restore a dismissed compatible. Audit: `parameter-module-compatible-restored`. |
| `POST` | `/api/v2/parameter-modules/mappings/preview` | Admin dry-run create mapping (`{ moduleId, matchKind, matchValue, priority? }`); `matchKind` is `compatible` \| `node-type` only. Returns `{ item: MappingApplyPreview }` without persisting. |
| `POST` | `/api/v2/parameter-modules/mappings` | Admin create mapping with **scoped apply** for bindings matching the new rule. Returns `{ item: registry, apply: MappingApplyPreview }` (`201`). Audit: `parameter-module-mapping-created`. |
| `DELETE` | `/api/v2/parameter-modules/mappings/:mappingId` | Admin delete mapping with scoped re-park for affected bindings. Returns `{ item: registry, apply: MappingApplyPreview }`. Audit: `parameter-module-mapping-deleted`. |
| `POST` | `/api/v2/parameter-modules/recompute-bindings` | Admin full-org or per-project recompute (optional `{ projectId, dryRun }`). `dryRun: true` returns `{ updated, conflicts, dryRun: true, preview }` without writes. Apply path returns `{ updated, conflicts, preview? }`; unique-key conflicts → `409`. Ops/backfill tool — daily classify uses scoped mapping apply, not full recompute. Audit: `parameter-module-bindings-recomputed`. |
| `GET` | `/api/v2/parameter-modules/driver-registry` | Org driver-registry view: `{ items: DriverRegistryEntry[], total }`. Each entry is a driver-group module with exact compatibles, `origin`, current-tree business category, authoritative `defaultBusinessCategoryId` (registration default; may differ from current parent), parameter/observed coverage, read-only `driverNature` / `instanceCardinality` (when linked to `driver_registrations`), and per-compatible parse coverage (pinned schema pattern **or** active org overlay; `source`/`driverId` identify which). Scaffolding labels excluded. |
| `POST` | `/api/v2/parameter-modules/driver-registry` | Admin register or claim a driver (`{ displayName, businessCategoryId, compatibles[], notes? }`). Creates a curated driver-group + exact compatible mappings, or claims an existing mapped group (move + rename + promote). Persists `businessCategoryId` as the registration `defaultBusinessCategoryId`. Returns `{ mode: 'registered'\|'claimed', item }` (`201`). Audit: `parameter-module-driver-registered`. |
| `PATCH` | `/api/v2/parameter-modules/driver-registry/:moduleId` | Admin update registration default business category (`{ defaultBusinessCategoryId }`). Same-txn audit + replay of that subject’s **auto** driver-group under the new default (curated frozen). Returns `{ item, defaultBusinessCategoryId, replay: { moved, skippedCurated, skippedMissingDefault } }`. Audit: `parameter-module-driver-default-business-category-updated`. |
| `POST` | `/api/v2/parameter-modules/driver-registry/:moduleId/replay-placement` | Explicit Admin “replay from registration”: reparent **auto** driver-group to registration default; curated skipped. Returns `{ moduleId, moved, skippedCurated, skippedMissingDefault }`. Audit: `parameter-module-driver-placement-replayed`. |
| `GET` | `/api/v2/organization-driver-schemas` | List org-owned manual driver schema overlays (`{ items, total }`). |
| `GET` | `/api/v2/organization-driver-schemas/:schemaId` | Get one overlay (`{ item }`). |
| `POST` | `/api/v2/organization-driver-schemas` | Admin create draft overlay (`{ compatible, displayName, notes?, properties[] }`). Each property is either `{ parameterSpecId }` (link definition library) or `{ propertyKey, valueShape, … }` (create/ensure the org manual ParameterSpec then link). Exact compatible only; rejects when a pinned releasable schema already covers the compatible (`409`). Returns `{ item }` (`201`). |
| `PATCH` | `/api/v2/organization-driver-schemas/:schemaId` | Admin update draft overlay metadata/properties (same property link/create shape). Active property sets are immutable. |
| `POST` | `/api/v2/organization-driver-schemas/:schemaId/activate` | Activate overlay: merges into org schema registry, upgrades matching provisional manual specs in place, resolves related open review tasks. Returns `{ schema, upgradedSpecIds, resolvedReviewTaskIds }`. |
| `GET` | `/api/v2/organization-driver-schemas/:schemaId/deprecation-impact` | Admin preview overlay retirement impact: `{ item: { schemaId, compatible, coverageLoss, definitionCount, projectCount, successorSource? } }`. |
| `POST` | `/api/v2/organization-driver-schemas/:schemaId/deprecate` | Deprecate an overlay so it no longer participates in matching. When preview reports `coverageLoss`, body must include `confirmCoverageLoss: true` or `409` with `confirmRequired`. Rejects create/activate when an active **platform** overlay already covers the compatible. |
| `GET` | `/api/v2/platform/driver-schemas/promotion-candidates` | `platform:schema-promote` only. Cross-org aggregate of active organization overlays grouped by `lower(compatible)`. Fixed projection: compatible, contributor organization ids, property keys/shapes, equivalence verdict, divergence (if any), existing platform overlay ids. Does **not** return full overlay records. |
| `POST` | `/api/v2/platform/driver-schemas/promotions` | `platform:schema-promote`. Body `{ compatible, documentationSourceOrganizationId? }`. Requires equivalent contributors. Writes platform overlay (`organization_id IS NULL`), promotes linked ParameterSpecs in place, marks contributors `superseded`, invalidates every org schema registry cache, fans out platform + per-tenant audit. |
| `POST` | `/api/v2/platform/driver-schemas/promotions/:promotionId/revert` | `platform:schema-promote`. Deprecates the platform overlay and restores contributor overlays to `active`. |

`DriverRegistryParseCoverage` when covered includes `scope: "platform" | "organization"` and optional `shadowedBy[]` for lower-tier matches that lost to the chosen tier.

`MappingApplyPreview` shape: `{ affectedBindings, byProject: [{ projectId, count }], fromModules: [{ moduleId, moduleName, count }], toModuleId, emptiedModules, conflicts }`.

**Binding module identity (Phase 2):** every `project_parameter_bindings` row persists a required `module_id` referencing `parameter_modules(id)` (migration `0067`), with browse unique key `(project_id, logical_node_id, parameter_spec_id, module_id)`. Writes resolve the module through a single resolver: **compatible → node-type → unclassified root** — never null. `module_id` must reference a **driver group** or **node-type unit** (or the org unclassified root); business categories never receive bindings. Device instance identity is **`logical_node_id` only** — two instances of one driver share definitions and differ in values. The bindings DTO exposes `moduleId`; the workbench treats it as the browse source of truth (no derive-on-read). Clean cutover with no dual-read compatibility layer (ADR-0010).

Value split: responses expose `exampleValue`, `schemaDefault`, `policyTarget`, and `effectiveValue` as distinct fields. Do not collapse them into a business `recommendedValue`. Topology payloads carry API provenance (`sourceChain` / occurrence spans); clients must not invent teaching fallbacks in API mode.

Config Set revisions persist a full manifest (`entryFile`, `includeSearchPaths`, overlay order, member roles). Historical revisions without a manifest are backfilled from pinned `dts_config_revision_members`. `manifestState=needs_review` fail-closes validate, typed edit, release, and writeback until repaired. Clients and validators must reload the persisted manifest rather than hardcoding `includeSearchPaths=["."]`.

Dashboard hotspots (`GET /api/v1/parameters/dashboard/hotspots`) include **global vendor specs** (`organization_id IS NULL`) for tenant-bound projects alongside org-owned specs.

**Migration CLI (maintenance only):** `npm run parameter-identities:migrate` supports `dry-run` (default), `--stage-review` (durable inferred staging transaction), and `--finalize --migration-run-id <id>` (atomic activity FK write). Cutover accepts only `finalized` runs. See `docs/runbooks/parameter-identity-cutover.md`.

**Round 4 evidence:** vendor dt-schema passes real `dt-validate` on golden DTBs; golden topology counts **176** property occurrences / **120** matched after structural exclusion / **684** seed `dts_properties` rows (locked in server tests). Review blockers honor `blocker_scope`; matcher overrides include locator fingerprint.

**Round 5 evidence (branch `fix/parameter-topology-round5-review-blockers`):** immutable base vs candidate binding revisions on merge/writeback; semantic merge fail-closed without `objectStore`/project/write-lock/toolchain; immutable `parameter_identity_migration_phases` rows with `migration_run_id` task linkage; tenant-scoped review resolve; manual spec draft→`activate`→resolve; acceptance helpers `acceptanceTaskLookup` / `semanticFixtureCleanup` (no `items[0]` fallbacks).

**Round 6 evidence (branch `fix/parameter-topology-round6-review-blockers`):** migration `0058` evidence-only review-task scope reconcile; lossless manual IDs/keys; global-spec activation authz; full valueShape; tenant cleanup and stable `test:all`; migrations `0059`–`0062` for exact draft identity, all-origin invalidation, and durable set/delete; and migration `0063` for transactionally durable submitted candidate identity. Exact submission locks/promotes the candidate and merge revalidates it. Disposable acceptance passes real set/delete submit→review→merge→writeback→reload role chains and asserts the request/item candidate IDs and `pending_approval` state. This is implementation acceptance only; TD-042 still blocks production cutover readiness.

Cutover/rollback procedure: `docs/runbooks/parameter-identity-cutover.md`. **TD-042 remains a BLOCKER** until a clean non-customer snapshot rehearsal completes — round 4–6 fixes do not clear production cutover readiness.

## Governance

The backend remains the contract owner. Frontend DTOs must map explicitly and tests must fail on drift. New endpoints should be added to the OpenAPI artifact and reviewed for authz, audit, error envelope, pagination, and evidence impact.

Run:

```bash
npm run contract:check
```
