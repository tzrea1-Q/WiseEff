# Xiaoze Sole Agent — WiseAgent Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire WiseAgent (M4 `UnifiedAgent` + session REST API) and make Xiaoze the only Agent in API mode; mock mode has no Agent UI.

**Architecture:** Three phases — (A) switch user-visible behavior to Xiaoze-only in API mode and remove WiseAgent FAB; (B) delete M4 dead code (frontend gateway, routes, provider stack) while keeping ToolRegistry + orchestrator approval paths; (C) align docs, ops templates, acceptance matrices, and health gates. No `VITE_XIAOZE_ENABLED` / `XIAOZE_RUNTIME_ENABLED` flags remain.

**Tech Stack:** React/Vite, CopilotKit v2, AG-UI SSE, LangGraph, Vitest, Playwright acceptance/quality, self-hosted Docker compose.

---

## Source Spec

- `docs/zh-CN/superpowers/specs/2026-06-26-xiaoze-sole-agent-cleanup-design.md`

## Git & PR Workflow

| Role | Action |
| --- | --- |
| Implementation subagent | Branch from latest `main`: **`feat/xiaoze-sole-agent-cleanup`**. Commit per task group. Do **not** push `main`, open PR, or merge. |
| Parent agent | Review, run verification gates, open PR, merge, sync local `main`. |

Suggested commit sequence:

1. `feat(xiaoze): mount sole agent UI in api mode (phase A)`
2. `refactor(agent): remove WiseAgent frontend and M4 session API (phase B)`
3. `chore(docs): xiaoze-only agent docs and ops (phase C)`

## Scope

### In scope

- Remove `UnifiedAgent` WiseAgent UI and M4 frontend stack
- Hard-delete `/api/v1/agent/sessions/*` routes and M4 `AgentProvider` stack
- API mode always mounts `XiaozeProvider`; mock mode mounts nothing Agent-related
- Remove env flags: `VITE_XIAOZE_ENABLED`, `XIAOZE_RUNTIME_ENABLED`, `AGENT_PROVIDER`, `AGENT_API_FORMAT`, `AGENT_PROMPT_VERSION`
- Retarget health/pilot-readiness to Xiaoze LLM config
- Replace M4 E2E (`test:m4`, `agent.acceptance.spec.ts`) with existing Xiaoze acceptance coverage mapping
- Documentation + self-hosted template alignment

### Out of scope

- LangGraph behavior changes, new tools, TD-029 Postgres checkpoint
- Renaming `AGENT_API_*` → `XIAOZE_LLM_*`
- Removing proactive suggest flags
- Physical deletion of `agent_sessions` table or orchestrator approval chain

## File Structure

### Delete (Phase B)

**Frontend**

- `src/features/agent/UnifiedAgent.tsx`
- `src/features/agent/UnifiedAgent.test.tsx`
- `src/application/ports/AgentGateway.ts`
- `src/infrastructure/http/agentClient.ts`
- `src/infrastructure/http/agentClient.test.ts`
- `src/infrastructure/http/agentDtos.ts`
- `src/infrastructure/http/agentDtos.test.ts`
- `src/application/agent/agentRuntime.ts`
- `src/application/agent/agentRuntime.test.ts`
- `src/infrastructure/mock/mockAgentGateway.ts`
- `src/infrastructure/mock/mockAgentGateway.test.ts`
- `src/domain/agent/types.ts` (when unreferenced)

**Backend**

- `server/modules/agent/routes.ts`
- `server/modules/agent/routes.test.ts`
- `server/modules/agent/provider.ts`
- `server/modules/agent/liveProvider.ts`
- `server/modules/agent/providerRegistry.ts`
- Provider-related tests (`provider.test.ts`, `liveProvider.test.ts`, `providerRegistry.test.ts`, `providerEvidence.test.ts` if M4-only)

**E2E**

- `e2e/agent.api.spec.ts`
- `e2e/acceptance/agent.acceptance.spec.ts`

### Modify (all phases)

