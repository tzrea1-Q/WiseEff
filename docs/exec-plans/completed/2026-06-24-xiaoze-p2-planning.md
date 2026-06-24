# Xiaoze P2 Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Code changes must follow `superpowers:test-driven-development`: write the failing test first, verify it fails, implement the smallest change, then verify green.

**Goal:** Turn Xiaoze (小泽) from a single-turn responder into a planning agent: it recognizes intent, proactively perceives, proposes a multi-step plan, executes approved steps one by one (resuming the same plan after each human approval), observes results, and continues — and it can proactively surface grounded suggestions on a page without being asked.

**Architecture:** Migrate the hand-rolled tool loop in `perceptionAgent.ts` to a LangGraph `StateGraph` (intent → perceive → plan → act → observe loop) with a checkpointer keyed by the agent thread/session id, so a run can suspend at a mutating-action interrupt and resume mid-plan after approval instead of terminating. Mutating steps still go through the P1 approval bridge → existing orchestrator approval chain (transactional re-authz + audit `actorType=agent`). A separate read-only "suggest" pass powers opt-in proactive suggestions surfaced in the existing `AgentInsightBar`. No new write paths; all guards preserved.

**Tech Stack:** TypeScript, LangGraph.js `StateGraph` + checkpointer (`@langchain/langgraph`), AG-UI interrupts/resume (from P1), `ChatOpenAI`, existing orchestrator approval chain, CopilotKit V2, `AgentInsightBar`, Vitest, Playwright acceptance.

---

## Reference Basis

- Design spec: `docs/superpowers/specs/2026-06-24-xiaoze-agent-design.md` (intent/planning capability; plan-act-observe; proactive suggestions; checkpoint resume; open question on opt-in).
- Completed phases: `docs/exec-plans/completed/2026-06-24-xiaoze-p0-perception.md`, `docs/exec-plans/completed/2026-06-24-xiaoze-p1-action.md`, and `server/modules/agent/xiaoze/SPIKE.md` / `SPIKE-P1.md`.
- Current agent loop (to migrate): `server/modules/agent/xiaoze/perceptionAgent.ts` (single-turn loop; mutating interrupt currently terminates the run).
- Resume path (to extend): `server/modules/agent/xiaoze/approvalBridge.ts`, `server/modules/agent/xiaoze/agUiEndpoint.ts` (`readResumeDecision`), `src/features/agent/xiaozeResumeBridge.ts`.
- Proactive surface: `src/components/AgentInsightBar.tsx` (`Insight` items with `tone`, `headline`, `actions`, dismiss); page context `src/features/agent/useXiaozePageContext.ts`.
- Approval chain (unchanged): `server/modules/agent/orchestrator.ts` (`approveToolCall`/`rejectToolCall`).
- LangGraph checkpointing: https://langchain-ai.github.io/langgraphjs/ (StateGraph, `interrupt`, `MemorySaver`, checkpointer interface).
- TD-028 (fixed) and known coverage IDs: `docs/exec-plans/tech-debt-tracker.md`, `e2e/acceptance/requirements.ts`, `e2e/acceptance/operationMatrix.ts`.

## Scope Boundary

P2 includes:

- Migrating the Xiaoze agent to a LangGraph `StateGraph` with a checkpointer keyed by thread/session id.
- Multi-step plan-act-observe: after an approved mutating step executes, the run resumes the same plan, observes the result, and continues (possibly to another approval) instead of terminating.
- Resume re-enters the graph at the suspended point (not a one-shot tool execution).
- Opt-in proactive suggestions: a read-only suggest pass that, on page context, produces grounded `AgentInsightBar` items; gated by a per-user/role opt-in setting.
- Tests: graph node unit tests (intent/plan/observe with a fake model), multi-step resume tests, proactive-suggest authz/grounding tests; acceptance for a multi-step task and a proactive suggestion.

P2 excludes:

- New mutating tools beyond P1's `action.submitParameterChange` (planning may chain existing tools; add new tools in follow-ups).
- Device writes / rollback execution by Xiaoze (still UI + backend-guarded).
- Fully autonomous execution without per-mutating-step human approval (every write still requires approval).
- MCP exposure and multi-agent (A2A) collaboration.
- Cross-session long-term memory beyond the per-thread checkpoint.

## Dependencies And Ordering

- Requires P0 + P1 (merged on `feat/xiaoze-agent`), including the TD-028 resume fix.
- The checkpointer choice (Task 1 spike) determines whether resume durability is in-memory (process-local) or Postgres-backed.
- Proactive suggestions depend on the existing `AgentInsightBar` and page-context hook.

