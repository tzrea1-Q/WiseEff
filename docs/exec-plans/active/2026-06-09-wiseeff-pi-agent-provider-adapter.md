# WiseEff Pi Agent Provider Adapter Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Keep changes surgical, preserve the existing WiseEff Agent approval/audit boundary, and do not introduce `@earendil-works/pi-coding-agent` into the product runtime.

**Goal:** Add first-round support for `earendil-works/pi` by using `@earendil-works/pi-ai` as a WiseEff live Agent provider adapter.

**Architecture:** WiseEff keeps the current frontend `AgentGateway`, backend `AgentProvider` interface, tool registry, approval state machine, and audit model. The first integration adds a Pi-backed provider path behind `AGENT_API_FORMAT=pi`, maps Pi model output into the existing `AgentProviderPlan`, and treats WiseEff backend tools as the only executable business tools. Pi Coding Agent CLI and its built-in filesystem/shell tools stay out of the product runtime.

**Tech Stack:** TypeScript, Node.js >= 22.19.0, Vite/React frontend unchanged, WiseEff modular backend, Vitest, Playwright M4 Agent smoke, PostgreSQL-backed Agent persistence, `@earendil-works/pi-ai`.

---

## Scope

In scope:

- Install and pin `@earendil-works/pi-ai`.
- Add `AGENT_API_FORMAT=pi` to server env/config/docs.
- Implement `server/modules/agent/piProvider.ts`.
- Route `AGENT_API_FORMAT=pi` through `createAgentProviderFromEnv`.
- Preserve existing `deterministic`, `wiseeff`, and `openai` live provider behavior.
- Convert Pi text/tool-call output into current WiseEff assistant messages, citations, confidence, usage, latency, safety, and tool requests.
- Add unit coverage for Pi provider mapping, safety rejection, outage fallback, and registry wiring.
- Update docs and runbooks for Pi provider configuration and target evidence.

Out of scope for this first round:

- No `@earendil-works/pi-agent-core` stateful loop.
- No `@earendil-works/pi-coding-agent` CLI, RPC, read/write/edit/bash tools, `.pi` project packages, or Pi trust flow in WiseEff runtime.
- No frontend streaming UI.
- No Agent message schema migration.
- No direct device writes or direct parameter writes from Pi.
- No replacement of WiseEff approval records with Pi permissions.

## Decisions

- Use `@earendil-works/pi-ai`, not `pi-agent-core`, for round one.
- Keep `AgentProviderMetadata.provider` as `"live"` for Pi-backed runs so current trace, health, and pilot readiness contracts remain stable.
- Use `AGENT_API_FORMAT=pi` as the switch. Add `AGENT_PI_PROVIDER` for Pi's provider id, for example `minimax`, while reusing `AGENT_MODEL`, `AGENT_API_KEY`, `AGENT_API_TIMEOUT_MS`, and `AGENT_PROMPT_VERSION`.
- Treat Pi tool calls as planning output only. WiseEff orchestrator still records the tool call, gates approval-required tools, and executes through `createAgentToolRegistry`.
- Require safe defaults: unknown tools rejected, malformed arguments rejected, mutating/write-adjacent tool calls without grounding rejected, provider outage returns degraded assistant response without tool execution.

