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

- Auth and users: `/me`, home organization `GET`/`PATCH /api/v1/organization`, user listing, user creation, activation, role replacement.
- Projects and modules: project metadata and module lookup.
- Parameters: parameter listing, detail, history, drafts, submission rounds, change requests, imports, dashboard aggregation (`/parameters/dashboard/summary`, `/parameters/dashboard/hotspots`), org module tree CRUD (`/parameter-modules`), **project parameter initialization** (`/parameters/projects/:projectId/initialization*`, `/parameters/admin/initialization-reviews*`), per-project parameter file hosting with sync, conflict resolution, and staged candidates (`/projects/:projectId/parameter-files*`, `/projects/:projectId/parameter-file-candidates*`), structured DTS read/search (`.../structure`, `/projects/:projectId/dts-search`), and per-project DTS config sets, release baselines, validation gate, and lossless export (`/projects/:projectId/config-sets*`, `/projects/:projectId/baselines/:baselineId/*`).
- Semantic parameter topology (v2): parameter specs, spec review tasks, source/effective topology, project bindings, identity mapping tasks, and fail-closed config-revision validate under `/api/v2/*` (see below). Legacy flat parameter IDs are retired at cutover with `410 legacy-parameter-id-retired`.
- Logs: upload/file records (plain text plus `.gz` / single-entry `.zip` archives unpacked at intake), analysis records, runs, rerun, archive, feedback, feedback-quality insights (`/logs/feedback-insights`), and org-scoped log-domain governance (`/log-domains`).
- Product feedback: Internal Beta sidebar feedback submission, admin triage, and attachment content.
- Knowledge: organization-scoped knowledge entries, revisions, published-only search, and file content under `/api/v1/knowledge/*`.
- Jobs: status and progress events.
- Debugging: devices, target detection, sessions, node reads/writes, snapshots, rollback.
- Agent: Xiaoze AG-UI run, proactive suggest, and thread persistence under `/api/v1/agent/xiaoze`.
- Audit: audit event listing and detail. Listing supports server-side filters (`projectId`, `app`/`apps`, `kind`, `severity`, `actorUserId`, `targetType`, `targetId`, `traceId`, cursor paging) plus `q` (case-insensitive search over action, kind, target id, and actor name) and `from`/`to` timestamps.
- Operations: liveness, readiness, metrics, pilot/release readiness.

`POST /api/v1/agent/xiaoze/suggest` validates `{ context?: { projectId?, projectName?, pageKey?, path? } }` and returns `{ suggestions: [{ id, tone, headline, meta?, citations }] }`; malformed input is `400 VALIDATION_FAILED`, while a drifting successful response fails closed in the frontend. Xiaoze's five WiseEff CUSTOM frame families have concrete Zod payload/envelope schemas tested against the existing `xiaozeTurnStream` reducer output. This does not wrap or replace `@ag-ui/client`, and the generic AG-UI SSE run response remains outside JSON-response OpenAPI modeling.

## Log and Debugging Scope

M2 log upload/list and M3 debugging runtime/catalog APIs are scoped by authenticated `organization_id`. They do not accept `projectId` query parameters or body fields. Log records may include optional `relatedParameterId` as a soft link to M1 definitions.

## Log Domains and Analyzer Provenance

Log domains are org-scoped registrations of a business's log intake (name, description, optional declarative format profile). Governance requires `logs:admin-domains` and every mutation writes a `log-domain-*` audit event.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/log-domains` | List domains (`logs:view`; `includeArchived=true` adds archived rows). |
| `POST` | `/api/v1/log-domains` | Create a domain (`{ name, description?, formatProfile? }`). Duplicate name in the organization → `409`; invalid format profile → `400` with issues. Returns `201 { item }`. |
| `PATCH` | `/api/v1/log-domains/:domainId` | Update name/description/format profile/status/model override (`formatProfile: null` clears the stored profile; `modelOverride: null` clears back to the global `LOG_ANALYSIS_MODEL`). |
| `POST` | `/api/v1/log-domains/:domainId/archive` | Archive the domain; existing log records keep their binding. |
| `GET` | `/api/v1/log-domains/:domainId/knowledge-links` | P2: list the domain's knowledge-entry links with each entry's current status (`logs:admin-domains`). |
| `PUT` | `/api/v1/log-domains/:domainId/knowledge-links` | P2: replace the link set (`{ knowledgeEntryIds: uuid[] }`). Only **published** knowledge entries in the caller's organization are accepted (`400` for drafts/archived, `404` for unknown entries); audited as `log-domain-knowledge-links-update`. |
| `PUT` | `/api/v1/log-domains/:domainId/webhook` | P3b: replace the domain's result-webhook config (`{ url: string\|null, enabled: boolean, secret?: string\|null }`; `secret` omitted keeps the stored one). URL must pass the SSRF policy (https-only, no credentials, no private/loopback/metadata addresses — `400` with `reason` codes `webhook-url-scheme` / `webhook-url-private-address` / `webhook-url-required` / `webhook-secret-required`). Audited as `log-domain-webhook-config`; the secret is never echoed. |
| `GET` | `/api/v1/log-domains/:domainId/webhook-deliveries` | P3b: recent delivery attempts (`limit` 1..50, default 10) — one row per attempt with `kind` (`result`/`test`), `attempt`, `status` (`delivered`/`retrying`/`failed`), `httpStatus?`, `error?`. |
| `POST` | `/api/v1/log-domains/:domainId/webhook-test` | P3b: send a single-attempt test delivery through the same SSRF-guarded signed sender; returns `{ outcome: { status, attempts, httpStatus?, error? } }` and is audited as `log-domain-webhook-test`. |

`POST /api/v1/log-files`, `POST /api/v1/logs`, and `POST /api/v1/logs/:logId/rerun` accept an optional `logDomainId`. The domain must belong to the organization and be `active`, otherwise `400`; omitting it keeps the built-in uncategorized log domain semantics (generic analysis, upload never blocked).

Log domain DTOs carry `modelOverride?` and a webhook summary `{ enabled, url?, secretConfigured, secretLastFour? }` — the signing secret itself is write-only. The outbound result-webhook payload and signature scheme (`X-WiseEff-Signature` = HMAC-SHA256 over `timestamp.rawBody`, `X-WiseEff-Timestamp` replay window) are specified in [`docs/api/log-analysis-integration.md`](../api/log-analysis-integration.md); delivery is best-effort and never blocks the analysis.

Log record DTOs gained additive provenance fields: `logDomainId?`, `logDomainName?`, `analysisSource?: "agent" | "rules-fallback"`, and `degradedReason?: "provider-unavailable" | "token-budget-exhausted"`. A `rules-fallback` source marks a degraded analysis and must stay visible to clients; the rest of the log output contract is unchanged.

### Compressed uploads (P3)