## Success Criteria

- [x] Given a goal like "project X charges slowly", Xiaoze perceives (multiple read tools), proposes a plan, requests approval for the parameter change, and after approval continues to observe and report — all in one conversational task.
- [x] A multi-step task with one approval resumes the same plan after approval (the run does not restart from scratch; prior perceived context is retained via the checkpoint).
- [x] Rejecting a step halts the plan gracefully with a clear message and no mutation.
- [x] With proactive suggestions enabled, entering a page can surface a grounded `AgentInsightBar` suggestion (e.g. "3 high-risk parameters pending review") bounded by the user's permissions; with the setting off, nothing is surfaced.
- [x] Proactive perception is read-only and authz-bounded: it never proposes data the user cannot access and never writes.
- [x] `npm run test:server`, `npm test -- src/features/agent`, `npm run build`, `npm run docs:check` pass; multi-step + proactive acceptance passes with new operation/requirement IDs.

## Expected File Structure

Create:

- `server/modules/agent/xiaoze/planningGraph.ts`: LangGraph `StateGraph` (intent/perceive/plan/act/observe) + checkpointer wiring; replaces the manual loop while preserving the `createPerceptionAgent` public contract (`run`, `listTools`).
- `server/modules/agent/xiaoze/planningGraph.test.ts`: node + multi-step + resume unit tests with a fake model.
- `server/modules/agent/xiaoze/checkpointer.ts`: checkpointer factory (per Task 1 spike: `MemorySaver` or a thin Postgres-backed saver).
- `server/modules/agent/xiaoze/checkpointer.test.ts`: save/load/resume-by-thread tests.
- `server/modules/agent/xiaoze/suggest.ts`: read-only proactive suggest pass (perception tools only) returning suggestion items.
- `server/modules/agent/xiaoze/suggest.test.ts`: grounding + authz boundary + read-only tests.
- `src/features/agent/useXiaozeSuggestions.ts`: fetches suggestions for the current page when enabled.
- `src/features/agent/useXiaozeSuggestions.test.tsx`: enabled/disabled + dismiss behavior.
- `server/modules/agent/xiaoze/SPIKE-P2.md`: spike findings (checkpointer + resume-into-graph shape).

Modify:

- `server/modules/agent/xiaoze/perceptionAgent.ts`: delegate to `planningGraph` (keep the export contract; mark the old loop superseded or remove once the graph passes).
- `server/modules/agent/xiaoze/agUiEndpoint.ts`: on resume, restore the checkpoint and continue the run via the graph (not a one-shot tool exec); add a suggest route `POST /api/v1/agent/xiaoze/suggest` (read-only, auth-gated, gated by the opt-in setting).
- `server/modules/agent/xiaoze/approvalBridge.ts`: after `approveToolCall`, return enough context for the graph to resume and observe.
- `server/config/env.ts`, `.env.example`: add `XIAOZE_PROACTIVE_ENABLED` (default off) and any checkpointer config.
- `src/features/agent/XiaozeProvider.tsx`: mount proactive suggestions into `AgentInsightBar`, gated by `VITE_XIAOZE_PROACTIVE_ENABLED` / user setting.
- `docs/FRONTEND.md` (+ `docs/zh-CN/frontend.md`), `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/SECURITY.md` (+ zh): document planning loop, checkpointing, and proactive suggestions (read-only, opt-in).
- `docs/developer/environment-variables.md` (+ zh): new env.
- `docs/developer/user-operation-coverage-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md`, `e2e/acceptance/requirements.ts`, `e2e/acceptance/operationMatrix.ts`: add P2 IDs.
- `docs/exec-plans/active/development-roadmap.md`: update Xiaoze status.

## Implementation Tasks

### Task 1: Spike — checkpointer + resume-into-graph

**Files:**
- Create: `server/modules/agent/xiaoze/SPIKE-P2.md`

