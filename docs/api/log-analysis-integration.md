# Log Analysis Integration Guide

> Chinese: [Chinese](../zh-CN/api/log-analysis-integration.md)

From a first skill to a first signed result webhook, using WiseEff forms and copyable requests.

User requests may bind the existing log, skill, file, job and SSE endpoints to an explicit `organizationId` query parameter. The server authorizes that target: ordinary users remain in their Home organization, while an active platform administrator retains their real identity when managing another organization. Omit the parameter to use Home. Audits record the actor and target separately; uploaded files, queued analyses and result-webhook outbox rows retain their captured organization after later navigation.

Machine integration credentials keep their own organization. Supplying another `organizationId` returns `403`; it never grants the human administrator's cross-organization authority. A frontend log client fixes the target for both HTTP requests and SSE, including cleanup when its view is replaced.

## 1. Build a skill from a template

You need your WiseEff URL and an organization account with **Manage analysis skills** (`logs:admin-domains`). Ask your administrator for access; no repository checkout or SDK is needed. Authoring uses API mode; mock mode is read-only.

1. Open **Log administration → Analysis skills** (`/log-admin?tab=skills`), choose **New skill** (新建技能), enter a name and select Generic text, Linux dmesg, Android logcat or JSON Lines. You can also copy a skill. Attach a sample text log (at most 2 MiB).
2. In **Overview**, set the description. In **Sample & parsing**, set applicable file globs and roles and check the sample path matches. Files outside the globs receive generic analysis without skill extraction/decoding.
3. In **Diagnostic procedure**, complete the Markdown outline: scope, first checks, root-cause criteria, common misjudgements and actions. Preview it. The procedure cannot override the platform's grounding or read-only protocol.
4. In **Sample & parsing**, use the basic-format form for timestamps, severity and multiline records. Select a sample line, choose **Create extractor from this line**, click value segments, name fields and choose types. Check match counts/coverage, then save the extractor.
5. In **Decoding**, add a register, choose its 8/16/32/64-bit width, add named bit ranges and optional enum/scale/offset/unit/signedness, and bind the numeric extractor field to it. Inspect the selected line's bit bar. Register maps choose a register using another field; frame forms define byte layouts, endianness and checksums.
6. In **Signals**, add a rule, choose an extracted or decoded field, comparison and value, and name the signal. For example, extract `reg=0x20`, decode bit 5 as `thermal_shutdown`, and signal when its decoded value equals numeric `1`. Check the sample hit and line.
7. Link knowledge in **Knowledge** if needed (creating entries also requires knowledge-edit permission). Upload optional version-labelled source archives in **Source** and wait for indexing. Source/log excerpts may reach the configured model provider; check your organization's data policy before upload.

Keep **Form** selected in parsing/decoding; code views are optional. **Save draft** preserves edits without changing already pinned runs.

## 2. Test and publish

- **Sample preview:** check matching and nonmatching lines, typed/decoded fields, errors and signal hits. A truncated preview covers only completed work.
- **Parse tests:** in **Tests**, select a sample line and **New test**, review expected field paths/values and add expected signal names or ids. **Run tests** checks deterministic parsing/signals. Tests travel with the revision and run on draft save and before publication.
- **Analysis cases:** add an original log bundle with expected root cause, file/line or pattern evidence, actions, or expected refusal. Run against the saved draft and compare with the last publication. These use the configured analyzer; degraded/rules-fallback results are not full model acceptance.
- **Dry run:** save the draft, run it on the stored sample and inspect its report, degradation reason and tool trace. It creates neither a normal log record nor a result webhook.

Choose **Publish**, review test outcomes and confirm. Failed tests inform the author but do not block publication. Publishing freezes a revision; new uploads use it, while previous runs retain their pinned revision.

## 3. Package and move the skill

Choose **Export skill package** in the workspace, select the current publication (default) or saved draft and download the ZIP. Unsaved edits are excluded. In the destination organization's skill list, choose **Import skill package**, select the ZIP, optionally override the name and choose Draft (default) or Published.