| File | Phase | Change |
| --- | --- | --- |
| `src/App.tsx` | A | Drop `agentGatewayClient`, `createAgentPlan`, `UnifiedAgent`; mount `XiaozePageContextRegistrar` + conditional `XiaozeProvider`; fix Logs `onAskAgent` |
| `src/infrastructure/http/runtimeMode.ts` | A/B | Remove `parseXiaozeEnabled` / `xiaozeEnabled`; gate Xiaoze on `wiseEffRuntimeMode === 'api'` |
| `src/vite-env.d.ts` | B | Remove `VITE_XIAOZE_ENABLED` |
| `src/styles.css` | B | Remove `.agent-fab`, `.agent-panel` blocks |
| `server/app.ts` | B | Remove `registerAgentRoutes` |
| `server/index.ts` | B | Remove `createAgentProviderFromEnv` wiring |
| `server/config/env.ts` | B | Remove `XIAOZE_RUNTIME_ENABLED`, `AGENT_PROVIDER` production check for M4 |
| `server/modules/agent/xiaoze/agUiEndpoint.ts` | B | Always register Xiaoze routes (no runtime flag gate) |
| `server/modules/agent/orchestrator.ts` | B | Remove `startSession` / `sendMessage` / M4 turn paths; keep approval + tool execution |
| `server/modules/agent/toolRegistry.ts` | B | Remove 9 legacy M4 tool names if unused |
| `server/modules/operations/health.ts` | B | Replace `checkAgentProvider` with Xiaoze LLM env check |
| `server/modules/operations/pilotReadiness.ts` | B | Same |
| `server/modules/contracts/routeManifest.ts` | B | Drop 5 M4 route IDs |
| `package.json` | B | Remove `test:m4` script |
| `.env.example`, `ops/self-hosted/.env.example` | C | Remove deleted vars |
| `ops/self-hosted/Dockerfile`, `compose.yaml` | C | Remove `VITE_XIAOZE_ENABLED` build arg |
| `ops/self-hosted/scripts/check-self-hosted-config.ts` | C | Drop removed env/docker tokens |
| Docs (see matrix) | C | Xiaoze-only narrative |

### Keep unchanged

- `server/modules/agent/xiaoze/**`
- `server/modules/agent/toolRegistry.ts`, `tools/**`, `approvalBridge.ts`
- `server/modules/agent/repository.ts`, `policy.ts`
- `src/components/AgentInsightBar.tsx`
- `AGENT_API_BASE_URL`, `AGENT_API_KEY`, `AGENT_MODEL`, `XIAOZE_*` proactive/deterministic vars

---

## Phase A — Behavior switch