- [ ] **Step 1:** Decide the checkpointer: `MemorySaver` (process-local; simplest; loses state on restart) vs a thin Postgres-backed saver keyed by thread id (durable; spec-aligned). Recommend Postgres-backed if a small table is acceptable; otherwise `MemorySaver` for P2 v1 with a documented durability follow-up. Record the choice and the table/columns if Postgres.
- [ ] **Step 2:** Define the `StateGraph` shape: state = `{ messages, plan, perceivedCitations, pendingApproval }`; nodes `intent`, `perceive`, `plan`, `act` (uses LangGraph `interrupt` for mutating steps), `observe`; edges loop `observe → plan` until done.
- [ ] **Step 3:** Decide how `agUiEndpoint` resume re-enters the graph: a resume `RunAgentInput` (carrying the approval decision, already bridged by `xiaozeResumeBridge`) invokes the graph with the same `threadId` so the checkpointer continues from the `act` interrupt; the decision feeds the `act` node, which calls `approvalBridge.resume` (approve → execute; reject → halt).
- [ ] **Step 4:** Write `SPIKE-P2.md` with decisions and a ~20-line sketch. Commit.

```bash
git add server/modules/agent/xiaoze/SPIKE-P2.md
git commit -m "docs: xiaoze p2 planning graph and checkpointer spike"
```

### Task 2: Checkpointer

**Files:**
- Create: `server/modules/agent/xiaoze/checkpointer.ts`, `server/modules/agent/xiaoze/checkpointer.test.ts`

- [ ] **Step 1: Write failing tests** that the checkpointer saves a state for a thread id and loads it back, and that an unknown thread returns empty.

```ts
import { describe, expect, it } from "vitest";
import { createXiaozeCheckpointer } from "./checkpointer";

describe("xiaoze checkpointer", () => {
  it("round-trips state per thread", async () => {
    const cp = createXiaozeCheckpointer();
    await cp.put("thread-1", { plan: ["a"], step: 1 });
    expect(await cp.get("thread-1")).toMatchObject({ plan: ["a"], step: 1 });
    expect(await cp.get("thread-unknown")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and confirm fail.** Run: `npm run test:server -- checkpointer` — Expected: FAIL.
- [ ] **Step 3: Implement** the checkpointer per the spike (wrap LangGraph `MemorySaver`, or a Postgres-backed store). Expose a small `put`/`get` plus the LangGraph checkpointer interface the graph needs.
- [ ] **Step 4: Run tests to confirm pass.** Run: `npm run test:server -- checkpointer` — Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add server/modules/agent/xiaoze/checkpointer.ts server/modules/agent/xiaoze/checkpointer.test.ts
git commit -m "feat(agent): add xiaoze planning checkpointer"
```

### Task 3: Planning StateGraph (preserve P0/P1 behavior)

**Files:**
- Create: `server/modules/agent/xiaoze/planningGraph.ts`, `server/modules/agent/xiaoze/planningGraph.test.ts`
- Modify: `server/modules/agent/xiaoze/perceptionAgent.ts`

- [ ] **Step 1: Write failing tests** that the graph (a) answers a read-only question grounded in a perception tool (P0 parity), and (b) returns an interrupt for a mutating tool without executing it (P1 parity).

```ts
it("grounds a read-only answer (P0 parity)", async () => {
  const runTool = vi.fn().mockResolvedValue({ summary: "12 parameters", data: {}, citations: [] });
  const model = fakeModelSequence([toolCall("perception.getProjectOverview", { projectId: "p1" }), finalText("Project p1 has 12 parameters")]);
  const agent = createPlanningAgent({ model, runTool, listTools: () => [{ name: "perception.getProjectOverview", description: "x", schema: {} }], checkpointer: createXiaozeCheckpointer() });
  const result = await agent.run({ message: "summarize p1", context: { projectId: "p1" }, threadId: "t1" });
  expect(result.text).toContain("12 parameters");
});
```

