# Log Analysis API Integration Guide

> Chinese: [Chinese](../zh-CN/api/log-analysis-integration.md)

How an external system pushes logs into WiseEff for analysis and consumes results — either by polling or through the domain-level **result webhook**. Inline examples cover uploads, jobs, reports, file windows and webhook signature checks without a packaged SDK.

Prerequisites: [Authentication](authentication.md) (bearer token), [Errors](errors.md) (error envelope). Endpoint schemas: [API Contract](../design-docs/api-contract.md) and [openapi.json](../generated/openapi.json).

## 1. Push a log

`POST /api/v1/log-files` with base64 content. JSON uploads accept at most 32 MiB of decoded file bytes; larger bundles use multipart under the configured upload cap (100 MiB by default). Oversized transport bodies return `413` before parsing. Bind the upload to a registered log domain via `logDomainId` (list them with `GET /api/v1/log-domains`); omit it to fall back to the built-in uncategorized domain — uploads are never blocked by domain selection.

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

An Admin configures the webhook per log domain in `/log-admin` (business-domain governance → Result webhook): HTTPS URL, signing secret, enabled flag. After an analysis for that domain reaches a terminal state (complete — including degraded — or failed), WiseEff POSTs a compact JSON summary. Raw log content and evidence text are **never** sent; fetch details through the API using `recordId`.

```json
{
  "event": "log-analysis.completed",
  "eventId": "log-result:run-...",
  "recordId": "log-...",
  "runId": "run-...",
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

### Delivery semantics

- At-least-once with bounded retries: the terminal-state transaction persists an outbox event before acknowledging completion. Workers claim due events using leases and `FOR UPDATE SKIP LOCKED`; crashes during delivery or backoff resume after lease expiry. Failed sends retry with exponential backoff (default 3 attempts), then remain failed. Every recorded attempt is visible in `/log-admin` → Recent deliveries; the REST API remains the source of truth.
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