### Task A1: Extract page context mount in App

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/features/agent/useXiaozePageContext.tsx` (imports only if needed)
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write failing test** — API mode renders Xiaoze toggle anchor, not WiseAgent FAB:

```tsx
it("does not render WiseAgent FAB in api mode", () => {
  render(<App authClient={createResolvedAuthClient()} runtimeMode="api" />);
  expect(screen.queryByLabelText("打开 WiseAgent")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run** `npm test -- src/App.test.tsx -t "does not render WiseAgent"` — Expected: FAIL (FAB still present when xiaoze off) or adjust if already hidden.

- [ ] **Step 3: In `AppShell`**, replace `<UnifiedAgent ... xiaozeEnabled={xiaozeEnabled} />` with:

```tsx
{runtimeMode === "api" && !isPlatformHome && canAccessCurrentPage ? (
  <XiaozePageContextRegistrar
    path={path}
    pageKey={page.key}
    projectId={state.activeProjectId}
    roleId={currentRoleId}
    visibleRecords={agentPlan.contextSummary ? [{ summary: agentPlan.contextSummary }] : undefined}
  />
) : null}
```

Keep `createAgentPlan` temporarily for `contextSummary` until Task A4.

- [ ] **Step 4: Wrap app shell** — change outer return to:

```tsx
return runtimeMode === "api" ? (
  <XiaozeProvider enableInspector={enableXiaozeInspector}>
    <XiaozePageContext.Provider value={xiaozePageContext}>{appShell}</XiaozePageContext.Provider>
  </XiaozeProvider>
) : (
  appShell
);
```

Remove `xiaozeEnabled` condition and `enabled={xiaozeEnabled}` prop.

- [ ] **Step 5: Run** `npm test -- src/App.test.tsx` — fix remaining WiseAgent assertions in this file incrementally.

- [ ] **Step 6: Commit** phase A1 changes.

### Task A2: Mock mode — no Agent UI

**Files:**

- Modify: `src/App.test.tsx`, `src/permissionRouting.test.tsx`
- Modify: `src/infrastructure/http/runtimeMode.ts` (if not done in A1)

- [ ] **Step 1: Write failing test**

```tsx
it("does not render Xiaoze or WiseAgent controls in mock mode", () => {
  render(<App initialAppState={userState} runtimeMode="mock" />);
  expect(screen.queryByLabelText("打开 WiseAgent")).not.toBeInTheDocument();
  expect(document.querySelector(".xiaoze-chat-toggle-anchor")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test** — Expected: FAIL until `XiaozeProvider` gated on `runtimeMode === 'api'`.

- [ ] **Step 3: Ensure** `XiaozeProvider` returns `children` unchanged when parent does not wrap (mock path uses bare `appShell`).

- [ ] **Step 4: Run** `npm test -- src/App.test.tsx src/permissionRouting.test.tsx` — Expected: PASS.

- [ ] **Step 5: Commit**

### Task A3: Logs “问 Agent” opens Xiaoze

**Files:**

- Modify: `src/App.tsx` (`onAskAgent` in Logs page section ~L4785)
- Modify: `src/logsPage.test.tsx`

- [ ] **Step 1: Replace** `.agent-fab` click with opening Xiaoze modal. Preferred pattern:

```tsx
const onAskAgent = () => {
  document.querySelector<HTMLButtonElement>(".xiaoze-chat-toggle-anchor button")?.click();
};
```

If toggle is not in DOM until provider mounts, expose a tiny `openXiaozeChat()` helper on a ref/context in `XiaozePopupOpenPolicy` instead.

- [ ] **Step 2: Update** `logsPage.test.tsx` — expect Xiaoze panel/modal, not `.agent-panel` / "WiseAgent" heading.

- [ ] **Step 3: Run** `npm test -- src/logsPage.test.tsx` — Expected: PASS.

- [ ] **Step 4: Browser check** (API mode, `/logs`): click 「问 Agent」opens Xiaoze popup. `playwright-cli` snapshot at 1440×900; save `work/ui-checks/xiaoze-logs-ask-agent-desktop.png`.

- [ ] **Step 5: Commit**

### Task A4: Remove `xiaozeEnabled` from runtimeMode exports

**Files:**

- Modify: `src/infrastructure/http/runtimeMode.ts`
- Modify: `src/App.tsx` (remove imports/usages of `xiaozeEnabled`)
- Test: `src/infrastructure/http/runtimeMode.test.ts`

- [ ] **Step 1: Delete** `parseXiaozeEnabled`, `xiaozeEnabled` exports.

- [ ] **Step 2: In App**, replace `xiaozeEnabled &&` proactive banner guard with `runtimeMode === 'api' &&`.

- [ ] **Step 3: Run** `npm test -- src/infrastructure/http/runtimeMode.test.ts` — remove xiaoze enabled tests or replace with api-mode gate tests.

- [ ] **Step 4: Run** `npm run build` — Expected: PASS.

- [ ] **Step 5: Commit**

**Phase A exit gate:**

```bash
npm test -- src/App.test.tsx src/logsPage.test.tsx src/permissionRouting.test.tsx
npm run build
rg "打开 WiseAgent" src --glob '!**/UnifiedAgent*'  # should trend to zero in App/tests
```

---

## Phase B — Delete dead code

### Task B1: Delete M4 frontend stack

**Files:** listed in Delete section

- [ ] **Step 1: Remove** `UnifiedAgent` import and component file + test.

- [ ] **Step 2: Remove** `agentGatewayClient` creation in `App.tsx`:

```tsx
// DELETE:
// const agentGatewayClient = useMemo(() => agentGateway ?? resolveAgentGateway(runtimeMode), ...);
```

Remove `resolveAgentGateway` import from `agentRuntime.ts`.

- [ ] **Step 3: Delete** AgentGateway port, agentClient, agentDtos, agentRuntime, mockAgentGateway, domain/agent/types + all tests.

- [ ] **Step 4: Fix** compile errors — grep `AgentGateway|agentClient|UnifiedAgent|mockAgentGateway` in `src/` and update tests to Xiaoze or delete.

- [ ] **Step 5: Run** `npm test -- src/features/agent src/App.test.tsx` and `npm run build` — Expected: PASS.

- [ ] **Step 6: Commit**

### Task B2: Delete WiseAgent CSS

**Files:** `src/styles.css`

- [ ] **Step 1: Remove** blocks for `.agent-fab`, `.agent-panel`, and responsive overrides (~10153–10361, 11136–11180). **Do not** remove `.agent-insight-*` or `.xiaoze-*`.

- [ ] **Step 2: Run** `npm run build` — Expected: PASS.

- [ ] **Step 3: Commit**

### Task B3: Delete M4 REST routes

**Files:**

- Delete: `server/modules/agent/routes.ts`, `routes.test.ts`
- Modify: `server/app.ts`, `server/modules/contracts/routeManifest.ts`, `server/app.test.ts`

- [ ] **Step 1: Remove** `registerAgentRoutes(router, ...)` from `server/app.ts`.

- [ ] **Step 2: Delete** route files; remove 5 entries from `routeManifest.ts` (`agent.createSession`, etc.).

- [ ] **Step 3: Update** `server/app.test.ts` — remove tests expecting `/api/v1/agent/sessions`; keep Xiaoze route tests.

- [ ] **Step 4: Run** `npm run test:server -- app.test agUiEndpoint` — Expected: PASS.

- [ ] **Step 5: Run** `npm run contract:check` — update OpenAPI artifact if scripted.

- [ ] **Step 6: Commit**

### Task B4: Delete M4 provider stack + slim orchestrator

**Files:**

- Delete: `provider.ts`, `liveProvider.ts`, `providerRegistry.ts` + tests
- Modify: `server/index.ts`, `server/config/env.ts`, `server/modules/agent/orchestrator.ts`, `server/modules/agent/orchestrator.test.ts`

- [ ] **Step 1: Remove** from `server/index.ts`:

```tsx
// DELETE createAgentProviderFromEnv and agentProvider passed to health
```

- [ ] **Step 2: Remove** env schema fields: `XIAOZE_RUNTIME_ENABLED`, `AGENT_PROVIDER` (and production validation forcing `AGENT_PROVIDER=live` for M4).

- [ ] **Step 3: In `agUiEndpoint.ts`**, remove `if (!options.env?.XIAOZE_RUNTIME_ENABLED)` guard in `registerXiaozeRoutes`; always register when DB present.

- [ ] **Step 4: Delete** M4 provider files; remove `startSession` / `sendMessage` exports from orchestrator used only by routes.

- [ ] **Step 5: Prune** `orchestrator.test.ts` — keep approval/tool tests; delete session/message turn tests tied to removed paths.

- [ ] **Step 6: Remove** 9 legacy tool names from `server/modules/agent/types.ts` + registry if only referenced by deleted provider.

- [ ] **Step 7: Run** `npm run test:server -- orchestrator toolRegistry agUiEndpoint planningGraph` — Expected: PASS.

- [ ] **Step 8: Commit**

### Task B5: Health and pilot readiness

**Files:** `server/modules/operations/health.ts`, `pilotReadiness.ts`, related tests

- [ ] **Step 1: Replace** `checkAgentProvider(agentProvider)` with `checkXiaozeLlmConfig(env)` verifying `AGENT_API_BASE_URL` + key when not `XIAOZE_DETERMINISTIC`.

- [ ] **Step 2: Update** pilot readiness gate labels from `agentProvider` to `xiaozeLlm` (or reuse `agentApi` naming).

- [ ] **Step 3: Run** `npm run test:server -- health pilotReadiness` — Expected: PASS.

- [ ] **Step 4: Commit**

### Task B6: E2E and package scripts cleanup

**Files:** `e2e/agent.api.spec.ts`, `e2e/acceptance/agent.acceptance.spec.ts`, `e2e/quality/*`, `package.json`, `e2e/acceptance/operationMatrix.ts`, `docs/developer/browser-acceptance-coverage-map.md`

- [ ] **Step 1: Delete** `e2e/agent.api.spec.ts`, `agent.acceptance.spec.ts`.

- [ ] **Step 2: Remove** `test:m4` from `package.json`.

- [ ] **Step 3: Remove** operation matrix rows `AGENT-APPROVAL-001`, `AGENT-UNAUTH-001`; remove matching rows from `browser-acceptance-coverage-map.md` (coverage already on `XIAOZE-ACTION-*`).

- [ ] **Step 4: Rewrite** `e2e/quality/helpers.ts`, `a11y.quality.spec.ts`, `visual.quality.spec.ts` to open Xiaoze popup instead of `.agent-panel`.

- [ ] **Step 5: Run** `npm run test:e2e -- e2e/quality/a11y.quality.spec.ts` (or project quality config) — Expected: PASS.

- [ ] **Step 6: Commit**

**Phase B exit gate:**

```bash
npm run build
npm run test:all
npm run test:server
rg "UnifiedAgent|AgentGateway|/agent/sessions|VITE_XIAOZE_ENABLED|XIAOZE_RUNTIME_ENABLED|AGENT_PROVIDER" \
  src server e2e package.json .env.example ops/self-hosted \
  --glob '!docs/**' --glob '!**/node_modules/**'
# Expected: no hits in production code (docs updated in Phase C)
```

---

## Phase C — Docs and ops

### Task C1: Environment templates and selfhost check

**Files:** `.env.example`, `ops/self-hosted/.env.example`, `Dockerfile`, `compose.yaml`, `check-self-hosted-config.ts` + test

- [ ] **Step 1: Remove** from all examples: `VITE_XIAOZE_ENABLED`, `XIAOZE_RUNTIME_ENABLED`, `AGENT_PROVIDER`, `AGENT_API_FORMAT`, `AGENT_PROMPT_VERSION`, `AGENT_PI_PROVIDER`.

- [ ] **Step 2: Add comment** — API mode always includes Xiaoze; mock mode has no Agent.

- [ ] **Step 3: Remove** Docker `VITE_XIAOZE_ENABLED` ARG/ENV and compose build arg.

- [ ] **Step 4: Update** `check-self-hosted-config.ts` required keys/tokens accordingly.

- [ ] **Step 5: Run** `npm run selfhost:check` and `npm test -- ops/self-hosted/scripts/check-self-hosted-config.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

### Task C2: Developer and architecture docs

**Files:** see Documentation Impact Matrix

- [ ] **Step 1: Update** `docs/FRONTEND.md` + `docs/zh-CN/frontend.md` — remove AgentGateway/UnifiedAgent sections; document sole Xiaoze model and mock=no agent.

- [ ] **Step 2: Update** `docs/developer/environment-variables.md` + zh-CN — remove deleted vars; document `AGENT_API_*` as Xiaoze LLM only.

- [ ] **Step 3: Update** `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md` + zh-CN — single Agent seam.

- [ ] **Step 4: Update** `docs/design-docs/api-contract.md` + zh-CN — remove M4 session route group.

- [ ] **Step 5: Update** `docs/QUALITY_SCORE.md`, `docs/developer/verification-matrix.md` + zh-CN — drop M4/`test:m4`; point to xiaoze acceptance.

- [ ] **Step 6: Update** `docs/developer/local-development.md` — remove `e2e/agent.api.spec.ts` reference.

- [ ] **Step 7: Review** `docs/runbooks/agent-provider.md` — archive or rewrite as Xiaoze LLM runbook.

- [ ] **Step 8: Run** `npm run docs:check` — Expected: PASS.

- [ ] **Step 9: Commit**

### Task C3: PLANS index and completion

- [ ] **Step 1: Move** this file to `docs/exec-plans/completed/2026-06-26-xiaoze-sole-agent-wiseagent-cleanup.md`.

- [ ] **Step 2: Remove** from active list in `docs/PLANS.md`.

- [ ] **Step 3: Add** tech-debt note if any follow-up (e.g. rename `AGENT_API_*`) to `docs/exec-plans/tech-debt-tracker.md`.

- [ ] **Step 4: Final verification** (full gate below).

- [ ] **Step 5: Commit** docs-only completion move.

---

## Documentation Impact Matrix

| Area | Action | Files | Notes |
| --- | --- | --- | --- |
| Superpowers spec | Review | `docs/zh-CN/superpowers/specs/2026-06-26-xiaoze-sole-agent-cleanup-design.md` | Source; no change unless design drift. |
| Exec plan | Update | This file → `completed/` | After verification. |
| PLANS index | Update | `docs/PLANS.md` | Add while active; remove when completed. |
| Frontend docs | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Xiaoze-only; mock no agent. |
| Env vars | Update | `docs/developer/environment-variables.md`, zh-CN | Remove deleted flags. |
| API contract | Update | `docs/design-docs/api-contract.md`, zh-CN | Remove 5 M4 routes. |
| Architecture | Update | `ARCHITECTURE.md`, `full-stack-architecture.md`, zh-CN | Single agent. |
| Quality | Update | `docs/QUALITY_SCORE.md`, `verification-matrix.md`, zh-CN | Drop M4 gates. |
| Browser acceptance | Update | `browser-acceptance-coverage-map.md`, `user-operation-coverage-matrix.md` | Remove AGENT-* rows; Xiaoze covers approval. |
| Local dev | Update | `docs/developer/local-development.md` | Remove agent.api e2e. |
| Runbooks | Review/Update | `docs/runbooks/agent-provider.md` | Retire or rename for Xiaoze LLM. |
| OpenAPI | Update | `docs/generated/openapi.json` via `contract:check` | After route deletion. |
| Self-hosted | Update | `ops/self-hosted/.env.example`, Dockerfile, compose, check script | Phase C1. |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` | Replace WiseAgent mentions if any. |
| Security | Review | `docs/SECURITY.md`, zh-CN | Confirm approval chain unchanged. |
| AGENTS.md | Review | `AGENTS.md` | Only if runtime rules change materially. |
| Tech debt | Update | `docs/exec-plans/tech-debt-tracker.md` | Optional AGENT_API rename follow-up. |
| References | No change | — | — |
| Generated DB schema | No change | — | Tables retained. |

## Documentation Update Gate

- [ ] All `Update` / `Review` rows applied or recorded unchanged with evidence.
- [ ] `npm run docs:check` passes.
- [ ] Browser acceptance matrix has no orphaned `AGENT-*` IDs without Xiaoze equivalent documented.
- [ ] Plan moved to `docs/exec-plans/completed/`.

## UI Interaction / Browser Acceptance

| Change | Requirement | Spec |
| --- | --- | --- |
| Remove WiseAgent FAB | No new ID; verify absence in mock | Manual + unit tests |
| Logs ask-agent → Xiaoze | Extend Xiaoze perception UX | `XIAOZE-PERCEPTION-001` (existing) + browser screenshot Task A3 |
| Quality visual/a11y | Retarget to Xiaoze popup | Update quality specs Task B6 |

No new acceptance ID required if Xiaoze action specs already cover approval (`XIAOZE-ACTION-APPROVE-001` replaces `AGENT-APPROVAL-001`).

## Verification Commands

```bash
# Phase A
npm test -- src/App.test.tsx src/logsPage.test.tsx src/permissionRouting.test.tsx
npm run build

# Phase B
npm run test:server -- orchestrator toolRegistry agUiEndpoint planningGraph app.test
npm run test:all
npm run contract:check
npm run build

# Phase C
npm run selfhost:check
npm run docs:check
npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/xiaoze-action.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/xiaoze-planning.acceptance.spec.ts
```

Browser (API mode, `npm run dev:all`):

```bash
playwright-cli -s=wiseeff-sole-agent open http://127.0.0.1:5173/parameters?project=aurora
# 1440x900 / 768x1024 / 390x844 — Xiaoze toggle visible; no WiseAgent FAB
playwright-cli -s=wiseeff-sole-agent-mock open http://127.0.0.1:5173/parameters?project=aurora
# with VITE_WISEEFF_RUNTIME_MODE=mock — no agent controls
```

## Expected Outcomes

1. API mode users interact only with Xiaoze; no WiseAgent strings or FAB.
2. Mock mode has zero Agent UI and no Agent HTTP from frontend.
3. Server exposes no `/api/v1/agent/sessions` routes.
4. Codebase and `.env.example` contain no `VITE_XIAOZE_ENABLED`, `XIAOZE_RUNTIME_ENABLED`, or `AGENT_PROVIDER`.
5. CI passes without `test:m4`; Xiaoze acceptance specs remain green.

## Risks

| Risk | Mitigation |
| --- | --- |
| Large test churn | Phase A fixes user-visible tests before file deletion |
| Health regression after provider removal | Task B5 before declaring complete |
| Logs ask-agent brittle selector | Prefer shared `openXiaozeChat()` helper in Task A3 |
| Contract drift | Run `contract:check` in Phase B |