- [ ] **Step 2: Run and confirm fail.** Run: `npm run test:server -- planningGraph` — Expected: FAIL.
- [ ] **Step 3: Implement `createPlanningAgent`** as a LangGraph `StateGraph` with the nodes from Task 1, using the checkpointer and `threadId`. Read tools execute in `perceive`/`act`; mutating tools trigger `interrupt`. Keep the same result contract (`{ text, citations, interrupt? }`) plus a `threadId`.
- [ ] **Step 4: Delegate `createPerceptionAgent`** to `createPlanningAgent` (or re-export) so existing P0/P1 callers and tests keep working; pass a default checkpointer.
- [ ] **Step 5: Run tests to confirm pass.** Run: `npm run test:server -- planningGraph perceptionAgent` — Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add server/modules/agent/xiaoze/planningGraph.ts server/modules/agent/xiaoze/planningGraph.test.ts server/modules/agent/xiaoze/perceptionAgent.ts
git commit -m "feat(agent): migrate xiaoze to a langgraph planning state graph"
```

### Task 4: Multi-step resume continues the plan

**Files:**
- Modify: `server/modules/agent/xiaoze/planningGraph.ts`, `server/modules/agent/xiaoze/agUiEndpoint.ts`, `server/modules/agent/xiaoze/approvalBridge.ts`
- Modify: `server/modules/agent/xiaoze/planningGraph.test.ts`, `server/modules/agent/xiaoze/agUiEndpoint.test.ts`

- [ ] **Step 1: Write failing tests** that after an approve resume, the graph continues from the checkpoint, executes the approved action, observes the result, and produces a follow-up answer in the same thread (not a fresh run); and that a reject halts with a clear message and no mutation.

```ts
it("resumes the plan after approval and observes the result", async () => {
  const checkpointer = createXiaozeCheckpointer();
  const orchestrator = { approveToolCall: vi.fn().mockResolvedValue({ messages: [{ content: "change request cr-1 created" }] }) } as any;
  // first run -> interrupt on action.submitParameterChange (threadId t9)
  // resume run with approve -> graph continues, observes, answers
  // assert orchestrator.approveToolCall called once and final text references cr-1
});
```

- [ ] **Step 2: Run and confirm fail.** Run: `npm run test:server -- planningGraph agUiEndpoint` — Expected: FAIL.
- [ ] **Step 3: Implement** resume-into-graph: `agUiEndpoint` resume restores the checkpoint for `threadId` and re-invokes the graph with the decision; the `act` node calls `approvalBridge.resume` (approve → execute via orchestrator; reject → halt), pushes the result into `observe`, and the loop continues or finishes. `approvalBridge.resume` returns the execution result/text for observation.
- [ ] **Step 4: Run tests to confirm pass.** Run: `npm run test:server -- planningGraph agUiEndpoint approvalBridge` — Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add server/modules/agent/xiaoze/planningGraph.ts server/modules/agent/xiaoze/agUiEndpoint.ts server/modules/agent/xiaoze/approvalBridge.ts server/modules/agent/xiaoze/planningGraph.test.ts server/modules/agent/xiaoze/agUiEndpoint.test.ts
git commit -m "feat(agent): resume xiaoze plan after approval and continue observe loop"
```

### Task 5: Proactive suggestions backend (read-only, opt-in)

**Files:**
- Create: `server/modules/agent/xiaoze/suggest.ts`, `server/modules/agent/xiaoze/suggest.test.ts`
- Modify: `server/modules/agent/xiaoze/agUiEndpoint.ts`, `server/config/env.ts`, `.env.example`

- [ ] **Step 1: Write failing tests** that `runXiaozeSuggest` uses only read perception tools (never a mutating tool), returns grounded suggestion items for the page context, and returns nothing for a project the user cannot access (authz-bounded).

```ts
it("produces grounded read-only suggestions", async () => {
  const runTool = vi.fn().mockResolvedValue({ summary: "3 high-risk parameters pending review", data: {}, citations: [{ type: "parameter", id: "p1", label: "x" }] });
  const result = await runXiaozeSuggest({ context: { projectId: "p1", pageKey: "parameter-review" }, runTool, listReadTools: () => ["perception.getProjectOverview"] });
  expect(result.suggestions[0]?.headline).toContain("pending review");
});

it("never calls a mutating tool", async () => {
  const runTool = vi.fn();
  await runXiaozeSuggest({ context: { pageKey: "parameters" }, runTool, listReadTools: () => [] });
  expect(runTool).not.toHaveBeenCalledWith(expect.stringContaining("action."), expect.anything());
});
```

