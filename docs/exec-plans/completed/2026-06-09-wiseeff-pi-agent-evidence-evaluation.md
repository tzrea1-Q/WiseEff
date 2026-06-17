# WiseEff Pi Agent Evidence And Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Code changes must follow test-first execution: write or update the focused test, confirm it fails for the intended reason, implement the smallest change, then verify green.

**Goal:** Turn the first-round Pi-backed Agent provider adapter into a measurable pilot-ready provider path with safe metadata, offline evaluation, optional live smoke evidence, and operations documentation.

**Architecture:** WiseEff keeps the current backend Agent provider seam, tool registry, approval state machine, audit model, and frontend AgentGateway contract. This round adds evidence and evaluation around the already-selected `@earendil-works/pi-ai` path: safe provider metadata flows through health/readiness and traces, deterministic eval fixtures validate adapter behavior without a network call, and an optional smoke script proves live Pi provider readiness without customer data or tool execution.

**Tech Stack:** TypeScript, Node.js >= 22.19.0, WiseEff modular backend, `@earendil-works/pi-ai`, Vitest, Playwright M4 Agent smoke, Prometheus text metrics, repository documentation governance.

---

## Reference Basis

- [earendil-works/pi README](https://github.com/earendil-works/pi): Pi monorepo identifies `@earendil-works/pi-ai` as the unified multi-provider LLM API, `@earendil-works/pi-agent-core` as the agent runtime, and `@earendil-works/pi-coding-agent` as the CLI. It also states Pi does not provide a built-in filesystem/process/network/credential permission system, so WiseEff must keep its own runtime boundary.
- [@earendil-works/pi-ai npm package](https://www.npmjs.com/package/@earendil-works/pi-ai): current dependency used by WiseEff first-round adapter. The installed first-round package is pinned to `0.79.0` and requires Node `>=22.19.0`.
- Existing WiseEff first-round plan: `docs/exec-plans/completed/2026-06-09-wiseeff-pi-agent-provider-adapter.md`.

## Scope

In scope:

- Add safe Agent provider metadata that can distinguish `provider=live` from `format=pi`, `piProvider`, `model`, and `promptVersion` without leaking API keys, prompts, customer data, or raw provider payloads.
- Surface safe metadata in `/health/ready`, `/api/v1/operations/pilot-readiness`, and `/metrics` where the existing contracts allow it.
- Persist safe provider evidence in Agent run traces so pilot evidence can tie a user-visible Agent turn to provider format, Pi provider id, model, prompt version, usage, cost, safety, fallback, request id, session id, and trace id.
- Add a deterministic offline eval harness for the Pi adapter using injected fake Pi completions.
- Add an optional live Pi smoke script that validates configured Pi provider health and one no-tool completion using non-customer prompts.
- Update runbooks, reliability, quality/testing, security, and Chinese developer docs for the evidence workflow.
- Keep existing deterministic, WiseEff HTTP, and OpenAI-compatible live provider behavior green.

Out of scope:

- No `@earendil-works/pi-agent-core` runtime adoption in WiseEff.
- No `@earendil-works/pi-coding-agent` CLI, RPC, filesystem tools, shell tools, browser tools, `.pi` project packages, or Pi trust flow in the product runtime.
- No frontend streaming UI, message schema redesign, or user-visible Agent UX change.
- No direct device writes or direct parameter writes from Pi output.
- No customer-data live benchmark corpus.
- No committing generated live provider transcripts or secrets.

## Approach Decision

Recommended and selected approach: evidence-first hardening around the first-round `@earendil-works/pi-ai` adapter.

Rejected alternatives:

- Adopt `pi-agent-core` now. This would duplicate WiseEff's orchestrator, approval, audit, and tool registry responsibilities before the product has provider evidence. It also increases permission-boundary risk because Pi itself does not supply the process/filesystem/network sandbox WiseEff needs.
- Build frontend streaming now. Streaming improves perceived responsiveness, but it changes browser-visible behavior and acceptance coverage. It should wait until the provider path has measurable correctness and pilot evidence.

## Current Baseline

The first round already added:

- `AGENT_API_FORMAT=pi`
- `AGENT_PI_PROVIDER`
- `server/modules/agent/piProvider.ts`
- `server/modules/agent/piProvider.test.ts`
- provider registry wiring through `createAgentProviderFromEnv`
- docs and self-hosted Node runtime-floor updates

Known baseline verification from the first round:

- Focused server gate passed.
- `npm run docs:check` passed.
- `npm run build` passed with the existing Vite chunk-size warning.
- `npm run test:m4` could not complete in this local workspace only because no local PostgreSQL `DATABASE_URL` was available for Playwright beforeAll.

## File Structure

Create:

- `server/modules/agent/providerEvidence.ts`: shared safe metadata and evidence types/helpers for Agent providers.
- `server/modules/agent/providerEvidence.test.ts`: unit tests for metadata redaction, defaults, and label safety.
- `server/modules/agent/piProvider.eval.test.ts`: offline golden eval cases for Pi adapter output mapping and rejection behavior.
- `scripts/run-pi-agent-smoke.ts`: optional live Pi provider smoke runner.
- `scripts/run-pi-agent-smoke.test.ts`: smoke runner tests using injected fake provider/HTTP-free execution.
- `docs/references/pi-agent-provider-evidence.md`: compact reference for future agents working on Pi provider evidence.

Modify:

- `package.json`: add `agent:pi-smoke` and, if useful, `agent:pi-eval` scripts.
- `server/modules/agent/provider.ts`: extend provider metadata with optional safe evidence fields while preserving existing `provider: "deterministic" | "live"`.
- `server/modules/agent/piProvider.ts`: return safe Pi metadata and avoid exposing API keys or raw prompts.
- `server/modules/agent/piProvider.test.ts`: add focused metadata and evidence assertions.
- `server/modules/agent/providerRegistry.ts`: pass metadata fields consistently when creating Pi provider.
- `server/modules/agent/providerRegistry.test.ts`: confirm Pi metadata is present and legacy formats remain stable.
- `server/modules/agent/orchestrator.ts`: persist safe provider evidence in run-trace metadata or structured trace fields.
- `server/modules/agent/orchestrator.test.ts`: assert Pi-like evidence is persisted with request/session/trace linkage and no side effects on rejected approvals.
- `server/modules/operations/health.ts`: include safe dependency metadata when available.
- `server/modules/operations/health.test.ts`: cover health metadata and secret redaction.
- `server/modules/operations/routes.ts`: include safe Agent provider metadata in pilot-readiness gate messages/details.
- `server/modules/operations/routes.test.ts`: cover Pi readiness evidence and deterministic blocking behavior.
- `server/observability/metrics.ts`: add low-cardinality provider labels for Agent readiness/call metrics where safe.
- `server/observability/metrics.test.ts`: cover safe labels and cardinality.
- `server/app.ts`: pass metadata to metrics rendering if metrics helpers need structured provider labels.
- `server/app.test.ts`: cover `/metrics` Pi labels without model-id cardinality explosion.
- `scripts/check-doc-governance.ts`: update required docs only if new reference files become required entry points.
- `docs/PLANS.md`: register this active plan.
- `docs/runbooks/agent-provider.md`: add eval/smoke/evidence steps.
- `docs/runbooks/m5-commercial-pilot-readiness.md`: add Pi evidence checklist.
- `docs/runbooks/monitoring-alerting.md`: add Agent provider metadata and alert interpretation.
- `docs/runbooks/observability-operations.md`: add Pi provider triage steps.
- `docs/developer/verification-matrix.md`: add second-round Pi eval and smoke gates.
- `docs/design-docs/testing-strategy.md`: document offline eval and optional live smoke distinction.
- `docs/QUALITY_SCORE.md`: add evidence/eval quality expectations.
- `docs/RELIABILITY.md`: document readiness and smoke behavior.
- `docs/SECURITY.md`: document metadata redaction and preserved approval boundary.
- `docs/security/secrets-management.md`: ensure Pi API keys and smoke logs are covered.
- `docs/design-docs/full-stack-architecture.md`: update provider evidence seam wording.
- `docs/design-docs/security-governance.md`: update advisory-output boundary if evidence fields change.
- `docs/zh-CN/backend-runtime.md`: Chinese runtime note for Pi provider evidence and smoke.
- `docs/zh-CN/security-reliability.md`: Chinese safety/reliability note for Pi evidence and unchanged approval boundary.

## Data Model Decision

Prefer no database migration in this round. Existing `agent_run_traces` already stores provider, model, prompt version, trace id, latency, tokens, cost, safety, and fallback fields. Use those existing fields first.

If implementation proves `piProvider` or `providerFormat` must be queryable later, record that as technical debt instead of migrating immediately. For this round, store extra safe details in logs/metrics/readiness messages or in existing JSON metadata only if such a JSON field already exists. Do not add a migration just to support a future dashboard.

## Implementation Tasks

### Task 1: Define Safe Provider Evidence Contract

**Files:**

- Create: `server/modules/agent/providerEvidence.ts`
- Create: `server/modules/agent/providerEvidence.test.ts`
- Modify: `server/modules/agent/provider.ts`

- [x] Write failing tests for evidence redaction.

Test cases:

```ts
expect(
  sanitizeAgentProviderEvidence({
    provider: "live",
    format: "pi",
    piProvider: "minimax",
    model: "abab6.5s-chat",
    promptVersion: "m7-pi-agent-v1",
    apiKey: "secret",
    rawPrompt: "customer prompt"
  } as never)
).toEqual({
  provider: "live",
  format: "pi",
  piProvider: "minimax",
  model: "abab6.5s-chat",
  promptVersion: "m7-pi-agent-v1"
});
```

Expected failure: `sanitizeAgentProviderEvidence` does not exist.

- [x] Implement minimal evidence types.

Use this contract:

```ts
export type AgentProviderFormat = "deterministic" | "wiseeff" | "openai" | "pi";

export type AgentProviderEvidence = {
  provider: "deterministic" | "live";
  format: AgentProviderFormat;
  model: string;
  promptVersion: string;
  piProvider?: string;
};
```

- [x] Add optional evidence to provider metadata without changing existing required fields.

Target shape:

```ts
export type AgentProviderMetadata = {
  provider: "deterministic" | "live";
  model: string;
  promptVersion: string;
  evidence?: AgentProviderEvidence;
};
```

- [x] Run `npm run test:server -- server/modules/agent/providerEvidence.test.ts`.

Expected result: evidence helper tests pass, and no API key, bearer token, raw prompt, or customer data can survive sanitization.

### Task 2: Attach Pi Metadata At The Provider Boundary

**Files:**

- Modify: `server/modules/agent/piProvider.ts`
- Modify: `server/modules/agent/piProvider.test.ts`
- Modify: `server/modules/agent/providerRegistry.ts`
- Modify: `server/modules/agent/providerRegistry.test.ts`

- [x] Add failing Pi provider metadata tests.

Assertions:

```ts
expect(provider.metadata()).toMatchObject({
  provider: "live",
  model: "model-a",
  promptVersion: "m7-pi-agent-v1",
  evidence: {
    provider: "live",
    format: "pi",
    piProvider: "minimax",
    model: "model-a",
    promptVersion: "m7-pi-agent-v1"
  }
});
```

- [x] Update `createPiAgentProvider()` metadata to return the safe evidence object.
- [x] Update registry tests to confirm:
  - `AGENT_API_FORMAT=pi` yields `format: "pi"` and the configured `AGENT_PI_PROVIDER`.
  - `AGENT_API_FORMAT=openai` yields `format: "openai"` if evidence is added for legacy live providers.
  - default WiseEff HTTP live provider yields `format: "wiseeff"` if evidence is added there.
  - deterministic provider metadata remains provider-compatible.
- [x] Run:

```bash
npm run test:server -- server/modules/agent/piProvider.test.ts server/modules/agent/providerRegistry.test.ts server/modules/agent/providerEvidence.test.ts
```

Expected result: Pi has safe format/provider-id metadata, and legacy provider tests remain green.

### Task 3: Persist Evidence In Agent Traces Without Schema Churn

**Files:**

- Modify: `server/modules/agent/orchestrator.ts`
- Modify: `server/modules/agent/orchestrator.test.ts`
- Review: `server/modules/agent/repository.ts`
- Review: `server/shared/database/migrations/*agent*`

- [x] Write failing orchestrator test with a Pi-like provider.

Provider fixture:

```ts
const piLikeProvider = {
  metadata: () => ({
    provider: "live" as const,
    model: "model-a",
    promptVersion: "m7-pi-agent-v1",
    evidence: {
      provider: "live" as const,
      format: "pi" as const,
      piProvider: "minimax",
      model: "model-a",
      promptVersion: "m7-pi-agent-v1"
    }
  }),
  checkHealth: async () => ({ ok: true as const, status: "ready" as const }),
  planTurn: async () => ({
    assistantDraft: { content: "Ready.", citations: [], confidence: 0.8 },
    toolRequests: [],
    provider: "live" as const,
    model: "model-a",
    promptVersion: "m7-pi-agent-v1",
    usage: { inputTokens: 10, outputTokens: 4, estimatedCostUsd: 0.001 },
    safety: { status: "safe" as const, reasons: [] },
    latencyMs: 42
  })
};
```

Assertions:

- trace row has `provider="live"`, `model="model-a"`, `prompt_version="m7-pi-agent-v1"`, `trace_id=<requestId>`.
- trace row has token/cost/latency/safety fields.
- no trace row contains `apiKey`, raw prompt, or raw provider payload.

- [x] If no existing trace JSON field can hold `format` and `piProvider`, do not add a DB migration in this task. Instead, rely on metadata in readiness/metrics and add a tech-debt row for queryable trace dimensions.
- [x] Run:

```bash
npm run test:server -- server/modules/agent/orchestrator.test.ts
```

Expected result: existing trace evidence is reliably populated for Pi-like provider turns without schema churn.

### Task 4: Enrich Health And Pilot Readiness With Safe Metadata

**Files:**

- Modify: `server/modules/operations/health.ts`
- Modify: `server/modules/operations/health.test.ts`
- Modify: `server/modules/operations/routes.ts`
- Modify: `server/modules/operations/routes.test.ts`

- [x] Extend `DependencyHealth` with optional safe `details`.

Target type:

```ts
export type DependencyHealth = {
  ok: boolean;
  status: "ready" | "missing" | "failed";
  message?: string;
  details?: Record<string, string | number | boolean>;
};
```

- [x] Write failing health test that a Pi-like provider returns:

```json
{
  "dependencies": {
    "agentProvider": {
      "ok": true,
      "status": "ready",
      "details": {
        "provider": "live",
        "format": "pi",
        "piProvider": "minimax",
        "model": "model-a",
        "promptVersion": "m7-pi-agent-v1"
      }
    }
  }
}
```

- [x] Implement health metadata by reading `agentProvider.metadata().evidence`.
- [x] Write failing pilot-readiness test that a live Pi provider gate includes the same safe details.
- [x] Ensure deterministic mode remains blocked for pilot readiness.
- [x] Ensure failed health still returns safe details when metadata is available.
- [x] Run:

```bash
npm run test:server -- server/modules/operations/health.test.ts server/modules/operations/routes.test.ts
```

Expected result: `/health/ready` and `/api/v1/operations/pilot-readiness` expose enough Pi evidence for operators without leaking credentials or prompt bodies.

### Task 5: Add Low-Cardinality Metrics For Provider Evidence

**Files:**

- Modify: `server/observability/metrics.ts`
- Modify: `server/observability/metrics.test.ts`
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`

- [x] Write failing metrics test for low-cardinality labels.

Preferred metric behavior:

```text
wiseeff_agent_provider_ready{provider="live",format="pi",piProvider="minimax"} 1
```

Do not put arbitrary model IDs into Prometheus labels unless the project already accepts that cardinality. Keep `model` and `promptVersion` in readiness/details and traces instead.

- [x] Update `setDependencyHealth()` or add `setAgentProviderHealth()` so Agent provider readiness can include safe labels.
- [x] Update `/metrics` rendering to pass provider evidence when an Agent provider exists.
- [x] Keep existing unlabeled `wiseeff_agent_provider_ready 1` compatibility if current dashboards/alerts require it, or update dashboards/alerts in the same task if changing the metric shape.
- [x] Run:

```bash
npm run test:server -- server/observability/metrics.test.ts server/app.test.ts
```

Expected result: metrics can distinguish Pi provider readiness without unbounded labels or secrets.

### Task 6: Add Offline Pi Adapter Eval Harness

**Files:**

- Create: `server/modules/agent/piProvider.eval.test.ts`
- Modify: `package.json`
- Review: `server/modules/agent/piProvider.ts`

- [x] Create golden eval fixtures directly in the test file for now. Do not create a large corpus until cases stabilize.

Initial cases:

| Case | Fake Pi Output | Expected WiseEff Result |
| --- | --- | --- |
| `plain_text_guidance` | one text block | assistant content, no tools, safe status |
| `read_tool_with_project` | `parameter.summarizeReviewQueue` tool call | one non-approval tool request with normalized project id |
| `mutating_tool_grounded` | citations block plus `parameter.submitChangeDraft` | one approval-required tool request with normalized payload |
| `unknown_tool_rejected` | `filesystem.read` tool call | throws unknown tool error |
| `malformed_args_rejected` | missing `reason` for `parameter.submitChangeDraft` | throws invalid arguments |
| `ungrounded_write_rejected` | write-adjacent tool call without citations | throws validation error |
| `usage_mapping` | usage fields populated | `inputTokens`, `outputTokens`, `estimatedCostUsd` mapped |
| `outage_wrapped` | fake completion throws | `LiveAgentProviderOutageError` |

- [x] Add helper `createFakePiAssistant()` inside the test file with explicit usage defaults.
- [x] Add `agent:pi-eval` script:

```json
"agent:pi-eval": "vitest run --config vitest.server.config.ts server/modules/agent/piProvider.eval.test.ts"
```

- [x] Run:

```bash
npm run agent:pi-eval
```

Expected result: offline eval gives repeatable evidence for adapter mapping without a real provider key or network access.

### Task 7: Add Optional Live Pi Smoke Script

**Files:**

- Create: `scripts/run-pi-agent-smoke.ts`
- Create: `scripts/run-pi-agent-smoke.test.ts`
- Modify: `package.json`
- Modify: `.env.example` only if the script needs an additional optional env var.

- [x] Write tests for smoke env validation and redaction.

Required env for live smoke:

```text
AGENT_PROVIDER=live
AGENT_API_FORMAT=pi
AGENT_PI_PROVIDER=<provider id>
AGENT_MODEL=<model id>
AGENT_API_KEY=<secret>
AGENT_API_TIMEOUT_MS=30000
AGENT_PROMPT_VERSION=m7-pi-agent-v1
```

Test cases:

- missing Pi provider config fails with actionable message.
- deterministic mode is rejected unless `--allow-deterministic` is passed for local no-op doc runs.
- output redacts `AGENT_API_KEY`.
- fake provider success prints a compact JSON evidence object.

- [x] Implement script using `createAgentProviderFromEnv()` with current environment loading.
- [x] Script must perform:
  - provider metadata check,
  - `checkHealth()`,
  - one no-tool `planTurn()` with a synthetic non-customer context and message: `"Reply with a one sentence readiness confirmation. Do not call tools."`
- [x] Script output should include:

```json
{
  "ok": true,
  "format": "pi",
  "piProvider": "minimax",
  "model": "<model>",
  "promptVersion": "m7-pi-agent-v1",
  "healthStatus": "ready",
  "latencyMs": 123,
  "usage": { "inputTokens": 1, "outputTokens": 1, "estimatedCostUsd": 0.001 },
  "toolRequests": 0
}
```

- [x] Add script:

```json
"agent:pi-smoke": "tsx scripts/run-pi-agent-smoke.ts"
```

- [x] Run fake/script tests:

```bash
npm test -- scripts/run-pi-agent-smoke.test.ts
```

- [x] Do not run the live smoke unless `AGENT_API_KEY`, `AGENT_PI_PROVIDER`, and `AGENT_MODEL` are intentionally configured in the local environment.

Expected result: operators have an explicit command for live Pi readiness evidence, but CI remains offline and deterministic.

### Task 8: Update Agent Provider Runbooks And Evidence Workflow

**Files:**

- Modify: `docs/runbooks/agent-provider.md`
- Modify: `docs/runbooks/m5-commercial-pilot-readiness.md`
- Modify: `docs/runbooks/monitoring-alerting.md`
- Modify: `docs/runbooks/observability-operations.md`
- Create: `docs/references/pi-agent-provider-evidence.md`

- [x] Add a Pi evidence collection sequence:

```bash
npm run agent:pi-eval
npm run agent:pi-smoke
npm run smoke:m5
```

- [x] State that `agent:pi-smoke` is optional and live-key dependent; `agent:pi-eval` is the CI-safe offline gate.
- [x] Add evidence checklist:
  - command and timestamp,
  - provider format,
  - Pi provider id,
  - model,
  - prompt version,
  - health status,
  - request id/session id/trace id for API smoke,
  - token/cost fields if returned,
  - fallback/safety status,
  - approval id for mutating request,
  - explicit statement that Pi Coding Agent CLI/filesystem/shell tools were not loaded.
- [x] Add failure triage:
  - config missing,
  - model not found,
  - provider timeout,
  - unsafe/ungrounded tool request,
  - approval boundary failure,
  - metrics/readiness mismatch.

Expected result: a future pilot operator can collect Pi provider evidence without rereading chat history.

### Task 9: Update Architecture, Security, Reliability, Quality, And Chinese Docs

**Files:**

- Modify: `docs/design-docs/full-stack-architecture.md`
- Modify: `docs/design-docs/security-governance.md`
- Modify: `docs/design-docs/testing-strategy.md`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `docs/RELIABILITY.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/security/secrets-management.md`
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/zh-CN/backend-runtime.md`
- Modify: `docs/zh-CN/security-reliability.md`

- [x] Architecture docs: state that provider evidence is attached at the WiseEff provider seam and does not change AgentGateway or tool execution.
- [x] Security docs: state that provider metadata is safe-to-observe only after redaction and that raw prompts/API keys/provider payloads are not evidence artifacts.
- [x] Reliability docs: document `/health/ready`, pilot-readiness, `/metrics`, `agent:pi-eval`, and optional `agent:pi-smoke`.
- [x] Quality/testing docs: add focused gates:

```bash
npm run agent:pi-eval
npm test -- scripts/run-pi-agent-smoke.test.ts
npm run test:server -- server/modules/agent/providerEvidence.test.ts server/modules/operations/health.test.ts server/modules/operations/routes.test.ts server/observability/metrics.test.ts server/app.test.ts
npm run test:m4
npm run build
npm run docs:check
```

- [x] Chinese docs: add concise backend-runtime and security/reliability notes so Chinese developer onboarding matches the new provider evidence workflow.

Expected result: docs describe the second-round evidence loop and do not imply broader Pi runtime integration.

### Task 10: Documentation Governance And Technical Debt Closure

**Files:**

- Modify: `docs/PLANS.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md` if new deferrals are introduced.
- Review: `docs/generated/*`
- Review: `docs/product-specs/*`
- Review: `docs/api/*`
- Review: `docs/FRONTEND.md`

- [x] Confirm `docs/PLANS.md` lists this plan under Current Active Plan.
- [x] Add or update a tech-debt row only for work intentionally deferred by this round, such as:
  - queryable `provider_format` / `pi_provider` trace columns,
  - frontend streaming UX,
  - `pi-agent-core` evaluation after evidence stabilizes,
  - larger provider benchmark corpus.
- [x] Record unchanged reviews in the completion summary for product specs, API docs/contracts, frontend docs, and generated artifacts if no product/API/UI/schema behavior changed.
- [x] Run:

```bash
npm run docs:check
```

Expected result: documentation governance passes, and the plan can later be moved to completed only after every Update/Review row is closed.

### Task 11: Full Verification Gate

Run these commands before marking the implementation complete:

```bash
npm run agent:pi-eval
npm test -- scripts/run-pi-agent-smoke.test.ts
npm run test:server -- server/modules/agent/providerEvidence.test.ts server/modules/agent/piProvider.test.ts server/modules/agent/providerRegistry.test.ts server/modules/agent/orchestrator.test.ts server/modules/operations/health.test.ts server/modules/operations/routes.test.ts server/observability/metrics.test.ts server/app.test.ts
npm run test:m4
npm run build
npm run docs:check
git diff --check
```

Expected result:

- Offline Pi eval passes.
- Smoke script tests pass without a live key.
- Focused server tests pass.
- M4 deterministic browser/API behavior remains intact.
- Build and docs gates pass.
- No whitespace errors.

If `npm run test:m4` cannot run because `DATABASE_URL` is unavailable, record that exact blocker with the failed command output and run the focused server gates plus `npm run build` and `npm run docs:check`.

## Browser Acceptance Impact

This plan intentionally avoids frontend interaction changes. It does not change routes, forms, tables, modals, approvals, navigation, Agent panel rendering, or frontend API clients.

Existing coverage remains the guardrail:

- Requirement/operation: `AGENT-APPROVAL-001` in `docs/developer/user-operation-coverage-matrix.md`.
- Browser spec: `e2e/acceptance/agent.acceptance.spec.ts`.
- API-mode smoke: `e2e/agent.api.spec.ts`.

No new browser acceptance requirement ID is needed unless implementation changes frontend-visible Agent behavior or backend response fields consumed by the UI. If that happens, implementation must update `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, the relevant Playwright spec, and operation evidence before completion.

## Risks And Controls

| Risk | Control |
| --- | --- |
| Provider metadata leaks secrets or customer prompts. | Use a dedicated evidence sanitizer; test redaction; never include API keys/raw prompts/raw provider payloads in readiness, metrics, or smoke output. |
| Metrics labels create high cardinality. | Use only low-cardinality labels such as `provider`, `format`, and known `piProvider`; keep model/prompt version in readiness/details and trace fields. |
| Offline eval is mistaken for live provider proof. | Docs distinguish `agent:pi-eval` as deterministic CI evidence and `agent:pi-smoke` as optional live-key evidence. |
| Live smoke accidentally calls tools. | Use a no-tool prompt and assert `toolRequests.length === 0`; no business DB or WiseEff tool registry execution is involved. |
| Pi output is treated as execution authority. | Preserve WiseEff tool registry, authz, approval, and audit as the only execution path. |
| Second round quietly expands into `pi-agent-core`. | Keep `pi-agent-core`, `pi-coding-agent`, filesystem/shell tools, and Pi trust flow explicitly out of scope. |
| Health/readiness response changes break clients. | Add optional `details` only; keep existing `ok`, `status`, and `message` fields stable. |

## Documentation Impact Matrix

| Area | Status | Files | Required Action |
| --- | --- | --- | --- |
| Repository maps | Review | `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md` | Update only if evidence commands become top-level onboarding or architecture summary items. |
| Planning docs | Update | `docs/PLANS.md`, `docs/exec-plans/completed/2026-06-09-wiseeff-pi-agent-evidence-evaluation.md`, `docs/exec-plans/tech-debt-tracker.md` | Register this plan; add debt only for intentionally deferred follow-ups. |
| Product specs | Review | `docs/product-specs/index.md`, `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` | No product workflow change expected; record unchanged evidence before completion. |
| Architecture docs | Update | `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/security-governance.md`, `ARCHITECTURE.md` | Describe Pi provider evidence seam and unchanged execution boundary. |
| API docs/contracts | Review | `docs/api/README.md`, `docs/api/examples.md`, `docs/design-docs/api-contract.md`, `docs/generated/openapi.json` | Review if `/health/ready` or pilot-readiness details should be documented; regenerate/check OpenAPI only if contract artifacts cover those fields. |
| Quality/testing docs | Update | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md`, `docs/developer/verification-matrix.md` | Add offline eval, smoke script test, and focused verification gates. |
| Reliability/runbooks | Update | `docs/RELIABILITY.md`, `docs/runbooks/agent-provider.md`, `docs/runbooks/m5-commercial-pilot-readiness.md`, `docs/runbooks/monitoring-alerting.md`, `docs/runbooks/observability-operations.md` | Add readiness, metrics, smoke, and triage instructions. |
| Security/governance docs | Update | `docs/SECURITY.md`, `docs/security/secrets-management.md`, `docs/security/README.md`, `docs/security/threat-model.md` | Document redaction, evidence boundaries, Pi API key handling, and unchanged WiseEff approval boundary. |
| Frontend/design docs | Review | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | No frontend change expected; record unchanged unless UI contract changes unexpectedly. |
| Generated artifacts | Review | `docs/generated/db-schema.md`, `docs/generated/m5-pilot-acceptance.md`, `docs/generated/acceptance-browser-evidence.md` | No DB schema or generated acceptance artifact change expected during code implementation; update only after live target evidence is intentionally collected. |
| References | Update | `docs/references/pi-agent-provider-evidence.md` | Add compact reference for future agents and operators. |
| Chinese developer docs | Update | `docs/zh-CN/backend-runtime.md`, `docs/zh-CN/security-reliability.md` | Add concise Chinese notes for provider evidence, live smoke, and unchanged approval/security boundary. |
| Environment examples | Review | `.env.example`, `ops/self-hosted/.env.example`, `docs/developer/environment-variables.md` | First round already added Pi env keys; update only if live smoke introduces new optional env. |
| Self-hosted ops | Review | `ops/self-hosted/Dockerfile`, `ops/self-hosted/scripts/check-self-hosted-config.ts`, `ops/self-hosted/observability/*` | Node runtime floor already handled; update observability assets only if Agent provider metric shape changes. |

## Documentation Update Gate

Before moving this plan to `docs/exec-plans/completed/`, complete all of the following:

- Every `Update` row in the Documentation Impact Matrix has been changed in the same branch.
- Every `Review` row has either been updated or recorded as unchanged in the completion summary with evidence.
- `docs/PLANS.md` lists this plan while active and is updated again when the plan moves to completed.
- Any new or deferred work is recorded in `docs/exec-plans/tech-debt-tracker.md`.
- `npm run docs:check` passes.
- If `/health/ready`, pilot-readiness, or metrics response shape changes in a way docs/contracts cover, the relevant docs or generated contract artifacts are updated.
- If frontend interaction behavior changes unexpectedly, browser acceptance coverage is updated before completion.

## Completion Criteria

- Pi provider metadata safely identifies `format=pi`, `piProvider`, model, and prompt version without leaking secrets or prompt bodies.
- `/health/ready` and `/api/v1/operations/pilot-readiness` expose safe Agent provider evidence.
- `/metrics` distinguishes Pi readiness through bounded labels or documented compatibility behavior.
- Agent traces continue to capture model, prompt version, trace id, latency, usage, cost, safety, and fallback evidence for Pi-like turns.
- Offline Pi eval passes without a real network call.
- Optional live Pi smoke can be run with configured env and emits redacted JSON evidence.
- Deterministic, WiseEff HTTP, and OpenAI-compatible provider paths remain green.
- WiseEff approval, authz, audit, and tool registry remain the only execution boundary.
- `pi-agent-core`, `pi-coding-agent`, Pi filesystem tools, and Pi shell tools remain out of runtime scope.
- Focused tests, `npm run test:m4` where environment allows, `npm run build`, `npm run docs:check`, and `git diff --check` pass or have explicit environment-blocker evidence.

## Implementation Status

Implemented on 2026-06-09 in branch `codex/pi-agent-provider-adapter`.

Completed:

- Safe provider evidence contract in `server/modules/agent/providerEvidence.ts`.
- Pi, deterministic, WiseEff HTTP, and OpenAI-compatible metadata evidence.
- `/health/ready` Agent provider details.
- Pilot-readiness Agent provider gate details.
- Low-cardinality `wiseeff_agent_provider_ready` metrics labels while preserving the unlabeled compatibility gauge.
- Existing Agent trace evidence coverage for Pi-like provider turns without adding a database migration.
- Offline `agent:pi-eval` gate.
- Optional `agent:pi-smoke` runner and smoke runner tests.
- Runbook, reliability, security, testing, Chinese developer, and compact reference documentation updates.
- TD-026 update for remaining deferred Pi work.

Verification run:

```bash
npm run agent:pi-eval
npm test -- scripts/run-pi-agent-smoke.test.ts
npm run test:server -- server/modules/agent/providerEvidence.test.ts server/modules/agent/piProvider.test.ts server/modules/agent/providerRegistry.test.ts server/modules/agent/orchestrator.test.ts server/modules/operations/health.test.ts server/modules/operations/routes.test.ts server/observability/metrics.test.ts server/app.test.ts
npm run docs:check
npm run build
git diff --check
npm run test:m4
```

Result:

- `agent:pi-eval`: passed, 7 tests.
- Pi smoke runner tests: passed, 5 tests.
- Focused server gate: passed, 8 files / 81 tests.
- `docs:check`: passed.
- `build`: passed with the existing Vite chunk-size warning.
- `git diff --check`: passed.
- `test:m4`: partial pass. `npm test` passed 216 files / 1954 tests, `npm run test:server` passed 75 files / 631 tests, and `npm run build` passed. The final Playwright `e2e/agent.api.spec.ts` failed in `beforeAll` because `DATABASE_URL` is not set in this local environment.

Completion decision, 2026-06-17: move this plan to `docs/exec-plans/completed/`. Offline eval, safe provider evidence, readiness metadata, metrics labels, smoke runner tests, and documentation gates are complete. Optional target live `agent:pi-smoke` evidence and deferred Pi expansion remain tracked in TD-026.
