# Log Analysis LLM Runbook

> Chinese: [Chinese](../zh-CN/runbooks/log-analysis-llm.md)

Use this runbook when validating the log-analysis LLM path in staging or pilot. The kernel runs behind `LogAnalysisAdapter` inside the log worker (ADR-0022) on a separate `LOG_ANALYSIS_*` env family, with no LangGraph, no ToolRegistry, and no write path — the entire output is an advisory, evidence-grounded report. The default kernel is a **bounded agent loop** (`LOG_ANALYSIS_KERNEL=loop`): a plain for-loop of at most `LOG_ANALYSIS_MAX_STEPS` model steps over read-only tools composed per run, running inside the `rootcause` stage and advancing its progress bar per step. File, signal, template, timeline, knowledge and parameter-context tools are platform capabilities; decoded-event tools require extractors. The P1 single-shot kernel stays available as a config fallback (`LOG_ANALYSIS_KERNEL=single-shot`).

## Required Configuration

- `LOG_ANALYSIS_API_BASE_URL`
- `LOG_ANALYSIS_MODEL`
- `LOG_ANALYSIS_API_KEY`
- `LOG_ANALYSIS_API_TIMEOUT_MS`
- `LOG_ANALYSIS_TOKEN_BUDGET` (loop mode: cumulative tokens across steps)
- `LOG_ANALYSIS_KERNEL` (`loop` default / `single-shot` fallback)
- `LOG_ANALYSIS_MAX_STEPS` (loop bound, default 6)

For acceptance or offline drills without a live model, set `LOG_ANALYSIS_DETERMINISTIC=true` instead of filling `LOG_ANALYSIS_API_*`; reports then record `model = deterministic`. The deterministic stub speaks both kernels' protocols.

An unconfigured, non-deterministic deployment behaves like a dead provider: every analysis retries and then completes as an honestly marked rules-fallback report, and `/health/ready` reports `logAnalysisLlm` as missing. That state is visible, not broken — but production should either configure a real provider or make the degradation decision explicit.

## Readiness Check

1. Start the API (and the worker service when `LOG_WORKER_ENABLED=false` on the API container) with the log-analysis LLM configuration.
2. Check `/health/ready` and confirm `dependencies.logAnalysisLlm` reports `ready` with safe details (`baseUrlConfigured`, optional `model`) — never keys or raw payloads.
3. Check `/metrics` from the private operations network: `wiseeff_log_analysis_llm_ready` reflects the dependency, and after traffic `wiseeff_log_analysis_llm_calls_total`, `wiseeff_log_analysis_llm_latency_ms_*`, `wiseeff_log_analysis_llm_tokens_total`, and `wiseeff_log_analysis_degraded_total` carry model/outcome/reason labels only.
4. Upload a small text log in API mode and confirm the report completes with `analysisSource = "agent"`, grounded evidence line numbers, and a recorded `prompt_version`.

## Degradation Chain

- Transient provider failure → the job retries with the existing backoff (`LOG_ANALYSIS_QUEUE_ATTEMPTS` / `LOG_ANALYSIS_QUEUE_BACKOFF_MS`).
- Retry-exhausting final attempt → deterministic rule-engine fallback, `analysis_source = 'rules-fallback'`, `degraded_reason = 'provider-unavailable'`, job completes normally (no dead letter).
- Budgeted output that cannot be grounded (invalid JSON, or every cited line rejected by the grounding check) → immediate fallback with `degraded_reason = 'token-budget-exhausted'`.
- Loop kernel additionally: steps or token budget exhausted before a grounded final → ONE early-convergence attempt; a grounded convergence returns `analysis_source = 'agent'` with `degraded_reason = 'token-budget-exhausted'` and confidence capped at 0.5; anything less lands on the rule fallback with the same reason. Repeated protocol violations (illegal tool names/arguments, non-JSON output — 3 consecutive) degrade the same way instead of burning budget.
- Only a failing fallback continues into the existing job failure/dead-letter path.

Verify the degraded path visibly: kill or misconfigure the provider, upload a log, and confirm the record completes with the prominent degraded rules-fallback badge in `/logs` and `/log-admin` instead of a silent success. In deterministic mode the same chain can be exercised by uploading a log containing the marker line `WISEEFF_SIMULATE_LLM_PROVIDER_DOWN`.

## Safety Expectations