Upload file names may carry `.gz` (single gzip file whose inner name keeps a supported text extension — `.log`, `.txt`, `.csv`, or `.json`, e.g. `app.log.gz`) or `.zip` (exactly one non-directory entry with a supported text extension; stored or deflate compression, no encryption). The server unpacks archives at intake, so the stored object and all downstream evidence line numbers reference the unpacked UTF-8 text. Unpack failures (corrupt stream, multi-entry zip, unsupported entry name, size bound) create a `failed` log record with a readable `failureReason` and no analysis job — the same path as unsupported extensions. Size discipline (zip-bomb guard, constants in `server/modules/logs/unpack.ts`): unpacked content is capped at **100 MB** absolute (the documented text-log bound) and at **200×** the compressed upload size, with a 1 MB floor so small archives are never over-restricted.

### Feedback quality insights (P3)

`GET /api/v1/logs/feedback-insights` (`logs:view`, org-scoped) aggregates `log_feedback` into the `/log-admin` analysis-quality dashboard: one row per log domain × `analysisSource` × `promptVersion` with `totalCount`, `helpfulCount`, `helpfulRate` (0..1), and `lastFeedbackAt`. Optional `timeWindow=today|7d|30d` filters by feedback creation time (same interval semantics as `GET /api/v1/logs`). Feedback is attributed to the analysis run stamped on the row (`log_feedback.run_id`, captured from the log's current run at insert time); rows that still have a null `run_id` fall back to the log's current run. List/detail continue to read the current run's report. `logDomainId`/`logDomainName` are `null` for the uncategorized domain and `analysisSource`/`promptVersion` are `null` for legacy reports without provenance.

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
| `GET` | `/api/v1/debugging/admin/catalog/export` | Export the org debug-node catalog (modules, nodes, bindings) as `wiseeff.debug-node-catalog.v1`. Requires `debugging:admin`. Writes `debug-node-catalog-export` audit without raw node paths. |
| `POST` | `/api/v1/debugging/admin/catalog/import` | Merge-import a v1 catalog document: upsert modules by parent+name and nodes by id or name+module path. Requires `debugging:admin`. Writes `debug-node-catalog-import` audit without raw node paths. |

The legacy `/api/v1/debugging/admin/parameters*` family is retired and returns `404`; it is absent from the route manifest, OpenAPI, and the frontend Admin client. This removes only the unused governance interface. `debugging_parameters`, `debugging_parameter_node_bindings`, their repository/service code, historical rows, bindings, operations, and audit evidence remain available for archive interpretation and migrations.

Runtime `/api/v1/debugging/parameters?protocol=...` (legacy) remains separate and returns only enabled, non-archived parameters with an enabled selected-protocol binding. Product `/node-debugging` uses the logical-node runtime interface instead.

Legacy runtime debugging parameter DTOs include optional value metadata:

- `valueKind`: `scalar | complex` (defaults to `scalar` for legacy rows)
- `valueFormat`: `raw | json | dts | line-list | kv-list`
- `normalizationMode`: `exact | trim | line-ending-normalized | json-canonical`
- `maxValueBytes`: positive integer cap for write payload size

Node write requests keep `value: string`; the service resolves format, normalization, digest, preview, and comparison from stored metadata.

Node operation DTOs may include `valueKind`, `valueFormat`, `normalizationMode`, `valuePreview`, and value digests for complex writes without returning full large payloads in list views.

## DTS reload debugging

Dedicated module under `/api/v1/dts-reload/*` (not the retired `/api/v1/debugging/reload-targets` / `.../parameters/reload` `410` surface).

| Method | Path | Authz | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/dts-reload/projects/:projectId/candidates` | `debugging:view` or `debugging:dts-reload` | Project parameters with debuggability, `moduleId`, `description` (parameter meaning), sensitiveMatch, lastReload. Each candidate carries both the raw catalog `valueShapeKind` (display only) and the server-resolved `resolvedValueShape` (normalized reload vocabulary, or null); clients drive authoring validation, placeholders, and examples from `resolvedValueShape` — never the catalog kind — because resolution needs the DTS parser and the library baseline. Debuggable when nonempty absolute `nodePath`, supported reload value shape, and library baseline exist — including single-segment `/label` paths (no synthesised-anchor path-shape refuse). Presence shapes (`boolean` / `empty`) may have an empty RHS baseline. Supported shapes include u32/u8/u16 cells (incl. `/bits/ 8`), catalog `string` (single quoted string, e.g. `replace_sensor`), `string-list`, GPIO-style `phandle-cells`, bare phandle lists (`<&gic>` → `phandle-list`), booleans, empty properties, and mixed string+cell values. Explicit `/delete-property/` is an overlay verb, never inferred from an empty cell or string. `u32-array` is treated as the same reload family as `cells` (width may be inferred from a regular library baseline). Catalog `mixed` / `phandle-list` baselines that match GPIO-style `<&label N …>` resolve to reload shape `phandle-cells` (e.g. `gpio_int`); true mixed AST stays `mixed` and is never coerced to cells. Catalog `bytes` baselines authored as `/bits/ 8 <…>` resolve to reloadable 8-bit cell arrays (e.g. `prevfod1_product_list`). Rows that share the same overlay identity (`nodePath` + `propertyKey`) are collapsed to one candidate. |
| `POST` | `/api/v1/dts-reload/projects/:projectId/runs` | `debugging:dts-reload` | Start run (batch targets); may require `confirm-sensitive-reload` |
| `POST` | `/api/v1/dts-reload/runs/:runId/deploy` | `debugging:dts-reload` | In-request bridge deploy; requires `confirm-dts-reload` |
| `GET` | `/api/v1/dts-reload/runs` / `.../:runId` | view path | History and detail including reload snapshot |
| `GET` | `/api/v1/dts-reload/residue` | view path | Device residue bookkeeping |
| `POST` | `/api/v1/dts-reload/projects/:projectId/restore-baseline` | `debugging:dts-reload` | Start compensating restore-baseline run |
| `POST` | `/api/v1/dts-reload/runs/:runId/promote-to-drafts` | Reload read gate plus `parameter:edit`, and either `debugging:dts-reload` or `admin:access`. Human actor only (`actorType` honest; Agent refused). | Promote selected stored debug values into `parameter_drafts` via `createBindingDraft`, then stop. Body `{ bindingIds, unverifiableAcknowledged? }`. Ordinary `verified` runs, or ordinary `unverifiable` with `unverifiableAcknowledged: true`. Does **not** create change requests, submit rounds, or write the debug value into the binding. Returns draft ids and a `/parameters?project=` workbench href. Audited as milestone `reload-value-promoted-to-draft`. |
| `*` | `/api/v1/dts-reload/configuration` | `debugging:admin` | Organisation reload-configuration defaults |

Committed OpenAPI (`docs/generated/openapi.json`) is authoritative for request/response schemas.

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

## Knowledge Base

Organization-scoped knowledge entries with immutable revisions (design: [Knowledge Base Design](2026-08-12-knowledge-base-design.md)). Reads require `knowledge:view`; creating and governing OWN entries requires `knowledge:edit`; governing any entry and hard delete require `knowledge:manage`. Drafts are visible to their owner and managers only. Every mutation writes an audit event with the request trace.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/knowledge/entries` | Create a markdown or file entry as a draft. File uploads send base64 content through the object-store seam and run text extraction. Returns `201 { item }`. |
| `GET` | `/api/v1/knowledge/entries` | List visible entries with optional `status`, `contentForm`, `sourceType` (`human` \| `agent` — the `/knowledge-admin` agent-draft queue lists `status=draft&sourceType=agent`), `tag`, `q` (title), and `limit` filters. |
| `POST` | `/api/v1/knowledge/distill-from-log` | Distil a COMPLETED log-analysis record into a pre-filled markdown **draft** (`{ logId }` → `201 { item }`): title from the conclusion, body assembled from conclusion/impact/severity/evidence line references/suggested actions, tags seeded (the log-analysis tag plus the severity label), and `sourceLogId` stored on the entry. Requires `knowledge:edit` plus `logs:view` and organization scope on the source record; non-complete analyses are `400`. Audited as `knowledge-entry-distill`. |
| `POST` | `/api/v1/knowledge/distill-from-reload-run` | Distil a TERMINAL DTS reload run (`verified` / `unverifiable` / `contradicted` / `failed`) into a pre-filled markdown **draft** (`{ runId }` → `201 { item }`): title from run purpose plus device context; body assembling the parameter set with baseline → debug values, per-parameter behavioural verification outcomes, the terminal state stated honestly (unverifiable/contradicted/failed never read as success), the artifact digest, and a kernel-log excerpt reference (never the whole capture — the run stays the evidence subject); tags seeded (the parameter-debugging and DTS-reload tags plus the terminal-state tag); `sourceReloadRunId` stored on the entry. Requires `knowledge:edit` plus the reload read gate (`debugging:view` or `debugging:dts-reload`) and organization scope on the source run; non-terminal runs are `400`. Audited as `knowledge-entry-distill`. |
| `GET` | `/api/v1/knowledge/search` | Search **published entries only** (`q`, optional `limit`). Hybrid retrieval: when `EMBEDDING_API_*` is configured and pgvector is available, chunk vector similarity fuses with the FTS/trigram ranking (reciprocal-rank fusion); otherwise the FTS-only path runs unchanged. Items carry citation-ready fields (`entryId`, `title`, `revisionId`, `excerpt`) and the response carries an honest `retrieval` report: `{ mode: "semantic_fts" \| "fts_only", vectorAvailable, embeddingConfigured, degradedReason? }`. |
| `GET` | `/api/v1/knowledge/related-to-log` | Related **published** knowledge for a COMPLETED log-analysis record (`logId`, optional `limit`, default 5): the similarity query derives from the stored conclusion/impact text only (never analyzer internals or rule ids) and runs through the same hybrid retrieval with a relevance cutoff (trigram `word_similarity` ≥ 0.2; vector cosine distance ≤ 0.75), so unrelated entries are dropped instead of padding the list. Requires `knowledge:view` plus `logs:view` and organization scope on the record; non-complete analyses are `400`, cross-organization records `404`. Same response shape as search (`items` + honest `retrieval`). Pure read — not audited, like search. |
| `GET` | `/api/v1/knowledge/related-to-spec` | **Published** entries structurally referencing one parameter definition (`specId`, optional `limit`) for the definition detail's related-knowledge list. Not a similarity search — a structural read over `knowledge_parameter_references`. Requires `knowledge:view`; organization-scoped; published-only invariant (drafts/archived never appear regardless of who looks); specs outside the caller's scope (unknown or another tenant's) are `404` like the spec detail API. Items carry the same citation fields as search. Pure read — not audited. |
| `PUT` | `/api/v1/knowledge/entries/:entryId/parameter-references/:specId` | Add a structural reference from the entry to a parameter definition. Binds to the `parameter_specs.id` **surrogate** (ADR-0017) so identity corrections never break it; referencing a deprecated definition is allowed (the lifecycle renders honestly, ADR-0011). Idempotent — re-adding an existing pair changes nothing and writes no audit. Entry owner with `knowledge:edit`, or `knowledge:manage`; archived entries are `400` like content edits; specs outside caller scope (org-owned or platform-global) are `404`. Returns `{ item }` with the updated `parameterReferences`. Audited as `knowledge-parameter-reference-add`. |
| `DELETE` | `/api/v1/knowledge/entries/:entryId/parameter-references/:specId` | Remove a structural definition reference. Same governance rule as adding; a reference that does not exist is `404`. Returns `{ item }`. Audited as `knowledge-parameter-reference-remove`. |
| `GET` | `/api/v1/knowledge/index/status` | Per-entry retrieval index health (`knowledge:manage` only): `{ retrieval, items }` where each item carries `status` (`pending` \| `processing` \| `succeeded` \| `failed`), `error`, indexed revision, and chunk counts. |
| `POST` | `/api/v1/knowledge/index/rebuild` | Re-enqueue every published entry for index rebuild (`knowledge:manage` only; e.g. after changing `EMBEDDING_MODEL`). Returns `{ enqueued }`. Audited. |
| `POST` | `/api/v1/knowledge/entries/:entryId/index/retry` | Re-enqueue one entry's index refresh (`knowledge:manage` only). Returns `{ enqueued: true }`. Audited. |
| `GET` | `/api/v1/knowledge/entries/:entryId` | Entry detail with head-revision content and file metadata (extraction status included). |
| `PATCH` | `/api/v1/knowledge/entries/:entryId` | Save an edit (`title` / `tags` / `contentMarkdown` / replacement `file`) as a new immutable revision. Requires `expectedHeadRevisionNumber`; a stale save returns `409 CONFLICT` with `details.code: "knowledge-revision-conflict"`. |
| `POST` | `/api/v1/knowledge/entries/:entryId/publish` | Publish a draft into retrieval (`draft → published`). |
| `POST` | `/api/v1/knowledge/entries/:entryId/archive` | Archive a published entry out of retrieval (`published → archived`). |
| `POST` | `/api/v1/knowledge/entries/:entryId/restore` | Restore an archived entry (`archived → published`). |
| `POST` | `/api/v1/knowledge/entries/:entryId/reject` | Archive-reject an **agent-sourced draft** from the publish queue (`draft → archived`, never published). Entry owner with `knowledge:edit`, or `knowledge:manage`; human drafts and non-drafts are `400`. Audited as `knowledge-entry-reject`. |
| `DELETE` | `/api/v1/knowledge/entries/:entryId` | Hard delete with revisions and file metadata; structural parameter references cascade and the audit metadata records `parameterReferenceCount`. `knowledge:manage` only; writes a `High`-severity audit event. |
| `GET` | `/api/v1/knowledge/entries/:entryId/revisions` | List immutable revisions, newest first. |
| `POST` | `/api/v1/knowledge/entries/:entryId/revisions/:revisionId/restore` | Restore a prior revision as a new head revision (requires `expectedHeadRevisionNumber`). |
| `GET` | `/api/v1/knowledge/entries/:entryId/file/content` | Download the current binary of a file-form entry. |

File uploads accept `application/pdf`, `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`), `application/msword`, `text/plain`, and `text/markdown`, up to 20 MB. Extraction failures are recorded honestly on the file row (`extractionStatus: "failed"` plus a readable `extractionError`) without failing the upload.

Publish, edit-of-published, archive, and restore enqueue an asynchronous index refresh (chunking + optional embeddings); the index worker only ever materializes **published** revisions, so drafts and archived entries are never retrievable. Xiaoze grounds knowledge questions through the registered read tools `knowledge.search` / `knowledge.getDocument`, which run under the calling user's AuthContext (`knowledge:view` + organization scope) and return citation payloads that deep-link to `/knowledge?entryId=…`. The approval-gated write tool `action.createKnowledgeDraft` (input: `title`, `contentMarkdown`, `tags`, optional `sourceLogId`) creates a NEW agent-sourced draft through the DB-backed approval chain — it interrupts for explicit human approval, executes under the calling user's AuthContext (`knowledge:edit`), records the creating session on `sourceSessionId`, and its drafts stay out of retrieval until published from `/knowledge-admin` or by the owning engineer.

Entry payloads (list + detail) carry `parameterReferences`: the entry's structural definition references, each with `specId` (the `parameter_specs.id` surrogate), `propertyKey`, `displayName`, `driverModule` (attribution-subject display name), and the definition `lifecycle` reported honestly (`draft` / `active` / `deprecated` — deprecation never removes a reference, ADR-0011). `knowledge.getDocument` mirrors them as `referencedParameters` (`specId` + `name` + `lifecycle`) so grounded answers can name the parameters.

## Project Parameter Initialization

One-time semantic binding library initialization for new projects (`projects.initialization_status`). Creator draft/submit; Admin approve/reject. Audit kinds: `project-initialization-submitted` / `approved` / `rejected`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/parameters/projects/:projectId/initialization` | Status + optional draft. |
| `PUT` | `/api/v1/parameters/projects/:projectId/initialization/draft` | Upsert draft (semantic snapshots or `emptyLibrary`). |
| `POST` | `/api/v1/parameters/projects/:projectId/initialization/preview` | Server-side primary/supplement merge preview. |
| `POST` | `/api/v1/parameters/projects/:projectId/initialization/submit` | Submit pending review. |
| `GET` | `/api/v1/parameters/admin/initialization-reviews` | List pending reviews (Admin). |
| `POST` | `/api/v1/parameters/admin/initialization-reviews/:reviewId/approve` | Approve + materialize bindings. |
| `POST` | `/api/v1/parameters/admin/initialization-reviews/:reviewId/reject` | Reject with required reason. |

While `initialization_status` ≠ `initialized`, `POST /api/v1/parameter-submission-rounds` fail-closes.

Admin project summaries (`GET/POST /api/v1/parameters/admin/projects`) return both ops `status` (`initialized` | `maintenance`) and `initializationStatus` (`projects.initialization_status`). The Admin projects table prefers a non-`initialized` init status for its status column.

## Project Parameter Files

Per-project DTS/JSON files are hosted internally with immutable version history. Upload bodies use JSON `contentBase64` (not multipart). P1 file size cap is 2 MB. Parameter list/detail DTOs expose optional `sourceFileName` and `sourceNodePath` on bound project values.

View routes require `canViewParameters`; upload, version upload, file-history rollback, sync, and conflict resolve require `canAdminParameters`. Conflict resolve also enforces `canReviewParameters` in the service layer. Version list items may include `createdByDisplayName` (from `users.name`; omitted when unknown).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/parameter-files` | List hosted files with current version metadata. |
| `POST` | `/api/v1/projects/:projectId/parameter-files` | Upload a new file or first version. Returns `201 { item, version, unsupportedConstructs?, driverSummary? }`. For DTS uploads, `driverSummary` compares file compatibles to registered mappings (`matchedRegistered` / `newUnregistered`). |
| `POST` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions` | Upload the next file version. Returns `201 { item }` (version DTO) plus optional `unsupportedConstructs` / `driverSummary` as above. |
| `GET` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions` | List version history for one file. Items include optional `createdByDisplayName`. |
| `POST` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/rollback` | Insert a new current version (`origin=rollback`) that reuses the chosen historical blob. Does not rewind history. Already-current → `409 CONFLICT`. Returns `201 { item, file }`. Requires `canAdminParameters`. Audits `parameter-file-rollback`. |
| `GET` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/content` | Download raw file bytes for one version. |
| `GET` | `/api/v1/projects/:projectId/parameter-file-candidates` | List staged candidates (`?fileId=&includeAbandoned=`). Returns `{ items }` without storage keys. |
| `POST` | `/api/v1/projects/:projectId/parameter-file-candidates` | Create a staged candidate (`fileName`, `contentBase64`, optional `fileId`). Never changes active version or config-set membership. Returns `201 { item }`. |
| `GET` | `/api/v1/projects/:projectId/parameter-file-candidates/:candidateId` | Read one candidate lifecycle DTO. |
| `GET` | `/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/impact` | Read candidate impact evidence (`textDiff`, `structuralDiff`, diagnostics, coverage, conflicts, blockers). |
| `GET` | `/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/content` | Download candidate bytes. |
| `POST` | `/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/abandon` | Abandon ready/blocked/failed/stale candidates without changing Working configuration. |
| `POST` | `/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/recompute` | Recompute impact for ready/blocked/failed/stale candidates; stale recomputation rebases against the current active version. |
| `POST` | `/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/activate` | Activate a ready candidate with `expectedCurrentVersionId` CAS. New files require `configSetId` + `role`. Stale base returns `409` with `reason: stale-base`, marks the candidate `stale`, and preserves Working configuration. Success returns `{ item, file, version }` and audits activation. |
| `POST` | `/api/v1/projects/:projectId/parameter-files/:fileId/sync` | Diff the current or requested version against DB and upsert `file_sync` drafts. Returns `{ item: syncSummary }`. |
| `GET` | `/api/v1/projects/:projectId/parameter-file-conflicts` | List open file/UI draft conflicts for the project. Each item is enriched with `baseValue`, `parameterName` / `parameterModule`, human `fileVersionLabel` (and `fileVersionNumber` / times), source identities (`fileId`, `fileName`, `configSetId`, `nodePath`, `propertyName`, optional `source` locator). |
| `POST` | `/api/v1/projects/:projectId/parameter-file-conflicts/:conflictId/resolve` | Resolve one conflict. Body: `{ "resolution": "file" \| "ui", "reason?" }`. Optional trimmed `reason` is stored on `parameter-file-conflict-resolve` audit metadata. |
| `POST` | `/api/v1/projects/:projectId/parameter-file-conflicts/bulk-preview` | Preview eligible bulk arbitration. Body: `{ "resolution": "file" \| "ui", "conflictIds?" }`. Omitting `conflictIds` previews all open project conflicts. Returns `{ resolution, eligible, ineligible, impact }` (`impact` summarizes eligible/ineligible counts, parameter names, file ids). Ineligible reasons: `not_found`, `already_resolved`, `wrong_project`, `missing_values`. |
| `POST` | `/api/v1/projects/:projectId/parameter-file-conflicts/bulk-resolve` | Apply one resolution to eligible conflict ids only. Body: `{ "resolution": "file" \| "ui", "conflictIds", "reason?" }`. Returns `{ resolved, skipped }` where `skipped` mirrors ineligible preview rows. The eligible batch is atomic (ADR-0027): an unexpected mid-batch failure rolls back every resolution and the request fails, never leaving a half-applied batch. |

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

When `versionId` is omitted, sync uses the file's `currentVersionId`. Versions with `origin=writeback` skip automatic draft generation during sync (`skipped: true`). After semantic identity cutover, sync diffs each parsed-index path against project parameter bindings (logical node locator + property key, scoped to that file version's occurrence graph) and upserts `file_sync` drafts on the binding. It does not query retired `project_parameter_values` / `parameter_definitions`. Open conflicts persist `project_parameter_binding_id` and `parameter_spec_id`; list/resolve DTOs still expose them as `projectParameterValueId` / `parameterDefinitionId`.

