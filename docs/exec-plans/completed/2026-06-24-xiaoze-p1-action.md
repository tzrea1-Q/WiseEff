# Xiaoze P1 Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Code changes must follow `superpowers:test-driven-development`: write the failing test first, verify it fails, implement the smallest change, then verify green.

**Goal:** Let Xiaoze (小泽) take real frontend-equivalent actions for the user — including mutating writes such as submitting a parameter change — where every mutating action flows through the existing approval chain (human approval + transactional re-authorization + audit `actorType=agent`), surfaced in chat via AG-UI human-in-the-loop. Also remove the now-redundant Pi provider.

**Architecture:** Add mutating "action" tools to the existing `ToolRegistry` (`kind: "mutating"`, `requiresApproval: true`). Bridge the P0 Xiaoze AG-UI runtime into the existing agent `Orchestrator` so mutating requests create persisted tool-call + approval records, pause the run with an AG-UI interrupt, and resume on the user's decision by calling the orchestrator's existing `approveToolCall` / `rejectToolCall` (which re-check authz and audit inside a transaction). Low-risk UI orchestration (navigate, pre-fill) uses CopilotKit frontend tools. The agent never bypasses any guard.

**Tech Stack:** TypeScript, existing agent `Orchestrator` + `agent_approvals` chain, LangGraph.js, AG-UI interrupts (`@ag-ui/core` / `@ag-ui/client`), CopilotKit V2 (`useInterrupt`, `useFrontendTool`), `ChatOpenAI`, Vitest, Playwright acceptance.

---

## Reference Basis

- Design spec: `docs/superpowers/specs/2026-06-24-xiaoze-agent-design.md` (security/approval model; execution model assumption).
- Completed P0 plan: `docs/exec-plans/completed/2026-06-24-xiaoze-p0-perception.md` and its `server/modules/agent/xiaoze/SPIKE.md`.
- Existing approval chain: `server/modules/agent/orchestrator.ts` (`approveToolCall` at ~552, transactional re-authorize + run + audit; `executeToolCall`; `createApprovalForToolCall`).
- Approval persistence: `server/modules/agent/repository.ts` (`getAgentApproval`, `getAgentToolCall`, `markAgentApprovalApproved`, `updateAgentToolCall`).
- Existing mutating tool example: `parameter.submitChangeDraft` in `server/modules/agent/tools/parameterTools.ts` and `piProvider.ts` metadata (mutating + grounded).
- Existing approval UI pattern: `src/features/agent/UnifiedAgent.tsx` (AlertDialog approve/reject), `src/application/ports/AgentGateway.ts` (`approveToolCall`/`rejectToolCall`).
- AG-UI interrupts: https://github.com/ag-ui-protocol/ag-ui (interrupt-aware run lifecycle; the next `RunAgentInput` on the same thread carries a `resume` array; interrupt `reason: "tool_call"` + `toolCallId`).
- Device write guards (must not be bypassed): `server/modules/debugging/service.ts` (`confirm-high-risk-write`, `confirm-rollback`, lease, snapshot, readback) and `docs/SECURITY.md`.
- Pi removal target: `docs/exec-plans/tech-debt-tracker.md` TD-027.

## Scope Boundary

P1 includes:

- Mutating "action" tools registered in `ToolRegistry` (`kind: "mutating"`, `requiresApproval: true`), starting minimal: `action.submitParameterChange`.
- Bridging the Xiaoze AG-UI runtime to the existing `Orchestrator` so mutating requests persist a tool-call + approval and pause via an AG-UI interrupt.
- AG-UI interrupt emission and resume handling that calls the existing `approveToolCall` / `rejectToolCall`.
- A CopilotKit frontend HITL approval card (`useInterrupt`) showing the proposed change, with approve / reject / edit-value.
- Low-risk CopilotKit frontend tools (`useFrontendTool`): navigate to a page and pre-fill a recommended value (no write).
- Removal of the Pi provider (TD-027): files, env, dependency, smoke script, runbook/evidence docs.
- Tests: mutating-tool authz/approval unit tests, interrupt/resume endpoint tests, frontend HITL card tests; acceptance for approve, reject, and authz-denied paths.