- [ ] **Step 2: Run and confirm fail.** Run: `npm run test:server -- suggest` — Expected: FAIL.
- [ ] **Step 3: Implement `runXiaozeSuggest`** (read perception tools only; returns `{ suggestions: { id, tone, headline, meta?, citations }[] }`) and a route `POST /api/v1/agent/xiaoze/suggest` gated by auth and `XIAOZE_PROACTIVE_ENABLED`. Authz flows through the registry as in P0.
- [ ] **Step 4: Run tests to confirm pass.** Run: `npm run test:server -- suggest` — Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add server/modules/agent/xiaoze/suggest.ts server/modules/agent/xiaoze/suggest.test.ts server/modules/agent/xiaoze/agUiEndpoint.ts server/config/env.ts .env.example
git commit -m "feat(agent): add read-only opt-in xiaoze proactive suggest pass"
```

### Task 6: Proactive suggestions frontend

**Files:**
- Create: `src/features/agent/useXiaozeSuggestions.ts`, `src/features/agent/useXiaozeSuggestions.test.tsx`
- Modify: `src/features/agent/XiaozeProvider.tsx`

- [ ] **Step 1: Write failing tests** that the hook fetches suggestions for the current page when enabled, surfaces them as `Insight` items, performs no write, and fetches nothing when disabled.
- [ ] **Step 2: Run and confirm fail.** Run focused test — Expected: FAIL.
- [ ] **Step 3: Implement `useXiaozeSuggestions`** (calls the suggest route for the current page context when `VITE_XIAOZE_PROACTIVE_ENABLED`/user setting is on) and render results in `AgentInsightBar`; an insight action can open the Xiaoze chat pre-seeded with the suggestion. Dismiss uses the existing `AgentInsightBar` dismiss.
- [ ] **Step 4: Mount** in `XiaozeProvider`, gated by the opt-in flag.
- [ ] **Step 5: Run tests to confirm pass.** Run focused test — Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add src/features/agent/useXiaozeSuggestions.ts src/features/agent/useXiaozeSuggestions.test.tsx src/features/agent/XiaozeProvider.tsx
git commit -m "feat(frontend): surface xiaoze proactive suggestions in AgentInsightBar"
```

### Task 7: Acceptance + coverage IDs

**Files:**
- Create: `e2e/acceptance/xiaoze-planning.acceptance.spec.ts`
- Modify: `e2e/acceptance/operationMatrix.ts`, `e2e/acceptance/requirements.ts`, `docs/developer/user-operation-coverage-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md`

- [ ] **Step 1: Add IDs** `XIAOZE-PLAN-MULTISTEP-001` (multi-step task: perceive → approve → continue → report) and `XIAOZE-PROACTIVE-001` (opt-in grounded suggestion appears; authz-bounded) to the matrices and coverage docs.
- [ ] **Step 2: Write the acceptance spec** (deterministic model): drive a multi-step task through the approval card to completion and assert the final report references the created change; with proactive enabled, assert a grounded suggestion appears and dismiss works; with it off, assert none.
- [ ] **Step 3: Run.** Run: `npm run acceptance:e2e -- e2e/acceptance/xiaoze-planning.acceptance.spec.ts` — Expected: PASS.
- [ ] **Step 4: Commit.**

```bash
git add e2e/acceptance/xiaoze-planning.acceptance.spec.ts e2e/acceptance/operationMatrix.ts e2e/acceptance/requirements.ts docs/developer/user-operation-coverage-matrix.md docs/developer/browser-acceptance-coverage-map.md
git commit -m "test(agent): xiaoze multi-step planning and proactive acceptance"
```

### Task 8: Verification + docs

- [ ] **Step 1:** Run: `npm run test:server` — Expected: PASS (note unrelated env-only failures).
- [ ] **Step 2:** Run: `npm test -- src/features/agent` — Expected: PASS.
- [ ] **Step 3:** Run: `npm run build` — Expected: PASS.
- [ ] **Step 4:** Update `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/SECURITY.md` (+ zh), `docs/FRONTEND.md` (+ zh), `docs/developer/environment-variables.md` (+ zh), and the roadmap.
- [ ] **Step 5:** Run: `npm run docs:check` — Expected: PASS (keep English docs free of Chinese characters).
- [x] **Step 6:** Frontend browser verification with `playwright-cli` (desktop/tablet/mobile): run a multi-step task through approval to completion; verify a proactive suggestion appears (enabled) and is absent (disabled); capture screenshots under `work/ui-checks/`; check console/network. Record evidence.
- [ ] **Step 7:** Commit docs and `git diff --check`.

```bash
git add docs ARCHITECTURE.md
git commit -m "docs: document xiaoze p2 planning, checkpointing, and proactive suggestions"
```

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `docs/README.md` | Note proactive surface if it becomes a primary entry point. |
| Planning docs | Update | `docs/exec-plans/active/development-roadmap.md`, this plan | Mark P2 active then completed when gate passes. |
| Product specs | Review | `docs/product-specs/product-spec.md` | Agent now plans and proactively suggests; review wording. |
| Architecture docs | Update | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md` | Document the planning StateGraph + checkpointer + resume-into-graph. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md` | Add multi-step + proactive acceptance gates and IDs. |
| Reliability/runbooks | Review | `docs/runbooks/agent-provider.md` | Note checkpointer durability if Postgres-backed. |
| Security/governance docs | Update | `docs/SECURITY.md` (+ zh) | Record proactive perception is read-only, authz-bounded, opt-in; writes still approval-gated. |
| Frontend/design docs | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Document proactive suggestions and the opt-in flag. |
| Generated artifacts | Review | `docs/generated/` | Regenerate acceptance/operation evidence after Task 7. |
| References | Review | `docs/references/` | Add a compact planning-graph reference if repeated agent work needs it. |
| Chinese developer docs | Update | `docs/zh-CN/frontend.md`, Chinese env companion | Planning/proactive surface and env are developer-facing. |