Audit actions: `parameter-file-upload`, `parameter-file-rollback`, `parameter-file-sync`, `parameter-file-conflict-open`, `parameter-file-conflict-resolve`, `parameter-writeback-to-file`.

### Structured read and DTS search (P3)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/structure` | Read the persisted structural model for one file version from `dts_*` (no re-parse). Returns `{ nodes }`; each node includes typed `properties` (`valueType`, `rawText`, `normalizedValue`), `phandleRefs`, and optional `source` locators (`startOffset`/`endOffset`/`startLine`/`startColumn`/`endLine`/`endColumn`) persisted at ingest. Requires `parameter:view`. |
| `GET` | `/api/v1/projects/:projectId/dts-search` | Search current file versions' `dts_*` rows. Query: `q` (required), optional `by` = `path`\|`address`\|`label`\|`compatible`\|`value`\|`file` (omit `by` to search all dimensions including file name). Returns `{ hits }` with optional `source` locators. Requires `parameter:view`. |
Structural source locators are persisted by migration `0092_dts_structural_spans.sql` on `dts_nodes` / `dts_properties` and returned on structure/search reads without re-parse.

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
| `GET` | `/api/v1/projects/:projectId/config-sets/:configSetId/files` | Read scoped Config-set members with role, format, sort order, and current active version identity. Requires `parameter:view`; an out-of-project or out-of-organization Config set returns `404`. |
| `POST` | `/api/v1/projects/:projectId/config-sets` | Create a config set. Body: `{ name, description?, derivedFromId? }`. Returns `201 { item }`. Duplicate `name` in the same project is `409`. |
| `POST` | `/api/v1/projects/:projectId/config-sets/:configSetId/files` | Add a parameter file as a config-set member. Body: `{ fileId, role, sortOrder? }` (`role` is `base`\|`overlay`\|`charging`\|`thermal`\|`misc`). Returns `201 { item }`. A file already owned by another config set is `409`. |
| `DELETE` | `/api/v1/projects/:projectId/config-sets/:configSetId/files/:fileId` | Remove a file from the config set. Returns `200 {}`. |
| `GET` | `/api/v1/projects/:projectId/config-sets/:configSetId/baselines` | List baselines for a config set. |
| `GET` | `/api/v1/projects/:projectId/config-sets/:configSetId/release-readiness` | Server-owned release readiness for the Config set. Optional query `acknowledgedWarningIds` (comma-separated). Returns `200 { item }` with `available`, `level` (`blocked`\|`warning`\|`ready`\|`in-sync`), ordered `blockers`/`warnings` (each with stable targets, remediation, optional acknowledgement), `gateToken`, `releasedBaselineId`, and authoritative `canCreateBaseline`/`canRelease`. `in-sync` requires working members to match the current released tip (version id or identical storage key). Admin-only; never reconstruct permission from client counts. |
| `POST` | `/api/v1/projects/:projectId/config-sets/:configSetId/baselines` | Snapshot the config set's current member versions into a new `draft` baseline. Body: `{ name, notes?, gateToken, acknowledgedWarningIds? }`. Returns `201 { item }`. Missing/stale `gateToken`, blocked readiness, a member with no current version, or a duplicate baseline name is `409`. Does not upload or mutate source files. |
| `GET` | `/api/v1/projects/:projectId/baselines/:baselineId` | Read one baseline with pinned members. Returns `200 { item, members }`. |
| `GET` | `/api/v1/projects/:projectId/baselines/:baselineId/compare` | Compare the baseline's pinned versions against Working (`against=working`, default) or the current released tip (`against=released`). Returns `200 { item: { baselineId, against, againstBaselineId?, members } }`; each member reports `unchanged`\|`version_changed`\|`file_added`\|`file_removed`, and `version_changed` DTS members include a `structuralDiff`. Missing released tip for `against=released` → `409`. |
| `GET` | `/api/v1/projects/:projectId/baselines/:baselineId/restore-preview` | Preview restore blast radius without applying. Returns `200 { item }` with per-member `from`/`to` versions, `action` (`noop`\|`rollback-pointer`), `driftedCount`, and `releasedBaselineUnchanged: true`. |
| `POST` | `/api/v1/projects/:projectId/baselines/:baselineId/rollback` | Atomically restore drifted members only (new `origin=rollback` pointer versions); never deletes history; leaves the current released tip unchanged. Returns `200 { item: { baselineId, restored } }`. |
| `POST` | `/api/v1/projects/:projectId/baselines/:baselineId/release` | Re-evaluate release readiness (require matching `gateToken`), run the validation gate, demote any previous `released` tip in the config set to `historical`, then mark the target baseline `released`. Body: `{ gateToken, acknowledgedWarningIds? }`. Returns `200 { item: baseline, gate }`. Stale/blocked readiness or validation failure → `409`. |
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