P1 excludes:

- Device writes / rollback execution by Xiaoze (still user-driven in the debugging UI; Xiaoze may only prepare). High-risk device guards remain UI/endpoint-owned in P1.
- Proactive suggestions, multi-step plan-act-observe autonomy, checkpoint resume (P2).
- Expanding mutating tools beyond `action.submitParameterChange` (add more in follow-ups once the pattern is proven).
- MCP exposure and multi-agent collaboration.

## Dependencies And Ordering

- Requires P0 (merged on `feat/xiaoze-agent`): perception tools, `perceptionAgent`, `agUiEndpoint`, CopilotKit provider.
- Confirm the design-spec execution-model assumption before Task 2: Xiaoze executes mutating actions only after explicit human approval. This plan assumes approval-gated execution.
- The existing `/api/v1/agent/*` orchestrator endpoints and `agent_approvals` table must be available (M4 baseline).

## Success Criteria

- [ ] When Xiaoze proposes a parameter change, the run pauses and the chat shows a HITL approval card with the proposed project/parameter/target value and the grounding citations.
- [ ] Approving the card executes the change through the existing approval chain: authz re-checked in a transaction, persisted, audited with `actorType=agent`, and the chat reports the result (e.g. change request id).
- [ ] Rejecting the card records the rejection, does not mutate state, and the chat acknowledges.
- [ ] A user without permission for the target project gets a denied result (no mutation, `FORBIDDEN`), surfaced as a safe message; no approval card grants more than the user could do manually.
- [ ] Editing the proposed value in the card changes what gets submitted (the edited args are a full replacement, per AG-UI interrupt semantics).
- [ ] Frontend `useFrontendTool` navigate/pre-fill works and performs no write.
- [ ] Pi provider is removed; `AGENT_PROVIDER=live` with `AGENT_API_FORMAT=openai`/`wiseeff` still works; `@earendil-works/pi-ai` is no longer a dependency.
- [ ] `npm run test:server`, frontend focused tests, `npm run build`, `npm run docs:check` pass; acceptance for approve/reject/denied passes with operation/requirement IDs added.

## Expected File Structure

Create:

- `server/modules/agent/tools/actionTools.ts`: mutating action tools (`action.submitParameterChange`).
- `server/modules/agent/tools/actionTools.test.ts`: kind/approval/authz unit tests.
- `server/modules/agent/xiaoze/approvalBridge.ts`: maps a LangGraph mutating tool request to an orchestrator tool-call + approval, emits the AG-UI interrupt payload, and resolves a resume decision via `approveToolCall`/`rejectToolCall`.
- `server/modules/agent/xiaoze/approvalBridge.test.ts`: interrupt emission + resume → approve/reject tests with a fake orchestrator.
- `src/features/agent/XiaozeApprovalCard.tsx`: HITL approval card rendered via `useInterrupt`.
- `src/features/agent/XiaozeApprovalCard.test.tsx`: approve/reject/edit interactions.
- `src/features/agent/xiaozeFrontendTools.ts`: `useFrontendTool` navigate + pre-fill registrations.
- `src/features/agent/xiaozeFrontendTools.test.tsx`: navigate/pre-fill perform no write.

Modify:

- `server/modules/agent/types.ts`: add `action.submitParameterChange` to `AgentToolName`.
- `server/modules/agent/toolRegistry.ts`: register action tools.
- `server/modules/agent/xiaoze/perceptionAgent.ts`: allow the tool loop to surface a mutating request as an interrupt outcome instead of executing it.
- `server/modules/agent/xiaoze/agUiEndpoint.ts`: persist runs via the orchestrator session, emit interrupt on mutating requests, handle the `resume` input to approve/reject.
- `server/modules/agent/providerRegistry.ts`: remove the `pi` branch.
- `server/modules/agent/piProvider.ts`, `server/modules/agent/piProvider.test.ts`, `scripts/run-pi-agent-smoke.ts`: delete.
- `server/config/env.ts`, `.env.example`: remove `AGENT_API_FORMAT=pi` / `AGENT_PI_PROVIDER`.
- `package.json`: remove `@earendil-works/pi-ai` and the `agent:pi-smoke` script.
- `src/features/agent/XiaozeProvider.tsx`: mount the approval card and frontend tools.
- `docs/runbooks/agent-provider.md`, `docs/references/pi-agent-provider-evidence.md`: remove Pi sections / mark superseded.
- `docs/SECURITY.md`, `docs/design-docs/full-stack-architecture.md`, `ARCHITECTURE.md`: document Xiaoze mutating actions via the existing approval chain.
- `docs/FRONTEND.md` (+ `docs/zh-CN/frontend.md`), `docs/developer/environment-variables.md` (+ Chinese companion): document the approval card and removed Pi env.
- `docs/developer/user-operation-coverage-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md`: add action operation/requirement IDs.
- `docs/exec-plans/tech-debt-tracker.md`: close TD-027.
- `docs/exec-plans/active/development-roadmap.md`: update Xiaoze status.

## Implementation Tasks

### Task 1: Spike — interrupt/resume + orchestrator bridge shape

**Files:**
- Create: `server/modules/agent/xiaoze/SPIKE-P1.md`

- [ ] **Step 1:** Confirm how the P0 `agUiEndpoint` can persist a session via the orchestrator (does the orchestrator expose `startSession`/`sendMessage`, and can a tool-call + approval be created without auto-executing?). Record the exact orchestrator/repository functions to reuse.
- [ ] **Step 2:** Define the AG-UI interrupt payload for a mutating tool: emit `TOOL_CALL_START`/`TOOL_CALL_ARGS`/`TOOL_CALL_END` for a frontend-handled tool (e.g. `xiaoze_approval`) carrying `{ approvalId, toolCallId, toolName, payload, citations }`, then `RUN_FINISHED` with the interrupt; the resume run carries `resume: [{ approvalId, decision, editedArgs? }]`.
- [ ] **Step 3:** Decide where authz is enforced on resume: always call the existing `approveToolCall` (which re-authorizes in a transaction). Record that `editedArgs` is a full replacement of the tool payload.
- [ ] **Step 4:** Write `SPIKE-P1.md` with the decisions and a 15-line end-to-end sketch. Commit.

```bash
git add server/modules/agent/xiaoze/SPIKE-P1.md
git commit -m "docs: xiaoze p1 interrupt/approval bridge spike"
```

### Task 2: Mutating action tool

**Files:**
- Create: `server/modules/agent/tools/actionTools.ts`, `server/modules/agent/tools/actionTools.test.ts`
- Modify: `server/modules/agent/types.ts`, `server/modules/agent/toolRegistry.ts`

- [ ] **Step 1: Write failing tests** that `action.submitParameterChange` is `kind: "mutating"`, `requiresApproval: true`, and that running it writes a parameter change draft/request via the injected db, returning a citation to the created record.

```ts
import { describe, expect, it, vi } from "vitest";
import { createActionTools } from "./actionTools";

const insertedId = "cr-1";
const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: insertedId }], rowCount: 1 }) };
const adminContext = {
  auth: { organization: { id: "org1" }, user: { id: "u1" }, roles: [{ roleId: "admin", projectId: null }] },
  requestId: "r1",
  sessionId: "s1",
  projectId: "p1"
} as any;

describe("action.submitParameterChange", () => {
  it("is mutating and approval-gated", () => {
    const tool = createActionTools({ db }).find((t) => t.name === "action.submitParameterChange")!;
    expect(tool.kind).toBe("mutating");
    expect(tool.requiresApproval).toBe(true);
  });

  it("submits a parameter change and cites the created record", async () => {
    const tool = createActionTools({ db }).find((t) => t.name === "action.submitParameterChange")!;
    const result = await tool.run(adminContext, { projectId: "p1", parameterId: "pd1", targetValue: "42", reason: "charging slow" });
    expect(result.citations[0]?.id).toBe(insertedId);
  });
});
```

