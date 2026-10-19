# WiseEff API Contract Design

> Chinese: [Chinese](../zh-CN/design-docs/api-contract.md)

Date: 2026-05-25

## Principles

WiseEff uses REST + JSON under `/api/v1` and the documented `/api/v2` endpoint families. The frontend talks to the backend through application ports and HTTP DTO mapping rather than page-owned fetch logic.

Rules:

- All writes require authentication, authorization, validation, audit, and idempotency where practical.
- List endpoints support pagination, sorting, and filtering.
- Errors use a structured envelope with request IDs.
- Long-running work exposes job status or event streams.
- OpenAPI contract freshness is checked in CI.

## Endpoint Groups

- Auth and users: `/me`, home organization `GET`/`PATCH /api/v1/organization`, user listing, user creation, permanent non-self deletion (`DELETE /api/v1/users/:userId`), activation, role replacement. Deletion returns `204`, removes account-owned rows, and leaves durable history with nullable user references.
- Projects and modules: project metadata and module lookup.
- Parameters: parameter listing, detail, history, drafts, submission rounds, change requests, imports, dashboard aggregation (`/parameters/dashboard/summary`, `/parameters/dashboard/hotspots`), org module tree CRUD (`/parameter-modules`), **project parameter initialization** (`/parameters/projects/:projectId/initialization*`, `/parameters/admin/initialization-reviews*`), per-project parameter file hosting with sync, conflict resolution, and staged candidates (`/projects/:projectId/parameter-files*`, `/projects/:projectId/parameter-file-candidates*`), structured DTS read/search (`.../structure`, `/projects/:projectId/dts-search`), and per-project DTS config sets, release baselines, validation gate, and lossless export (`/projects/:projectId/config-sets*`, `/projects/:projectId/baselines/:baselineId/*`).
- Semantic parameter topology (v2): parameter specs, spec review tasks, source/effective topology, project bindings, identity mapping tasks, and fail-closed config-revision validate under `/api/v2/*` (see below). Legacy flat parameter IDs are retired at cutover with `410 legacy-parameter-id-retired`.
- Canonical parameter catalog (v2): `/api/v2/catalog/*` plus organization registration/review routes. S8-CON freezes the OpenAPI, DTO, route, error, and typed client contract for PCAT-API-01 through PCAT-API-12. At source baseline `67d4a77325b6009b77c2373bd788298a6d022bcf`, `server/app.ts` registers the read, governance and legacy handlers through `server/modules/parameter-catalog-api/productionWire.ts`. Runtime readiness still depends on the installed release and required database/internal capabilities. See [parameter-catalog-api-transition.md](parameter-catalog-api-transition.md).
- Logs: upload/file records (plain files and multi-file `.tar` / `.tar.gz` / `.tgz` / `.zip` / `.gz` bundles validated at intake), analysis records, runs, rerun, archive, feedback, feedback-quality insights (`/logs/feedback-insights`), and org-scoped log-domain governance (`/log-domains`).
- Product feedback: Internal Beta sidebar feedback submission, admin triage, and attachment content.
- Knowledge: organization-scoped knowledge entries, revisions, published-only search, and file content under `/api/v1/knowledge/*`.
- Jobs: status and progress events.
- Debugging: devices, target detection, sessions, node reads/writes, snapshots, rollback.
- Agent: Xiaoze AG-UI run, proactive suggest, and thread persistence under `/api/v1/agent/xiaoze`.
- Audit: audit event listing and detail. Listing supports server-side filters (`projectId`, `app`/`apps`, `kind`, `severity`, `actorUserId`, `targetType`, `targetId`, `traceId`, cursor paging) plus `q` (case-insensitive search over action, kind, target id, and actor name) and `from`/`to` timestamps.
- Operations: liveness, readiness, metrics, pilot/release readiness.

`POST /api/v1/agent/xiaoze/suggest` validates `{ context?: { projectId?, projectName?, pageKey?, path? } }` and returns `{ suggestions: [{ id, tone, headline, meta?, citations }] }`; malformed input is `400 VALIDATION_FAILED`, while a drifting successful response fails closed in the frontend. Xiaoze's five WiseEff CUSTOM frame families have concrete Zod payload/envelope schemas tested against the existing `xiaozeTurnStream` reducer output. This does not wrap or replace `@ag-ui/client`, and the generic AG-UI SSE run response remains outside JSON-response OpenAPI modeling.

## Log and Debugging Scope

M2 log upload/list and M3 debugging runtime/catalog APIs are scoped by authenticated `organization_id`. A new log association requires `relatedParameterPin: { kind: "canonical-pin", projectId, bindingId, definitionId?, definitionRevisionId? }`; the server authorizes that exact project Binding and freezes its canonical Value, DefinitionRevision, and source pin for each analysis run. Rerun resolves the current Binding again; prior run snapshots and reports remain historical. `relatedParameterId` alone is not accepted for new uploads, and legacy stored links without a verified project scope cannot be treated as current. Unassociated log uploads and debugging APIs do not accept a top-level `projectId` field.

## Generic signals

`GET /api/v1/logs/:logId` adds optional `signalSummary` for the current analysis run. Older records may omit it. Its shape is `{ signals, templates, truncatedSignals, truncatedTemplates }`. Each signal has `kind`, `severity: "Critical" | "Warning" | "Info"`, `source: "generic" | "skill"`, `title`, `count`, and bounded `anchors: [{ file, line, content }]`; line numbers are one-based within that file. Crash signals additionally expose optional `signature` (for example, `Oops` or `Kernel panic`), with separate counts and anchors per file/signature while keeping `kind: "crash"`. Each template has `template`, `count`, `first` and `last` anchors with the same shape. Truncation flags distinguish a capped summary from a complete inventory. Signals are analysis aids, not independently verified root causes.

The summary additionally accepts optional `truncated: boolean` and `reason: "time_cap" | "line_cap" | "extraction_error"`. These describe incomplete extraction separately from count caps: a timeout retains completed results, long lines are scanned only through a bounded prefix, and an extraction failure returns an empty summary while analysis continues. Existing report JSON persists these fields and the Signals tab explains the reason.

The platform extracts crash signatures, timestamp gaps, restarts, error bursts and each file's first error even when the upload has no skill. Line templates normalize numbers, hexadecimal values, identifiers and paths and retain occurrence counts and first/last locations. Skill signals come from the run's pinned revision. Rule fallback uses both sources and preserves `analysisSource`, `degradedReason` and existing confidence caps.

The read-only agent always has `get_signals` (optional `kind`, `severity`, `offset`, `limit`), `get_line_templates` (`offset`, `limit`), and `get_timeline` (an ISO `time` or a `file` + `line` anchor, with `before`/`after`). Pagination uses nonnegative offsets and limits from 1 to 20. Timeline context is capped at 20 lines on either side and ordered by timestamp across files. Only returned anchors and lines count as seen evidence; an existing line outside a returned page or window is still unseen. These are internal worker tools, not additional HTTP endpoints.

## Analysis Skills, Revisions and Analyzer Provenance

Analysis skills retain their `log_domains` identities and ids. Reads require `logs:view`; writes require `logs:admin-domains`. New-resource writes commit `log-skill-create`, `log-skill-draft-save`, `log-skill-publish`, `log-skill-draft-discard` or `log-skill-restore` audit events in the same transaction. All lookups are organization-scoped; foreign identities/revisions return `404`.

Each identity exposes an organization-unique `skillKey` matching `^[a-z0-9][a-z0-9-]{1,62}$`, generated from the creation name with a short id suffix for non-ASCII names or collisions. Migration 0200 backfills existing skills. Renaming or publishing preserves the key. `PATCH /api/v1/log-domains/:domainId` accepts `skillKey` for administrators; changes are audited, invalid keys and duplicates produce field errors. Both `POST /api/v1/log-files` (JSON/multipart) and `POST /api/v1/logs` accept `skillKey` alongside `skillId` and its `logDomainId` alias. Selectors resolve within the caller's organization and must agree when combined; conflicts return `400 VALIDATION_FAILED`, unknown/foreign keys are rejected. Uploads pin the current published revision.

The workspace's Integration section owns key editing, upload examples, result webhook configuration/test/history, model override and budgets. Overview links to it; old administration provides a workspace link instead of duplicate editors. Optional positive-integer `spec.stepBudget` and `spec.tokenBudget` publish with the revision, like `modelOverride`. Missing values use global defaults. Server writes reject values above the configured `LOG_ANALYSIS_MAX_STEPS` / `LOG_ANALYSIS_TOKEN_BUDGET` with `VALIDATION_FAILED` field errors; skill details expose `budgetCaps`. Runtime also respects lowered platform caps for older revisions. Webhook configuration and the key remain live identity settings.