## Documentation Update Gate

- `npm run docs:check` must pass before this plan moves to completed.
- Every `Update` row must be edited or recorded as unchanged with evidence; deferred items go to `docs/exec-plans/tech-debt-tracker.md`.
- If the checkpointer is `MemorySaver` (non-durable), record a tech-debt entry for durable checkpointing.
- Any Chinese companion not updated must record why.

## UI Interaction Automation Review

P2 adds a multi-step in-chat task flow and a proactive suggestion surface.

- Affected acceptance specs: `e2e/acceptance/xiaoze-planning.acceptance.spec.ts` (new); existing `xiaoze-action.acceptance.spec.ts` for the approval step.
- Acceptance requirement IDs: `XIAOZE-PLAN-MULTISTEP-001`, `XIAOZE-PROACTIVE-001` (new).
- Operation IDs: `XIAOZE-PLAN-MULTISTEP-001` (new).
- Required action: add browser acceptance for the multi-step task completing through approval and for the opt-in proactive suggestion appearing/being absent; preserve operation evidence generation.
- Required commands: `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:browser`, `npm run acceptance:evidence`.

## External Inputs Needed

- Whether proactive suggestions default off (recommended) and whether the opt-in is per-user, per-role, or org-level.
- Whether the checkpointer must be durable (Postgres) for the first pilot or in-memory is acceptable for P2 v1.
- Any limit on how many proactive suggestions may surface per page.

## Known Limitations

- **Real-auth browser screenshots:** Completed on 2026-06-24. Evidence captured with `AUTH_MODE=development` (auto-authorized seed admin `u-xu-yun`), `XIAOZE_DETERMINISTIC=true`, proactive flags enabled on both server and Vite (`XIAOZE_PROACTIVE_ENABLED=true`, `VITE_XIAOZE_PROACTIVE_ENABLED=true`), project `aurora` on `/parameters?project=aurora`, via `npm run dev:all` + `playwright-cli` at desktop `1440x900`, tablet `768x1024`, and mobile `390x844`. Console errors: 0 on verified flows (CopilotKit license and Lit dev-mode warnings only).
- **Proactive insight placement fix:** `XiaozeProactiveInsights` must render under `XiaozePageContext.Provider` (via `XiaozePageContextRegistrar`) so the hook receives page `projectId`; mounting it as a sibling of `AppShell` in `XiaozeProvider` left suggestions empty in the browser.

## Manual Browser Evidence (P2)

| Requirement | Screenshots | Interactions verified |
| --- | --- | --- |
| `XIAOZE-PROACTIVE-001` (enabled) | `work/ui-checks/xiaoze-p2-proactive-enabled-{desktop,tablet,mobile}.png` | Grounded headline `1 open change requests pending review`; `Ask Xiaoze` opens chat; dismiss hides bar; `POST /api/v1/agent/xiaoze/suggest` 200 |
| `XIAOZE-PROACTIVE-001` (disabled) | `work/ui-checks/xiaoze-p2-proactive-disabled-desktop.png` | No insight bar with `VITE_XIAOZE_PROACTIVE_ENABLED=false` |
| `XIAOZE-PROACTIVE-001` (authz) | API only | `x-wiseeff-user: u-liu-min` + `projectId=secret-project` returns `{ "suggestions": [] }` |
| `XIAOZE-PLAN-MULTISTEP-001` (approve) | `work/ui-checks/xiaoze-p2-multistep-approve-{desktop,tablet,mobile}.png` | Prompt → HITL card → Approve → checkpoint resume → message cites new change request UUID |
| `XIAOZE-PLAN-MULTISTEP-001` (reject) | `work/ui-checks/xiaoze-p2-multistep-reject-desktop.png` | Reject → `Tool request rejected: Rejected in Xiaoze chat.` with no write |