- [ ] **Step 2: Run and confirm fail.** Run: `npm run test:server -- actionTools` — Expected: FAIL (module not found).
- [ ] **Step 3: Add `action.submitParameterChange`** to `AgentToolName`; implement `createActionTools` following the `parameterTools.ts` write pattern and the existing `parameter.submitChangeDraft` semantics (create a reviewable change, never auto-merge). Use the same SQL the existing parameter submit path uses (verify table/columns against `parameterTools.ts` / `server/modules/parameters/service.ts`). Set `permission` to the existing parameter-submit permission string.
- [ ] **Step 4: Register** `...createActionTools(options)` in `createAgentToolRegistry`.
- [ ] **Step 5: Run tests to confirm pass.** Run: `npm run test:server -- actionTools` — Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add server/modules/agent/tools/actionTools.ts server/modules/agent/tools/actionTools.test.ts server/modules/agent/types.ts server/modules/agent/toolRegistry.ts
git commit -m "feat(agent): add approval-gated submitParameterChange action tool"
```

### Task 3: Surface mutating requests as interrupts in the agent loop

**Files:**
- Modify: `server/modules/agent/xiaoze/perceptionAgent.ts`
- Modify/Create: `server/modules/agent/xiaoze/perceptionAgent.test.ts`

- [ ] **Step 1: Write a failing test** that when the model requests a tool whose definition is `requiresApproval: true`, the agent run returns an `interrupt` outcome (with tool name + payload + citations) instead of executing the tool.

```ts
it("returns an interrupt for approval-gated tools instead of executing", async () => {
  const runTool = vi.fn();
  const fakeModel = makeFakeModelThatCalls("action.submitParameterChange", { projectId: "p1", parameterId: "pd1", targetValue: "42", reason: "x" });
  const agent = createPerceptionAgent({
    model: fakeModel,
    runTool,
    listTools: () => [{ name: "action.submitParameterChange", description: "x", schema: {}, requiresApproval: true }]
  });
  const result = await agent.run({ message: "set pd1 to 42", context: { projectId: "p1" } });
  expect(runTool).not.toHaveBeenCalled();
  expect(result.interrupt?.toolName).toBe("action.submitParameterChange");
});
```

- [ ] **Step 2: Run and confirm fail.** Run: `npm run test:server -- perceptionAgent` — Expected: FAIL.
- [ ] **Step 3: Implement** the interrupt branch: extend `listTools` items with `requiresApproval`; in the tool node, if the requested tool is approval-gated, stop and return `{ interrupt: { toolName, payload, citations } }` rather than calling `runTool`. Read tools without approval continue to execute.
- [ ] **Step 4: Run tests to confirm pass.** Run: `npm run test:server -- perceptionAgent` — Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add server/modules/agent/xiaoze/perceptionAgent.ts server/modules/agent/xiaoze/perceptionAgent.test.ts
git commit -m "feat(agent): pause xiaoze loop on approval-gated tool requests"
```

### Task 4: Approval bridge to the existing orchestrator chain

**Files:**
- Create: `server/modules/agent/xiaoze/approvalBridge.ts`, `server/modules/agent/xiaoze/approvalBridge.test.ts`
- Modify: `server/modules/agent/xiaoze/agUiEndpoint.ts`

- [ ] **Step 1: Write failing tests** that (a) on a mutating interrupt the bridge creates a persisted tool-call + approval via the orchestrator and emits an AG-UI interrupt referencing the `approvalId`, and (b) a resume with `decision: "approve"` calls the orchestrator `approveToolCall(approvalId)` and `decision: "reject"` calls `rejectToolCall`.

