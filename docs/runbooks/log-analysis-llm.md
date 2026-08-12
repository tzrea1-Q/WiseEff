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

The behavior-layer eval report lands in `docs/generated/log-analysis-eval.{json,md}` and the quality-layer report in `docs/generated/log-analysis-quality.{json,md}`; acceptance IDs `LOG-DOMAIN-001`, `LOG-DEGRADED-001`, and `LOG-DOMAIN-KNOWLEDGE-001` cover domain governance, visible degradation, and knowledge-entry links.