The package carries `SKILL.md` (procedure and settings), `parsing.yaml`, `signals.yaml`, `tests.yaml`, linked Markdown knowledge and analysis cases with original fixtures. It excludes workspace samples, source snapshots, credentials, webhook settings/secrets, runs and traces. Import allocates new destination ids; the key is a suggestion, so copy the destination's actual key. Imported knowledge always starts as draft, even when the skill is published: review and publish it separately. Upload samples/source snapshots separately and select the destination snapshot.

Validation occurs before an atomic audited write. Path-specific errors identify malformed/unsafe files; name collisions offer a replacement name. Fix and retry. Identical parsing/signals and case bytes preserve deterministic rule evidence; model results also depend on destination knowledge, source and provider settings.

## 4. Issue a credential and choose the skill key

An administrator with `logs:admin-domains` issues a credential in the skill workspace's Integration → Integration credentials subsection. The secret appears once, at issue or rotation; copy it to a secret manager and acknowledge that it is saved before closing. Use `Authorization: Bearer <integration-credential>` over TLS. Set `$WISEEFF_INTEGRATION_CREDENTIAL` from your secret manager for the examples below; never commit or log its value.

A credential is an organization-scoped machine principal with no user account, roles or permissions. Its fixed scope allows uploads to `POST /api/v1/log-files` and `POST /api/v1/logs`, and reads of its own record, report and files only. It cannot list records or skills, read other credentials' or users' records, access jobs/SSE, run history, traces, source administration, `/me` or lifecycle administration. Copy the skill selector from the workspace using a user session. A bound credential with no selector uses its bound skill as an explicit selection; a selector for a different skill returns `403`. An unbound credential with no selector uses automatic recommendation over its organization's published skills. Only unbound credentials can request general analysis with `skillSelection: "generic"`. Bound credentials receive `403` for that request, even with a selector matching their bound skill. Existing size, rate and analysis limits apply.

Rotation invalidates the old secret immediately; revocation takes effect on the next request. Archiving a skill revokes its bound credentials. Only a hash is stored; lists never return a secret. Metadata exposes `createdByCredentialId` and `createdByCredentialName`; uploading user is null, and organization users with `logs:view` retain normal visibility. Upload audits identify the integration credential. Last-used timestamps update at most once a minute.


Open **Integration** (集成), copy **Skill key** (技能标识), **Upload URL** (上传地址) and a request snippet. Choose **Issue credential** (签发凭据), name it and keep **Bind to current skill** checked for a skill-specific integration. The reveal dialog displays `wie_<credentialId>_<secret>` once. Copy it to your secret manager and acknowledge saving it before closing. The API credential and the webhook signing secret are separate secrets.

For the examples below, set `WISEEFF_API` to your HTTPS origin (without `/api/v1`), `WISEEFF_SKILL_KEY` to the copied key and `WISEEFF_INTEGRATION_CREDENTIAL` from your secret manager. The copied Upload URL already includes `/api/v1/log-files`. All values here are placeholders.

```bash
WISEEFF_API='https://wiseeff.example.com'
WISEEFF_SKILL_KEY='replace-with-copied-skill-key'
# Supply WISEEFF_INTEGRATION_CREDENTIAL from your secret manager.
```

## 5. Push a log bundle with curl

### Select an analysis skill by key

Open a skill workspace's Integration section to copy its `skillKey`, upload URL and JSON/base64 or multipart examples. Replace the credential placeholder before running them. `skillKey` is stable across renames and publications, unique within an organization, and matches `^[a-z0-9][a-z0-9-]{1,62}$`. Administrators can edit it in that section; edits are audited and integrations must then use the new key. Creation derives a slug from the name, with a short id suffix when needed for non-ASCII names or collisions. Migration 0202 backfills existing identities.

Both `POST /api/v1/log-files` (JSON or multipart) and `POST /api/v1/logs` (stored file) accept `skillKey`. `skillId` and its compatibility alias `logDomainId` remain supported. When several selectors are supplied they must identify the same skill; conflicting selectors return `400 VALIDATION_FAILED`. Keys resolve only within the caller's organization. Unknown or foreign keys are rejected. A successful upload pins the skill's current published revision, including its model and budgets; later edits or publications do not change that run.

### Single file: JSON / Base64