```ts
it("approves via the orchestrator on resume", async () => {
  const orchestrator = { createApproval: vi.fn().mockResolvedValue({ approvalId: "a1", toolCallId: "t1" }), approveToolCall: vi.fn().mockResolvedValue({ messages: [{ content: "done" }] }), rejectToolCall: vi.fn() };
  const bridge = createApprovalBridge({ orchestrator });
  const interrupt = await bridge.begin({ auth: anyAuth, sessionId: "s1", toolName: "action.submitParameterChange", payload: { projectId: "p1" }, citations: [] });
  expect(interrupt.approvalId).toBe("a1");
  await bridge.resume({ auth: anyAuth, approvalId: "a1", decision: "approve" });
  expect(orchestrator.approveToolCall).toHaveBeenCalledWith(expect.objectContaining({ approvalId: "a1" }));
});
```

- [ ] **Step 2: Run and confirm fail.** Run: `npm run test:server -- approvalBridge` — Expected: FAIL.
- [ ] **Step 3: Implement `createApprovalBridge`.** `begin` uses the orchestrator/repository to persist a tool-call in `pending_approval` and create an approval (reuse `createApprovalForToolCall` semantics), returning `{ approvalId, toolCallId }`. `resume` calls the existing `approveToolCall` (which re-authorizes + executes + audits in a transaction) or `rejectToolCall`. For `editedArgs`, update the tool-call payload before approval (full replacement). All authz stays in `approveToolCall`.
- [ ] **Step 4: Wire `agUiEndpoint`** to: persist a session for the run, on `result.interrupt` call `bridge.begin` and emit the AG-UI interrupt event sequence (per Task 1), and on a `resume` request input call `bridge.resume` then stream the result text + `RUN_FINISHED`.
- [ ] **Step 5: Run tests to confirm pass.** Run: `npm run test:server -- approvalBridge agUiEndpoint` — Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add server/modules/agent/xiaoze/approvalBridge.ts server/modules/agent/xiaoze/approvalBridge.test.ts server/modules/agent/xiaoze/agUiEndpoint.ts
git commit -m "feat(agent): bridge xiaoze mutating actions to the approval chain"
```

### Task 5: Frontend HITL approval card

**Files:**
- Create: `src/features/agent/XiaozeApprovalCard.tsx`, `src/features/agent/XiaozeApprovalCard.test.tsx`
- Modify: `src/features/agent/XiaozeProvider.tsx`

- [ ] **Step 1: Write failing tests** that the card renders the proposed change and that approve/reject call the interrupt resolver with the right decision, and editing the value sends `editedArgs`.

```tsx
it("resolves approve with edited value", async () => {
  const resolve = vi.fn();
  render(<XiaozeApprovalCard interrupt={{ approvalId: "a1", toolName: "action.submitParameterChange", payload: { projectId: "p1", parameterId: "pd1", targetValue: "42" }, citations: [] }} resolve={resolve} />);
  fireEvent.change(screen.getByLabelText(/target value/i), { target: { value: "50" } });
  fireEvent.click(screen.getByRole("button", { name: /approve/i }));
  expect(resolve).toHaveBeenCalledWith({ decision: "approve", editedArgs: expect.objectContaining({ targetValue: "50" }) });
});
```

- [ ] **Step 2: Run and confirm fail.** Run focused test — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `XiaozeApprovalCard`** using CopilotKit `useInterrupt` to detect the `xiaoze_approval` interrupt, render the proposed change + citations, and resolve with `{ decision, editedArgs? }`. Reuse existing AlertDialog/card styling from `UnifiedAgent.tsx`.
- [ ] **Step 4: Mount** the card inside `XiaozeProvider`.
- [ ] **Step 5: Run tests to confirm pass.** Run focused test — Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add src/features/agent/XiaozeApprovalCard.tsx src/features/agent/XiaozeApprovalCard.test.tsx src/features/agent/XiaozeProvider.tsx
git commit -m "feat(frontend): xiaoze HITL approval card via useInterrupt"
```

### Task 6: Frontend low-risk tools (navigate + pre-fill)