- The kernel has no write path: no device access, no parameter mutations, no ToolRegistry entry, no approval chain. Loop tools are internal read-only worker functions, organization-scoped at the repository layer.
- Log content, retrieved domain knowledge, and parameter context are untrusted model input; the grounding check bounds fabricated citations and instructions embedded in them must not change the output contract. `read_domain_knowledge` only ever sees published knowledge entries (published-only invariant), restricted to the domain's linked entry set when links exist.
- Degraded analyses must never impersonate full analyses; provenance stays on the report row and in the UI.
- Prompt changes must bump `LOG_ANALYSIS_PROMPT_VERSION` (single-shot) or `LOG_ANALYSIS_LOOP_PROMPT_VERSION` (loop) and pass `npm run logs:eval` (behavior-layer eval, CI-gated); model or prompt changes should additionally run `npm run logs:eval:quality` before release.

## Generic signals and tools

Every analysis extracts platform signals, including uploads without a skill: crash signatures (kernel panic, Oops, `BUG:`, watchdog, ANR, `FATAL EXCEPTION`, segfault and assert), timestamp gaps of at least 60 seconds, boot/reset markers, at least five errors within ten seconds, and the first error in each file. Templates normalize changing numbers, hexadecimal values, identifiers and paths and retain count plus first/last anchors. Patterns use `compileLogPattern` (RE2); extraction retains at most 200 signals across both sources, 200 templates, five anchors per signal and 400 characters per evidence line. Truncation is explicit. The pinned skill's signal hits join this bounded summary; an unskilled signal summary contains generic signals only.

Skill/domain findings drive the conclusion, confidence and root-cause evidence; generic signals remain supplementary and cannot raise a skill finding's confidence. For compatibility, uploads without a pinned skill retain the legacy charging prefilter, so the charging fixture still concludes thermal foldback. With no matching domain findings, generic signals drive the rule conclusion. An explicitly pinned skill without signal rules stays empty and never inherits charging rules. Deterministic models retain their established priority and confidence, selecting the strongest finding across files and grounding citations to that file.

The burst threshold remains five error lines in a rolling ten-second window per file: this surfaces repeated failures while isolated errors remain visible as first-error signals. A parsed error severity or a standalone, case-insensitive `ERROR`, `ERR` or `FATAL` word qualifies; a formal level field is unnecessary, so `usb 1-1: error -71 while reading descriptor` qualifies. Kernel `[seconds.fraction]` prefixes (optionally preceded by a numeric `<priority>`) supply boot-relative time for per-file bursts, gaps and resets without a skill. Clock changes clear the burst window; boot-relative and absolute clocks are never compared or combined across files. These prefixes do not establish absolute time for the cross-file timeline tool. Crash rows are grouped by file and matched signature, exposed as optional `signature` with stable `kind: crash`; the report localizes kind labels and generic titles while retaining technical signature names.

Templates retain the first 200 distinct normalized kinds encountered and rank that retained set by count. Counts and first/last anchors continue updating for retained kinds, in file scan order. After the cap, a later distinct kind is omitted even if it becomes frequent; this is not an exact heavy-hitter ranking across all input. Check `truncatedTemplates` and inspect raw logs when broader coverage matters.

`LOG_SIGNAL_MAX_MS` defaults to `5000` ms and is clamped to `10000`; only positive safe integers are accepted, and malformed, zero, negative or unsafe values use the default. Pattern matching and template normalization scan at most the first 6144 UTF-16 code units of each line. Extraction checks its deadline before every line and yields after about 8 ms or 64 checkpoints. A timeout retains completed results with `truncated: true, reason: "time_cap"`; a shortened line prefix marks `line_cap`. Extraction errors produce an empty summary marked `extraction_error` and analysis continues. These optional fields persist in the existing report JSON and drive the Signals-tab notice; count caps still use `truncatedSignals` and `truncatedTemplates`.

Run `npx tsx scripts/log-signals-memory-probe.ts` for the pathological extraction check: 1600 materialized numeric-token lines total about 100 MiB, preceded by one crash line. With an explicit 250 ms budget, the script asserts completion within 1250 ms, an event-loop yield, retained crash evidence and `time_cap`; it prints elapsed time and process peak RSS. Input construction is excluded from elapsed time and included in peak RSS. This checks extraction alone, not the entire worker pipeline.

