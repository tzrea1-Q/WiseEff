# Log Analysis LLM Runbook

> Chinese: [Chinese](../zh-CN/runbooks/log-analysis-llm.md)

Use this runbook when validating the log-analysis LLM path in staging or pilot. The kernel runs behind `LogAnalysisAdapter` inside the log worker (ADR-0022) on a separate `LOG_ANALYSIS_*` env family, with no LangGraph, no ToolRegistry, and no write path — the entire output is an advisory, evidence-grounded report. Since P2 the default kernel is a **bounded agent loop** (`LOG_ANALYSIS_KERNEL=loop`): a plain for-loop of at most `LOG_ANALYSIS_MAX_STEPS` model steps over five read-only tools (`search_log_lines`, `read_line_range`, `get_prefilter_findings`, `read_domain_knowledge`, `get_related_parameter_context`), running inside the `rootcause` stage and advancing its progress bar per step. The P1 single-shot kernel stays available as a config fallback (`LOG_ANALYSIS_KERNEL=single-shot`).

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

- The kernel has no write path: no device access, no parameter mutations, no ToolRegistry entry, no approval chain. The five loop tools are internal read-only worker functions, organization-scoped at the repository layer.
- Log content, retrieved domain knowledge, and parameter context are untrusted model input; the grounding check bounds fabricated citations and instructions embedded in them must not change the output contract. `read_domain_knowledge` only ever sees published knowledge entries (published-only invariant), restricted to the domain's linked entry set when links exist.
- Degraded analyses must never impersonate full analyses; provenance stays on the report row and in the UI.
- Prompt changes must bump `LOG_ANALYSIS_PROMPT_VERSION` (single-shot) or `LOG_ANALYSIS_LOOP_PROMPT_VERSION` (loop) and pass `npm run logs:eval` (behavior-layer eval, CI-gated); model or prompt changes should additionally run `npm run logs:eval:quality` before release.

## Skill diagnostic procedures

- In the skill workspace, authors edit and preview Markdown in the Diagnostic procedure section. `skill/v1.procedure` is optional and capped at 20,000 characters. Saving changes only the draft; publishing creates an immutable revision. The worker reads the procedure from the run's pinned `skill_revision_id`, so subsequent draft edits cannot change queued or explicitly revision-pinned reruns. New uploads use the current published revision.
- Prompt order is platform protocol → delimited, lower-priority skill procedure → user mission. The procedure is a JSON string inside `<skill_diagnostic_procedure>`; newlines and delimiter characters are escaped so closing tags or fake protocol headings remain data. The guidance explicitly cannot override grounding, refusal rules or the ban on writes. Evidence must come from tool results; the legacy single-shot kernel uses its platform-provided excerpt. The tool allowlist and existing evidence checks remain enforced independently of the text.
- Current versions: loop `2026-10-19.loop.procedure.1`, related-parameter loop `2026-10-19.loop.procedure.related-parameter.1`; single-shot `2026-10-19.procedure.1`, related-parameter single-shot `2026-10-19.procedure.related-parameter.1`. Reports retain the matching `prompt_version`. Without a procedure, the prompt changes only in its version label. Deterministic rule fallback ignores the procedure.
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
- Defaults fit the memory envelope of the stock self-hosted 512 MiB API / 384 MiB worker containers and retain the previous 100 MiB single-file cap. Raising limits requires more container memory until streaming intake (#1234) lands. The probe below measured 357 MiB peak RSS for a 95 MiB bundle in a standalone process.
- Triage starts with the upload dialog's rule reason, then the report's file inventory: binary/unsupported files show skip reasons and lossy text is marked. Evidence cites file and line. Stored objects are decoded UTF-8 per file; legacy records without `log_files` retain the single-object path.
- For an optional near-cap intake memory probe, run `npx tsx scripts/log-bundle-memory-probe.ts` separately from tests. It processes three log files totaling 95 MiB, runs intake plus per-file UTF-8 storage/copy into a throwaway sink, and prints process peak RSS and heap usage after storage; archive construction is included in the RSS high-water mark.
- The worker currently retains per-file parsed lines/entries for one analysis. Streaming line-offset indexes are deferred, so large bundles may have high peak memory.

## Worker decoding limits

- `LOG_DECODE_MAX_EVENTS` defaults to `50000` retained events across the run. Extra matches increment `decoded_event_counts.errors.event_cap`; analysis continues with retained events.
- `LOG_DECODE_MAX_MS` defaults to `15000` ms, is clamped to `20000`, and worker decoding uses at most one quarter of the remaining job lease. There is no lease renewal; the remaining budget covers compression, storage and analysis. Deadline checks precede every line/flush/compilation; scheduling yields after about 8 ms or 2000 checkpoints. Timeout preserves completed events, discards unfinished groups, records one `time_cap`, stores the partial artifact/counters, and continues analysis. Worker deadlines cannot preempt a single bounded RE2 operation.
- Parsing patterns are capped at 512 UTF-16 code units and counted repetition at 100, including multiline controls. Match input is at most 6144 code units per line and 16,384 per group; overlong lines/groups record `match_input_cap` without prefix matches. Preview has a fixed 100 ms validation/decoding watchdog, 5000 processed lines and 500 returned events; `truncated` and `reason` identify partial results. These limits are independent of worker environment settings. `query_events` returns at most 50 events/16 KiB, with 1 KiB field previews and `truncated: true` when shortened.
- Compression/upload failure increments `decoded_event_counts.errors.artifact_error`, stores a null artifact key and continues without decoded events. Cleanup of a partial content-addressed local/S3 object is best-effort; cleanup failure does not fail analysis.
- An older pinned revision outside the new pattern bounds records `decode_error` and continues without decoding; new saves/publications reject it with issue paths.
- Both variables accept positive safe integers; malformed, zero and negative values fall back to defaults. Defaults target the stock 384 MiB worker in `ops/self-hosted/compose.yaml`. Raising either limit requires reviewing memory and job-lease budgets, just as raising bundle limits requires more container memory. Parsed input and event objects still consume memory; this is not a hard heap limit.
- JSONL is written one event at a time through `createGzip()` with backpressure; only compressed chunks are collected for the object-store Buffer. The ordered event array preserves existing extractor/completion ordering and cursor offsets. The file/line evidence map references the same objects rather than copying fields or raw values; flattening that map would change query order when extractors revisit a line.
- The coordinator can run `npx tsx scripts/log-decode-memory-probe.ts` separately from tests. Three synthetic kernel files total 95 MiB with about 20% matching lines. The probe uses the worker decode/compress/index functions and explicit default caps; it prints elapsed ms, retained events/errors, process peak RSS, final and sampled peak heapUsed, and the longest stall from a 10 ms `setInterval` drift monitor. Elapsed/stall measurements exclude input construction, while process peak RSS includes it. It isolates decoding, not the entire parser/analyzer pipeline. No measurement is recorded yet for this change.

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
