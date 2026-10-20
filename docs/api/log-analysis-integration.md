# Log Analysis API Integration Guide

> Chinese: [Chinese](../zh-CN/api/log-analysis-integration.md)

How an external system pushes logs into WiseEff for analysis and consumes results through polling or a skill's **result webhook**. Inline examples cover uploads, jobs, reports, file windows and webhook signature checks without a packaged SDK.

Prerequisites: [Authentication](authentication.md) (bearer token), [Errors](errors.md) (error envelope). Endpoint schemas: [API Contract](../design-docs/api-contract.md) and [openapi.json](../generated/openapi.json).

## 1. Push a log

### Select an analysis skill by key

Open a skill workspace's Integration section to copy its `skillKey`, upload URL and runnable JSON/base64 or multipart examples. Supply your bearer token through `$WISEEFF_TOKEN`; examples never contain a real credential. `skillKey` is stable across renames and publications, unique within an organization, and matches `^[a-z0-9][a-z0-9-]{1,62}$`. Administrators can edit it in that section; edits are audited and integrations must then use the new key. Creation derives a slug from the name, with a short id suffix when needed for non-ASCII names or collisions. Migration 0202 backfills existing identities.

Both `POST /api/v1/log-files` (JSON or multipart) and `POST /api/v1/logs` (stored file) accept `skillKey`. `skillId` and its compatibility alias `logDomainId` remain supported. When several selectors are supplied they must identify the same skill; conflicting selectors return `400 VALIDATION_FAILED`. Keys resolve only within the caller's organization. Unknown or foreign keys are rejected. A successful upload pins the skill's current published revision, including its model and budgets; later edits or publications do not change that run.

```bash
curl --fail-with-body -X POST "$WISEEFF_API/api/v1/log-files" \
  -H "Authorization: Bearer $WISEEFF_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"skillKey":"charging","fileName":"example.log","contentType":"text/plain","contentBase64":"SU5GTyBib290Cg=="}'

curl --fail-with-body -X POST "$WISEEFF_API/api/v1/log-files" \
  -H "Authorization: Bearer $WISEEFF_TOKEN" \
  --form-string 'skillKey=charging' \
  -F 'file=@device.log;type=text/plain' -F 'file=@kernel.log;type=text/plain'
```

Replace `charging` with the copied key. The multipart example expects the named local files. The workspace keeps model override and optional step/token budgets in the draft; publish them to affect new runs. Missing budgets use the platform defaults. Values above `LOG_ANALYSIS_MAX_STEPS` / `LOG_ANALYSIS_TOKEN_BUDGET` are rejected with field errors. Webhook configuration and the key remain live identity settings, independent of publication.

Step budgets must be integers of at least 1. Per-revision token budgets must be integers of at least `min(4096, LOG_ANALYSIS_TOKEN_BUDGET)`. Save and publish validate these bounds with field-specific errors. An explicit per-revision token budget bounds cumulative usage reported by the provider, checked before each model call, including early convergence; it is not a token estimate or a strict per-call ceiling. One completion may take cumulative usage above the budget, but no further call is made after exhaustion. Exhausted runs without a grounded final report use the existing `rules-fallback` result with `degradedReason: "token-budget-exhausted"`. Omitting `tokenBudget` preserves the existing platform-global budget accounting and early-convergence behavior.

`POST /api/v1/log-files` with base64 content. JSON uploads accept at most 32 MiB of decoded file bytes; larger bundles use multipart under the configured upload cap (100 MiB by default). Oversized transport bodies return `413` before parsing. Select a published skill using `skillKey`, `skillId` or the compatibility alias `logDomainId` (list skills with `GET /api/v1/log-skills`). Any explicit selector takes precedence over recommendation. Without a selector, the server scores the stored bundle against only your Organization's active published skills. A unique best score of at least 8 selects that skill; ties, lower scores and exhausted recommendation budgets use general analysis. To require general analysis, send `skillSelection: "generic"` without a skill selector. These rules also apply to multipart uploads and `POST /api/v1/logs` for stored files.

### Preview a recommendation