The worker renews its default 60-second lease every lease/3 throughout preprocessing, decoding, signals and analysis. The compare-and-set renewal requires a processing job, the matching owner and an unexpired lease against PostgreSQL `clock_timestamp()`; failure stops work. `LOG_ANALYSIS_JOB_MAX_MS` defaults to `600000` ms and bounds total wall time from the claimed attempt, including persistence; renewal never resets it.

Signals and decoding share a fixed `LOG_ANALYSIS_PREPROCESS_MAX_MS` allowance, default `20000` ms, starting when signal extraction begins and capped by remaining attempt wall time. Signal extraction time reduces the decoding allowance; renewals never refill it. `LOG_SIGNAL_MAX_MS` and `LOG_DECODE_MAX_MS` still cap each phase separately. Both new settings require positive integers at most `2147483647`; central environment validation rejects invalid values, while standalone worker calls use defaults for invalid values. A bounded RE2 call cannot be preempted midway, so the line-prefix limit also bounds each pattern operation.

The run report stores `signal_summary` after migration `0192_log_signal_summary.sql`; record detail exposes optional `signalSummary`. Reruns keep their own summaries. In `/logs`, inspect the Signals tab, check source/kind/severity/count and template first/last anchors, and click a `file:line` chip to locate available raw lines. Existing report content remains beside it.

- `get_signals` returns generic and pinned-skill signals, optionally filtered by `kind` or `severity`, with `offset` and a 1–20 `limit`.
- `get_line_templates` pages templates by `offset` and a 1–20 `limit`, with occurrence counts and first/last anchors.
- `get_timeline` accepts exactly one ISO `time` or `file` + positive `line` anchor; `before` and `after` each range from 0 to 20. The returned cross-file window is timestamp-ordered.

All three tools are always available and output-capped. Only anchors/lines actually returned count as seen, exactly as with `read_line_range`; omitted pages or neighboring lines do not. Rule fallback combines generic signals with the pinned revision's rules and retains the existing degraded marker and confidence caps. Run `npm run logs:eval` to regenerate the committed behavioral artifacts and exercise legal calls, tool-only grounding and unseen-line rejection. The PostgreSQL run-level integration uploads a multi-file bundle without a skill and checks the stored crash, gap/restart, burst and grounded report.

## Skill diagnostic procedures

- In the skill workspace, authors edit and preview Markdown in the Diagnostic procedure section. `skill/v1.procedure` is optional and capped at 20,000 characters. Saving changes only the draft; publishing creates an immutable revision. The worker reads the procedure from the run's pinned `skill_revision_id`, so subsequent draft edits cannot change queued or explicitly revision-pinned reruns. New uploads use the current published revision.
- Prompt order is platform protocol → delimited, lower-priority skill procedure → user mission. The procedure is a JSON string inside `<skill_diagnostic_procedure>`; newlines and delimiter characters are escaped so closing tags or fake protocol headings remain data. The guidance explicitly cannot override grounding, refusal rules or the ban on writes. Evidence must come from tool results; the legacy single-shot kernel uses its platform-provided excerpt. The tool allowlist and existing evidence checks remain enforced independently of the text.
- Current versions: loop `2026-10-19.loop.procedure.signals.1`, related-parameter loop `2026-10-19.loop.procedure.signals.related-parameter.1`; single-shot `2026-10-19.procedure.signals.1`, related-parameter single-shot `2026-10-19.procedure.signals.related-parameter.1`. Reports retain the matching `prompt_version`. Without a procedure, the procedure section is omitted; platform signal tools remain available. Deterministic rule fallback ignores the procedure.
- Run `npm run logs:eval` for prompt order, hostile procedure, delimiter injection, grounding and illegal write-tool scenarios. The PostgreSQL run-level test is `server/modules/logs/procedure.integration.test.ts`; it captures scripted-model prompts and verifies publication, draft isolation and explicitly pinned reruns. These checks do not establish live-provider resistance to all prompt injection.

## Quality Eval (`logs:eval:quality`)

- Deterministic demo (zero API cost): `LOG_ANALYSIS_DETERMINISTIC=true npm run logs:eval:quality` — runs the golden case set with the deterministic kernel and the deterministic rubric judge.
- Real-model run: configure `LOG_ANALYSIS_API_*` (and optionally `LOG_ANALYSIS_JUDGE_*` for the LLM-as-judge) and run `npm run logs:eval:quality`.
- Reports land in `docs/generated/log-analysis-quality.{json,md}` with kernel, model, prompt version, and judge label. The baseline gate (`eval-cases/logs/baseline.json`) compares realLog-case scores against the committed baseline minus stated tolerances; while the set has no real cases the report states `quality baseline pending real cases` and the gate stays inactive.