## Files

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Modify: `server/config/env.ts`
- Modify: `server/config/env.test.ts`
- Modify: `server/config/envExample.test.ts`
- Modify: `server/modules/agent/provider.ts`
- Modify: `server/modules/agent/providerRegistry.ts`
- Create: `server/modules/agent/piProvider.ts`
- Create: `server/modules/agent/piProvider.test.ts`
- Modify: `server/modules/agent/providerRegistry.test.ts`
- Modify: `server/modules/agent/orchestrator.test.ts`
- Modify: `server/modules/operations/health.test.ts` if health copy or provider metadata expectations need adjustment.
- Modify: `docs/runbooks/agent-provider.md`
- Modify: `docs/developer/environment-variables.md`
- Modify: `docs/developer/local-development.md`
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/FRONTEND.md`
- Modify: `docs/design-docs/full-stack-architecture.md`
- Modify: `docs/design-docs/security-governance.md`
- Modify: `docs/design-docs/testing-strategy.md`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `docs/RELIABILITY.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/zh-CN/security-reliability.md`
- Modify: `docs/zh-CN/frontend.md`
- Modify: `docs/runbooks/m5-commercial-pilot-readiness.md` if pilot provider evidence wording needs to name Pi.
- Modify: `ops/self-hosted/Dockerfile`
- Modify: `ops/self-hosted/scripts/check-self-hosted-config.ts`
- Modify: `ops/self-hosted/scripts/check-self-hosted-config.test.ts`

## Implementation Tasks

### Task 1: Add Pi Dependency And Runtime Floor

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `ops/self-hosted/Dockerfile`
- Modify: `ops/self-hosted/scripts/check-self-hosted-config.ts`
- Modify: `ops/self-hosted/scripts/check-self-hosted-config.test.ts`

Steps:

1. Run `npm install @earendil-works/pi-ai@0.79.0 --save-exact`.
2. Confirm `package.json` contains `"@earendil-works/pi-ai": "0.79.0"` under dependencies.
3. Confirm `package-lock.json` contains `node_modules/@earendil-works/pi-ai` and its transitive dependencies.
4. Update self-hosted Docker base images from floating `node:22-alpine` to a tag that satisfies Pi's `>=22.19.0` engine requirement. Preferred target: `node:22.21.1-alpine` or the latest available Node 22 Alpine tag greater than or equal to 22.19.0.
5. Update `check-self-hosted-config.ts` so it rejects Node image tags below 22.19.0 and still accepts newer major versions.
6. Update `check-self-hosted-config.test.ts` fixtures and expectations from generic `node:22-alpine` to the concrete accepted tag.
7. Run `npm test -- ops/self-hosted/scripts/check-self-hosted-config.test.ts`.

Expected result:

- Dependency is installed and pinned.
- Self-hosted runtime cannot silently run a Node version below Pi's engine requirement.

### Task 2: Extend Environment Contract For Pi

**Files:**

- Modify: `.env.example`
- Modify: `server/config/env.ts`
- Modify: `server/config/env.test.ts`
- Modify: `server/config/envExample.test.ts`
- Modify: `docs/developer/environment-variables.md`

Steps:

1. Extend `AGENT_API_FORMAT` enum from `["wiseeff", "openai"]` to `["wiseeff", "openai", "pi"]`.
2. Add optional `AGENT_PI_PROVIDER` to `rawEnvSchema`.
3. Add validation: when `AGENT_PROVIDER=live` and `AGENT_API_FORMAT=pi`, `AGENT_PI_PROVIDER`, `AGENT_MODEL`, and `AGENT_API_KEY` must be present. `AGENT_API_BASE_URL` must not be required for Pi.
4. Keep existing validation: `AGENT_API_BASE_URL` remains required for `wiseeff` and `openai` formats.
5. Update `.env.example` Agent section:

```text
# Pi-backed live Agent provider. Use AGENT_API_FORMAT=openai only for legacy OpenAI-compatible transport.
AGENT_PROVIDER=live
AGENT_API_FORMAT=pi
AGENT_PI_PROVIDER=minimax
AGENT_API_BASE_URL=
AGENT_MODEL=
AGENT_API_KEY=
AGENT_API_TIMEOUT_MS=30000
AGENT_PROMPT_VERSION=m7-pi-agent-v1
```

6. Update env tests to cover:
   - Pi live config loads without `AGENT_API_BASE_URL`.
   - Pi live config rejects missing `AGENT_PI_PROVIDER`.
   - OpenAI/wiseeff live config still rejects missing `AGENT_API_BASE_URL`.
   - Production still rejects non-live Agent provider.
7. Run `npm run test:server -- server/config/env.test.ts server/config/envExample.test.ts`.

Expected result:

- Pi has a first-class config path.
- Existing live provider formats keep their stricter URL requirements.

### Task 3: Add Pi Provider Adapter

**Files:**

- Create: `server/modules/agent/piProvider.ts`
- Create: `server/modules/agent/piProvider.test.ts`
- Modify: `server/modules/agent/provider.ts`

Implementation design:

- Import `complete`, `getModel`, `Type`, and Pi content/tool types from `@earendil-works/pi-ai`.
- Export `createPiAgentProvider(options)` returning WiseEff `AgentProvider`.
- Use Pi's `getModel(options.piProvider, options.model)`.
- Build a Pi context with:
  - system prompt: concise WiseEff operator assistant prompt.
  - one user message containing JSON with `promptVersion`, `context`, and `message`.
  - tools representing only the current WiseEff `AgentToolName` set.
- Convert Pi assistant text blocks into `assistantDraft.content`.
- Convert Pi toolCall blocks into `AgentToolRequest[]`.
- Convert usage into `inputTokens`, `outputTokens`, and `estimatedCostUsd` when Pi returns usage.
- Use `AbortController` and `AGENT_API_TIMEOUT_MS`.
- Return `safety: { status: "safe", reasons: [] }` for adapter-validated output in round one. Do not claim model-level safety evaluation if Pi does not provide one for the selected provider.
- Add `checkHealth()` that performs a tiny completion against the selected model with a timeout and returns `{ ok: true, status: "ready" }` on success or `{ ok: false, status: "failed", message }` on failure. The health prompt must not include customer data or request tool use.

Tool schema guidance:

- Use explicit TypeBox schemas for each tool payload.
- `parameter.submitChangeDraft` requires `projectId` and `reason`, with optional `parameterId` and `targetValue`.
- Read tools accept optional `projectId`.
- Unknown tool names must never be cast through.

Test cases:

1. `maps plain Pi assistant text into AgentProviderPlan`.
2. `maps known Pi tool calls into WiseEff toolRequests`.
3. `rejects unknown Pi tool calls`.
4. `rejects malformed tool arguments`.
5. `preserves token usage and latency`.
6. `returns failed health when Pi completion throws`.
7. `aborts Pi completion after configured timeout`.

Expected result:

- Pi provider is unit-tested without a real network call by mocking the Pi completion function through a small injectable transport/facade.

### Task 4: Wire Pi Through Provider Registry

**Files:**

- Modify: `server/modules/agent/providerRegistry.ts`
- Modify: `server/modules/agent/providerRegistry.test.ts`

Steps:

1. Update `AgentProviderEnv` with `AGENT_API_FORMAT?: "wiseeff" | "openai" | "pi"` and `AGENT_PI_PROVIDER?: string`.
2. Import `createPiAgentProvider`.
3. Change `createAgentProviderFromEnv` branching:
   - deterministic returns current provider.
   - live + `pi` returns `createPiAgentProvider`.
   - live + `openai` returns current OpenAI-compatible transport.
   - live + `wiseeff` or missing format returns current HTTP transport.
4. Do not pass `AGENT_API_BASE_URL` to Pi provider.
5. Add registry tests:
   - Pi provider created when requested.
   - Pi provider does not require `AGENT_API_BASE_URL`.
   - Missing `AGENT_PI_PROVIDER` throws a clear error.
   - OpenAI-compatible registry behavior remains unchanged.
6. Run `npm run test:server -- server/modules/agent/providerRegistry.test.ts server/modules/agent/piProvider.test.ts`.

Expected result:

- `AGENT_API_FORMAT=pi` is selectable from environment wiring without disturbing existing formats.

### Task 5: Preserve Orchestrator Safety And Approval Behavior

**Files:**

- Modify: `server/modules/agent/orchestrator.test.ts`
- Modify: `server/modules/agent/piProvider.test.ts`

Steps:

1. Add an orchestrator test using a Pi-like provider plan that returns `parameter.submitChangeDraft`.
2. Assert `sendMessage()` records the tool call as `pending_approval`.
3. Assert direct `runToolCall()` before approval returns `APPROVAL_REQUIRED`.
4. Assert `rejectToolCall()` leaves no `parameter_drafts` side effect in the memory DB.
5. Assert `approveToolCall()` creates a parameter draft and writes `agent-tool:approval-executed` audit.
6. Add a provider test that a Pi mutating tool call without any citation is rejected before reaching orchestrator, or explicitly document if the existing `createLiveAgentProvider` safety wrapper is reused around Pi output to enforce this centrally.
7. Run `npm run test:server -- server/modules/agent/orchestrator.test.ts server/modules/agent/piProvider.test.ts`.

Expected result:

- Pi output cannot bypass WiseEff's existing approval and audit model.

### Task 6: Update Health, Readiness, And Evidence Wording

**Files:**

- Modify: `server/modules/operations/health.test.ts` if necessary.
- Modify: `docs/runbooks/agent-provider.md`
- Modify: `docs/runbooks/m5-commercial-pilot-readiness.md`
- Modify: `docs/RELIABILITY.md`
- Modify: `docs/QUALITY_SCORE.md`

Steps:

1. Confirm `buildReadyHealth()` continues to surface `dependencies.agentProvider` from the provider's `checkHealth()`.
2. If tests assert provider format copy, update them to treat Pi as a live provider format.
3. Update Agent provider runbook with Pi setup:

```text
AGENT_PROVIDER=live
AGENT_API_FORMAT=pi
AGENT_PI_PROVIDER=minimax
AGENT_MODEL=<pi model id>
AGENT_API_KEY=<secret>
AGENT_API_TIMEOUT_MS=30000
AGENT_PROMPT_VERSION=m7-pi-agent-v1
```

4. Add evidence requirements:
   - provider `pi`,
   - Pi provider id,
   - model id,
   - prompt version,
   - request id/session id/trace id,
   - token usage/cost if returned,
   - approval id for mutating request,
   - explicit note that Pi Coding Agent CLI was not loaded in product runtime.
5. Run `npm run test:server -- server/modules/operations/health.test.ts`.

Expected result:

- Readiness and pilot evidence can prove Pi provider health without weakening existing M5 gates.

### Task 7: Update Architecture, Security, Frontend, And Chinese Docs

**Files:**

- Modify: `ARCHITECTURE.md`
- Modify: `docs/design-docs/full-stack-architecture.md`
- Modify: `docs/design-docs/security-governance.md`
- Modify: `docs/design-docs/testing-strategy.md`
- Modify: `docs/FRONTEND.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/developer/local-development.md`
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/zh-CN/security-reliability.md`
- Modify: `docs/zh-CN/frontend.md`