**Files:**
- Create: `src/features/agent/xiaozeFrontendTools.ts`, `src/features/agent/xiaozeFrontendTools.test.tsx`
- Modify: `src/features/agent/XiaozeProvider.tsx`

- [ ] **Step 1: Write failing tests** that `useXiaozeFrontendTools` registers a `navigateTo` tool that changes the route and a `prefillParameterValue` tool that sets a form value, and that neither performs a network write.
- [ ] **Step 2: Run and confirm fail.** Run focused test — Expected: FAIL.
- [ ] **Step 3: Implement** with `useFrontendTool`: `navigateTo({ path })` and `prefillParameterValue({ parameterId, value })` operating on existing runtime/router only.
- [ ] **Step 4: Mount** in `XiaozeProvider`.
- [ ] **Step 5: Run tests to confirm pass.** Run focused test — Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add src/features/agent/xiaozeFrontendTools.ts src/features/agent/xiaozeFrontendTools.test.tsx src/features/agent/XiaozeProvider.tsx
git commit -m "feat(frontend): xiaoze low-risk navigate and prefill tools"
```

### Task 7: Remove the Pi provider (TD-027)

**Files:**
- Delete: `server/modules/agent/piProvider.ts`, `server/modules/agent/piProvider.test.ts`, `scripts/run-pi-agent-smoke.ts`
- Modify: `server/modules/agent/providerRegistry.ts`, `server/config/env.ts`, `.env.example`, `package.json`, `docs/runbooks/agent-provider.md`, `docs/references/pi-agent-provider-evidence.md`, `docs/exec-plans/tech-debt-tracker.md`

- [ ] **Step 1: Write/adjust the failing test** in `providerRegistry`'s test that `AGENT_API_FORMAT=pi` is no longer accepted (now an error) and that `openai`/`wiseeff` still resolve.
- [ ] **Step 2: Run and confirm fail.** Run: `npm run test:server -- providerRegistry` — Expected: FAIL.
- [ ] **Step 3: Remove the `pi` branch** and `AGENT_PI_PROVIDER` usage from `providerRegistry.ts`; delete the Pi files; remove `@earendil-works/pi-ai` from `package.json` and the `agent:pi-smoke` script; remove `AGENT_API_FORMAT=pi`/`AGENT_PI_PROVIDER` from `env.ts` and `.env.example`.
- [ ] **Step 4: Run tests to confirm pass.** Run: `npm run test:server -- providerRegistry` — Expected: PASS.
- [ ] **Step 5: Update docs** — remove/supersede Pi sections in the runbook and evidence reference; close TD-027 in `tech-debt-tracker.md` with evidence.
- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "refactor(agent): remove redundant Pi provider (TD-027)"
```

### Task 8: Acceptance + coverage IDs

**Files:**
- Create: `e2e/acceptance/xiaoze-action.acceptance.spec.ts`
- Modify: `e2e/acceptance/operationMatrix.ts`, `e2e/acceptance/requirements.ts`, `docs/developer/user-operation-coverage-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md`

- [ ] **Step 1: Add IDs** `XIAOZE-ACTION-APPROVE-001`, `XIAOZE-ACTION-REJECT-001`, `XIAOZE-ACTION-AUTHZ-001` to the coverage docs and matrices.
- [ ] **Step 2: Write the acceptance spec** (deterministic model path): ask Xiaoze to change a parameter, assert the approval card appears with the proposed value; approve → assert the change request exists + audit `actorType=agent`; reject → assert no mutation; denied project → assert no mutation and a safe message.
- [ ] **Step 3: Run.** Run: `npm run test:e2e -- e2e/acceptance/xiaoze-action.acceptance.spec.ts` — Expected: PASS.
- [ ] **Step 4: Commit.**

```bash
git add e2e/acceptance/xiaoze-action.acceptance.spec.ts e2e/acceptance/operationMatrix.ts e2e/acceptance/requirements.ts docs/developer/user-operation-coverage-matrix.md docs/developer/browser-acceptance-coverage-map.md
git commit -m "test(agent): xiaoze action approval/reject/authz acceptance"
```