## Judge Calibration (P3b)

- Every quality run deterministically samples judged cases (id-hash, rate `LOG_ANALYSIS_JUDGE_SAMPLE_RATE`, default 0.2, minimum 1) into the human review checklist `docs/generated/log-analysis-judge-sample.md`. The checklist shows the agent conclusion, the judge's scores and reasoning, and a ready-to-fill YAML template.
- Human reviewers commit the completed template as `eval-cases/logs/reviews/<run-id>.yaml` (`runId`, `reviewer`, `reviewedAt`, per-case `humanRootCauseScore` 0..1 + optional `humanCategoryMatch`/`notes`). Broken review files fail the quality run — they must be fixed, never silently dropped.
- With reviews present, the report's fixed "Judge calibration" section computes judge-human agreement: exact agreement rate (identical scores), mean absolute difference, and category agreement. Without reviews it honestly says "no human reviews yet". A drifting judge (rising mean difference) means judge prompts/rubric need retuning before its scores gate anything.

## Quality Gate Workflow (release checklist)

- Before a release that touched prompts, models, kernels, or golden cases: manually trigger the **Log analysis quality gate** GitHub Actions workflow (`workflow_dispatch` on `log-analysis-quality-gate.yml`); it also runs weekly as a drift watch. CI runs deterministic mode (no provider key); the workflow comments document the secrets switch to the real model.
- Reading the artifact (`log-analysis-quality-report`): check `Baseline gate` first — `inactive-pending-real-cases` is expected until the expert-annotated real cases land, `failed` blocks the release (real-case quality fell below baseline minus tolerance). Then check `Judge calibration` for the sample and agreement status, and `Problems` for loader/review-file errors. A green run with `pending` markers is honest, not a pass on quality — synthetic cases only cover format coverage.

## Result Webhooks (P3b)

- Per-domain config lives in `/log-admin` domain governance → result-webhook editor (URL, write-only secret, enabled); sender tuning is `LOG_WEBHOOK_TIMEOUT_MS` / `LOG_WEBHOOK_MAX_ATTEMPTS` / `LOG_WEBHOOK_RETRY_BASE_DELAY_MS`. Terminal transactions persist an outbox drained by the log worker in both polling and Redis modes. HTTP failures do not affect analyses; enqueue failures roll back the terminal transaction. Expired leases recover abandoned sends; receivers dedupe on stable `eventId`, and exhausted retries remain `failed`. The channel stays out of `/health/ready`.
- Before upgrading, give API and log workers the same `LOG_WEBHOOK_SECRET_ENCRYPTION_KEY` (`openssl rand -base64 32`), retain it across restarts, and back it up separately. Apply migration `0185` first; startup idempotently encrypts existing plaintext rows. Configured production webhooks refuse startup without the key; only development/test may use the deterministic default. The migration also grants outbox DML to existing roles with INSERT on `log_domains`, excluding the owner and PUBLIC; runtime LOGINs need no re-provisioning. Backfill only processes `webhook_secret_encrypted=false` rows, including plaintext beginning with `logwh:`; envelope writes set the flag true. Marked ciphertext is not decrypted at startup. A key-id mismatch or integrity failure immediately fails that domain's attempt with a clear delivery-history error while other domains and startup continue.
- Rotation: stop all API and log workers and back up the database and old key. Run the offline call below with the old key in `LOG_WEBHOOK_SECRET_ENCRYPTION_KEY` and the new key in temporary environment variable `LOG_WEBHOOK_SECRET_ENCRYPTION_KEY_NEXT`; it re-encrypts in one transaction and writes the new key fingerprint. After success, configure every process with the new key and restart. Retain the old key for older backups; changing only the environment variable cannot rotate stored ciphertext. Offline rotation only re-encrypts marked rows whose key id/version differs; an incorrect old key rolls back the rotation transaction.

