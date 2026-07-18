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
| `POST` | `/api/v1/parameter-modules` | Create a module (`name`, optional `parentId`). |
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

`POST /api/v1/parameter-submission-rounds` has two non-overlapping item shapes. Legacy flat submissions use `{ parameterId, targetValue, reason }`. Post-cutover topology submissions use `{ draftId, projectParameterBindingId, parameterSpecId, targetValue, reason }` and must not also send `parameterId`. The server loads that exact user-owned draft within the caller organization/project, verifies binding/spec/value/reason, the draft's persisted candidate revision (`0059`), and its binding/file/occurrence write lock before creating the round. Cross-project or missing drafts return `404`; mismatched identities, non-draft candidates, or stale locks return `409`. Failed validation creates no success audit. The `parameter-submit` audit records the accepted draft, binding, and spec IDs.

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

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v2/parameter-specs` | List versioned parameter specs (property key, driver module, locator fields separated). |
| `GET` | `/api/v2/parameter-specs/:specId` | Spec detail including example/default/policy metadata (`example_value` is informational). |
| `GET` | `/api/v2/parameter-spec-review-tasks` | Org-scoped, paginated, status-filtered spec review queue (`?status=&limit=&cursor=`). |
| `POST` | `/api/v2/parameter-specs/:specId/activate` | Admin activates a **draft** **org-owned** spec (`organization_id === caller org`) with full `valueShape` (bits/groups/cellsPerGroup/length as inferred), `constraints`, `documentation`, `reason`. Platform-global drafts (`organization_id IS NULL`) → `403` fail-closed. Cross-org → `404`. Incomplete/conflicting shapes → `400`/`409`. Audit on success only: `parameter-topology-governance` / `spec-activated`. |
| `POST` | `/api/v2/parameter-spec-review-tasks/:taskId/resolve` | Admin resolve/dismiss a spec review task (`parameterSpecId` must be org-owned or global, **or** `createSpec: true` for unmatched tasks). Server validates tenant ownership of project/revision/occurrence/logical-node evidence via scoped join before applying decisions — raw evidence IDs alone are not trusted. `createSpec: true` creates an org-owned **draft** spec (typed shape from occurrence AST) and returns `draftCreated` with a message to activate before resolve. Only **active**+complete specs may resolve/release. Resolve applies occurrence→spec→binding + reusable matcher override (scoped by compatible + **node locator fingerprint** + property key) in one transaction. Library resolve with a different property key requires explicit `confirmPropertyMismatch: true` or the server rejects with a mismatch error. Dismiss is fail-closed: no binding is created and release/validate still blocks dismissed properties. Audit: `parameter-topology-governance` / `spec-review-resolved`. |
| `GET` | `/api/v2/projects/:projectId/config-sets/:configSetId/revisions/:revisionId/topology` | Source or effective tree (`?view=source\|effective`). |
| `GET` | `/api/v2/projects/:projectId/parameter-bindings` | Stable project bindings (spec + logical node + effective value). |
| `GET` | `/api/v2/identity-mapping-tasks` | List open/resolved identity mapping tasks. |
| `POST` | `/api/v2/identity-mapping-tasks/:taskId/resolve` | Admin resolve a mapping task. |
| `POST` | `/api/v2/projects/:projectId/config-revisions/:revisionId/validate` | Fail-closed toolchain validate for publish readiness. Failed re-validation **revokes** a previously `validated` revision (does not leave a stale validated marker). Open identity-mapping or dismissed-but-unmatched spec-review blockers fail closed. |
| `POST` | `/api/v2/projects/:projectId/parameter-bindings/:bindingId/drafts` | Typed binding draft with **exact-occurrence** Config Set writeback: locks binding revision, occurrence, file version, checksum, and CST span (schema enforced; **base** binding revision immutable; merged values on **candidate** revision). Stale revision/occurrence identity → `409`. Post-cutover semantic merge fail-closes without `objectStore`, project scope, write lock, or real DTC toolchain — no `WISEEFF_WRITEBACK_SKIP_TOOLCHAIN` production path. Post-cutover drafts must not create shadow `project_parameter_values` / `parameter_definitions` rows. |

Value split: responses expose `exampleValue`, `schemaDefault`, `policyTarget`, and `effectiveValue` as distinct fields. Do not collapse them into a business `recommendedValue`. Topology payloads carry API provenance (`sourceChain` / occurrence spans); clients must not invent teaching fallbacks in API mode.

Config Set revisions persist a full manifest (`entryFile`, `includeSearchPaths`, overlay order, member roles). Historical revisions without a manifest are backfilled from pinned `dts_config_revision_members`. `manifestState=needs_review` fail-closes validate, typed edit, release, and writeback until repaired. Clients and validators must reload the persisted manifest rather than hardcoding `includeSearchPaths=["."]`.

Dashboard hotspots (`GET /api/v1/parameters/dashboard/hotspots`) include **global vendor specs** (`organization_id IS NULL`) for tenant-bound projects alongside org-owned specs.

**Migration CLI (maintenance only):** `npm run parameter-identities:migrate` supports `dry-run` (default), `--stage-review` (durable inferred staging transaction), and `--finalize --migration-run-id <id>` (atomic activity FK write). Cutover accepts only `finalized` runs. See `docs/runbooks/parameter-identity-cutover.md`.

**Round 4 evidence:** vendor dt-schema passes real `dt-validate` on golden DTBs; golden topology counts **173** property occurrences / **519** seed `dts_properties` rows (locked in server tests). Review blockers honor `blocker_scope`; matcher overrides include locator fingerprint.

**Round 5 evidence (branch `fix/parameter-topology-round5-review-blockers`):** immutable base vs candidate binding revisions on merge/writeback; semantic merge fail-closed without `objectStore`/project/write-lock/toolchain; immutable `parameter_identity_migration_phases` rows with `migration_run_id` task linkage; tenant-scoped review resolve; manual spec draft→`activate`→resolve; acceptance helpers `acceptanceTaskLookup` / `semanticFixtureCleanup` (no `items[0]` fallbacks).

**Round 6 evidence (branch `fix/parameter-topology-round6-review-blockers`):** migration `0058` evidence-only review-task scope reconcile (including missing-evidence reopen); lossless manual entity IDs and persisted specification keys (`vendor,limit` ≠ `vendor-limit`); org Admin cannot activate global drafts; full valueShape activate path; tenant-scoped cleanup; API-runtime/fixture/query isolation under `test:all`; and migration `0059` plus explicit binding-draft submission identity. Topology acceptance creates a marker-verified disposable post-cutover database and passes the real submit→review→merge→writeback→reload role chain. This is implementation acceptance only; TD-042 still blocks production cutover readiness.

Cutover/rollback procedure: `docs/runbooks/parameter-identity-cutover.md`. **TD-042 remains a BLOCKER** until a clean non-customer snapshot rehearsal completes — round 4–6 fixes do not clear production cutover readiness.

## Governance

The backend remains the contract owner. Frontend DTOs must map explicitly and tests must fail on drift. New endpoints should be added to the OpenAPI artifact and reviewed for authz, audit, error envelope, pagination, and evidence impact.

Run:

```bash
npm run contract:check
```