`POST /api/v1/log-skills/recommend` requires an active account with `logs:upload`. Send `{ "files": [{ "path": "kernel.log", "head": ["charging current reduced"] }] }`. The response is `{ "recommendations": [{ "skillId": "...", "score": 8, "reasons": [{ "kind": "pattern", "file": "kernel.log", "detail": "..." }] }], "recommendedSkillId": "..." }`. `recommendedSkillId` is omitted when no unique candidate meets the threshold. Rankings contain at most 100 skills and 24 reasons per skill. `kind` is `file` or `pattern`; scores are ranking evidence, not a probability of a correct analysis. The endpoint only previews selection; omit the upload selector to let the server independently score the stored contents. See the [recommendation contract](../design-docs/api-contract.md#skill-recommendation-and-upload-routing-1247) for weights and limits.

Supply an optional `sourceVersion` label (trimmed, 1–200 characters) to select the matching source snapshot belonging to the pinned skill. The worker selects a matching non-archived snapshot even while it is queued, indexing or failed; source tools are offered only when that snapshot is ready. With no matching label, or no label, it uses the pinned revision's default snapshot. An unknown label is recorded in report provenance, with a short fallback note there. The same field is accepted by JSON uploads, multipart uploads and `POST /api/v1/logs` when creating a record from a stored file. `GET /api/v1/log-skills` exposes `hasSourceSnapshots` and `readySourceVersions`, an array of ready version labels without snapshot metadata. The upload dialog offers these labels and a default-snapshot option; integration APIs continue accepting free-text labels.

`GET /api/v1/log-skills/{skillId}/source-versions` returns only `{ "items": ["v2.4.0"] }` for ready snapshots in the skill's organization. It permits `logs:view` or active users with `logs:upload`, including upload-only clients; foreign-organization skills return `404`. It exposes no snapshot ids, status, file inventory or source content.

```bash
curl -sS -X POST "$WISEEFF_API/api/v1/log-files" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg content "$(base64 < charging-foldback.log)" \
    --arg domain "$LOG_DOMAIN_ID" \
    '{fileName: "charging-foldback.log", contentType: "text/plain",
      contentBase64: $content, logDomainId: $domain, sourceVersion: "firmware-v7",
      analysisQuestion: "Why did fast charging fold back?"}')"
```

The `201` response carries `log.id` (the record) and `job.id` (the analysis job).

Supported text extensions are `.log`, `.txt`, `.csv` and `.json`; bundle intake recognizes UTF-8 and BOM-marked UTF-16 text. Archives can contain several files and use `.gz`, `.zip`, `.tar`, `.tar.gz` or `.tgz`. For several loose text files in one record, send `multipart/form-data` with a repeated `file` field. Inspect the record's `files` inventory for analyzed and skipped entries. Configured compressed, unpacked, file-count and per-file limits apply; see [environment variables](../developer/environment-variables.md). Archive expansion also has a 200× ratio bound with a 1 MiB minimum budget. Rejected inputs retain a readable failure reason.

## 2. Poll the job

`GET /api/v1/jobs/{jobId}` until `status` is `complete` or `failed`. Recommended cadence: 1s for the first ~30s, then back off to 2–5s; analysis targets p95 ≤ 3 minutes for ≤ 10MB logs. `GET /api/v1/jobs/{jobId}/events` offers the same snapshots as Server-Sent Events.

## 3. Fetch the result

`GET /api/v1/logs/{logId}` returns the conclusion, impact, severity, confidence, evidence (with line anchors), suggested actions, and the provenance fields `analysisSource` / `degradedReason` — a `rules-fallback` report is a degraded analysis and never impersonates a full agent analysis.

New records also expose `skillSelection: { mode: "recommended" | "explicit" | "generic", reasons: [{ kind, file, detail }] }` in report metadata. Recommended selection records the winning score's reasons. Explicit and generic choices have no matching reasons; older records can omit the field. The selected publication is separately recorded in `skillRevision`.

Source provenance appears on the record and its runs (`GET /api/v1/logs/{logId}/runs`): `sourceSnapshot: { id, versionLabel, status }` identifies the selected snapshot, `sourceSnapshotSelection` is `matched_version`, `default` or `none`, and `requestedSourceVersion` preserves the requested label when supplied. A `default` or `none` result with a requested label means that label was not found. Selection notes belong only to provenance, never the report conclusion. Source evidence locations must have appeared in tool results; `search_source` returns bounded ranked excerpts and `read_source_range` returns at most 80 numbered lines from the selected snapshot.

The record also exposes optional `signalSummary: { signals, templates, truncatedSignals, truncatedTemplates }` for its current run. Generic signals are produced without selecting a skill; a pinned skill contributes its own signal hits. Signals carry kind, severity, source, occurrence count and bounded `file:line` anchors with excerpts. Templates carry normalized text, count and first/last anchors. Check the truncation flags before treating a summary as complete. Older records can omit this field. Rule fallback uses generic and pinned-skill signals while retaining the degraded marker and confidence caps. See the [signal contract](../design-docs/api-contract.md#generic-signals) for field shapes and the internal agent tools; the tools do not add REST endpoints.

Optional `signalSummary.truncated` and `reason` describe incomplete extraction: `time_cap` retains completed results, `line_cap` limits matching to line prefixes, and `extraction_error` returns an empty summary while analysis continues. Check these fields alongside the count-cap flags before interpreting an empty summary as absence of anomalies.

### Administrator traces and draft dry runs

`GET /api/v1/logs/{logId}/trace` returns ordered `{ steps }` for the record's current run. It requires `logs:admin-domains`; `logs:view` alone receives `403`, and inaccessible records return `404`. Steps contain bounded tool-argument summaries, result byte counts, returned line references, outcomes and available token counts, never raw prompts or provider payloads. See the [trace and dry-run contract](../design-docs/api-contract.md#analysis-traces-and-draft-dry-runs-1230) for storage bounds and the administrator-only draft dry-run endpoints. Dry runs use the saved draft and stored sample; they create no `/logs` records or result webhooks.

### Skill analysis cases

All analysis-case routes require `logs:admin-domains` and organization-scoped access. Cases belong to a skill identity across revisions. See the [analysis-case API contract](../design-docs/api-contract.md#skill-analysis-cases-1246) for CRUD, run, trace, report-prefill and ZIP endpoints. New uploads preserve original input bytes separately from normalized analysis files, so saving a report as a case retains its original bundle. Historical reports without retained original uploads cannot reconstruct those bytes and return an explicit error when saved as a case.

Case runs use the configured analyzer, compare the saved draft with its last published revision, and persist isolated test outcomes. They share draft dry-run admission, produce no user-visible log record or result webhook, and never block publishing. Import and export use the [`eval-cases/logs` layout](../../eval-cases/logs/README.md), with exact fixture bytes and path-specific validation errors.

### Fetch a file's line window

`GET /api/v1/logs/{logId}/lines?file=...&startLine=...&endLine=...` returns a window from one analyzed file. It requires `logs:view` and the same Organization scope as the record. Use the exact `path` from the record's `files` inventory for `file`; this is a bundle path, not an object-store key.

Both line bounds are required, positive, 1-based integers and inclusive. A request may contain at most 400 lines. The server clips `endLine` at the end of the file; a `startLine` beyond the file, reversed bounds, or a window over 400 lines returns `400 VALIDATION_FAILED`. A final newline does not add a line; actual blank lines remain addressable. An empty file returns `startLine: 1`, `endLine: 0`, `totalLines: 0` and `lines: []`. Older indexes rebuild lazily on access. A missing or skipped file returns `404 NOT_FOUND`.

```bash
curl -sS --get "$WISEEFF_API/api/v1/logs/$LOG_ID/lines" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "file=device/kernel.log" \
  --data-urlencode "startLine=40" \
  --data-urlencode "endLine=42"
```

```json
{
  "item": {
    "file": "device/kernel.log",
    "startLine": 40,
    "endLine": 42,
    "totalLines": 850,
    "lines": [
      { "lineNumber": 40, "content": "Starting diagnostic task" },
      { "lineNumber": 41, "content": "ERROR device unavailable" },
      { "lineNumber": 42, "content": "Retry scheduled" }
    ]
  }
}
```

The reader uses the file's UTF-8 text object and line-offset index, including for UTF-16 uploads converted during intake. CRLF counts as one line break, and the final line remains addressable without a trailing newline. Each returned line is bounded to a 64 KiB prefix; longer lines end with `… [line truncated at 64 KiB]`. Consumers should preserve this marker when displaying or copying a truncated line.

The record's existing raw-log panel remains a preview: at most the first 400 lines per file, with a shared 128 KiB text budget per run. In `/logs`, clicking an evidence `file:line` chip or a signal/template anchor opens the shared file drawer, scrolls to and highlights its citation, and offers context loading above and below plus line copying. Use the line-window endpoint for locations beyond the preview rather than treating `rawLines` as the complete file.

## 4. Or consume the result webhook

An administrator configures a skill's webhook in its workspace's Integration section: HTTPS URL, write-only signing secret (set or rotate), and enabled flag. The same section offers a test delivery and recent delivery attempts. The old administration page links to this workspace. After an analysis for that skill reaches a terminal state (complete, including degraded, or failed), WiseEff POSTs a compact JSON summary. Raw log content and evidence text are **never** sent; fetch details through the API using `recordId`.

```json
{
  "event": "log-analysis.completed",
  "eventId": "log-result:run-...",
  "recordId": "log-...",
  "runId": "run-...",
  "skillRevisionId": "revision-...",
  "skillRevisionNumber": 2,
  "skill": { "id": "domain-...", "key": "charging", "revisionId": "revision-...", "revisionNumber": 2 },
  "degraded": false,
  "fileName": "charging-foldback.log",
  "logDomainId": "domain-...",
  "status": "complete",
  "analysisSource": "agent",
  "degradedReason": null,
  "severity": "Warning",
  "confidence": 0.82,
  "conclusionSummary": "Charging behavior is consistent with thermal foldback protection…",
  "occurredAt": "2026-08-13T02:00:00.000Z",
  "productPath": "/logs?id=report-run-..."
}
```

`event` is `log-analysis.completed`, `log-analysis.failed`, or `log-analysis.test` (admin test button).

Result events add `skill: { id, key, revisionId, revisionNumber }` and `degraded: boolean` while retaining all previous fields. Revision fields are nullable for legacy unpinned runs. `degraded` is true for rule fallback or an available degradation reason; `degradedReason` carries the reason when available. The key is captured when the terminal event is enqueued; retries preserve that snapshot. The synchronous test event retains its existing shape.

### Delivery semantics

- At-least-once with bounded retries: the terminal-state transaction persists an outbox event before acknowledging completion. Workers claim due events using leases and `FOR UPDATE SKIP LOCKED`; crashes during delivery or backoff resume after lease expiry. Failed sends retry with exponential backoff (default 3 attempts), then remain failed. Every recorded attempt is visible in the skill workspace's Integration section; the REST API remains the source of truth.
- Delivery-attempt history is bounded independently per log domain. The worker keeps the latest 10,000 rows by `created_at DESC, id DESC` by default; cleanup failures produce a redacted warning and retry on the next 60-second cycle without interrupting delivery. Operators can tune the bound or disable future pruning with `LOG_WEBHOOK_DELIVERY_RETENTION_*`, but only database backup/restore can recover rows already deleted. Attempt history and terminal outbox rows (`delivered` / `failed`) each independently retain the newest N rows under the same setting and ordering, with at most ten batches of 1,000 deletes per table per cycle. `pending`, `processing`, and `retry` events are never pruned.
- Respond with a `2xx` quickly (do the work async). Redirects are not followed; response bodies are discarded.
- A receiver may accept a request before the sender crashes and records success. Deduplicate result events using the stable `eventId` (or existing `runId`); retries preserve the payload and event id. The admin test endpoint remains a synchronous single attempt.

### Verify the signature

Every request carries:

| Header | Content |
| --- | --- |
| `X-WiseEff-Timestamp` | Unix seconds when the delivery was signed |
| `X-WiseEff-Signature` | `sha256=<hex>` — HMAC-SHA256 over `` `${timestamp}.${rawBody}` `` with the domain's signing secret |

The timestamp is part of the signed input, which is what makes it a real replay defence. Verify with a constant-time comparison and reject deliveries whose timestamp is outside your replay window (recommended: 300 seconds).

Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWiseEffWebhook({ secret, rawBody, headers, toleranceSeconds = 300 }) {
  const timestamp = Number(headers["x-wiseeff-timestamp"]);
  const signature = headers["x-wiseeff-signature"] ?? "";
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false; // stale or missing timestamp — possible replay
  }
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

curl / openssl (recompute the signature for a captured request):

```bash
TIMESTAMP=1755050000            # X-WiseEff-Timestamp header
SECRET=your-domain-signing-secret
BODY_FILE=payload.json          # raw request body, byte-for-byte

printf '%s.' "$TIMESTAMP" | cat - "$BODY_FILE" \
  | openssl dgst -sha256 -hmac "$SECRET" -hex \
  | sed 's/^.*= /sha256=/'
# compare (constant-time in real code) with X-WiseEff-Signature
```

### Receiver checklist

- Verify the signature and replay window before parsing the body.
- Return `2xx` fast; retry-causing statuses (`5xx`, timeouts) consume the sender's bounded retries.
- Rotate the secret in `/log-admin` when needed; the API never echoes it (only configured-state and its last four characters).
- Local development: senders refuse plain HTTP and private/loopback addresses by default; a local receiver such as `http://127.0.0.1:9999` only works when the server runs with `LOG_WEBHOOK_ALLOW_INSECURE_LOCAL=true` (never in production).

## Error handling and retries (push side)

- `400 VALIDATION_FAILED`: bad base64/fields — fix the request, do not retry as-is.
- `401 / 403`: token or permission problem (`logs:upload`); see [Authentication](authentication.md).
- `5xx` on upload: safe to retry with backoff; each accepted upload creates a new record (no server-side dedup), so reuse a client-side idempotency guard if you retry aggressively.
- A `failed` record carries a readable `failureReason` (unsupported format, oversized archive, exhausted attempts); rerun with `POST /api/v1/logs/{logId}/rerun` after fixing the input if appropriate.