**ParameterSpec identity (ADR-0013 / ADR-0014 / ADR-0017):** Stable catalog identity is owner scope + `attributionSubjectId` (driver registration or node-type definition) + `property_key`. `parameter_specs.id` is a **surrogate**; find-or-create resolves by those columns and mints a hash id only for a row about to be inserted. `specification_key` is **derived** from the triple and is rewritten in the same transaction as an identity correction (ID-R4); do not treat it as an independently authored field. List/detail DTO `lifecycle` reflects definition-level `definition_lifecycle` (`draft` \| `active` \| `deprecated`). Versioned content lives in `parameter_spec_versions` (`version_status`: `draft` \| `active` \| `superseded`); `currentVersionId` / `currentVersion` point at the active content row when present. Org definitions override platform for the same subject + key.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v2/parameter-specs` | List parameter specs by stable subject + property identity. Each item includes `attributionSubjectId`, `lifecycle` (definition layer), `currentVersionId` / `currentVersion`, `propertyKey`, display-only `driverModule` (from attribution subject display name when present), and `attributionModules: Array<{ id, name, kind }>` — distinct attribution units (driver groups and node-type units) observed via bindings, server-computed. Empty `attributionModules` means not yet observed. Filters: `?q=&sourceKind=&lifecycle=&attributionSubjectId=&propertyKey=`. The spec layer does not re-run compatible or node-type matching (ADR-0010). |
| `POST` | `/api/v2/parameter-specs` | Admin create org-owned **draft** definition for `attributionSubjectId` + `propertyKey` (driver-registration or node-type-definition subject only). Body requires `reason`; optional `displayName`, `description`, `documentation`, `valueShape`, `constraints`, `units`, `exampleValue`. Rejects structural property keys (ADR-0003) → `400`. Duplicate subject+key in org → `409`. Org override of platform twin requires `overridePlatform: true` → `409` with `confirmRequired` when omitted. Returns `{ item }` (`201`). Audit: `spec-draft-created`. |
| `GET` | `/api/v2/parameter-specs/:specId` | Spec detail: definition `lifecycle`, version pointers, `attributionSubjectId`, example/default/policy metadata (`exampleValue` illustrative only). When an open cutover run exists, includes optional `cutover` summary (`status`, version pointers, impact counts). |
| `PATCH` | `/api/v2/parameter-specs/:specId` | Admin in-place **documentation-class** update on **active** / **deprecated** (or platform-global) definitions — not for drafts (`409`; use activate). Body: `documentation`, `reason`, optional `displayName`, `description`, `exampleValue`, and optional restated `valueShape` / `constraints` / `units`. Changing `valueShape`, `constraints`, or `units` → `409` with `details.code = semantic-edit-requires-successor` (ADR-0032); equality is `stableJson` against the stored version and omitted keys are not changes. Use `POST .../activate` to mint a successor + cutover. Documentation writes update the current `parameter_spec_version` row. Does **not** accept `policyTarget` (product-scoped; see TD-055). Audit: `spec-updated`. |
| `GET` | `/api/v2/parameter-spec-review-tasks` | Org-scoped, paginated, status-filtered spec review queue (`?status=&limit=&cursor=`). |
| `POST` | `/api/v2/parameter-specs/:specId/activate` | Admin activates a **draft** **org-owned** spec, or records a semantic successor when called on **active** with changed content (ADR-0014). Body requires full `valueShape`, `constraints`, `documentation`, `reason`; optional `displayName`, `description`, `units`, `exampleValue`, `coverageClaim` (required for subject-bound drafts without an existing claim). `constraints` **replaces** the stored object (omitted keys are removed). **`coverageClaim.kind` must be `overlay-property` only** (`pinned-schema-property` is **not supported**; coverage remains overlay-only). Platform-global drafts (`organization_id IS NULL`) → `403`. Cross-org → `404`. Incomplete/conflicting shapes → `400`/`409`. Deprecated specs → `409`. **Staged cutover:** content change on an active definition inserts a draft successor version and a `parameter_spec_version_cutover_run`. When no bindings reference the current version tip, cutover **auto-finalizes** (supersedes old version, activates successor). When tip bindings exist, the run stays `preparing` with pending cutover items until prepare/finalize. Audit: `spec-activated` (and cutover finalize audit when auto-finalized). |
| `GET` | `/api/v2/parameter-specs/:specId/cutover` | Open cutover impact for the spec (`{ item: cutoverSummary }`). No open run → `404`. View authz. |
| `POST` | `/api/v2/parameter-specs/:specId/cutover/prepare` | Admin marks pending cutover binding items `ready` (reuses base revision id; no second revision row). Optional body `{ reason? }`. Run → `ready` when all items ready. Audit: `spec-version-cutover-prepared`. |
| `POST` | `/api/v2/parameter-specs/:specId/cutover/finalize` | Admin finalizes after prepare: updates binding revision `parameter_spec_version_id`, supersedes old version, activates successor. Body `{ reason }`. Pending/incompatible items → `409`. Audit: `spec-version-cutover-finalized`. |
| `POST` | `/api/v2/parameter-specs/:specId/deprecate` | Admin soft-deprecate at the **definition** layer (`definition_lifecycle → deprecated`; current version stays readable for parse/release). Org-owned: org Admin; platform-global → `403` for organization Admin; **`platform-admin` may deprecate platform-global definitions** (ADR-0011 amended). Body `{ reason }`. `409` when lifecycle is not `draft` or `active`. Audit: `spec-deprecated`. |
| `POST` | `/api/v2/parameter-specs/:specId/restore` | Admin restore a deprecated definition: org-owned by org Admin, or platform-global by **`platform-admin`**. Restore lands on `active` when `activated_at` is set, otherwise `draft`. Body `{ reason }`. `409` unless currently `deprecated`. Audit: `spec-restored`. |
| `POST` | `/api/v2/parameter-specs/:specId/reattribute` | Admin identity correction: rewrite `attribution_subject_id` in **any** lifecycle, including active with references (ADR-0017, D-ID-2). Body `{ attributionSubjectId, reason }`. Rewrites derived `specification_key` and `schema_namespace` in the same transaction (ID-R4). Org-owned: org Admin; platform-global → `403` for organization Admin; **`platform-admin` may reattribute platform-global definitions** (same ownership split as deprecate/restore, ID-R5). Triple already taken (including a **deprecated** blocker hidden from the default library) → `409` with `details: { parameterSpecId, lifecycle }`. Audit: `spec-reattributed`. |
| `POST` | `/api/v2/parameter-specs/:specId/rename-property-key` | Admin identity correction: rewrite `property_key` **only while `referenceCount = 0`** (D-ID-2). Body `{ propertyKey, reason }`. Same derived-column rewrite as reattribute. Same org Admin vs `platform-admin` ownership split (ID-R5). Referenced definitions → `409` with `details: { parameterSpecId, referenceCount }`. Triple collision → `409` with `details: { parameterSpecId, lifecycle }` (including deprecated). Audit: `spec-property-key-changed`. Referenced rename is **not** this route and is **not** an inline editor field (ADR-0034 / TD-117). |
| `POST` | `/api/v2/parameter-specs/:specId/property-key-cutover/preview` | Admin **read-only** precheck for a referenced `property_key` source cutover (ADR-0034 / TD-117). Body `{ propertyKey }`. Returns `{ item }` with `fromKey`, `toKey`, `referenceCount`, `writesCatalog: false`, `writesSource: false`, `inlineRenameEligible`, `startBlockers` (`triple-collision`, `open-version-cutover`, `open-property-key-cutover`), and `locations` (binding tip + optional occurrence, `status`: `would-rewrite` \| `already-new-key` \| `missing-from-source` \| `no-occurrence` \| `conflict`). Does **not** start a run, write drafts/CRs, rewrite source, or change the catalog triple. Same org Admin vs `platform-admin` ownership split as rename. Structural or same-key body → `400`. Distinct from version cutover `POST .../cutover/prepare`. |
| `POST` | `/api/v2/parameter-specs/:specId/property-key-cutover/start` | Admin starts a property-key cutover on a spec with `referenceCount > 0`. Body `{ propertyKey, reason }`. Persists `from_key` / `to_key` and one item per preview location (`pending` / `skipped` / `incompatible`) using existing binding and occurrence identities. `writesCatalog` and `writesSource` stay `false`. Zero refs → `409` (use `rename-property-key`). Triple collision, open version cutover, or an already-open property-key cutover → `409` `{ startBlockers }`. Audit: `spec-property-key-cutover-started`. |
| `GET` | `/api/v2/parameter-specs/:specId/property-key-cutover` | Admin reads the **open** property-key cutover run (`{ item }`). Items include `configSetId` / `fileId` / `fileName` / `nodePath` for the existing configuration-workbench candidate URL (`configSet` + `sourceMode=candidate` + `candidate` + `inspector=file`). `stagedRewrite.status` is the **live** file-candidate status (`ready`, `active`, `abandoned`, `missing`, …), not a stale prepare snapshot. Does not activate candidates or write live source. No open run → `404`. |
| `POST` | `/api/v2/parameter-specs/:specId/property-key-cutover/prepare` | Admin stages source rewrites for `would-rewrite` items through the existing **parameter-file candidate** seam (old key → new key, same raw value). Body `{ reason? }`. Creates mergeable drafts only; **does not activate** live source and **does not** rewrite the catalog triple (`writesSource: false`, `stagedSource: true` when a candidate exists). Items become `ready` with `fileId` and `stagedRewrite: { kind: "file-candidate", id, status }`. Honest skip when the source already has the new key (or the binding is gone); conflict / missing / no-occurrence stay `incompatible`. Triple collision or open version cutover → `409` `{ startBlockers }` and no candidate is created. Audit: `spec-property-key-cutover-prepared`. |
| `POST` | `/api/v2/parameter-specs/:specId/property-key-cutover/finalize` | Admin finalizes after every live location is `already-new-key` or an honest skip. Body `{ reason }`. Fail-closed: triple collision or open version cutover → `409` `{ startBlockers }`; any pending / incompatible item (old key still in source) → `409` `{ blockingItems }`. One transaction rewrites `property_key` + derived `specification_key` / `schema_namespace` (same as zero-ref rename). No standing alias. Audit: `spec-property-key-cutover-finalized`. Inline `rename-property-key` stays `409` while `referenceCount > 0`. |
| `POST` | `/api/v2/parameter-spec-review-tasks/:taskId/resolve` | Admin resolve/dismiss a spec review task (`parameterSpecId` must be org-owned or global, **or** `createSpec: true` for unmatched tasks). Server validates tenant ownership of project/revision/occurrence/logical-node evidence via scoped join before applying decisions — raw evidence IDs alone are not trusted. `createSpec: true` creates an org-owned **draft** spec (typed shape from occurrence AST) and returns `draftCreated` with a message to activate before resolve. Only **active**+complete specs may resolve/release. Resolve applies occurrence→spec→binding + reusable matcher override (scoped by compatible + **node locator fingerprint** + property key) in one transaction. Library resolve with a different property key requires explicit `confirmPropertyMismatch: true` or the server rejects with a mismatch error. Dismiss is fail-closed: no binding is created and release/validate still blocks dismissed properties. Audit: `parameter-topology-governance` / `spec-review-resolved`. |
| `GET` | `/api/v2/projects/:projectId/config-sets/:configSetId/revisions` | List non-`resolving` config revisions for the config set, newest first (`{ items: ConfigRevisionSummary[] }`). Requires `parameter:view`. Missing project/config set or a config set that belongs to another project → `404`. This is the real revision source for the configuration workbench gate; clients must not invent a teaching id. |
| `GET` | `/api/v2/projects/:projectId/config-sets/:configSetId/revisions/:revisionId/topology` | Source or effective tree (`?view=source\|effective`). Each node may include derived `enablement` (`selfEnabled`, `override`, `reachable`, blocking ancestor labels) — not a parameter binding. Unknown revision ids → `404` (aliases `current`/`latest`/`head` resolve to the listed head). |
| `GET` | `/api/v2/projects/:projectId/parameter-bindings` | Stable project bindings (spec + logical node + effective value). |
| `GET` | `/api/v2/identity-mapping-tasks` | List identity mapping tasks (`?projectId=&status=` where `status` is `open` \| `resolved` \| `dismissed` \| `new_identity`). Items include `taskKind` (`identity-ambiguity` \| `singleton-cardinality`), candidates, and evidence. |
| `POST` | `/api/v2/identity-mapping-tasks/:taskId/resolve` | Admin resolve/dismiss/declare new identity. Body `{ decision: resolved \| dismissed \| new-identity, reason, selectedLogicalNodeId?, confirmAllCandidates? }`. `resolved` requires `selectedLogicalNodeId` in candidates. Repeating the same selected id on an already `resolved` ambiguity is idempotent; selecting a different candidate performs protected re-resolve only when stored prior-selection/previous-node continuity exists, the candidate belongs to the same organization/project/revision, and affected nodes have no downstream drafts, submission items, or device operations. Otherwise `409` `identity-mapping-migration-required`; there is no inverse undo or reopen. `new-identity` with multiple candidates requires `confirmAllCandidates: true`. `singleton-cardinality` tasks reject identity decisions (`409` `singleton-cardinality-conflict`) — fix registration/topology instead. `dismissed` and open `singleton-cardinality` remain **release blockers**; `resolved` and `new_identity` clear blocking. Audit: `identity-mapping-resolved` / `identity-mapping-dismissed` / `identity-mapping-new-identity` (re-resolve metadata includes prior/next ids and `reResolved: true`). |
| `POST` | `/api/v2/identity-mapping-tasks/:taskId/reopen` | Admin reopen a `dismissed` or `new_identity` `identity-ambiguity` task (`{ reason }`). Re-asserts revision `needs_mapping`. Applied `resolved` mappings use protected re-resolve, not reopen (`409`). Audit: `identity-mapping-reopened`. |
| `POST` | `/api/v2/projects/:projectId/config-revisions/:revisionId/validate` | Fail-closed toolchain validate for publish readiness. Failed re-validation **revokes** a previously `validated` revision (does not leave a stale validated marker). Open identity-mapping, **dismissed** identity-mapping, **singleton-cardinality** mapping blockers, or dismissed-but-unmatched spec-review blockers fail closed. Config revisions are never `published` — releasing is the release baseline (ADR-0012). Soft/warn passes (hard dtc pass with remaining toolchain diagnostics, or warn-mode) may set `requiresConfirmation: true`; the configuration workbench release ConfirmDialog must acknowledge that flag. |
| `POST` | `/api/v2/projects/:projectId/parameter-bindings/:bindingId/drafts` | Typed binding draft with `action: set|delete` and **exact-occurrence** Config Set writeback: locks binding revision, occurrence, file version, checksum, and CST span (schema enforced; **base** binding revision immutable; set values land on the **candidate** revision). Delete returns `rawText: ""`, persists a candidate tombstone effect, and deliberately creates no replacement candidate binding revision. Stale revision/occurrence identity → `409`. Post-cutover semantic merge fail-closes without `objectStore`, project scope, write lock, or real DTC toolchain — no `WISEEFF_WRITEBACK_SKIP_TOOLCHAIN` production path. Post-cutover drafts must not create shadow `project_parameter_values` / `parameter_definitions` rows. |
| `POST` | `/api/v2/projects/:projectId/node-enablement-drafts` | Node enablement draft on the shared working-tip pipeline. Body: `{ logicalNodeId, baseRevisionId, target: force-enabled\|force-disabled\|unstated, reason, acknowledgeNonstandard?, spellingOverride? }`. Writes or deletes DTS `status` on the locked overlay file; shares candidate revision coordination with binding drafts (mixed tips → `409 mixed-working-tips`). Requires `parameter:edit`; `dts_sensitive_node_rules` apply. Audit: `parameter-topology-governance` / `enablement-changed`. |
| `GET` | `/api/v2/projects/:projectId/bindings/:bindingId/history` | Phase-2 binding revision history. Returns `{ items: [{ id, changedAt, fromRawValue?, toRawValue? }] }` ordered newest→oldest, derived from `project_parameter_binding_revisions` only (adjacent revision raw values mapped into from→to). Never reads the legacy flat `parameter_history_entries`. Actor/reason are not exposed because `project_parameter_binding_revisions` carries no per-revision actor or reason column. |
| `GET` | `/api/v2/projects/:projectId/bindings/:bindingId/compare` | Phase-2 cross-project compare. Returns `{ items: [{ projectId, projectName, rawValue, moduleName?, driverModule? }] }` for other projects in the same organization that share the binding's `parameter_spec_id` + `module_id`; the source project is excluded. |
| `GET` | `/api/v2/parameter-modules` | Org module registry: `{ item: { modules, mappings } }`. Module DTO fields include `kind`, `origin`, `sourceKey`, `attributionSubjectId` (driver-group / node-type catalog subject), `effectiveImportance`, `definitionCount` (distinct specs in the subtree), `parameterCount` (subtree bindings / measured occurrences), plus `name`, `parentId`, `sortOrder`, `importance`. These two counts are different facts; do not collapse them. Library `referenceCount` is the same binding fact scoped to one definition. Module CRUD stays on v1. |
| `GET` | `/api/v2/parameter-modules/discovery-hints` | Observed unmapped `compatible` values from bindings (`{ item: { compatibles: [{ compatible, bindingCount, projectCount, suggestedGroupName }], total } }`), excluding dismissed and scaffolding labels. |
| `POST` | `/api/v2/parameter-modules/discovery-hints/dismissals` | Admin dismiss a compatible from the queue (`{ compatible, reason? }`); returns refreshed hints. Audit: `parameter-module-compatible-dismissed`. |
| `DELETE` | `/api/v2/parameter-modules/discovery-hints/dismissals/:compatible` | Admin restore a dismissed compatible. Audit: `parameter-module-compatible-restored`. |
| `POST` | `/api/v2/parameter-modules/mappings/preview` | Admin dry-run create mapping (`{ moduleId, matchKind, matchValue, priority? }`); `matchKind` is `compatible` \| `node-type` only. Returns `{ item: MappingApplyPreview }` without persisting. |
| `POST` | `/api/v2/parameter-modules/mappings` | Admin create mapping with **scoped apply** for bindings matching the new rule. Returns `{ item: registry, apply: MappingApplyPreview }` (`201`). Audit: `parameter-module-mapping-created`. |
| `DELETE` | `/api/v2/parameter-modules/mappings/:mappingId` | Admin delete mapping with scoped re-park for affected bindings. Returns `{ item: registry, apply: MappingApplyPreview }`. Audit: `parameter-module-mapping-deleted`. |
| `POST` | `/api/v2/parameter-modules/recompute-bindings` | Admin full-org or per-project recompute (optional `{ projectId, dryRun }`). `dryRun: true` returns `{ updated, conflicts, dryRun: true, preview }` without writes. Apply path returns `{ updated, conflicts, preview? }`; unique-key conflicts → `409`. Ops/backfill for historical drift or seed repair — daily classify and driver register/claim use scoped mapping apply, not full recompute. Audit: `parameter-module-bindings-recomputed`. |
| `GET` | `/api/v2/parameter-modules/driver-registry` | Org driver-registry view: `{ items: DriverRegistryEntry[], total }`. Each entry is a driver-group module with exact compatibles, `origin`, current-tree business category, authoritative `defaultBusinessCategoryId` (registration default; may differ from current parent), parameter/observed coverage, editable-via-PATCH `driverNature` / `instanceCardinality` (when linked to `driver_registrations`; GET itself is read-only), and per-compatible parse coverage (pinned schema pattern **or** active org overlay; `source`/`driverId` identify which). Scaffolding labels excluded. |
| `POST` | `/api/v2/parameter-modules/driver-registry` | Admin register or claim a driver (`{ displayName, businessCategoryId, compatibles[], notes? }`). Creates a curated driver-group + exact compatible mappings, or claims an existing mapped group (move + rename + promote). Persists `businessCategoryId` as the registration `defaultBusinessCategoryId`. Same transaction: scoped binding recompute per compatible (same semantics as mapping create). Returns `{ mode: 'registered'\|'claimed', item, apply }` (`201`). Unique-key conflicts → `409`. Audit: `parameter-module-driver-registered` (metadata includes `affectedBindings`). |
| `PATCH` | `/api/v2/parameter-modules/driver-registry/:moduleId` | Admin updates driver registration attributes (`{ driverNature?, instanceCardinality? }`; at least one required). Org Admin may edit **org** subjects only; **platform-admin** may edit platform **and** org subjects. Same transaction: registration update + audit (`parameter-module-driver-registration-updated`, org id = subject org so platform-admin edits appear in org history) + re-sync singleton-cardinality blocking tasks on tip revisions (publish gate only; no topology rewrite). Returns `{ moduleId, driverNature, instanceCardinality, attributionSubjectId }`. |
| `PATCH` | `/api/v2/parameter-modules/driver-registry/:moduleId/default-business-category` | Admin update registration default business category (`{ defaultBusinessCategoryId }`). Same-txn audit + replay of that subject’s **auto** driver-group under the new default (curated frozen). Returns `{ item, defaultBusinessCategoryId, replay: { moved, skippedCurated, skippedMissingDefault } }`. Audit: `parameter-module-driver-default-business-category-updated`. Dedicated path so it does not collide with nature/cardinality updates on `PATCH .../driver-registry/:moduleId`. |
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