### Task 9: Verification + docs

- [ ] **Step 1:** Run: `npm run test:server` — Expected: PASS (note any unrelated env-only failures).
- [ ] **Step 2:** Run focused frontend tests for `src/features/agent` — Expected: PASS.
- [ ] **Step 3:** Run: `npm run build` — Expected: PASS.
- [ ] **Step 4:** Update `docs/SECURITY.md`, `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/FRONTEND.md` (+ `docs/zh-CN/frontend.md`), `docs/developer/environment-variables.md` (+ Chinese companion), and the roadmap.
- [ ] **Step 5:** Run: `npm run docs:check` — Expected: PASS.
- [ ] **Step 6:** Run: `git diff --check`. Commit docs.
- [ ] **Step 7:** Frontend browser verification with `playwright-cli` (desktop/tablet/mobile): trigger an action, exercise the approval card approve/reject/edit, capture screenshots under `work/ui-checks/`, check console/network. Record evidence in the completion report.

```bash
git add docs ARCHITECTURE.md
git commit -m "docs: document xiaoze p1 action and approval chain"
```

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `docs/README.md` | Pi runbook link removed; Xiaoze action surface noted if it becomes a primary entry. |
| Planning docs | Update | `docs/exec-plans/active/development-roadmap.md`, this plan, `docs/exec-plans/tech-debt-tracker.md` | Update Xiaoze status; close TD-027. |
| Product specs | Review | `docs/product-specs/product-spec.md` | Agent assistance now performs approval-gated writes; review wording. |
| Architecture docs | Update | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md` | Document Xiaoze mutating actions reusing the orchestrator approval chain; Pi removed. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md` | Add action acceptance gate and IDs. |
| Reliability/runbooks | Update | `docs/runbooks/agent-provider.md` | Remove Pi section; keep OpenAI-compatible live provider guidance. |
| Security/governance docs | Update | `docs/SECURITY.md` | Record that Xiaoze writes require human approval + transactional re-authz + audit; device guards unchanged. |
| Frontend/design docs | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Document the HITL approval card and frontend tools. |
| Generated artifacts | Review | `docs/generated/` | Regenerate acceptance/operation evidence after Task 8. |
| References | Update | `docs/references/pi-agent-provider-evidence.md` | Mark superseded by Pi removal. |
| Chinese developer docs | Update | `docs/zh-CN/frontend.md`, Chinese env companion | Action surface and env changes are developer-facing. |

## Documentation Update Gate

- `npm run docs:check` must pass before this plan moves to completed.
- TD-027 must be closed with evidence that Pi files/dependency/env/smoke are removed and `openai`/`wiseeff` live providers still work.
- Every `Update` row must be edited or recorded as unchanged with evidence; deferred items go to `docs/exec-plans/tech-debt-tracker.md`.
- Any Chinese companion not updated must record why.

## UI Interaction Automation Review

P1 adds approval-gated mutating actions initiated from the Xiaoze chat.

- Affected acceptance specs: `e2e/acceptance/xiaoze-action.acceptance.spec.ts` (new).
- Acceptance requirement IDs: `XIAOZE-ACTION-APPROVE-001`, `XIAOZE-ACTION-REJECT-001`, `XIAOZE-ACTION-AUTHZ-001` (new).
- Operation IDs: `XIAOZE-ACTION-APPROVE-001` (new).
- Required action: add browser acceptance for the approval card approve/reject/edit and the authz-denied path; preserve operation evidence generation.
- Required commands: `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:browser`, `npm run acceptance:evidence`.

## External Inputs Needed

- Confirmation that `action.submitParameterChange` should create a change request for review (not a direct merge) in P1.
- Which roles may trigger Xiaoze actions in P1 (all permitted users vs a pilot role).
- Whether `editedArgs` editing should be limited to the target value or allow editing the reason too.