Steps:

1. Update architecture docs to state the live Agent provider seam now supports WiseEff HTTP, OpenAI-compatible, and Pi-backed provider formats.
2. State explicitly that `@earendil-works/pi-ai` is used only behind the backend provider adapter.
3. State explicitly that `@earendil-works/pi-coding-agent`, Pi built-in filesystem tools, Pi shell tools, and project-local `.pi` extensions are not part of the WiseEff product runtime.
4. Update frontend docs only to say the frontend contract is unchanged.
5. Update security docs to preserve the rule: model/planner output is advisory until WiseEff registry, authz, approval, and audit have accepted it.
6. Update testing docs with targeted Pi gate:

```bash
npm run test:server -- server/modules/agent/piProvider.test.ts server/modules/agent/providerRegistry.test.ts server/modules/agent/orchestrator.test.ts
npm run test:m4
npm run build
```

7. Add the same operational summary to the Chinese developer docs, or explicitly mark that only backend runtime/provider docs changed.
8. Run `npm run docs:check`.

Expected result:

- Documentation matches the runtime change and does not imply a broader autonomous Agent scope than implemented.

### Task 8: Full Verification Gate

**Files:**

- No additional file changes unless verification exposes issues.

Commands:

```bash
npm run test:server -- server/modules/agent/piProvider.test.ts server/modules/agent/providerRegistry.test.ts server/modules/agent/orchestrator.test.ts server/config/env.test.ts server/config/envExample.test.ts server/modules/operations/health.test.ts
npm run test:m4
npm run build
npm run docs:check
```

