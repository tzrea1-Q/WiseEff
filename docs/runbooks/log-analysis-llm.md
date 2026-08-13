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

- Per-domain config lives in `/log-admin` domain governance → result-webhook editor (URL, write-only secret, enabled); sender tuning is `LOG_WEBHOOK_TIMEOUT_MS` / `LOG_WEBHOOK_MAX_ATTEMPTS` / `LOG_WEBHOOK_RETRY_BASE_DELAY_MS`. The channel is best-effort: it never blocks, fails, or delays an analysis and deliberately stays out of `/health/ready`.
- Triage a "consumer got nothing": open the domain's recent-deliveries list (or `GET /api/v1/log-domains/:domainId/webhook-deliveries`) — per-attempt rows show delivered/retrying/failed with HTTP status or error. `webhook-url-private-address` errors mean the URL is SSRF-blocked (see `docs/SECURITY.md`); uncategorized logs never fire webhooks; disabled/missing config is silently skipped by design.
- Use the audited test-delivery button to probe the receiver through the exact production path. Metrics: `wiseeff_log_webhook_deliveries_total{domain,outcome}` and `wiseeff_log_webhook_delivery_duration_ms_*` — a climbing `failed`/`blocked` outcome for one domain is a receiver or config problem, not an analysis problem.
- Receiver-side verification (signature, replay window) is specified in `docs/api/log-analysis-integration.md`.

## Online Feedback Monitoring (P3)

- The `/log-admin` analysis-quality section reads `GET /api/v1/logs/feedback-insights` (`logs:view`): helpful rate per log domain × analysis source × prompt version over today/7d/30d. It watches live feedback drift between quality-eval runs; the golden case set stays the quality anchor.
- Operational reading: a helpful-rate drop scoped to one `promptVersion` points at a prompt/model regression (compare against the previous version's rows and re-run `logs:eval:quality`); a drop scoped to one domain with stable prompt version points at domain knowledge / format-profile gaps; rows with `analysisSource = rules-fallback` climbing means the degradation chain is firing — check provider health first (`/health/ready`, degradation counters).
- Sparse feedback makes rates noisy; treat cells with a single-digit `totalCount` as anecdotes, not signals.

## Archive Intake (P3)

- Uploads may be `.gz` (single file, inner name keeps a supported text extension) or `.zip` (exactly one non-directory entry, stored/deflate, no encryption). Unpacking happens at intake; the object store always holds plain UTF-8 text, so reruns never re-unpack.
- Zip-bomb bounds (constants in `server/modules/logs/unpack.ts`, documented in the API contract): unpacked size ≤ 100 MB absolute and ≤ 200× the compressed upload (1 MB floor). Oversized or corrupt archives become `failed` records with a readable `failureReason` and no analysis job — they never reach the worker or the retry loop.
- Triage: a user reporting a "failed" compressed upload should read the record's failure reason first; multi-entry zips are the most common cause (macOS Finder compression adds `__MACOSX` metadata entries — re-zip only the single log file, or gzip it).

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