Save and publish also enforce `stepBudget >= 1` and `tokenBudget >= min(4096, LOG_ANALYSIS_TOKEN_BUDGET)`, returning path-specific validation issues. Token budgets bound cumulative provider-reported usage, checked before every model call, including convergence, without token estimation. A single completion may exceed the remaining budget; no subsequent call is made once reported usage reaches the budget. Without a grounded final report, exhaustion produces `rules-fallback` with `degradedReason: "token-budget-exhausted"`.

Result webhooks add `skill: { id, key, revisionId, revisionNumber }` and `degraded: boolean` without removing the legacy `logDomainId`, `skillRevisionId`, `skillRevisionNumber` or other fields. Revision fields are nullable for unpinned legacy runs. Rule fallback or an available degradation reason sets `degraded`; `degradedReason` remains present when available. Terminal enqueue snapshots the key and pinned revision; retries keep that payload. The synchronous test event keeps its existing shape. See the [integration guide](../api/log-analysis-integration.md#4-or-consume-the-result-webhook).

| Method | Path | Shape |
| --- | --- | --- |
| `GET` | `/api/v1/log-skills` | `{ items }`: identity, `currentRevision: { id, number, publishedAt }`, `hasDraft`, `analyses7d` (runs created in seven days), `helpfulRate7d` (0..1, null without feedback; same attribution semantics as feedback insights). `includeArchived=true` includes archived skills. |
| `GET` | `/api/v1/log-skills/:skillId` | `{ item }`: identity, full `currentRevision`, nullable `draft`. |
| `GET` | `/api/v1/log-skill-templates` | Requires `logs:admin-domains`. `{ items: [{ id, label, description, spec }] }` provides `generic-text`, `linux-dmesg`, `android-logcat`, and `json-lines`. Each validated spec includes a procedure outline, a base format and signal rules. JSON Lines uses a generic profile and JSON level-token signals. |
| `POST` | `/api/v1/log-skills` | `{ name, description?, startingPoint?: { templateId } \| { copyFromSkillId }, formatProfile? }` creates identity + published revision 1; `201 { item }`. Copy uses the source draft when present, otherwise its current publication, and never copies its sample. A foreign source returns `404`. Without a starting point, the generic template is used unless a legacy format profile is supplied. Explicit description overrides the starting spec description. Audit metadata records `templateId` or `copyFromSkillId`. |
| `PUT` | `/api/v1/log-skills/:skillId/sample` | Requires `logs:admin-domains`. `{ fileName, contentBase64 }` replaces the skill's single, non-revisioned text sample, at most 2 MiB of decoded upload bytes. Uses bundle intake encoding detection (UTF-8 or BOM-marked UTF-16); binary and archive input returns `400` with a localized reason. Returns `{ item: metadata }`. Commits `log-skill-sample-replace` in the same transaction. Objects use unique sample names; replaced objects are retained. |
| `GET` | `/api/v1/log-skills/:skillId/sample` | Requires `logs:view`. `{ item: metadata & { content, truncated } \| null }`; no sample is null, an inaccessible skill is `404`. Content is normalized to LF and capped at the first 5000 lines; `lineCount` retains the total. Metadata: `id`, `skillId`, `fileName`, original `sizeBytes`, `sha256`, `encoding`, `lineCount`, nullable `uploadedByUserId`, `createdAt`, `updatedAt`. Storage keys are never exposed. |
| `DELETE` | `/api/v1/log-skills/:skillId/sample` | Requires `logs:admin-domains`. Organization-scoped, idempotent `204`, with `log-skill-sample-delete` in the same transaction. Retains objects and skill revisions. |
| `PUT` | `/api/v1/log-skills/:skillId/draft` | `{ spec: { schemaVersion: "skill/v1", description?, formatProfile?, modelOverride?, signalRules?, parsing?, procedure?, knowledgeEntryIds? }, baseDraftRevisionId: string \| null, basePublishedRevisionId: string }` replaces the draft, returning `{ item: revision }` with a fresh draft id. Both base fields are required: the editor's starting draft id (null when no draft existed) and published revision id. A mismatch against either current revision under the skill lock returns `409 LOG_SKILL_DRAFT_CONFLICT`. `description` is optional, trimmed, at most 2000 characters, without a schema-version bump. Publish and restore retain the identity description when the field is absent; an explicit empty string clears it. Absent signal rules use the platform charging defaults. |
| `POST` | `/api/v1/log-skills/:skillId/parse-preview` | Requires `logs:admin-domains` and an organization-scoped skill. Body `{ parsing, sampleText, fileName? }` validates unsaved `parsing/v1`. Returns `{ valid, issues: [{path, message}], events, counts: {total, byExtractor, errors}, unmatchedLineCount, truncated, reason? }`. Schema issues return `200`, `valid: false` and paths. Samples above 1 MiB UTF-8 and invalid bodies return `400`. A fixed 100 ms validation/decoding watchdog, 5000 processed lines and 500 returned events produce partial results with `truncated: true` and `reason: time_cap \| line_cap \| event_cap`; counts cover completed work, unprocessed lines remain unmatched. Validation timeout returns `valid: false` with an issue and the same time-cap flag. Foreign/missing skill: `404`; insufficient permission: `403`. Read-only, no audit or sample storage. |
| `DELETE` | `/api/v1/log-skills/:skillId/draft?draftRevisionId=:revisionId` | Required query parameter `draftRevisionId` identifies the draft observed by the editor. Under the skill lock, a different existing draft returns `409 LOG_SKILL_DRAFT_CONFLICT`; a matching or absent draft returns idempotent `204`. Audits `log-skill-draft-discard` on success, including an already-absent draft. |
| `POST` | `/api/v1/log-skills/:skillId/publish` | `{ draftRevisionId }` atomically publishes that draft and supersedes the previous publication; missing/stale draft returns `409 LOG_SKILL_DRAFT_CONFLICT`. Synchronizes identity description, format profile and model override. Returns `{ item: skill }`. |
| `POST` | `/api/v1/log-skills/:skillId/revisions/:revisionId/restore` | Publishes the selected historical spec as a new revision with the next number; never rewrites historical content. Returns `{ item: skill }`. Under the skill lock, an existing draft returns `409 LOG_SKILL_DRAFT_EXISTS`; a missing/foreign/draft source returns `404`. Audits `log-skill-restore` with `{ fromRevisionId, newRevisionId }` in the publication transaction. |
| `GET` | `/api/v1/log-skills/:skillId/revisions` | `{ items: revision[] }`, newest revision number first. |
| `GET` | `/api/v1/log-skills/:skillId/revisions/:revisionId` | `{ item: revision }`; revisions contain `id`, `skillId`, `number`, `status`, `spec`, `contentHash`, creation and publication times/users, plus optional `publishedByDisplayName`. Published/superseded content is immutable. Account deletion clears author/publisher references under the existing history-retention policy; spec, hash and publication facts remain unchanged. |

`skill/v1` also accepts optional `procedure`: trimmed Markdown, at most 20000 characters, without a version bump. The version diff includes it in the overview group; this slice has no procedure editor.

`skill/v1.knowledgeEntryIds?: uuid[]` stores the skill's knowledge-entry links in its draft and immutable published revisions. Links are organization-scoped and validated server-side; foreign entry ids are rejected. The workspace searches the normal `GET /api/v1/knowledge/entries?status=published&q=...` list for existing entries and uses `POST /api/v1/knowledge/entries` with Markdown content for uploads. Upload creates knowledge drafts under `knowledge:edit`, with normal knowledge audit; skill-administration permission alone is insufficient. A newly created draft may be linked, but remains excluded from retrieval until separately published. Removing a link does not delete the entry.

`read_domain_knowledge` uses the pinned skill revision's entry ids, never the live identity link set. Existing published-only retrieval behavior is retained, including organization-wide retrieval when no links are configured. Report/record and run DTOs expose `knowledgeRevisions: [{ entryId, revisionId }]`, the distinct knowledge revisions actually returned during that run. Linked but unretrieved entries are absent. Later edits or new knowledge revisions do not rewrite this recorded provenance; no retrieval and historical unknown provenance return `[]`. Migration `0197` snapshots legacy runs' link scopes before backfilling existing domain links into the current published skill revision; it does not invent sources for historical reports.

Linked-entry metadata follows the knowledge module's `canReadEntry` policy, independently of log administration rights. Skill specifications carry entry ids only. The knowledge picker requires `knowledge:view` and lists published entries only. Legacy link responses replace unreadable titles with a localized restricted-entry label, return empty tags and omit `entryStatus`; unreadable nonpublished ids return `404` on legacy replacement without disclosing status. Report, log-list and run provenance retain `entryId` but omit `revisionId` for unreadable entries. This read-time projection never rewrites stored provenance.

Upload/create/rerun accept `skillId`; `logDomainId` remains an alias. Rerun accepts `revisionPolicy: "current" | "pinned"` (default `current`): `current` pins the current publication; `pinned` reuses the preceding run's revision and cannot change its skill. Uncategorized runs retain a null pin and platform defaults. Records/runs expose `skillRevision: { id, number } | null`; result webhook payloads add nullable `skillRevisionId` and `skillRevisionNumber`. Workers read format profile, model override and signal rules solely from the pinned revision.

All legacy endpoints below remain supported. Domain creation also publishes v1. A PATCH containing `formatProfile` or `modelOverride` immediately publishes a new revision, preserves any separate draft and leaves old run pins unchanged. Name, status and webhook configuration stay on the identity. Knowledge links are revisioned; the legacy replacement endpoint publishes them immediately to retain its existing behavior. Workspace description edits are revisioned; publication synchronizes the identity description, which legacy PATCH can still edit independently.

Log domains are org-scoped registrations of a business's log intake (name, description, optional declarative format profile). Governance requires `logs:admin-domains` and every mutation writes a `log-domain-*` audit event. Format-profile patterns use RE2 syntax on a linear-time engine (no lookaround or backreferences; at most 4,096 characters), and lines longer than 65,536 characters are not matched by them; an unsupported pattern is rejected with `400` and its field path.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/log-domains` | List domains (`logs:view`; `includeArchived=true` adds archived rows). |
| `POST` | `/api/v1/log-domains` | Create a domain (`{ name, description?, formatProfile? }`). Duplicate name in the organization → `409`; invalid format profile → `400` with issues. Returns `201 { item }`. |
| `PATCH` | `/api/v1/log-domains/:domainId` | Update name/description/format profile/status/model override (`formatProfile: null` clears the stored profile; `modelOverride: null` clears back to the global `LOG_ANALYSIS_MODEL`). Supplying description, format profile or model override publishes a revision immediately; under the skill lock, an existing workspace draft instead returns `409 LOG_SKILL_DRAFT_EXISTS` (`Publish or discard the skill draft first.`). Name/status-only edits, archive and webhook updates remain available. |
| `POST` | `/api/v1/log-domains/:domainId/archive` | Archive the domain; existing log records keep their binding. |
| `GET` | `/api/v1/log-domains/:domainId/knowledge-links` | List the current published skill revision's knowledge-entry links with each entry's current status (`logs:admin-domains`). |
| `PUT` | `/api/v1/log-domains/:domainId/knowledge-links` | Replace the link set (`{ knowledgeEntryIds: uuid[] }`) by immediately publishing a new skill revision. An existing workspace draft returns `409 LOG_SKILL_DRAFT_EXISTS`; publish or discard it first. Only **published** knowledge entries in the caller's organization are accepted (`400` for drafts/archived, `404` for unknown/foreign entries); audited as `log-domain-knowledge-links-update`. Existing runs retain their pinned link scopes. |
| `PUT` | `/api/v1/log-domains/:domainId/webhook` | P3b: replace the domain's result-webhook config (`{ url: string\|null, enabled: boolean, secret?: string\|null }`; `secret` omitted keeps the stored one). URL must pass the SSRF policy (https-only, no credentials, no private/loopback/metadata addresses — `400` with `reason` codes `webhook-url-scheme` / `webhook-url-private-address` / `webhook-url-required` / `webhook-secret-required`). Audited as `log-domain-webhook-config`; the secret is never echoed. |
| `GET` | `/api/v1/log-domains/:domainId/webhook-deliveries` | P3b: recent delivery attempts (`limit` 1..50, default 10) — one row per attempt with `kind` (`result`/`test`), `attempt`, `status` (`delivered`/`retrying`/`failed`), `httpStatus?`, `error?`. |
| `POST` | `/api/v1/log-domains/:domainId/webhook-test` | P3b: send a single-attempt test delivery through the same SSRF-guarded signed sender; returns `{ outcome: { status, attempts, httpStatus?, error? } }` and is audited as `log-domain-webhook-test`. |

`POST /api/v1/log-files`, `POST /api/v1/logs`, and `POST /api/v1/logs/:logId/rerun` accept an optional `logDomainId`. The domain must belong to the organization and be `active`, otherwise `400`; omitting it keeps the built-in uncategorized log domain semantics (generic analysis, upload never blocked).

Log domain DTOs carry `modelOverride?` and a webhook summary `{ enabled, url?, secretConfigured, secretLastFour? }` — the signing secret itself is write-only. The outbound result-webhook payload and signature scheme (`X-WiseEff-Signature` = HMAC-SHA256 over `timestamp.rawBody`, `X-WiseEff-Timestamp` replay window) are specified in [`docs/api/log-analysis-integration.md`](../api/log-analysis-integration.md); delivery is best-effort and never blocks the analysis.

Log record DTOs gained additive provenance fields: `logDomainId?`, `logDomainName?`, `analysisSource?: "agent" | "rules-fallback"`, and `degradedReason?: "provider-unavailable" | "token-budget-exhausted"`. A `rules-fallback` source marks a degraded analysis and must stay visible to clients; the rest of the log output contract is unchanged.

### Compressed uploads (P3)

`POST /api/v1/log-files` accepts the existing JSON base64 body and multipart/form-data. Repeated `file` parts (several plain files) become one bundle; alternatively upload one archive, without accompanying files. Formats: `.tar`, `.tar.gz`/`.tgz`, multi-entry `.zip` (stored/deflate), and `.gz`; a gzip inner name ending in `.tar` is treated as tar.gz. One nested archive level is expanded, with the enclosing archive entry name used as a path prefix. Directories are skipped; normalized relative paths are limited to 1024 UTF-8 bytes. Traversal (including backslashes and `..` segments), absolute paths, links, devices, FIFOs, encrypted zip entries, duplicate normalized paths, corrupt archives and limit violations create a failed record with the rule reason in `failureReason`, an `inline/` pseudo storage key and no analysis job or object-store write. The response remains `201`; a `log-upload-failed` audit event records `{ fileName, failureReason }`. Bundle/archive reasons are Chinese; unsupported single plain files retain the existing English format message. Unexpected decoder/archive exceptions use a generic archive-integrity reason without internal error details.

Records expose `files: [{ path, sizeBytes, lineCount, encoding, lossy, status, skipReason }]`; evidence adds nullable `filePath`, with line numbers relative to that file. `encoding` is `utf-8|utf-16le|utf-16be`: UTF-8 with/without BOM and UTF-16 LE/BE BOM are detected; other byte sequences decode lossily as UTF-8 with `lossy: true`. NUL in the first 8 KiB without a UTF-16 BOM, a decoded U+0000 (unsupported by PostgreSQL text), or a control-character ratio above 20% in the text sample marks a skipped binary file. Unsupported extensions are also inventoried with a skip reason. `.log/.txt/.csv/.json` and extensionless text are analyzed. A skipped-only bundle retains inventory and a failed record without a job. Each analyzed file is stored as decoded UTF-8; legacy records without inventory keep their single-object fallback. Result webhooks remain summary-only, without evidence or raw text.

Defaults: 100 MiB total uploaded bytes (`LOG_BUNDLE_MAX_COMPRESSED_BYTES`), 100 MiB total original file bytes (`LOG_BUNDLE_MAX_UNPACKED_BYTES`), 2000 files (`LOG_BUNDLE_MAX_FILES`), and 100 MiB per file (`LOG_BUNDLE_MAX_FILE_BYTES`). The whole archive and each individual inflate are bounded by 200 times compressed bytes, with a 1 MiB floor, as well as the per-file/remaining-total limits. The intermediate tar in tar.gz also fits the remaining-total bound, including headers and padding. Plain single-file uploads retain the default 100 MiB ceiling; configured upload, total and per-file bounds apply together. The server is authoritative; the client only prechecks obvious violations.

### Decoded events and tools

`skill/v1` gains optional `parsing: {schemaVersion: "parsing/v1", extractors}`; save, publish and restore validate it with path-bearing `400` errors. [Parsing reference](log-parsing-v1.md) defines the strict schema, timestamp subset, bounds and event envelope. Workers use the pinned revision. After parsing, each run with extractors records a gzip JSONL artifact key and `{total, byExtractor, errors}` counters in migration 0190's run columns under the current job lease; provider retries retain them. Runs without extractors remain unchanged.

Evidence adds optional `decodedFields: DecodedEvent[]`, persisted as `log_evidence.decoded_fields`. Each event carries `v`, `source`, `extractor`, `file`, `line`, optional `endLine`, `fields` and optional errors. Only events whose exact file/start-line anchor is cited are attached. Converted fields retain raw text and typed values; enums display their labels. Register nodes additionally carry nested `fields`, optional enum `meaning` and `unit`; the original raw register value remains on the parent. Unsafe integers are decimal strings, and tree depth is capped at 8. Reports render this tree below cited lines. Loop, single-shot and rule reports share this behavior; result webhooks remain summary-only.

`parsing` also accepts optional `registers: Record<id, {width: 8|16|32|64, fields: {bits: [hi,lo], name, enum?, scale?, offset?, unit?, signed?, description?}[]}>` and `registerMaps: Record<id, {selectBy, cases: Record<addressOrMessageId, registerId>, default?}>`. Extractor `int`/`uint`/`hex` fields attach `decode: {register: id}` or `decode: {registerMap: id}`. Save/publication and the existing unsaved-draft preview validate overlap, range, duplicate names and references with exact paths. A map without a matching case/default records `unmatched_register` on the event and does not fail the run. Register work shares existing execution budgets. See the [BQ25890 example and value rules](log-parsing-v1.md#registers-and-register-maps).

These internal read-only ADR-0022 tools exist only when the pinned revision has extractors; they are not HTTP endpoints and retain existing loop step/token budgets:

| Tool | Contract |
| --- | --- |
| `describe_event_schema({})` | `{extractors: [{id, fields: Record<name, FieldSpec>, count}], counts}`. Includes configured names/types even with zero events. Metadata does not establish observed lines. |
| `query_events({extractor, file?, where?, limit?, cursor?})` | `{events: DecodedEvent[], nextCursor: string \| null}`. Exact extractor and optional file; default/max limit 50. `where` is an AND list of `{field, op: eq\|ne\|lt\|lte\|gt\|gte\|in, value}`. Equality uses typed scalars/enum labels or bytes `{hex,length}`. Ordering uses numbers or strings (timestamps use normalized UTC ISO values); `in` takes an array. Missing/failed fields never match. Unknown fields/extractors and malformed cursors are rejected. Use the opaque continuation string in deterministic run event order. |

Only query results' own `events[].file/line` anchors establish observation. End-line ranges and references embedded in fields, schema metadata or non-allowlisted tools do not establish grounding.

`query_events` also returns `truncated: boolean`. Its serialized envelope is capped at 16 KiB; each field value, including its nested register tree, at 1 KiB. Nested fields and meanings are returned intact when they fit. Oversized values become marked string previews, and trailing fields can be omitted to fit one event. Filtering uses original values, and stored evidence is unchanged. The event-count cap remains 50; `nextCursor` resumes at the first unreturned event when the byte or count cap is reached.

### Feedback quality insights (P3)

`GET /api/v1/logs/feedback-insights` (`logs:view`, org-scoped) aggregates `log_feedback` into the `/log-admin` analysis-quality dashboard: one row per log domain × `analysisSource` × `promptVersion` with `totalCount`, `helpfulCount`, `helpfulRate` (0..1), and `lastFeedbackAt`. Optional `timeWindow=today|7d|30d` filters by feedback creation time (same interval semantics as `GET /api/v1/logs`). Feedback is attributed to the analysis run stamped on the row (`log_feedback.run_id`, captured from the log's current run at insert time); rows that still have a null `run_id` fall back to the log's current run. List/detail continue to read the current run's report. `logDomainId`/`logDomainName` are `null` for the uncategorized domain and `analysisSource`/`promptVersion` are `null` for legacy reports without provenance.

### Source snapshot metadata and administration (#1243)

| Method | Path | Shape |
| --- | --- | --- |
| `GET` | `/api/v1/log-skills/:skillId/source-snapshots` | `200 { items: snapshot[] }`; requires `logs:view`. Metadata only, including archived snapshots. |
| `POST` | `/api/v1/log-skills/:skillId/source-snapshots` | Multipart `{ versionLabel, file }` only; `201 { item: snapshot }` in `queued` state. Requires `logs:admin-domains`. |
| `POST` | `/api/v1/log-skills/:skillId/source-snapshots/:snapshotId/default` | `200 { item: skill }`; creates or replaces the draft with `spec.defaultSourceSnapshotId`. Requires `logs:admin-domains`; takes effect on the next publication. |
| `POST` | `/api/v1/log-skills/:skillId/source-snapshots/:snapshotId/archive` | `200 { item: snapshot }` in `archived` state; requires `logs:admin-domains`. |

The required trimmed `versionLabel` is 1–200 characters and unique per skill among non-archived snapshots (`409` on conflict). Archives are `.tar.gz`, `.tgz` or `.zip`; the default compressed cap is 100 MiB. The route body cap adds 64 KiB for multipart framing; excessive `Content-Length` is rejected before buffering, and actual request bytes remain bounded (`413` when exceeded). File bytes share the request buffer; JSON/base64 uploads are not supported. `LOG_SOURCE_*` controls upload/indexing limits; see the [environment reference](../developer/environment-variables.md#log-analysis-llm) and [runbook](../runbooks/log-analysis-llm.md#source-snapshots-1243) for the allowlist and safety rules. Skill/snapshot lookups require the same organization and skill; cross-scope identifiers return `404`. Archived snapshots cannot be newly selected as defaults (`409`). Save, publication and restore may retain unchanged archived defaults; all references must belong to the same organization and skill. Snapshot upload, default selection and archive record `log-source-snapshot-upload`, `log-source-snapshot-default` and `log-source-snapshot-archive` audit events in their database write transactions.

Snapshot metadata includes `id`, `skillId`, `versionLabel`, `status` (`queued`, `indexing`, `ready`, `failed`, `archived`), `filesProcessed`, `filesTotal`, `fileCount`, `skippedCount`, `skippedFiles: [{ path, reason }]` (at most 200 details), nullable `error`, and `createdAt`. Uploads optionally accept `sourceVersion` (trimmed, 1–200 characters). The worker matches a non-archived snapshot within the pinned revision's organization and skill, regardless of readiness, otherwise using that revision's default. Records and runs expose `sourceSnapshot: { id, status }`, `sourceSnapshotSelection` (`matched_version`, `default`, `none`) and optional `requestedSourceVersion`. Unmatched labels add a fallback note. Unready or archived sources do not fail analysis; the report explains their unavailability.

Only ready runs offer `locate_log_statement`, `search_source` and `read_source_range`. Search takes `pathGlob`, `query`, optional `mode` (`literal`, `full_text`) and `limit` (1–20). Literal queries need three consecutive letters or numbers and cannot contain newlines. Full-text and trigram indexes select at most 200 chunks; a separate bounded pass covers at most 200 split-line boundaries. Ranked hits include snapshot, path, line and a 400-character excerpt. Range reads require the run's `snapshotId`, `path`, `startLine` and `endLine`, clamp to 80 lines and 1,000 characters per line, and return numbered lines. Both tools cap total output at 16 KiB and mark truncation. Source evidence must cite exact locations returned by these tools; neighboring or omitted lines are unseen. Report viewers can read the bounded excerpt around a persisted citation, without a general source browsing endpoint.

Search admits at most 201 matching chunk ids before scoring, using the extra id only to detect truncation; it ranks the first 200 candidates rather than the entire snapshot. All queries require at least three characters. A query matching more than 200 chunks without a literal path prefix is rejected with guidance to narrow the glob or query. Each search statement has a one-second PostgreSQL deadline inside a transaction; timeout rolls back that scope and returns `{ items: [], truncated: true, reason: "statement_timeout" }`. Successful searches restore the enclosing transaction's timeout. A source-search timeout does not fail log analysis.

Literal ranking scores the 400-character match neighborhood. Single-line chunks reuse their indexed full-text match instead of reparsing the line. A caller's tighter nonzero database deadline is retained.

## Debugging Parameter Semantics

`GET /api/v1/debugging/parameters?protocol=adb` returns enabled, non-archived organization catalog rows with an enabled selected-protocol binding. Authorization uses org-level debugging permissions only.

Read/write node APIs resolve protocol-specific `nodePath` from `debug_node_bindings` when `nodeId` is provided (preferred) or from legacy `debugging_parameter_node_bindings` when `parameterId` is provided. The request does not need to send a raw node path for catalog-backed nodes.

Ordinary `POST /api/v1/debugging/nodes/write` responses and `node_operations` expose independent outcomes: `writeOutcome` is `executed | failed | unknown`, while `readbackOutcome` is `observed | failed | unsupported | not_requested | unknown`. An observed readback is evidence only; the server does not compare its representation with the requested value. `targetValue` remains the request and `currentValue` advances only from an observed readback. A technical readback failure preserves the prior current value. `verified` and operation status `readback_mismatch` are nullable/deprecated legacy evidence; new ordinary writes do not produce mismatch status. `POST /api/v1/debugging/nodes/read` accepts optional `relatedOperationId` for a read-only retry linked to a same-session, same-node write. RW writes still require a pre-write snapshot; WO writes are rejected. Snapshot rollback deliberately retains strict comparison semantics.

### Runtime Node Catalog (Option A)

`GET /api/v1/debugging/nodes?protocol=hdc|adb` returns enabled, non-archived logical nodes that have an **enabled binding for the requested protocol**. Nodes missing or with a disabled binding for that protocol are omitted from runtime lists. Admin list APIs return full logical nodes with all bindings so `/debugging-admin` can show HDC/ADB coverage labels.

### Debugging Admin Catalog

`/api/v1/debugging/admin/*` is reserved for Admin catalog governance and requires `debugging:admin`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/debugging/admin/nodes` | List logical debug nodes, including disabled or archived rows when `includeArchived=true`. Optional `moduleId` + `includeDescendants` subtree filter. |
| `POST` | `/api/v1/debugging/admin/nodes` | Create a logical debug node and optional initial bindings. |
| `PATCH` | `/api/v1/debugging/admin/nodes/:nodeId` | Update logical node metadata. |
| `DELETE` | `/api/v1/debugging/admin/nodes/:nodeId` | Permanently delete an enabled or disabled node, all of its `node_operations`, their operation events and unshared snapshots, and its HDC/ADB bindings in one transaction. Shared sessions/snapshots, unrelated operations, and audit evidence remain. Success is `204`. |
| `PUT` | `/api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol` | Upsert the HDC or ADB binding for a logical node. |
| `PATCH` | `/api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol` | Update the HDC or ADB binding for a logical node. |
| `POST` | `/api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol/archive` | Disable one protocol binding without affecting the logical node or other protocols. |
| `GET` | `/api/v1/debugging/admin/modules` | List org debug node module tree nodes. |
| `POST` | `/api/v1/debugging/admin/modules` | Create a debug module (`name`, optional `parentId`). |
| `PATCH` | `/api/v1/debugging/admin/modules/:moduleId` | Update debug module metadata. |
| `POST` | `/api/v1/debugging/admin/modules/:moduleId/move` | Reparent a debug module (cycle → `409`). |
| `DELETE` | `/api/v1/debugging/admin/modules/:moduleId` | Delete when no child modules or assigned nodes remain (`409` otherwise). Legacy name-only node assignments also count as references. |
| `GET` | `/api/v1/debugging/admin/catalog/export` | Export the **complete** org debug-node catalog (every module, every persisted node including archived/disabled/unbound rows, every binding) as `wiseeff.debug-node-catalog.v2`. Response `item` carries `document`, `counts` (`modules`/`nodes`/`bindings`), `organizationId` and `fileBytes`; the document's `counts` always match its object set. The result is independent of search, module, protocol, paging or tree expansion state. Requires `debugging:admin`. Writes `debug-node-catalog-export` audit (counts + byte size + format, never raw node paths). Files above the 20 MiB contract fail the whole export with `413 PAYLOAD_TOO_LARGE` instead of returning a truncated file. |
| `POST` | `/api/v1/debugging/admin/catalog/import-preview` | Read-only server-side preview of a v1 or v2 catalog document: classifies every module, node and binding as `created`/`updated`/`unchanged`, returns blocking `conflicts`, `warnings`, per-object field differences and a `previewDigest`. No catalog write and no import audit. Requires `debugging:admin`. Document/field/reference problems return `400 VALIDATION_FAILED` with object/array/field locations; documents above 20 MiB return `413`. |
| `POST` | `/api/v1/debugging/admin/catalog/import` | Atomically merge-import a previewed catalog document. Body `{ document, previewDigest }`; the digest from `import-preview` is mandatory, so a raw document cannot bypass preview (`400 VALIDATION_FAILED`) and a file or target that changed after the preview returns `409 CONFLICT` with `details.reason: "stale-preview"`. Matching is source node id first, then unique full module-name path + node name; modules match by full path; bindings match by target node + protocol. Missing nodes are created, uniquely matched nodes are updated in place (target id and history preserved), and target-only modules, nodes and bindings are never deleted or overwritten. Archive state on an existing target is preserved. Every module, node, binding and the `debug-node-catalog-import` audit commit in one transaction; a mid-way failure rolls all of it back. Requires `debugging:admin`. |

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

ADR-0038 defines a server-internal trusted invocation context for sensitive mutations, and #610 implements its shared constructors plus policy/audit seams. Clients cannot send or override the `user` / `agent` / `system` initiator. Human-required routes accept only a server-constructed `user` initiator; an approved Agent call remains Agent initiated, and unattended system calls are denied unless a future policy explicitly permits them. A missing context fails as an internal invariant before any state write; a valid disallowed initiator returns stable `403` refusal evidence. Tickets #611–#615 still own production entry reconstruction and migration across all five DTS reload mutations and every parameter-sensitive production path; legacy `actorType` plumbing remains untrusted until those migrations land.

| Method | Path | Authz | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/dts-reload/projects/:projectId/candidates` | `debugging:view` or `debugging:dts-reload` | Project parameters with debuggability, `moduleId`, `description` (parameter meaning), sensitiveMatch, lastReload. Each candidate carries both the raw catalog `valueShapeKind` (display only) and the server-resolved `resolvedValueShape` (normalized reload vocabulary, or null); clients drive authoring validation, placeholders, and examples from `resolvedValueShape` — never the catalog kind — because resolution needs the DTS parser and the library baseline. Debuggable when nonempty absolute `nodePath`, supported reload value shape, and library baseline exist — including single-segment `/label` paths (no synthesised-anchor path-shape refuse). Presence shapes (`boolean` / `empty`) may have an empty RHS baseline. Supported shapes include u32/u8/u16 cells (incl. `/bits/ 8`), catalog `string` (single quoted string, e.g. `replace_sensor`), `string-list`, GPIO-style `phandle-cells`, bare phandle lists (`<&gic>` → `phandle-list`), booleans, empty properties, and mixed string+cell values. Explicit `/delete-property/` is an overlay verb, never inferred from an empty cell or string. `u32-array` is treated as the same reload family as `cells` (width may be inferred from a regular library baseline). Catalog `mixed` / `phandle-list` baselines that match GPIO-style `<&label N …>` resolve to reload shape `phandle-cells` (e.g. `gpio_int`); true mixed AST stays `mixed` and is never coerced to cells. Catalog `bytes` baselines authored as `/bits/ 8 <…>` resolve to reloadable 8-bit cell arrays (e.g. `prevfod1_product_list`). Rows that share the same overlay identity (`nodePath` + `propertyKey`) are collapsed to one candidate. |
| `POST` | `/api/v1/dts-reload/projects/:projectId/runs` | `debugging:dts-reload` | Start run (batch targets); may require `confirm-sensitive-reload` |
| `POST` | `/api/v1/dts-reload/runs/:runId/deploy` | `debugging:dts-reload` | In-request bridge deploy; requires `confirm-dts-reload` |
| `GET` | `/api/v1/dts-reload/runs` / `.../:runId` | view path | History and detail including reload snapshot |
| `GET` | `/api/v1/dts-reload/residue` | view path | Device residue bookkeeping |
| `POST` | `/api/v1/dts-reload/projects/:projectId/restore-baseline` | `debugging:dts-reload` | Start compensating restore-baseline run |
| `POST` | `/api/v1/dts-reload/runs/:runId/promote-to-drafts` | Reload read gate plus `parameter:edit`, and either `debugging:dts-reload` or `admin:access`. Human-required: after TD-068, trusted initiator must be `user`; Agent and system are refused. | Promote selected stored debug values into `parameter_drafts` via `createBindingDraft`, then stop. Body `{ bindingIds, unverifiableAcknowledged? }`. Ordinary `verified` runs, or ordinary `unverifiable` with `unverifiableAcknowledged: true`. Does **not** create change requests, submit rounds, or write the debug value into the binding. Returns draft ids and a `/parameters?project=` workbench href. Audited as milestone `reload-value-promoted-to-draft`. |
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

The retained v1 list is a compatibility projection of authorized current canonical Bindings (`pbind_` identity), not a mirror of legacy parameter specs or values. Shell project discovery (`GET /api/v1/projects`) excludes archived projects and uses the protected Binding reader's project scope: an organization-wide role includes all non-archived organization projects; project-bound roles include only their non-archived projects. The admin project list retains archived projects for management and restoration. The application shell reads `GET /api/v2/projects/:projectId/parameter-bindings` directly; optional historical identifier reads cannot block shell hydration. Old `?parameter=` links resolve only through exact typed historical mappings and the readable Binding's owning project; unavailable or evidence-only targets remain visibly historical.

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
| `GET` | `/api/v1/parameters/dashboard/hotspots` | Ranked hotspot leaderboard for the selected window and dimension (`project`, `module`, `parameter`). |

Query parameters:

- `summary`: `window` (default `30d`), optional `projectId`
- `hotspots`: `window` (default `30d`), `dimension` (`project` | `module` | `parameter`, default `project`), optional `projectId`

Response envelopes:

- `summary` returns `{ item: DashboardSummary }`
- `hotspots` returns `{ items: DashboardHotspot[] }`

Every project, module, and parameter row uses the same behavioral `DashboardHotspot.scoreBreakdown` contract:

```json
{
  "frequency": 30,
  "scope": 40,
  "workflow": 25,
  "collaboration": 15
}
```

- `frequency`: parameter-history activity plus change requests in the selected window.
- `scope`: modified parameter instances for project/module rows; modified projects for parameter rows.
- `workflow`: requests in the window, open requests, and returned work.
- `collaboration`: distinct contributors in and across the selected window.

`score` is the rounded sum of those four deterministic server-side dimensions. The frontend renders the returned score, evidence, trend, and deep link; it does not reconstruct ranking or business aggregates. `ParameterDashboardHotspotsResponse` in the generated OpenAPI publishes this exact four-key object and does not accept the retired `risk` / `impact` / `drift` breakdown.

## Product Feedback

Internal Beta feedback is organization-scoped and separate from log-analysis feedback. Active authenticated users can submit feedback, maintain their own drafts and follow up through the feedback center. The `mine` and draft routes require ownership; admin triage, assignment choices and admin attachment reads require `admin:access`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/product-feedback` | Create product feedback with optional image attachments. Returns `201 { item }`. |
| `GET` | `/api/v1/product-feedback` | Admin list with optional `status`, `feedbackType`, `q`, `pagePath`, `createdFrom`, `createdTo`, `cursor`, and `limit` filters. |
| `GET` | `/api/v1/product-feedback/:id` | Admin detail for one feedback record and ordered attachments. |
| `PATCH` | `/api/v1/product-feedback/:id` | Save `priority` (`low`, `normal`, `high`), nullable `assigneeUserId`, or a legacy status/note update. Assignment requires an active administrator in the same organization. Status updates use the audited progress rules below. |
| `GET` | `/api/v1/product-feedback/assignees` | Eligible organization administrators: `{ items: [{ id, name, username }] }`; username is nullable. |
| `GET` | `/api/v1/product-feedback/stats` | Counts of all submitted records by status; drafts are excluded. |
| `POST` | `/api/v1/product-feedback/:id/progress` | Append `publicMessage` and/or private `internalMessage` (each at most 2000 characters), with optional `toStatus` and `resolutionCode`. |
| `GET` | `/api/v1/product-feedback/mine` | Owner-only history, including drafts. Supports `q`, `status` (including `draft`), `cursor`, and `limit`. |
| `GET` | `/api/v1/product-feedback/mine/:id` | Owner-only public detail. Internal notes and actor IDs are excluded. |
| `POST` | `/api/v1/product-feedback/mine/:id/replies` | Owner-only submitted feedback supplement: `{ message, attachments?, reopen? }`; returns `201 { item }`. The nonblank message is at most 2000 characters. Attachments are additive; `reopen: true` requires resolved or closed feedback. Closed feedback cannot receive a supplement without reopening. |
| `POST` / `PATCH` / `DELETE` | `/api/v1/product-feedback/drafts`; `/drafts/:id` | Create, save or delete an owned draft. Draft creation permits partial fields; save accepts `retainedAttachmentIds` (including an empty array) and `newAttachments`. Submitted feedback is immutable through these routes. |
| `POST` | `/api/v1/product-feedback/drafts/:id/submit` | Submit an owned draft, optionally finalizing page context, type and description. |
| `GET` | `/api/v1/product-feedback/:id/attachments/:attachmentId/content` | Admin image content response for one attachment. |
| `GET` | `/api/v1/product-feedback/mine/:id/attachments/:attachmentId/content` | Owner-only image content for an owned feedback or draft. |

Create body:

```json
{
  "pagePath": "/parameters",
  "pageTitle": "Project parameter workspace",
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

`feedbackType` is one of `experience`, `data`, `export_submit`, or `feature`. The usual flow is `open -> in_progress -> resolved -> closed`; open or processing feedback can also be closed directly. Resolving or closing requires a resolution code and public explanation. Resolved or closed feedback can reopen to `in_progress` with a public reason, clearing its previous resolution. Closed records permit routing changes; progress requires reopening. Legacy note edits preserve earlier text in the private journal.

Both lists return `{ items, nextCursor }`, where `nextCursor` is an opaque base64url string or null. Pass it back unchanged; timestamp precision is preserved. Limits range from 1 to 100, defaulting to 50. User progress includes `author: submitter | team`; internal-only events and actor IDs are absent. Public admin progress and status changes notify the submitter with a `/feedback?id=...` link; private-only notes do not notify.

Attachments accept `image/png`, `image/jpeg`, and `image/webp`, with up to 5 images, 5 MB per image, and 15 MB total across original and supplemental images. Removing a draft attachment detaches its authorized reference; shared content-addressed image bytes remain until reference-aware garbage collection is available.

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
| `GET` | `/api/v1/knowledge/related-to-definition` | Published entries structurally referencing the exact visible Catalog `definitionId` (optional `limit`). Requires `knowledge:view` and the protected Catalog Definition read; unknown or hidden definitions return `404`. Draft and archived entries do not appear. Pure read. |
| `PUT` / `DELETE` | `/api/v1/knowledge/entries/:entryId/definition-references/:definitionId` | Add or remove one exact Catalog Definition reference. The entry owner with `knowledge:edit`, or `knowledge:manage`, may edit an unarchived entry. New adds verify Catalog visibility and reject retired definitions; existing add and absent delete are idempotent without a new audit event. Changes are audited and returned in `{ item }`. |
| `GET` / `PUT` / `DELETE` | `/api/v1/knowledge/related-to-spec`; `/api/v1/knowledge/entries/:entryId/parameter-references/:specId` | Historical Spec references remain readable and removable. PUT only replays an already stored pair; it refuses a new legacy row. No Spec ID is inferred to be a Definition ID. |
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

Entry payloads carry `parameterReferences` with distinct `kind` identities: current canonical references have `definitionId`, `availability`, Catalog lifecycle, and authorized display fields; unavailable canonical references retain the exact ID with nullable display fields. Historical `legacy-spec` references retain `specId` and S7 mapping status without inferred retargeting. `knowledge.getDocument` preserves that distinction in `referencedParameters`; neither an unavailable ID nor a legacy mapping is presented as a current Definition name.

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

### Reviewed whole-DTS source revisions

The existing candidate-create endpoint additionally accepts `{ intent: "source_revision", fileId, expectedCurrentVersionId, expectedConfigRevisionId, clientMutationId, fileName, contentBase64 }`. It pins one nonempty DTS file up to 2 MiB and the complete configuration membership; it does not change active state. Candidate source-preview returns `kind: "source_revision"`, exact `before`/`after`, diagnostics, impact, proof token and currently eligible assigned reviewers. Existing source-review submission additionally requires a scoped mutation key. Reusing a key with identical input replays; different input conflicts. Only one pending source revision may own a config set.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v2/projects/:projectId/source-revision-requests?mine=true&status=pending` | Author's requests when `mine=true`; otherwise requests assigned to the current eligible reviewer. |
| `GET` | `/api/v2/projects/:projectId/source-revision-requests/:requestId` | Authorized fixed source diff, context digest, impact and applied version/config receipt. |
| `POST` | `/api/v2/projects/:projectId/source-revision-requests/:requestId/review` | `{ decision: "approve" | "reject", proofDigest, note? }`; current assigned reviewer, separate from author. |
| `POST` | `/api/v2/projects/:projectId/source-revision-requests/:requestId/withdraw` | Author withdraws a pending request; no active source update. |

`source_revision` is a distinct immutable request kind, including zero-target comment/unregistered-only changes. Old single/batch contracts and dedicated dispatch remain intact. The frozen proof includes exact file/config/member versions, digests, Catalog/registration context, Binding/value/pin cohort, identity continuity and proposed additions. Submission and approval recheck current permissions and all version/context fences. A pinned historical Catalog Definition is validated against its historical snapshot; an advanced current pointer requires a fresh preview. Registration validation currently holds a table-level shared lock during the transaction, serializing registration writes; a per-organization fence is the documented scaling upgrade.

Value validation retains the Catalog vendor byte projection: a string schema accepts a valid byte literal or integer-only 8-bit cells as DTS text. Numeric schemas still validate exact integer values and bounds; this projection does not admit ordinary numeric cells or references as strings, or skip unchanged registered values.

Approval atomically advances source file/config versions, structural occurrences, stable Bindings, values, pins, history, audit and the verified receipt through existing owners. Storage or relational failures leave no partial active state. Removing a genuinely effective bound property records `dts-source-absence` / `dts-source-absence-v1`, anchored to the real before occurrence and after config; it never fabricates a deleted node or discards history. Readding that terminal-deleted same-source bound occurrence is currently refused at preview with `source-occurrence-restoration-requires-mapping`; it requires an explicit identity mapping workflow. Exact saved bytes remain downloadable, including comments, numeric spelling, BOM and consistent line endings. This flow does not rename global Definitions, change membership, publish baselines or write devices.

### Structured read and DTS search (P3)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/structure` | Read the persisted structural model for one file version from `dts_*` (no re-parse). Returns `{ nodes }`; each node includes typed `properties` (`valueType`, `rawText`, `normalizedValue`), `phandleRefs`, and optional `source` locators (`startOffset`/`endOffset`/`startLine`/`startColumn`/`endLine`/`endColumn`) persisted at ingest. Requires `parameter:view`. |
| `GET` | `/api/v1/projects/:projectId/dts-search` | Search current file versions' `dts_*` rows. Query: `q` (required), optional `by` = `path`\|`address`\|`label`\|`compatible`\|`value`\|`file` (omit `by` to search all dimensions including file name). Returns `{ hits }` with optional `source` locators. Requires `parameter:view`. |
Structural source locators are persisted by migration `0092_dts_structural_spans.sql` on `dts_nodes` / `dts_properties` and returned on structure/search reads without re-parse.

Both reads accept optional `navigationScope=organization`. Structure still returns the complete `nodes` array and adds `navigation`: either `{ status: "ready", catalogReleaseId, managedNodePaths }` or `{ status: "unavailable", reason: "catalog-unavailable" | "registration-unavailable" }`. Ready paths identify directly matched, active Catalog subjects with active registration in the authenticated organization, including disabled instances and instances without parameter values. Matching reuses the Catalog's compatible/alias rules and node-name fallback only when no compatible is declared. Clients add actual DTS ancestors for navigation and hide ancestor-only properties; retaining an ancestor does not retain its unrelated descendants. An empty ready set is different from an unavailable read. The file version is the requested version; registration is current organization state, not historical state pinned by `catalogReleaseId`.

Scoped search applies the same rule to each current file version in the existing project search scope. Node hits may include structural ancestors; property hits belong only to directly matched nodes. File-name hits remain available even when no node matches. Catalog or registration unavailability fails scoped search with `500` (`INTERNAL_ERROR`); unscoped reads retain their existing behavior. Organization and principal come from server authentication, never from query input. Navigation scope changes presentation only: complete source, edit validation and authorization remain authoritative.

| `POST` | `/api/v1/projects/:projectId/dts-structured-edits/submit` | Submit one or more structured DTS property edits as a parameter submission round. Body: `{ edits: [{ fileId, nodePath, propertyName, rawText, reason? }], reason?, assignees? }`. Maps each edit to a `project_parameter_value` via `source_file_name`/`source_node_path`, creates drafts, and submits CRs whose `targetValue` is `rawText` (not `normalizedValue`). Returns `201 { item }` (submission round with CR items). Requires `parameter:edit`; sensitive-node rules apply (`parameter:edit-critical` for critical paths; agent writes to critical nodes denied). Audit: `parameter-structured-edit-submit`. |

### Change-request impact extensions (P3)

`GET /api/v1/parameter-change-requests` (and related detail payloads) expose `impact[]` with kinds `module` \| `test` \| `parameter` \| `phandle` \| `compatible` \| `config-set`. When the project value is structurally bound, the server appends phandle / compatible / config-set peers; otherwise it keeps the legacy template.

Sensitive-node guards apply on submit/merge/writeback paths: missing `parameter:edit-critical` → `403`; agent writes to `critical` rules → `403` with `requireHuman: true` and audit `parameter-sensitive-node-denied`.

## Config Sets, Release Baselines, and the Validation Gate (P2)

Board-level config sets aggregate a project's parameter files into one buildable unit; release baselines snapshot a config set for compare/rollback/release; the validation gate runs `dtc` before a baseline can be released. `GET /api/v1/projects/:projectId/config-sets` requires `parameter:view` so the user topology workspace can load it. Config Set mutations, baselines, export, and release remain Admin-only.

`GET /api/v1/projects/:projectId/parameter-workflow-assignees` requires `parameter:edit` and returns `{ item: { hardwareCommitters, softwareCommitters, softwareUsers, ready, missingRoles } }`. Candidates are active users proven by caller-organization plus exact-project role bindings, deduplicated per pool. `ready` is true when all 3 candidate pools contain at least one eligible user; if any pool is empty, `ready` is false and `missingRoles` lists the missing role names (`hardware-committer`, `software-committer`, `software-user`). Admin-only, inactive, guest, cross-project, and cross-organization users are excluded; submission revalidates every selected id server-side.

`POST /api/v1/parameter-submission-rounds` has three non-overlapping item shapes. Legacy flat submissions use `{ parameterId, targetValue, reason }` **only before semantic cutover**. Post-cutover binding submissions use `{ draftId, projectParameterBindingId, parameterSpecId, action, targetValue, reason }` (optional `editSubjectKind: binding`). Node-enablement submissions use `{ draftId, editSubjectKind: "node-enablement", logicalNodeId, action, targetValue, reason }`. Binding items must not also send `parameterId`; `action` is `set|delete`, `set` requires a non-empty target, and `delete` requires `targetValue: ""`. Enablement and binding drafts may share one submission round when they share the same working tip. The server locks the exact user-owned draft plus candidate/evidence rows, verifies organization/project/Config Set, binding/spec/action/value/reason and write locks, then atomically promotes the candidate `draft -> pending_approval`. Migration `0063` persists `candidateConfigRevisionId` on both returned submission items and change requests; submit audit metadata carries the same ID. Merge locks and revalidates that exact `pending_approval` candidate and its set-value or delete-tombstone proof before history/writeback. Missing identity, changed status/value/action proof, or a historical request that predates `0063` returns `409` without success history/audit. Cross-project or missing drafts return `404`; stale locks return `409`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/workflow-role-bindings` | List project workflow role bindings (`hardware-committer`, `software-committer`, `software-user`) for the project, per-pool readiness, and eligible users. Admin-only (`users:manage`). |
| `PUT` | `/api/v1/projects/:projectId/workflow-role-bindings/:userId` | Update project review roles for a user using compare-and-swap concurrency control. Body: `{ roles: RoleId[], expectedRoles: RoleId[] }`. Scoped to the project only; does not affect organization roles. |
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
| `GET` | `/api/v1/projects/:projectId/baselines/:baselineId/restore-preview` | Preview restore blast radius without applying. Returns `200 { item }` with per-member `from`/`to` versions, `action` (`noop`\|`rollback-pointer`), server-owned `canonicalOwned`, `driftedCount`, and `releasedBaselineUnchanged: true`. Ownership includes the member's current Config set and the baseline's Config set, matching the whole-source mutation fence. If any member is canonically owned, the workbench exposes only read-only drift and explains that a prepared and approved canonical source transaction is required. |
| `POST` | `/api/v1/projects/:projectId/baselines/:baselineId/rollback` | Atomically restore drifted legacy-owned members only (new `origin=rollback` pointer versions); never deletes history; leaves the current released tip unchanged. Returns `200 { item: { baselineId, restored } }`. Canonically owned sources or Config sets are refused with `409 CONFLICT` before mutation; the trusted refusal audit survives rollback. |
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

The default list is the effective catalog projection (ADR-0039). `view=effective` (the default when `view` is omitted) returns only one active/current row per canonical driver subject + property key, after organization-active > platform-active precedence, and only when the subject, driver schema, and organization driver-group placement are complete. `view=governance` returns raw owner/lifecycle/version rows, including drafts, deprecated rows, shadowed twins, and incomplete placements; it is the repair/audit view and must not be used as a matcher override. Each returned row may include `effectiveScope`, `overrideOfSpecId`, `declaredPlacement` (authoritative taxonomy placement), and `observationState` (binding evidence, not identity). Unknown/ambiguous ingest evidence is review-only and does not create a recognized binding. The expand/contract data repair is run with `npm run parameter-definitions:reconcile -- --dry-run|--apply`; the independent full read-only gate is `npm run parameter-definitions:check`. `--catalog-only` selects the driver-catalog subset used by self-hosted candidate readiness; it omits node-type taxonomy and project binding-tip checks and must not replace the full config-release gate.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v2/parameter-specs` | List parameter specs by stable subject + property identity. Default `view=effective` returns only the unique effective active/current definition; `view=governance` exposes raw draft/deprecated/shadowed/incomplete rows for Admin repair. Each item includes `attributionSubjectId`, `lifecycle` (definition layer), `currentVersionId` / `currentVersion`, `propertyKey`, display-only `driverModule` (from attribution subject display name when present), `effectiveScope`, optional `overrideOfSpecId`, optional authoritative `declaredPlacement`, `observationState`, and `attributionModules: Array<{ id, name, kind }>` — distinct attribution units (driver groups and node-type units) observed via bindings, server-computed. Empty `attributionModules` means not yet observed. Filters: `?q=&sourceKind=&lifecycle=&attributionSubjectId=&propertyKey=&view=effective|governance`. The spec layer does not re-run compatible or node-type matching (ADR-0010). |
| `POST` | `/api/v2/parameter-specs` | Admin create org-owned **draft** definition for `attributionSubjectId` + `propertyKey` (driver-registration or node-type-definition subject only). Body requires `reason`; optional `displayName`, `description`, `documentation`, `valueShape`, `constraints`, `units`, `exampleValue`. Rejects structural property keys (ADR-0003) → `400`. Duplicate subject+key in org → `409`. Org override of platform twin requires `overridePlatform: true` → `409` with `confirmRequired` when omitted. Returns `{ item }` (`201`). Audit: `spec-draft-created`. |
| `GET` | `/api/v2/parameter-specs/:specId` | Spec detail defaults to the effective projection (`view=effective`): a shadowed, ambiguous, incomplete, or otherwise non-winning id returns `404`. `view=governance` explicitly reads the raw/history row for Admin repair. Both views include definition `lifecycle`, version pointers, `attributionSubjectId`, example/default/policy metadata (`exampleValue` illustrative only), effective scope/placement fields, and optional `cutover` summary (`status`, version pointers, impact counts). |
| `PATCH` | `/api/v2/parameter-specs/:specId` | Admin in-place **documentation-class** update on **active** / **deprecated** (or platform-global) definitions — not for drafts (`409`; use activate). Body: `documentation`, `reason`, optional `displayName`, `description`, `exampleValue`, and optional restated `valueShape` / `constraints` / `units`. Changing `valueShape`, `constraints`, or `units` → `409` with `details.code = semantic-edit-requires-successor` (ADR-0032); equality is `stableJson` against the stored version and omitted keys are not changes. Use `POST .../activate` to mint a successor + cutover. Documentation writes update the current `parameter_spec_version` row. Does **not** accept `policyTarget` (product-scoped; see TD-055). Audit: `spec-updated`. |
| `GET` | `/api/v2/parameter-spec-review-tasks` | Org-scoped, paginated, status-filtered spec review queue (`?status=&limit=&cursor=`). |
| `POST` | `/api/v2/parameter-specs/:specId/activate` | Admin activates a **draft** **org-owned** spec, or records a semantic successor when called on **active** with changed content (ADR-0014). Body requires full `valueShape`, `constraints`, `documentation`, `reason`; optional `displayName`, `description`, `units`, `exampleValue`, `coverageClaim` (required for subject-bound drafts without an existing claim). `constraints` **replaces** the stored object (omitted keys are removed). **`coverageClaim.kind` must be `overlay-property` only** (`pinned-schema-property` is **not supported**; coverage remains overlay-only). Platform-global drafts (`organization_id IS NULL`) → `403`. Cross-org → `404`. Incomplete/conflicting shapes → `400`/`409`. Deprecated specs → `409`. **Staged cutover:** content change on an active definition inserts a draft successor version and a `parameter_spec_version_cutover_run`. When no bindings reference the current version tip, cutover **auto-finalizes** (supersedes old version, activates successor). When tip bindings exist, the run stays `preparing` with pending cutover items until prepare/finalize. Audit: `spec-activated` (and cutover finalize audit when auto-finalized). |
| `GET` | `/api/v2/parameter-specs/:specId/cutover` | Open cutover impact for the spec (`{ item: cutoverSummary }`). No open run → `404`. View authz. |
| `POST` | `/api/v2/parameter-specs/:specId/cutover/prepare` | Admin marks pending cutover binding items `ready` (reuses base revision id; no second revision row). Optional body `{ reason? }`. Run → `ready` when all items ready. Audit: `spec-version-cutover-prepared`. |
| `POST` | `/api/v2/parameter-specs/:specId/cutover/finalize` | Admin finalizes after prepare: updates binding revision `parameter_spec_version_id`, supersedes old version, activates successor. Body `{ reason }`. Pending/incompatible items → `409`. Audit: `spec-version-cutover-finalized`. |
| `POST` | `/api/v2/parameter-specs/:specId/deprecate` | Admin soft-deprecate at the **definition** layer (`definition_lifecycle → deprecated`; current version stays readable for parse/release). Org-owned: org Admin; platform-global → `403` for organization Admin; **`platform-admin` may deprecate platform-global definitions** (ADR-0011 amended). Body `{ reason }`. `409` when lifecycle is not `draft` or `active`. Audit: `spec-deprecated`. |
| `POST` | `/api/v2/parameter-specs/:specId/restore` | Admin restore a deprecated definition: org-owned by org Admin, or platform-global by **`platform-admin`**. Restore lands on `active` when `activated_at` is set, otherwise `draft`. Body `{ reason }`. `409` unless currently `deprecated`. Audit: `spec-restored`. |
| `POST` | `/api/v2/parameter-specs/:specId/reattribute` | Admin identity correction: rewrite `attribution_subject_id` in **any** lifecycle, including active with references (ADR-0017, D-ID-2). Body `{ attributionSubjectId, reason }`. Rewrites derived `specification_key` and `schema_namespace` in the same transaction (ID-R4). Org-owned: org Admin; platform-global → `403` for organization Admin; **`platform-admin` may reattribute platform-global definitions** (same ownership split as deprecate/restore, ID-R5). Triple already taken (including a **deprecated** blocker hidden from the default library) → `409` with `details: { parameterSpecId, lifecycle }`. A linked DTS property whose `DriverSchema` names a different subject is also rejected with `409`; use the audited definition reconciliation flow so the schema/property tuple is corrected together. An unassigned DTS driver root updates its root schema subject atomically. Audit: `spec-reattributed`. |
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
| `GET` | `/api/v2/platform/driver-schemas/promotion-candidates` | Retired: returns `410 GONE` with the canonical successor link; no candidate query, promotion or revert is executed. |
| `POST` | `/api/v2/platform/driver-schemas/promotions` | Retired: returns `410 GONE` with the canonical successor link; no candidate query, promotion or revert is executed. |
| `POST` | `/api/v2/platform/driver-schemas/promotions/:promotionId/revert` | Retired: returns `410 GONE` with the canonical successor link; no candidate query, promotion or revert is executed. |

Successful `GET /api/v2/parameter-modules`, `GET /api/v2/parameter-modules/discovery-hints`, and `GET /api/v2/parameter-modules/driver-registry` responses carry these bounded legacy read headers:

```text
Deprecation: true
Sunset: Fri, 31 Dec 2027 00:00:00 GMT
Link: </api/v2/catalog>; rel="successor-version"
Warning: 299 WiseEff "Legacy ParameterModule contract is deprecated"
X-WiseEff-Legacy-Contract: parameter-module-v2
```

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