Expected result:

- All focused server tests pass.
- M4 Agent gate passes with deterministic provider path preserved.
- Production build passes with Pi dependency.
- Documentation governance passes.

## Browser Acceptance Impact

This first round does not change user-facing frontend interaction, routes, forms, modals, or browser-visible Agent approval behavior. It changes only the backend live provider format.

Existing coverage remains relevant:

- Requirement/operation: `AGENT-APPROVAL-001` in `docs/developer/user-operation-coverage-matrix.md`.
- Browser spec: `e2e/acceptance/agent.acceptance.spec.ts`.
- API-mode smoke: `e2e/agent.api.spec.ts`.

No new browser acceptance requirement ID is needed unless implementation changes frontend messages, confirmation dialog behavior, action rendering, or approval UX. If that happens during implementation, update `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, and the relevant Playwright acceptance spec before completing the plan.

## Risks And Controls

| Risk | Control |
| --- | --- |
| Pi package engine requires Node >= 22.19.0 while self-hosted Docker uses a broad Node 22 tag. | Pin self-hosted Docker image to a concrete >=22.19.0 tag and update config checks. |
| Pi tool calling could be mistaken for execution. | Adapter returns tool requests only; WiseEff orchestrator records, approves, and executes. |
| Pi Coding Agent CLI could introduce filesystem/shell tools into product runtime. | Do not install `@earendil-works/pi-coding-agent`; docs and tests name this as out of scope. |
| OpenAI-compatible legacy path could regress. | Preserve existing `createOpenAiCompatibleAgentTransport` tests and registry tests. |
| Provider health check could leak sensitive prompts. | Health check uses a static non-customer prompt and does not include page context or customer data. |
| Pi usage/cost metadata may differ by provider. | Adapter maps known fields when available and leaves absent metadata undefined rather than fabricating values. |

## Documentation Impact Matrix

| Area | Status | Files | Required Action |
| --- | --- | --- | --- |
| Repository maps | Update | `README.md`, `ARCHITECTURE.md`, `docs/README.md` | Mention Pi-backed live Agent provider seam if implementation changes top-level setup or architecture wording. |
| Planning docs | Update | `docs/PLANS.md`, `docs/exec-plans/active/2026-06-09-wiseeff-pi-agent-provider-adapter.md`, `docs/exec-plans/tech-debt-tracker.md` | Current plan already includes required sections. Add tech debt only if `pi-agent-core`, eval expansion, or streaming are deferred as explicit follow-ups beyond existing Agent provider debt. |
| Product specs | Review | `docs/product-specs/index.md`, `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` | Usually unchanged because product behavior and UI stay the same. Record unchanged evidence before completion. |
| Architecture docs | Update | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/domain-model.md` | Update provider seam wording. Domain model only needs review unless trace fields change. |
| API docs/contracts | Review | `docs/api/README.md`, `docs/api/examples.md`, `docs/design-docs/api-contract.md`, `docs/generated/openapi.json` | No endpoint contract change expected. Regenerate/check OpenAPI only if response schema changes. |
| Quality/testing docs | Update | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md`, `docs/developer/verification-matrix.md` | Add Pi provider adapter test gate and note M4 deterministic smoke remains. |
| Reliability/runbooks | Update | `docs/RELIABILITY.md`, `docs/runbooks/agent-provider.md`, `docs/runbooks/m5-commercial-pilot-readiness.md`, `docs/developer/local-development.md` | Add Pi provider env, health, readiness, and evidence instructions. |
| Security/governance docs | Update | `docs/SECURITY.md`, `docs/design-docs/security-governance.md`, `docs/security/README.md`, `docs/security/threat-model.md` | State Pi is not the approval/permission boundary and Pi Coding Agent CLI tools are not exposed. |
| Frontend/design docs | Review | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Frontend contract unchanged; update only the Agent Gateway backend provider note. |
| Generated artifacts | Review | `docs/generated/db-schema.md`, `docs/generated/m5-pilot-acceptance.md`, `docs/generated/acceptance-browser-evidence.md` | No DB schema change expected. Pilot acceptance evidence updates only after live target validation, not during code-only implementation. |
| References | Review | `docs/references/*` | No change expected unless a new compact Pi reference is added for agents. |
| Chinese developer docs | Update | `docs/zh-CN/security-reliability.md`, `docs/zh-CN/frontend.md` | Add short note about Pi-backed provider seam and unchanged frontend/approval boundary. |
| Environment examples | Update | `.env.example`, `docs/developer/environment-variables.md` | Add `AGENT_API_FORMAT=pi` and `AGENT_PI_PROVIDER`. |
| Self-hosted ops | Update | `ops/self-hosted/Dockerfile`, `ops/self-hosted/scripts/check-self-hosted-config.ts`, `ops/self-hosted/scripts/check-self-hosted-config.test.ts` | Enforce Node runtime floor for Pi dependency. |

## Documentation Update Gate

Before moving this plan to `docs/exec-plans/completed/`, complete all of the following:

- Every `Update` row in the Documentation Impact Matrix has been changed in the same branch.
- Every `Review` row has either been updated or recorded as unchanged in the completion summary with evidence.
- `.env.example` contains all required Agent keys, including `AGENT_PI_PROVIDER` if the implementation adds it.
- `npm run docs:check` passes.
- Any follow-up not completed in this round is added to `docs/exec-plans/tech-debt-tracker.md`.
- If frontend interaction changes unexpectedly, browser acceptance coverage is updated before completion.

## Completion Criteria

- `AGENT_API_FORMAT=pi` creates a live provider backed by `@earendil-works/pi-ai`.
- Pi provider text responses produce normal WiseEff assistant messages.
- Pi provider tool calls produce persisted WiseEff tool calls.
- Approval-required tools still require WiseEff approval before execution.
- Unknown, malformed, unsafe, or ungrounded tool requests are rejected before business side effects.
- Provider outage produces degraded assistant output and trace fallback without tool execution.
- Legacy `AGENT_API_FORMAT=openai` and `AGENT_API_FORMAT=wiseeff` tests still pass.
- Node self-hosted runtime floor is enforced.
- Focused tests, `npm run test:m4`, `npm run build`, and `npm run docs:check` pass.