```bash
node --import tsx --input-type=module <<'JS'
import { createPostgresDatabase } from './server/shared/database/client.ts';
import { ensureLogWebhookSecretsEncrypted } from './server/modules/logs/webhookSecrets.ts';
import { resolveLogWebhookSecretKey } from './server/config/logWebhookSecretKey.ts';
const db = createPostgresDatabase(process.env.DATABASE_URL);
try {
  await ensureLogWebhookSecretsEncrypted(db, {
    previousKey: resolveLogWebhookSecretKey(),
    key: resolveLogWebhookSecretKey({
      NODE_ENV: 'production',
      LOG_WEBHOOK_SECRET_ENCRYPTION_KEY: process.env.LOG_WEBHOOK_SECRET_ENCRYPTION_KEY_NEXT
    })
  });
} finally { await db.close(); }
JS
```

- Triage a "consumer got nothing": open the domain's recent-deliveries list (or `GET /api/v1/log-domains/:domainId/webhook-deliveries`) — per-attempt rows show delivered/retrying/failed with HTTP status or error. `webhook-url-private-address` errors mean the URL is SSRF-blocked (see `docs/SECURITY.md`); uncategorized logs never fire webhooks; disabled/missing config is silently skipped by design.
- Use the audited test-delivery button to probe the receiver through the exact production path. Metrics: `wiseeff_log_webhook_deliveries_total{domain,outcome}` and `wiseeff_log_webhook_delivery_duration_ms_*` — a climbing `failed`/`blocked` outcome for one domain is a receiver or config problem, not an analysis problem.
- Receiver-side verification (signature, replay window) is specified in `docs/api/log-analysis-integration.md`.

## Online Feedback Monitoring (P3)

