# Log Analysis API Integration Guide

> Chinese: [Chinese](../zh-CN/api/log-analysis-integration.md)

How an external system pushes logs into WiseEff for analysis and consumes results — either by polling or through the domain-level **result webhook**. Inline examples replace a packaged SDK on purpose: the surface is three REST calls plus one signature check, and the guide stays the single source of truth until a real consumer asks for more.

Prerequisites: [Authentication](authentication.md) (bearer token), [Errors](errors.md) (error envelope). Endpoint schemas: [API Contract](../design-docs/api-contract.md) and [openapi.json](../generated/openapi.json).

## 1. Push a log

`POST /api/v1/log-files` with base64 content. Bind the upload to a registered log domain via `logDomainId` (list them with `GET /api/v1/log-domains`); omit it to fall back to the built-in uncategorized domain — uploads are never blocked by domain selection.

```bash
curl -sS -X POST "$WISEEFF_API/api/v1/log-files" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg content "$(base64 < charging-foldback.log)" \
    --arg domain "$LOG_DOMAIN_ID" \
    '{fileName: "charging-foldback.log", contentType: "text/plain",
      contentBase64: $content, logDomainId: $domain,
      analysisQuestion: "Why did fast charging fold back?"}')"
```

The `201` response carries `log.id` (the record) and `job.id` (the analysis job).

Supported formats: UTF-8 text logs with extensions `.log`, `.txt`, `.csv`, `.json`, plus compressed uploads — single-file `.gz` or single-entry `.zip` containing one such text log. Unpacked size is capped at 100MB absolute and 200× the compressed size (1MB floor); binary content, multi-entry or encrypted archives fail with a readable `failureReason` on the record.

## 2. Poll the job

`GET /api/v1/jobs/{jobId}` until `status` is `complete` or `failed`. Recommended cadence: 1s for the first ~30s, then back off to 2–5s; analysis targets p95 ≤ 3 minutes for ≤ 10MB logs. `GET /api/v1/jobs/{jobId}/events` offers the same snapshots as Server-Sent Events.

## 3. Fetch the result

`GET /api/v1/logs/{logId}` returns the conclusion, impact, severity, confidence, evidence (with line anchors), suggested actions, and the provenance fields `analysisSource` / `degradedReason` — a `rules-fallback` report is a degraded analysis and never impersonates a full agent analysis.

## 4. Or consume the result webhook

An Admin configures the webhook per log domain in `/log-admin` (business-domain governance → 结果回调): HTTPS URL, signing secret, enabled flag. After an analysis for that domain reaches a terminal state (complete — including degraded — or failed), WiseEff POSTs a compact JSON summary. Raw log content and evidence text are **never** sent; fetch details through the API using `recordId`.

```json
{
  "event": "log-analysis.completed",
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

- Best-effort and asynchronous: delivery never blocks or fails the analysis itself. Failed sends retry with exponential backoff (default 3 attempts) and are then marked failed; every attempt is visible in `/log-admin` → 最近投递. Treat the webhook as a notification channel and the REST API as the source of truth.
- Respond with a `2xx` quickly (do the work async). Redirects are not followed; response bodies are discarded.
- Deliveries are at-least-once across retries — deduplicate on `runId` if your handler is not idempotent.

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