This small example sends `INFO reg=0x20\n`. For your own file, replace the filename/content type and the standard Base64 string with the file's bytes encoded without embedded newlines.

```bash
curl --fail-with-body "$WISEEFF_API/api/v1/log-files" \
  -H "Authorization: Bearer $WISEEFF_INTEGRATION_CREDENTIAL" \
  -H 'Content-Type: application/json' \
  --data "{\"skillKey\":\"$WISEEFF_SKILL_KEY\",\"fileName\":\"example.log\",\"contentType\":\"text/plain\",\"contentBase64\":\"SU5GTyByZWc9MHgyMAo=\"}"
```

### Multipart: multiple files or one archive

```bash
curl --fail-with-body "$WISEEFF_API/api/v1/log-files" \
  -H "Authorization: Bearer $WISEEFF_INTEGRATION_CREDENTIAL" \
  --form-string "skillKey=$WISEEFF_SKILL_KEY" \
  -F 'file=@application.log;type=text/plain' \
  -F 'file=@system.log;type=text/plain'
```

For a single archive replace both `-F` lines with `-F 'file=@logs.tar.gz;type=application/gzip'`. Send an archive alone, without accompanying loose files. Do not set the multipart Content-Type yourself; curl supplies its boundary.

The multipart example expects the named local files. The workspace keeps model override and optional step/token budgets in the draft; publish them to affect new runs. Missing budgets use the platform defaults. Values above `LOG_ANALYSIS_MAX_STEPS` / `LOG_ANALYSIS_TOKEN_BUDGET` are rejected with field errors. Webhook configuration and the key remain live identity settings, independent of publication.

Step budgets must be integers of at least 1. Per-revision token budgets must be integers of at least `min(4096, LOG_ANALYSIS_TOKEN_BUDGET)`. Save and publish validate these bounds with field-specific errors. An explicit per-revision token budget bounds cumulative usage reported by the provider, checked before each model call, including early convergence; it is not a token estimate or a strict per-call ceiling. One completion may take cumulative usage above the budget, but no further call is made after exhaustion. Exhausted runs without a grounded final report use the existing `rules-fallback` result with `degradedReason: "token-budget-exhausted"`. Omitting `tokenBudget` preserves the existing platform-global budget accounting and early-convergence behavior.

`POST /api/v1/log-files` with base64 content. JSON uploads accept at most 32 MiB of decoded file bytes; larger bundles use multipart under the configured upload cap (100 MiB by default). Oversized transport bodies return `413` before parsing. Select a published skill using `skillKey`, `skillId` or the compatibility alias `logDomainId` (users can list skills with `GET /api/v1/log-skills`). Any explicit selector, including a credential's bound skill, takes precedence over recommendation. Without a selector or credential binding, the server scores the stored bundle against only your organization's active published skills. A unique best score of at least 8 selects that skill; ties, lower scores and exhausted recommendation budgets use general analysis. To require general analysis, send `skillSelection: "generic"` without a skill selector, using a user session or an unbound credential. Bound credentials cannot request generic analysis: `skillSelection: "generic"` returns `403`, even with a matching skill selector. A selector conflicting with the credential's bound skill also returns `403`. These rules also apply to multipart uploads and `POST /api/v1/logs` for stored files.

### Routing and optional source versions