- The `/log-admin` analysis-quality section reads `GET /api/v1/logs/feedback-insights` (`logs:view`): helpful rate per log domain × analysis source × prompt version over today/7d/30d. It watches live feedback drift between quality-eval runs; the golden case set stays the quality anchor.
- Operational reading: a helpful-rate drop scoped to one `promptVersion` points at a prompt/model regression (compare against the previous version's rows and re-run `logs:eval:quality`); a drop scoped to one domain with stable prompt version points at domain knowledge / format-profile gaps; rows with `analysisSource = rules-fallback` climbing means the degradation chain is firing — check provider health first (`/health/ready`, degradation counters).
- Sparse feedback makes rates noisy; treat cells with a single-digit `totalCount` as anecdotes, not signals.

## Archive Intake (P3)

- Accept multiple plain files or one `.tar/.tar.gz/.tgz/.zip/.gz` archive, expanding at most one nested archive level. All safety validation precedes object-store writes. Rejection returns a failed record (`201`, `failureReason`, `inline/` pseudo key), no object-store write or job, and a `log-upload-failed` audit with `{ fileName, failureReason }`. Bundle/archive reasons are Chinese; unsupported single plain files preserve the English format message. Unexpected archive exceptions use a generic integrity reason. A bundle without analyzable files retains skipped inventory and a failed record without a job.
- Defaults are 100 MiB uploaded, 100 MiB total original file bytes, 2000 files and 100 MiB per file, configured by `LOG_BUNDLE_MAX_COMPRESSED_BYTES`, `LOG_BUNDLE_MAX_UNPACKED_BYTES`, `LOG_BUNDLE_MAX_FILES`, and `LOG_BUNDLE_MAX_FILE_BYTES`. Each inflate retains the 200x ratio / 1 MiB floor and stops at the output bound. Plain files also obey the upload bound. Intermediate tar data (including headers/padding) fits the remaining-total bound.
- Keep these defaults for the stock 512 MiB API / 384 MiB worker containers. The worker now streams, but archive intake still buffers compressed and inflated bytes. Do not raise unpacked/per-file defaults to 512/200 MiB without separately measuring that API path. The byte limits apply to both original files and their normalized UTF-8 text, preventing lossy/UTF-16 expansion from bypassing the storage budget. Encoding validation and conversion use bounded chunks.
- Triage starts with the upload dialog's rule reason, then the report's file inventory: binary/unsupported files show skip reasons and lossy text is marked. Evidence cites file and line. Stored objects are decoded UTF-8 per file; legacy records without `log_files` retain the single-object path.
- JSON/base64 uploads have an additional 32 MiB decoded-upload ceiling; use multipart for larger uploads. Transport collection is bounded before parsing. Base64 validation checks alphabet/padding without a complete decode/re-encode copy. Multipart file buffers share the bounded request buffer. An oversized JSON body returns `413`; it does not create a record.
- Migration `0194` allows a per-file sparse line index: one UTF-8 byte offset every 256 lines. Indexes load or build only on the first tool/viewer range read; full-file prefiltering needs no index. Historical single-object records receive an organization-scoped file inventory lazily. Local and S3 range streams preserve CRLF, Unicode and actual blank lines; a final separator does not add a line. Older index objects rebuild lazily without re-uploading the text. Worker tools, decoding and signals use these readers; completed entries are released. Reader chunks check preprocessing deadlines, including unfinished multiline entries. Legacy offline adapters without streaming retain their small-input path.
- Reports keep a raw preview of at most 400 lines and 128 KiB from only the first analyzed file, for the existing raw panel. Other file previews are not loaded up front; full content remains available through the viewer. Individual displayed lines and profile-merged entries stop at 64 KiB with a truncation marker. Prefiltering prefetches at most eight GET streams and consumes them in file order, preserving the run-shared 32,768-reference, 8,192-code and 2 MiB code/metadata budget; codes have a 256-character preview. Counts still cover all scanned entries; capped prefilter tool output reports `truncated`.

Run the probes separately from tests, with an explicit disposable PostgreSQL `DATABASE_URL`:

```bash
npx tsx scripts/log-bundle-memory-probe.ts --mode=worker --profile=spec
npx tsx scripts/log-bundle-memory-probe.ts --mode=worker --profile=configured
npx tsx scripts/log-bundle-memory-probe.ts --mode=api-multipart --profile=configured
npx tsx scripts/log-bundle-memory-probe.ts --mode=api-json --profile=configured
npx tsx scripts/log-bundle-memory-probe.ts --mode=api-multipart --profile=configured --chunked=true
```

Generation and upload clients run in separate subprocesses. Worker measurements include actual PostgreSQL job processing, any requested text indexing, preprocessing, report persistence and a pinned decoder. The `spec` worker profile directly seeds stored text (512 MiB, 2,000 files, one 200 MiB file); it does not establish acceptance for a 512 MiB API intake. API modes exercise HTTP collection, validation, intake and local object storage. `--profile=smoke` uses 2 MiB; `--mode=intake` retains the older 95 MiB construction-inclusive intake-only probe.

Historical measurements on the macOS host on 2026-10-19, before lazy indexing and lease heartbeats:

| Path | Input | Elapsed | Peak RSS |
| --- | --- | --- | --- |
| Worker, spec profile | 512 MiB / 2,000 files / largest 200 MiB | 55,720.41 ms | 171.64 MiB |
| API multipart | 100 MiB tar upload | 8,550.36 ms | 290.28 MiB |
| API JSON after applying its ceiling | 32 MiB tar upload | 6,577.96 ms | 394.08 MiB |
| API multipart, chunked transport | 100 MiB tar upload | 6,010.87 ms | 364.08 MiB |

That worker implementation completed and persisted all 2,000 indexes. Signals were partial and decoding recorded `time_cap` with zero events under its previous shared lease budget; these are historical results, not measurements of the current lazy-index/heartbeat path. Bounded chunked collection switches to one upload buffer after 8 MiB, avoiding a complete second copy at concatenation. These measurements establish bounded streaming on this synthetic workload, not complete decoding of every cap-sized input or production/container acceptance. A 100 MiB JSON upload previously measured 1,106.41 MiB; removing redundant copies reduced it to 669.84 MiB, still above the API limit. This is why the JSON ceiling remains lower and the bundle defaults are unchanged.

The current PostgreSQL slow-store integration test completed a 2,000-file bundle in **16,801 ms**, with 20 ms added to every object-store GET, 2,197 total GET calls and peak read concurrency eight. With a 3,000 ms lease and 60,000 ms attempt bound, the report reached `complete` on attempt one. This measures lease survival and bounded I/O; RSS was not remeasured.

## Worker decoding limits

- `LOG_DECODE_MAX_EVENTS` defaults to `50000` retained events across the run. Extra matches increment `decoded_event_counts.errors.event_cap`; analysis continues with retained events.
- `LOG_DECODE_MAX_MS` defaults to `15000` ms and is clamped to `20000`; decoding also obeys the fixed shared `LOG_ANALYSIS_PREPROCESS_MAX_MS` allowance remaining after signals and remaining attempt wall time. Lease renewal does not refill either allowance. Decode deadline checks precede every line/flush/compilation; scheduling yields after about 8 ms or 2000 checkpoints. Timeout preserves completed events, discards unfinished groups, records one `time_cap`, stores the partial artifact/counters, and continues analysis. Worker deadlines cannot preempt a single bounded RE2 operation.
- Parsing patterns are capped at 512 UTF-16 code units and counted repetition at 100, including multiline controls. Match input is at most 6144 code units per line and 16,384 per group; overlong lines/groups record `match_input_cap` without prefix matches. Preview has a fixed 100 ms validation/decoding watchdog, 5000 processed lines and 500 returned events; `truncated` and `reason` identify partial results. These limits are independent of worker environment settings. `query_events` returns at most 50 events/16 KiB, with 1 KiB field previews and `truncated: true` when shortened.
- Compression/upload failure increments `decoded_event_counts.errors.artifact_error`, stores a null artifact key and continues without decoded events. Cleanup of a partial content-addressed local/S3 object is best-effort; cleanup failure does not fail analysis.
- An older pinned revision outside the new pattern bounds records `decode_error` and continues without decoding; new saves/publications reject it with issue paths.
- Both decode variables accept positive safe integers; malformed, zero and negative values fall back to defaults. Defaults target the stock 384 MiB worker in `ops/self-hosted/compose.yaml`. Raising either limit requires reviewing memory and total attempt time. Parsed input is streamed; capped event objects still consume memory. This is not a hard heap limit.
- JSONL is written one event at a time through `createGzip()` with backpressure; only compressed chunks are collected for the object-store Buffer. The ordered event array preserves existing extractor/completion ordering and cursor offsets. The file/line evidence map references the same objects rather than copying fields or raw values; flattening that map would change query order when extractors revisit a line.
- The coordinator can run `npx tsx scripts/log-decode-memory-probe.ts` separately from tests. Three synthetic kernel files total 95 MiB with about 20% matching lines. The probe uses the worker decode/compress/index functions and explicit default caps; it prints elapsed ms, retained events/errors, process peak RSS, final and sampled peak heapUsed, and the longest stall from a 10 ms `setInterval` drift monitor. Elapsed/stall measurements exclude input construction, while process peak RSS includes it. It isolates decoding, not the entire parser/analyzer pipeline. No measurement is recorded yet for this change.

## Source Snapshots (#1243)

Skipped-file cells show a total and compact reason breakdown; the View control opens a paginated path/reason dialog. If the bounded list is truncated, the breakdown explicitly covers only listed paths. Directory entries and macOS metadata (`._*`, `__MACOSX/`, `.DS_Store`) are silently excluded from the inventory, progress and skipped-file counts. Archive-entry, path/type validation and cumulative inflate safety budgets still apply to these entries.

Skill administrators upload one `.tar.gz`, `.tgz` or `.zip` archive with a required version label in the workspace's source section. Labels are unique within the skill among non-archived snapshots. Uploads enter `queued`; the indexer moves them through `indexing` to `ready` or `failed`, with an error reason. `filesProcessed / filesTotal` reports progress; tar archives use a streaming validation/count pass before indexing to establish a stable total. The table polls only while any snapshot is queued or indexing and shows up to 200 skipped paths with reasons plus the complete skipped count. `logs:view` users can read metadata; upload, default selection and archive require `logs:admin-domains` and audited writes.

The source indexer starts alongside the log worker: keep `LOG_WORKER_ENABLED=false` on the API when the dedicated `npm run worker:logs` process owns the work. It reclaims indexing attempts whose last progress update is older than five minutes. Attempt tokens prevent an old attempt from overwriting an archived or reclaimed snapshot. A failed snapshot retains its reason; upload a replacement after archiving it if the label must be reused.

Defaults are compressed upload 100 MiB (`LOG_SOURCE_MAX_COMPRESSED_BYTES=104857600`), cumulative unpacked bytes 1 GiB (`LOG_SOURCE_MAX_UNPACKED_BYTES=1073741824`), per file 2 MiB (`LOG_SOURCE_MAX_FILE_BYTES=2097152`) and 20,000 files (`LOG_SOURCE_MAX_FILES=20000`). Values must be positive safe integers. Skipped files still consume the unpacked/file-count budgets. There is also a twice-file-count archive-entry ceiling. Uploads use multipart `{ versionLabel, file }` only, avoiding base64 copies within the stock 512 MiB API budget. The route body limit is the compressed cap plus 64 KiB framing overhead; excessive `Content-Length` is rejected before buffering, and streamed request bytes remain bounded. File bytes share the bounded request buffer. Streaming object-store reads, temporary archive storage and one-file processing avoid retaining the archive or tree in indexer memory; budget temporary disk for one compressed archive per active attempt.

The allowlist includes `.c`, `.h`, `.cc`, `.cpp`, `.cxx`, `.hpp`, `.hh`, `.hxx`, `.S`, `.s`, `.java`, `.kt`, `.kts`, `.py`, `.go`, `.rs`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.sh`, `.bash`, `.zsh`, `.mk`, `.cmake`, `.dts`, `.dtsi`, `.json`, `.yaml`, `.yml`, `.toml`, `.gradle`, `.xml`, `.properties`, `.cfg`, `.conf`, `.ini`, `.proto`, `.sql`, `.rb`, `.swift`, `.m` and `.mm`. Recognized build names are Makefile, GNUmakefile, CMakeLists.txt, Kconfig and Kconfig.*, Dockerfile, meson, meson.build, meson_options.txt, BUILD, BUILD.bazel and WORKSPACE. Extension/name matching is case-insensitive except the assembly spelling is preserved in the allowlist.

Skip reasons distinguish unsupported types, oversized files, binary/non-UTF-8 content and ignored directories. Ignored directory segments are `third_party`, `third-party`, `thirdparty`, `vendor`, `vendors`, `node_modules`, `external`, `.git`, `.svn`, `.hg`, `__pycache__`, `.venv` and `venv`, matched case-insensitively. Reject traversal, absolute/overlong paths, duplicate paths, links/devices/special files, invalid archives, encrypted/unsupported ZIP members, ZIP64 and overlapping ZIP ranges. Inflation counts actual bytes, including skipped members, against the cumulative cap; ZIP members must match declared size and CRC. Accepted files store path, size, SHA-256, line count and language, plus chunks capped at 200 lines or 32 KiB characters with PostgreSQL full-text and trigram GIN indexes.

Setting a default updates or creates the skill draft's optional `defaultSourceSnapshotId`; publish the draft to affect new runs. An archived snapshot cannot be newly selected as a default. Existing archived references may remain unchanged through save, publication and restore, preserving historical specs. Each run resolves its pinned revision's default and records the observed snapshot id/status. Queued, indexing, failed and archived defaults do not fail analysis: the persisted report explains source unavailability in Chinese. This slice adds no source tools, public content routes or source text in provider prompts. Source statement indexing, retrieval tools, evidence and upload `sourceVersion` matching remain #1244/#1245.

Run `npx tsx scripts/log-source-memory-probe.ts` separately from tests. The default probe streams a 1 GiB tar.gz snapshot of 512 files at the 2 MiB cap, exercises extraction and UTF-8 chunk serialization without retaining prior files, reports peak RSS/heap, and asserts peak RSS below the stock 384 MiB worker limit. Run `npx tsx scripts/log-source-memory-probe.ts --upload` separately to stream a 100 MiB multipart request through the shared HTTP parser and assert RSS below the stock 512 MiB API limit. These probes do not include PostgreSQL persistence or a full production API process; record observed RSS with the run's evidence.

## Evidence

Record:

- model label,
- prompt version,
- request/trace id,
- latency and token counts,
- degradation reason when applicable,
- analysis source (`agent` / `rules-fallback`).

Do not commit API keys, raw prompts, raw provider payloads, Authorization headers, or raw customer log content to repository docs.

## Smoke Commands

```bash
npm run logs:eval
npm run logs:eval:quality
npm run acceptance:e2e -- e2e/acceptance/log-analysis.acceptance.spec.ts
```

The behavior-layer eval report lands in `docs/generated/log-analysis-eval.{json,md}` and the quality-layer report in `docs/generated/log-analysis-quality.{json,md}`; acceptance IDs `LOG-DOMAIN-001`, `LOG-DEGRADED-001`, and `LOG-DOMAIN-KNOWLEDGE-001` cover domain governance, visible degradation, and knowledge-entry links, and the P3a IDs `LOG-FEEDBACK-INSIGHTS-001`, `LOG-EVAL-DRAFT-001`, and `LOG-ARCHIVE-UPLOAD-001` cover the feedback-quality dashboard, the annotation-draft export, and compressed uploads.
