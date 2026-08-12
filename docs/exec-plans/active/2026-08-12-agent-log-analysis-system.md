# Agent log analysis system

> Status: **Active (P1 implemented on `feat/log-analysis-p1-domains-and-llm`, in review; P2/P3 not started)**
> Date: 2026-08-12
> Planning branch: `plan/agent-log-analysis` (this document, glossary, ADR-0022)
> Implementation branches: `feat/log-analysis-p1-domains-and-llm`, `feat/log-analysis-p2-agent-loop-and-golden-set`, `feat/log-analysis-p3-eval-maturation` (one branch per phase; each checked out from the latest `main`)
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-12-agent-log-analysis-system.md`](../../zh-CN/exec-plans/active/2026-08-12-agent-log-analysis-system.md)
> Decision record: 25 questions settled in a grilling session on 2026-08-12; glossary terms registered in `CONTEXT.md`; stack decision recorded as [ADR-0022](../../adr/0022-log-analysis-agent-runs-outside-the-xiaoze-stack.md)

## Goal

Evolve the shipped M2 log-analysis pipeline in place: replace the 4-rule deterministic kernel behind the reserved `LogAnalysisAdapter` seam with an evidence-grounded **log analysis agent**, add organization-scoped **log domains** so multiple businesses can onboard with their own format profiles and domain knowledge, and build a two-layer evaluation system (behavior-layer eval in CI, quality-layer eval on a golden case set) that gates every prompt/model change. The upload → object store → job/run/stage → evidence → report → feedback pipeline, the four-stage vocabulary (`parse/pattern/rootcause/report`), and the existing output contract stay (one additive exception below).

## Context

- The pipeline (queue, lease, retry, dead letter, audit, evidence model, permissions) is real and production-shaped; only the analysis kernel is hardcoded rules with table-lookup confidence. `LogAnalysisAdapter` (`server/modules/logs/analyzer.ts`) was left as the injection seam by the M2 plan.
- The `rootcause` stage is currently an empty progress bar — the natural home for the agent loop. `LogRecord.analysisQuestion` exists end-to-end but never affects results today.
- Xiaoze is the sole conversational Agent and stays out of analysis (reads finished conclusions only). Stack separation is ADR-0022.
- The only existing AI eval harness is `xiaoze:eval` (deterministic fake model, pure-function assertions, CI exit-code gate, reports under `docs/generated/`). Its pattern is reused; log analysis itself has zero eval today (2 fixtures, binary feedback).

### Settled decisions (grilling 2026-08-12, Q1–Q25)

- **Positioning**: evolve in place behind `LogAnalysisAdapter`; no parallel system. The kernel is a multi-step autonomous loop, distinct from Xiaoze (terms: log analysis agent, `CONTEXT.md`).
- **Log domain**: org-scoped registration = format profile + domain knowledge + analysis emphasis. Registration governed in `/log-admin` (new permission `logs:admin-domains`); upload binds via optional selector/API field; missing domain falls back to the built-in uncategorized log domain (generic analysis, upload never blocked). Pilot domains: charging/power-subsystem kernel log + uncategorized; the second real domain is named by the product owner at P2 start (criterion: experts available for 20–50 annotations).
- **Intake**: MVP = existing `/logs` UI + existing REST API plus a `logDomainId` field. SDK / result callbacks deferred to P3.
- **Quality bar** (priority order): evidence grounding > correct root cause > no fabrication > answering `analysisQuestion` > actionable suggestions.
- **Output contract**: unchanged except one approved additive field set for analyzer provenance (`analysisSource` + degraded marker) so degraded analysis never impersonates full analysis.
- **Provider**: OpenAI-compatible endpoint via a separate `LOG_ANALYSIS_*` env family (global config; no per-domain model override until a real need appears). Evidence discipline: record model/latency/tokens/trace id; never raw prompts or provider payloads.
- **Compatibility**: MVP handles per-domain dialects through declarative format profiles (UTF-8 text, stable line numbers). Archive unpacking (`.gz`/`.zip`) is P3 backlog; binary and 100MB+ stay excluded.
- **Performance**: p95 ≤ 3 min for ≤ 10MB text logs; deterministic prefilter bounds what the model reads; per-analysis token budget; queue concurrency unchanged; tenant rate limiting stays out of scope.
- **Rule engine**: kept with exactly three roles — prefilter signal source, degradation fallback, eval baseline.
- **Evaluation**: build order = regression gate → benchmark → online monitoring, all sharing one golden case set (real logs + expert-confirmed root cause/evidence/actions; synthetic logs count only toward format coverage). Cold start: 20–50 expert-annotated cases per domain; inventory of any existing labelled data is the first P2 task. Two layers: behavior-layer eval (fake model, CI) and quality-layer eval (real model, on prompt/model change and pre-release, gated by previous baseline minus stated tolerance). Judgment: deterministic evidence-line overlap + rubric-guided LLM-as-judge with sampled human review; eval-only root-cause category enum (not in the product contract). Cases live de-identified in-repo; non-de-identifiable cases stay out.

## Non-goals

- Xiaoze performing log analysis, or any shared LangGraph/ToolRegistry/approval-chain wiring (ADR-0022).
- Any write path from the agent: no device access, no parameter mutations; output stays an advisory report.
- Binary logs, 100MB+ logs, chunked upload; archive unpacking before P3.
- Per-domain model overrides, tenant rate limiting, SDK/webhook intake before P3.
- Changing the four-stage vocabulary, the mock runtime's static log seeds, or the knowledge-base workflow (domain knowledge documents are the MVP source and migrate later).

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on the phase branch (`feat/log-analysis-p1-domains-and-llm`, then P2/P3 branches); do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

One phase → one branch → one PR. The planning branch `plan/agent-log-analysis` carries only docs (this plan, glossary, ADR-0022, index updates).

## Architecture

- **Domains**: new tables `log_domains` (org-scoped: name, status, format profile JSON) and `log_domain_knowledge_docs` (P2; admin-maintained markdown), next free migration numbers. `log_records.log_domain_id` nullable reference; `source` keeps meaning intake channel.
- **Parsing**: `parser.ts` gains format-profile awareness (timestamp shape, multi-line merge, severity mapping, structured-field hints) while preserving stable line numbers.
- **Prefilter**: extract the rule analyzer's matching into `prefilter.ts`; `pattern` stage output (candidate anomaly lines, error-code stats, rule hits) becomes prefilter findings handed to the kernel.
- **Kernel** (`server/modules/logs/analyzer/`): P1 `llmAnalyzer.ts` — single-shot budgeted call implementing `LogAnalysisAdapter`, structured output validated against the contract, every cited evidence line checked to exist (grounding check), `analysisQuestion` injected. P2 `agentLoop.ts` — plain bounded loop (max steps + token budget, deterministic fake-model seam) with five read-only tools in `analyzer/tools/`: `search_log_lines`, `read_line_range`, `get_prefilter_findings`, `read_domain_knowledge`, `get_related_parameter_context`. Versioned prompt constant (`LOG_ANALYSIS_PROMPT_VERSION`).
- **Degradation chain**: provider failure → existing job retry/backoff → rule-analyzer fallback (`analysisSource: "rules-fallback"`); token-budget exhaustion → early convergence with lowered confidence and degraded marker. Both surfaced as degraded analysis in UI; dead letter only when even the fallback fails.
- **Config**: `LOG_ANALYSIS_API_BASE_URL`, `LOG_ANALYSIS_MODEL`, `LOG_ANALYSIS_API_KEY`, `LOG_ANALYSIS_API_TIMEOUT_MS`, `LOG_ANALYSIS_TOKEN_BUDGET`, `LOG_ANALYSIS_MAX_STEPS`, `LOG_ANALYSIS_DETERMINISTIC` in `server/config/env.ts` + `.env.example`; readiness/metrics wired like the Xiaoze LLM gate (`/health/ready` dependency, worker metrics extended with token/latency/degradation counters).
- **Frontend** (surgical, inside existing components): upload dialog domain selector; conclusion card + admin drawer degraded/provenance badge; `pollJobUntilTerminal` grows adaptive backoff (1s→2s→5s) with an elapsed-time cap aligned to the SLO instead of 60 fixed 1s attempts.
- **Eval assets**: `server/modules/logs/eval/` (behavior scenarios, assertions, quality runner, judge, scoring), golden cases under `eval-cases/logs/<domain>/<case-id>/` (`log.txt` + `case.yaml`: domain, de-identification attestation, eval-only root-cause category, root-cause points, key evidence lines, expected actions, optional expected-refusal, optional analysisQuestion), annotation + de-identification guide in `eval-cases/logs/README.md`, baseline scores in `eval-cases/logs/baseline.json`, npm scripts `logs:eval` (behavior, CI) and `logs:eval:quality` (real model), reports to `docs/generated/log-analysis-eval.{json,md}` and `docs/generated/log-analysis-quality.{json,md}`.

## Phase P1 — log domains + LLM single-shot analysis + honest degradation + behavior eval

1. Migration + repository/service/routes for `log_domains`; `logDomainId` on upload/rerun APIs and DTOs; uncategorized fallback semantics; permission `logs:admin-domains`; audit events for domain governance.
2. Format-profile-aware parsing applied in `parse` stage; profile editor (declarative JSON) in `/log-admin` domain governance section.
3. `llmAnalyzer.ts` behind `LogAnalysisAdapter`: prefilter → budgeted excerpt → structured conclusion; grounding check rejects/repairs citations of nonexistent lines; `analysisQuestion` injected; prompt versioned.
4. Degradation chain + additive contract fields (`analysisSource`, degraded reason) through DB/DTO/frontend badge.
5. Env family, `/health/ready` dependency, metrics counters, runbook evidence discipline.
6. Frontend: domain selector in upload dialog, degraded badge, adaptive polling cap.
7. Behavior-layer eval harness + `logs:eval` in CI (fake model): grounding (no conclusion without an existing cited line), honest degradation marking, budget respected, only legal tools (P1: no tools — single-shot scenario set), prompt version recorded, meta self-check that a scripted hallucinating model fails the harness.

**P1 acceptance**: uploading a charging log in API mode produces an LLM conclusion with valid line-grounded evidence; killing the provider mid-run yields a rules-fallback report visibly marked degraded, never a silent success; `logs:eval` green in CI; `npm run build`, targeted vitest suites, and `npm run docs:check` green; playwright-cli checks on `/logs` and `/log-admin` at 1440x900 / 768x1024 / 390x844 with snapshot + screenshot + console-error review.

## Phase P2 — agent loop + tools + domain knowledge + golden set v1 + quality eval

1. First task: inventory any existing labelled logs/conclusions with domain experts; feed findings into golden set scoping.
2. `agentLoop.ts` bounded loop replaces single-shot as the default `LogAnalysisAdapter` (single-shot stays as a config fallback); loop progress mapped onto the `rootcause` stage progress range; five read-only tools with org-scoped repository queries.
3. `log_domain_knowledge_docs` + admin editing + `read_domain_knowledge` retrieval into the loop.
4. Golden case set v1: 20–50 de-identified charging-domain cases + uncategorized-domain cases; annotation guide; second real domain named by product owner before annotation starts.
5. Quality-layer eval: real-model runner over golden cases; deterministic evidence-line overlap scoring; rubric + LLM-as-judge for root-cause correctness with sampled human review; rule-analyzer baseline comparison; `baseline.json` + gate rule (root-cause accuracy within 2pp, evidence overlap within 5pp of baseline — tolerances stated in the report and tunable).
6. Behavior-layer scenarios extended to the loop: tool-call legality, in-budget convergence, refusal honesty on insufficient evidence.

**P2 acceptance**: agent loop beats the rule baseline on golden set v1 (report artifact committed); `logs:eval` green in CI; `logs:eval:quality` produces gated reports; behavior + quality reports land under `docs/generated/`.

## Phase P3 — eval maturation + intake expansion

1. Judge calibration workflow (sampled human review recorded alongside quality reports); gate automation for release checklists.
2. Online monitoring: `log_feedback` (helpful rate per domain/prompt version) aggregated into `/log-admin` insights.
3. `/log-admin` "promote a live case + human correction into an annotation draft" tooling.
4. Intake expansion: SDK/result-callback design, archive (`.gz`/`.zip`) unpacking, per-domain model override only if a real need has appeared.

## Security & privacy

- The kernel is read-only; org scoping enforced in repository queries; no ToolRegistry/approval chain (ADR-0022); TD-068 does not apply (no write path).
- Log content and domain knowledge documents are untrusted model input: tools stay read-only, output stays advisory and evidence-grounded, the grounding check bounds fabricated citations, and knowledge docs are admin-authored only.
- Provider evidence discipline per `docs/runbooks/agent-provider.md` pattern: model, request id, trace id, latency/tokens/cost, degradation state; never API keys, raw prompts, or raw provider payloads.
- Golden cases must pass the de-identification checklist before entering git; non-de-identifiable cases stay out of the repo set.
- `docs/SECURITY.md` gains a log-analysis LLM section in the same change that ships P1.

## Verification

- Per phase: targeted vitest (`server/modules/logs/**`, touched frontend suites), `npm run test:server` for logs module, `npm run build`, `npm run docs:check`.
- Behavior eval: `npm run logs:eval` (CI-gated from P1). Quality eval: `npm run logs:eval:quality` (P2+, on prompt/model change and pre-release).
- Frontend-visible phases: playwright-cli on `/logs` and `/log-admin`, viewports 1440x900 / 768x1024 / 390x844, snapshot + screenshot + console error + upload/rerun interactions, evidence under `work/ui-checks/`.

## UI interaction automation review

- Existing coverage: `LOG-HAPPY-001` (P0) and `LOG-REANALYZE-001` (P1) in `e2e/acceptance/log-analysis.acceptance.spec.ts` (requirement `LOG-HAPPY-001` in `docs/developer/browser-acceptance-coverage-map.md`).
- P1 changes visible interaction (domain selector, degraded badge), so before implementation the phase adds requirement/operation IDs `LOG-DOMAIN-001` (register domain in `/log-admin`, upload bound to a domain) and `LOG-DEGRADED-001` (degraded analysis visibly marked) to `docs/developer/browser-acceptance-coverage-map.md` and `docs/developer/user-operation-coverage-matrix.md`, and extends `e2e/acceptance/log-analysis.acceptance.spec.ts`; operation evidence stays generated through `npm run acceptance:browser` / `npm run acceptance:evidence`.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Update | `ARCHITECTURE.md` (analysis kernel + eval), `AGENTS.md` Current Product Shape (log analysis wording) |
| Planning | Update | This plan + zh companion; `docs/PLANS.md` + `docs/zh-CN/PLANS.md`; `docs/exec-plans/tech-debt-tracker.md` for any deferral |
| Domain / ADR | Update | `CONTEXT.md` (terms landed 2026-08-12; ADR index), `docs/adr/README.md` + `docs/adr/0022-log-analysis-agent-runs-outside-the-xiaoze-stack.md` (landed), `docs/design-docs/domain-model.md` + `docs/zh-CN/design-docs/domain-model.md` (log domain entities, degradation states) at P1 |
| Product specs | Update | `docs/product-specs/product-spec.md` (log analysis workflow); Review `docs/product-specs/mvp-scope.md`, `docs/product-specs/prototype-functional-spec.md` |
| Architecture | Update | `docs/design-docs/full-stack-architecture.md` (worker LLM path, degradation chain) |
| API / generated | Update | `docs/design-docs/api-contract.md` (+ zh companion), `docs/generated/openapi.json`, `docs/generated/db-schema.md` after migrations |
| Frontend | Update | `docs/FRONTEND.md` + `docs/zh-CN/FRONTEND.md` (domain selector, degraded badge, polling) |
| Security | Update | `docs/SECURITY.md` + zh companion (log-analysis LLM section, prompt-injection stance, evidence discipline) |
| Reliability / runbooks | Update | New `docs/runbooks/log-analysis-llm.md` (+ zh companion per bilingual inventory), `docs/runbooks/README.md`; Review `docs/RELIABILITY.md` (degradation + SLO) |
| Quality / testing | Update | `docs/design-docs/testing-strategy.md` (two eval layers), `docs/developer/verification-matrix.md` (`logs:eval`, `logs:eval:quality`), `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`; Review `docs/QUALITY_SCORE.md` |
| Developer | Update | `docs/developer/environment-variables.md` (+ zh companion), `.env.example` (`LOG_ANALYSIS_*`) |
| Generated eval artifacts | Update | `docs/generated/log-analysis-eval.{json,md}`, `docs/generated/log-analysis-quality.{json,md}` (new) |
| References | Review | `docs/references/productization-api-contract-draft.md` — expected unchanged with evidence |

## Documentation Update Gate

- [x] P1 PR updates: domain-model EN+zh, api-contract + OpenAPI, FRONTEND EN+zh, SECURITY EN+zh, environment-variables EN+zh + `.env.example`, runbook (`docs/runbooks/log-analysis-llm.md` EN+zh), ARCHITECTURE, product-spec EN+zh, acceptance coverage map + operation matrix (LOG-DOMAIN-001 / LOG-DEGRADED-001, EN+zh), db-schema regenerated via `npm run db:schema-doc` (migration `0103_log_domains.sql`) — all done on `feat/log-analysis-p1-domains-and-llm`
- [ ] P2 PR updates: testing-strategy (eval layers), verification-matrix (eval commands), QUALITY_SCORE review, eval reports + baseline committed
- [ ] P3 PR updates: runbook monitoring section, RELIABILITY review, tech-debt entries for anything deferred
- [ ] Every phase: `npm run docs:check` green before its PR merges; plan moves to `completed/` only after all rows above are Update-done or Review-recorded with evidence

## Risks

- **Expert annotation bandwidth** is the biggest external dependency (golden set v1 and judge calibration both need it); mitigated by the P2 inventory task and the admin annotation-draft tooling in P3.
- **Provider cost/limits**: bounded by prefilter + token budget; metrics expose per-analysis tokens from P1.
- **Eval variance**: quality layer runs a pinned model/temperature and reports tolerances; behavior layer stays deterministic.
- **Prompt injection via log content**: mitigated structurally (read-only tools, advisory output, grounding check); stated in SECURITY.md at P1.