`POST /api/v1/log-skills/recommend` requires an active user account with `logs:upload`; integration credentials cannot call this endpoint. Send `{ "files": [{ "path": "kernel.log", "head": ["charging current reduced"] }] }`. The response is `{ "recommendations": [{ "skillId": "...", "score": 8, "reasons": [{ "kind": "pattern", "file": "kernel.log", "detail": "..." }] }], "recommendedSkillId": "..." }`. `recommendedSkillId` is omitted when no unique candidate meets the threshold. Rankings contain at most 100 skills and 24 reasons per skill. `kind` is `file` or `pattern`; scores are ranking evidence, not a probability of a correct analysis. The endpoint only previews selection; omit the upload selector to let the server independently score the stored contents when no credential binding applies. See the [recommendation contract](../design-docs/api-contract.md#skill-recommendation-and-upload-routing-1247) for weights and limits.

Supply an optional `sourceVersion` label (trimmed, 1–200 characters) to select the matching source snapshot belonging to the pinned skill. The worker selects a matching non-archived snapshot even while it is queued, indexing or failed; source tools are offered only when that snapshot is ready. With no matching label, or no label, it uses the pinned revision's default snapshot. An unknown label is recorded in report provenance, with a short fallback note there. The same field is accepted by JSON uploads, multipart uploads and `POST /api/v1/logs` when creating a record from a stored file. `GET /api/v1/log-skills` exposes `hasSourceSnapshots` and `readySourceVersions`, an array of ready version labels without snapshot metadata. The upload dialog offers these labels and a default-snapshot option; integration APIs continue accepting free-text labels.

`GET /api/v1/log-skills/{skillId}/source-versions` returns only `{ "items": ["v2.4.0"] }` for ready snapshots in the skill's organization. It permits `logs:view` or active users with `logs:upload`, including upload-only clients; foreign-organization skills return `404`. It exposes no snapshot ids, status, file inventory or source content.

A successful `201` response is `{ fileObject, log, job }`. Save `log.id` as `LOG_ID`; no second create request is needed. `POST /api/v1/logs` is an alternative for an already stored file, not the next step after uploading.

Supported text extensions are `.log`, `.txt`, `.csv`, `.json` and extensionless text files; bundle intake recognizes UTF-8 and BOM-marked UTF-16 text. Archives can contain several files and use `.gz`, `.zip`, `.tar`, `.tar.gz` or `.tgz`. For several loose text files in one record, send `multipart/form-data` with a repeated `file` field. Inspect the record's `files` inventory for analyzed and skipped entries. Configured compressed, unpacked, file-count and per-file limits apply; see [environment variables](../developer/environment-variables.md). Archive expansion also has a 200× ratio bound with a 1 MiB minimum budget. Rejected inputs retain a readable failure reason.


| Intake limit | Shipped default |
| --- | --- |
| JSON decoded file bytes | 32 MiB; use multipart above this |
| Total uploaded/compressed bytes | 100 MiB |
| Total unpacked original bytes | 100 MiB |
| Per-file bytes | 100 MiB |
| File count | 2,000 |
| Archive expansion | 200×, with a 1 MiB minimum budget; file/total caps still apply |

Deployment caps may differ. Archive safety/expansion violations return `201` with a failed `log`, readable `failureReason`, no job and no stored archive. Check `log.status`, not only HTTP status. Transport caps can instead return `413`.

For an **unbound** credential, force generic analysis with this request; for automatic routing remove `"skillSelection":"generic",`. A bound credential cannot use either technique to bypass its binding.

```bash
curl --fail-with-body "$WISEEFF_API/api/v1/log-files" \
  -H "Authorization: Bearer $WISEEFF_INTEGRATION_CREDENTIAL" \
  -H 'Content-Type: application/json' \
  --data '{"skillSelection":"generic","fileName":"example.log","contentType":"text/plain","contentBase64":"SU5GTyByZWc9MHgyMAo="}'
```

Credentials cannot select related parameters. Recommendation preview and source-version listing require user authentication; the upload itself accepts a free-text `sourceVersion` from a credential.

## 6. Read results with the same credential

Poll `GET /api/v1/logs/{logId}` using the credential that uploaded the record until `status` is `complete` or `failed`. Recommended cadence: 1s for the first ~30s, then back off to 2–5s; analysis targets p95 ≤ 3 minutes for ≤ 10MB logs. Job polling (`GET /api/v1/jobs/{jobId}`) and job SSE (`GET /api/v1/jobs/{jobId}/events`) require a user session and are outside credential scope.

### Read the report

`GET /api/v1/logs/{logId}` returns the conclusion, impact, severity, confidence, evidence (with line anchors), suggested actions, and the provenance fields `analysisSource` / `degradedReason` — a `rules-fallback` report is a degraded analysis and never impersonates a full agent analysis.

New records also expose `skillSelection: { mode: "recommended" | "explicit" | "generic", reasons: [{ kind, file, detail }] }` in report metadata. Recommended selection records the winning score's reasons. Explicit and generic choices have no matching reasons; older records can omit the field. The selected publication is separately recorded in `skillRevision`.

Source provenance appears on the record (run-history reads require a user session): `sourceSnapshot: { id, versionLabel, status }` identifies the selected snapshot, `sourceSnapshotSelection` is `matched_version`, `default` or `none`, and `requestedSourceVersion` preserves the requested label when supplied. A `default` or `none` result with a requested label means that label was not found. Selection notes belong only to provenance, never the report conclusion. Source evidence locations must have appeared in tool results; `search_source` returns bounded ranked excerpts and `read_source_range` returns at most 80 numbered lines from the selected snapshot.

The record also exposes optional `signalSummary: { signals, templates, truncatedSignals, truncatedTemplates }` for its current run. Generic signals are produced without selecting a skill; a pinned skill contributes its own signal hits. Signals carry kind, severity, source, occurrence count and bounded `file:line` anchors with excerpts. Templates carry normalized text, count and first/last anchors. Check the truncation flags before treating a summary as complete. Older records can omit this field. Rule fallback uses generic and pinned-skill signals while retaining the degraded marker and confidence caps. See the [signal contract](../design-docs/api-contract.md#generic-signals) for field shapes and the internal agent tools; the tools do not add REST endpoints.

Optional `signalSummary.truncated` and `reason` describe incomplete extraction: `time_cap` retains completed results, `line_cap` limits matching to line prefixes, and `extraction_error` returns an empty summary while analysis continues. Check these fields alongside the count-cap flags before interpreting an empty summary as absence of anomalies.

### Fetch a file's line window

`GET /api/v1/logs/{logId}/lines?file=...&startLine=...&endLine=...` returns a window from one analyzed file. It accepts the creating integration credential, or a user with `logs:view` in the record's organization. Use the exact `path` from the record's `files` inventory for `file`; this is a bundle path, not an object-store key.

Both line bounds are required, positive, 1-based integers and inclusive. A request may contain at most 400 lines. The server clips `endLine` at the end of the file; a `startLine` beyond the file, reversed bounds, or a window over 400 lines returns `400 VALIDATION_FAILED`. A final newline does not add a line; actual blank lines remain addressable. An empty file returns `startLine: 1`, `endLine: 0`, `totalLines: 0` and `lines: []`. Older indexes rebuild lazily on access. A missing or skipped file returns `404 NOT_FOUND`.

```bash
LOG_ID='replace-with-log.id'
curl --fail-with-body "$WISEEFF_API/api/v1/logs/$LOG_ID" \
  -H "Authorization: Bearer $WISEEFF_INTEGRATION_CREDENTIAL"

curl --fail-with-body --get "$WISEEFF_API/api/v1/logs/$LOG_ID/lines" \
  -H "Authorization: Bearer $WISEEFF_INTEGRATION_CREDENTIAL" \
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

The reader uses the file's UTF-8 text object and line-offset index, including for UTF-16 uploads converted during intake. CRLF counts as one line break, and the final line remains addressable without a trailing newline. Each returned line is bounded to a 64 KiB prefix; longer lines end with a localized truncation marker. Consumers should preserve this marker when displaying or copying a truncated line.

The record's existing raw-log panel remains a preview: at most the first 400 lines per file, with a shared 128 KiB text budget per run. In `/logs`, clicking an evidence `file:line` chip or a signal/template anchor opens the shared file drawer, scrolls to and highlights its citation, and offers context loading above and below plus line copying. Use the line-window endpoint for locations beyond the preview rather than treating `rawLines` as the complete file.

The complete credential allowlist is the two upload POSTs and these two GETs (`/logs/{id}` and `/logs/{id}/lines`). The report and file inventory are embedded in `{ item }`; there is no separate credential report endpoint. Only records created by the same credential are readable. Lists, jobs/SSE, run history, traces, source browsing, recommendation, `/me` and administration require a user session.

## 7. Consume the result webhook

Before the first push, an administrator configures a skill's webhook in its workspace's Integration section: public HTTPS URL, write-only signing secret of at least 16 characters (set or rotate), and enabled flag. The same section offers a test delivery and recent delivery attempts. The old administration page links to this workspace. After an analysis for that skill reaches a terminal state (complete, including degraded, or failed), WiseEff POSTs a compact JSON summary. Raw log content and evidence text are **never** sent; fetch details through the API using `recordId`.

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
  "conclusionSummary": "<localized analysis conclusion>",
  "occurredAt": "2026-08-13T02:00:00.000Z",
  "productPath": "/logs?id=report-run-...&organizationId=org-..."
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

Keep the exact raw request bytes (a Buffer) before JSON middleware; re-serializing JSON changes the signature input. Pass Node's lowercase request headers and the configured signing secret. This standalone Node function needs no dependency:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWiseEffWebhook({ secret, rawBody, headers, toleranceSeconds = 300 }) {
  const header = headers["x-wiseeff-timestamp"];
  if (typeof header !== "string" || !/^\d+$/.test(header)) return false;
  const timestamp = Number(header);
  const signature = headers["x-wiseeff-signature"];
  if (typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false; // stale or missing timestamp — possible replay
  }
  const expected = "sha256=" + createHmac("sha256", secret)
    .update(header + ".").update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

### Receiver checklist

- Verify the signature and replay window before parsing the body.
- After verification, atomically deduplicate `eventId` (or `runId`), durably enqueue work and return `2xx` fast; retry-causing statuses (`5xx`, timeouts) consume the sender's bounded retries.
- Rotate the secret in `/log-admin` when needed; the API never echoes it (only configured-state and its last four characters).
- Local development: senders refuse plain HTTP and private/loopback addresses by default; a local receiver such as `http://127.0.0.1:9999` only works when the server runs with `LOG_WEBHOOK_ALLOW_INSECURE_LOCAL=true` (never in production).

## 8. Troubleshooting, rotation and revocation

| Symptom | Meaning and action |
| --- | --- |
| `400 VALIDATION_FAILED` | Invalid fields/Base64, conflicting selectors or invalid skill. Correct the request; do not retry unchanged. Package errors name the file/field. |
| `401 UNAUTHENTICATED` | Missing/malformed, unknown, rotated or revoked token, or a user-only route. Check Bearer formatting and the current secret on an allowlisted route. |
| `403 FORBIDDEN` | Binding/scope violation (bound → generic, a different skill, or related parameters), or insufficient user permission. Use the bound skill or ask an administrator for the intended scope. |
| `404 NOT_FOUND` | Inaccessible/unknown record, another creator's record, or missing/skipped file. Check the uploaded id, creating credential and exact file path. |
| `409` | Authoring conflict: stale draft/publication, an existing draft during restore, missing sample/draft for dry run, or duplicate import name. Reload and reconcile/save, supply a sample, or rename as indicated. This is not authentication failure; do not blindly retry stale edits. |
| `413 PAYLOAD_TOO_LARGE` | HTTP/JSON cap exceeded. Use multipart above 32 MiB decoded JSON, then split/reduce bundles to deployment caps. Archive validation can instead return `201` failed records. |
| `429` | Rate/admission capacity exhausted; back off. |
| Failed/degraded record or missing webhook | Inspect `failureReason`, `analysisSource`, `degradedReason` and Integration delivery attempts. Generic analysis has no selected skill's callback. Correct input/configuration and push again; credentials cannot rerun records. |

Upload retries may create duplicates: there is no server upload idempotency key. Persist returned record ids, reconcile ambiguous failures and back off for transient server errors.

In **Integration → Credentials**, inspect last-used time (updated at most once a minute). **Rotate** immediately invalidates the old secret and reveals the replacement once; coordinate updating callers. It keeps the credential identity, so the replacement can read earlier records. **Revoke** is irreversible and affects the next request; issuing another credential does not transfer old-record read scope. Archiving a skill revokes its bound credentials.

Rotate the webhook signing secret separately in its editor; blank keeps the existing secret. Pending deliveries use current webhook configuration. Keep raw secrets out of code, logs and screenshots.

Full schemas: [API contract](../design-docs/api-contract.md), [Authentication](authentication.md), [Errors](errors.md). These supplement the UI snippets and require no repository checkout.
