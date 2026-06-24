# Xiaoze P0 Perception Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Code changes must follow `superpowers:test-driven-development`: write the failing test first, verify it fails, implement the smallest change, then verify green.

**Goal:** Give the Xiaoze (小泽) agent grounded perception — it can see the user's current page state and proactively read any other data the user is permitted to access across pages, then summarize and answer questions, all through a CopilotKit/AG-UI chat surface.

**Architecture:** Add read-only, authz-bounded "perception tools" to the existing backend `ToolRegistry`. Introduce a LangGraph.js perceive/answer agent (model via LangChain `ChatOpenAI` against the existing OpenAI-compatible endpoint) exposed over the AG-UI protocol. Wire a CopilotKit V2 frontend provider plus per-page `useAgentContext` so the agent receives current-page state. No mutating tools, no human-in-the-loop writes, no proactive autonomy in P0; those are P1/P2.

**Tech Stack:** TypeScript, LangGraph.js (`@langchain/langgraph`), LangChain `ChatOpenAI` (`@langchain/openai`), AG-UI (`@ag-ui/*`), CopilotKit V2 (`@copilotkit/react-core/v2`), existing WiseEff backend modular monolith + `WiseEffRouter`, Vite/React frontend, Vitest, Playwright acceptance.

---

## Reference Basis

- Design spec: `docs/superpowers/specs/2026-06-24-xiaoze-agent-design.md` (EN) / `docs/zh-CN/superpowers/specs/2026-06-24-xiaoze-agent-design.md` (ZH).
- AG-UI protocol: https://github.com/ag-ui-protocol/ag-ui (SSE event stream, ~16 event types, interrupts).
- CopilotKit V2 self-managed agents: https://docs.copilotkit.ai (`selfManagedAgents` + `@ag-ui/client` `HttpAgent`; hooks `useAgentContext`, `useAgent`, `useFrontendTool`, `useInterrupt`; provider `CopilotKitProvider` / `CopilotKit` from `@copilotkit/react-core/v2`).
- LangGraph.js: https://langchain-ai.github.io/langgraphjs/ (`StateGraph`, prebuilt `createReactAgent`, `interrupt`, checkpointing).
- Existing agent code: `server/modules/agent/toolRegistry.ts`, `server/modules/agent/tools/parameterTools.ts` (tool authoring pattern), `server/modules/agent/policy.ts` (`requireAgentPermission`, `requireAgentProjectAccess`), `server/modules/agent/orchestrator.ts`, `server/modules/agent/providerRegistry.ts`.
- Existing acceptance: `e2e/acceptance/agent.acceptance.spec.ts`.

## Scope Boundary

P0 includes:

- A new group of read-only perception tools (cross-page, permission-bounded) registered in `ToolRegistry`.
- A LangGraph.js perceive/answer agent that calls perception tools and produces grounded summaries/answers with citations.
- An AG-UI-compatible backend endpoint exposing that agent, secured by the existing auth/authz context.
- A CopilotKit V2 frontend provider and chat surface, plus per-page `useAgentContext` declaring current-page visible state.
- Env variables for the Xiaoze runtime and OpenAI-compatible model endpoint.
- Unit tests for perception-tool authz boundaries, agent grounding, and the AG-UI endpoint; one perception acceptance spec.

P0 excludes:

- Any mutating tool, write action, or device action (P1).
- AG-UI human-in-the-loop approval UI wired to writes (P1).
- Proactive suggestions, multi-step plan-act-observe autonomy, and checkpoint resume (P2).
- Removing the Pi provider files (tracked separately; P0 only stops using them by setting the new runtime). Pi removal lands in P1 where the provider seam is reworked.
- MCP exposure and multi-agent collaboration.

## Dependencies And Ordering

- P0 is the foundation for P1 (action) and P2 (planning). It must ship first.
- The OpenAI-compatible endpoint and key must be available (reuses existing `AGENT_API_BASE_URL` / `AGENT_API_KEY` conventions).
- The existing `deterministic` provider remains the offline test double; P0 tests must not require a live model.

## Success Criteria

- [ ] A user can open the Xiaoze chat in any workflow page and ask a question; the agent answers grounded in the current page's declared context.
- [ ] The agent can proactively pull cross-page data the user is permitted to see (e.g. from the parameters page, read node/log data) via perception tools.
- [ ] Perception tools reject out-of-scope access: a request for a project the user cannot access returns `FORBIDDEN` and the agent surfaces a safe "not permitted" answer instead of data.
- [ ] No perception tool can mutate state (all are `kind: "read"`).
- [ ] The AG-UI endpoint authenticates every request using the existing auth context; unauthenticated requests are rejected.
- [ ] `npm run test:server`, frontend focused tests, `npm run build`, and `npm run docs:check` pass.
- [ ] Perception acceptance spec passes; operation/requirement IDs added.

## Expected File Structure

Create:

- `server/modules/agent/tools/perceptionTools.ts`: read-only cross-page perception tools.
- `server/modules/agent/tools/perceptionTools.test.ts`: authz boundary + result-shape unit tests.
- `server/modules/agent/xiaoze/perceptionAgent.ts`: LangGraph perceive/answer agent factory (model + perception tools loop).
- `server/modules/agent/xiaoze/perceptionAgent.test.ts`: grounding tests with an injected fake chat model.
- `server/modules/agent/xiaoze/agUiEndpoint.ts`: AG-UI SSE bridge that runs the agent under the request's auth context.
- `server/modules/agent/xiaoze/agUiEndpoint.test.ts`: auth enforcement + event-stream shape tests.
- `server/modules/agent/xiaoze/SPIKE.md`: spike findings doc (transport + runtime decision; see Task 1).
- `src/features/agent/XiaozeProvider.tsx`: CopilotKit V2 provider configured with a self-managed `HttpAgent`.
- `src/features/agent/useXiaozePageContext.ts`: hook wrapping `useAgentContext` for declaring page-visible state.
- `src/features/agent/XiaozeProvider.test.tsx`: provider mounts and exposes context.

Modify:

- `server/modules/agent/toolRegistry.ts`: register perception tools.
- `server/modules/agent/types.ts`: extend `AgentToolName` with perception tool names.
- `server/app.ts`: register the AG-UI route next to `registerAgentRoutes`, gated by `XIAOZE_RUNTIME_ENABLED`.
- `server/config/env.ts`: add `XIAOZE_*` env schema.
- `.env.example`: document new env.
- `src/App.tsx`: mount `XiaozeProvider` around the app; replace the current `UnifiedAgent` mount path for perception (keep behind a flag).
- `src/features/agent/UnifiedAgent.tsx`: route page-context declaration through `useXiaozePageContext` (read-only in P0).
- `package.json`: add `@langchain/langgraph`, `@langchain/openai`, `@ag-ui/client`, `@ag-ui/core` (backend) and `@copilotkit/react-core` (frontend), pinned to current versions resolved at install.
- `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`: document the Xiaoze perception surface.
- `docs/design-docs/full-stack-architecture.md`, `ARCHITECTURE.md`: document the AG-UI + LangGraph perception seam.
- `docs/developer/environment-variables.md` and Chinese companion: document `XIAOZE_*`.
- `docs/developer/user-operation-coverage-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md`: add perception operation/requirement IDs.
- `docs/exec-plans/active/development-roadmap.md`: link this plan.

## Implementation Tasks

### Task 1: Integration Spike (transport + runtime shape)

**Files:**
- Create: `server/modules/agent/xiaoze/SPIKE.md`

- [ ] **Step 1: Verify SSE support in `WiseEffRouter`.** Inspect `server/shared/http/router.ts` and confirm whether a route handler can stream `text/event-stream`. Record yes/no and the exact streaming mechanism (raw `res` access, async iterator, etc.).

- [ ] **Step 2: Choose the AG-UI transport.** Decide between (a) self-managed `HttpAgent` on the frontend pointing at our own AG-UI SSE endpoint, vs (b) `CopilotRuntime` Node endpoint proxying an `AbstractAgent`. Decision criteria: (a) is simpler and keeps auth on our existing endpoint; pick (a) unless `WiseEffRouter` cannot stream SSE, in which case pick (b) with `copilotRuntimeNodeHttpEndpoint`.

- [ ] **Step 3: Choose the LangGraph↔AG-UI binding.** Decide between emitting AG-UI events manually around `createReactAgent`, vs an existing `@ag-ui/langgraph` adapter if it cleanly supports our auth-injected tools. Record the decision and the minimal event set needed for P0 (`RUN_STARTED`, `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `RUN_FINISHED`, `RUN_ERROR`).

- [ ] **Step 4: Write `SPIKE.md`** capturing the three decisions, the chosen package versions, and a 10-line end-to-end sketch. Commit.

```bash
git add server/modules/agent/xiaoze/SPIKE.md
git commit -m "docs: xiaoze p0 integration spike findings"
```

### Task 2: Perception tool names and registry slot

**Files:**
- Modify: `server/modules/agent/types.ts:1-10`
- Modify: `server/modules/agent/toolRegistry.ts:45-52`

- [ ] **Step 1: Write the failing test** that the registry exposes the new perception tool names.

```ts
// server/modules/agent/tools/perceptionTools.test.ts
import { describe, expect, it } from "vitest";
import { createAgentToolRegistry } from "../toolRegistry";

const fakeDb = { query: async () => ({ rows: [], rowCount: 0 }) };

describe("perception tools registration", () => {
  it("registers read-only perception tools", () => {
    const registry = createAgentToolRegistry({ db: fakeDb });
    const overview = registry.get("perception.getProjectOverview");
    expect(overview?.kind).toBe("read");
    expect(overview?.requiresApproval).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run: `npm run test:server -- perceptionTools` — Expected: FAIL (`perception.getProjectOverview` unknown / tool undefined).

- [ ] **Step 3: Extend `AgentToolName`** with the perception names.

```ts
export type AgentToolName =
  | "parameter.scanOrphans"
  | "parameter.draftCleanupPlan"
  | "parameter.summarizeReviewQueue"
  | "parameter.submitChangeDraft"
  | "log.explainRootCause"
  | "log.generateChecklist"
  | "debugging.recommendTargetValues"
  | "debugging.prepareRollback"
  | "audit.summarizeRecentEvents"
  | "perception.getProjectOverview"
  | "perception.searchParameters"
  | "perception.getNodeSnapshot"
  | "perception.getRecentLogConclusions";
```

- [ ] **Step 4: Register perception tools** in `createAgentToolRegistry`.

```ts
import { createPerceptionTools } from "./tools/perceptionTools";
// inside createAgentToolRegistry:
const tools = [
  ...createParameterTools(options),
  ...createLogTools(options),
  ...createAuditTools(options),
  ...createDebuggingTools(options),
  ...createPerceptionTools(options)
];
```

- [ ] **Step 5: Run the test to confirm pass.** Run: `npm run test:server -- perceptionTools` — Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add server/modules/agent/types.ts server/modules/agent/toolRegistry.ts server/modules/agent/tools/perceptionTools.test.ts
git commit -m "feat(agent): register xiaoze perception tool names"
```

### Task 3: Implement perception tools (read-only, authz-bounded)

**Files:**
- Create: `server/modules/agent/tools/perceptionTools.ts`
- Modify: `server/modules/agent/tools/perceptionTools.test.ts`

- [ ] **Step 1: Write failing tests** for tool behavior and that every perception tool is `kind: "read"`.

```ts
import { describe, expect, it } from "vitest";
import { createPerceptionTools } from "./perceptionTools";

const overviewRow = { project_id: "p1", parameter_count: 12, open_change_requests: 3 };
const db = {
  query: async () => ({ rows: [overviewRow], rowCount: 1 })
};
const adminContext = {
  auth: {
    organization: { id: "org1" },
    user: { id: "u1" },
    roles: [{ roleId: "admin", projectId: null }]
  },
  requestId: "r1",
  sessionId: "s1",
  projectId: "p1"
} as any;

describe("createPerceptionTools", () => {
  it("are all read-only", () => {
    for (const tool of createPerceptionTools({ db })) {
      expect(tool.kind).toBe("read");
      expect(tool.requiresApproval).toBe(false);
    }
  });

  it("getProjectOverview returns a grounded summary with citations", async () => {
    const tool = createPerceptionTools({ db }).find((t) => t.name === "perception.getProjectOverview")!;
    const result = await tool.run(adminContext, { projectId: "p1" });
    expect(result.summary).toContain("p1");
    expect(result.citations[0]?.type).toBe("parameter");
  });
});
```

- [ ] **Step 2: Run and confirm fail.** Run: `npm run test:server -- perceptionTools` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement perception tools** following the existing `parameterTools.ts` pattern (read-only SQL, `permission` set to the least-privilege read permission used by the corresponding domain read, citations populated). Each tool reads only the effective project derived from payload/context; cross-page reads still flow through `authorize` in the registry, so project scope and permission are enforced before `run`.

```ts
import type { AgentToolDefinition } from "../toolRegistry";

type ToolOptions = {
  db: { query<Row>(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }> };
};

function readProjectId(contextProjectId: string | undefined, payload: Record<string, unknown>) {
  return typeof payload.projectId === "string" ? payload.projectId : contextProjectId;
}

export function createPerceptionTools(options: ToolOptions): AgentToolDefinition[] {
  return [
    {
      name: "perception.getProjectOverview",
      label: "Get project overview",
      kind: "read",
      permission: "parameter:read",
      requiresApproval: false,
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const { rows } = await options.db.query<{ project_id: string; parameter_count: number; open_change_requests: number }>(
          `select $1::text as project_id,
                  (select count(*) from parameter_project_values ppv where ppv.project_id = $1) as parameter_count,
                  (select count(*) from parameter_change_requests pcr where pcr.project_id = $1 and pcr.status = 'pending') as open_change_requests`,
          [projectId]
        );
        const row = rows[0];
        return {
          summary: `Project ${projectId}: ${row?.parameter_count ?? 0} parameters, ${row?.open_change_requests ?? 0} open change requests.`,
          data: { ...row },
          citations: [{ type: "parameter", id: String(projectId), label: `Project ${projectId} overview` }]
        };
      }
    }
    // perception.searchParameters, perception.getNodeSnapshot, perception.getRecentLogConclusions
    // follow the same shape: read-only SQL scoped to the effective project, least-privilege read permission,
    // and citations referencing the source records.
  ];
}
```

- [ ] **Step 4: Implement the remaining three tools** (`searchParameters` -> `permission: "parameter:read"`; `getNodeSnapshot` -> `permission: "debugging:read"`; `getRecentLogConclusions` -> `permission: "log:read"`), each read-only and citation-bearing. Use the exact permission strings already accepted by `requireAgentPermission` (verify against `server/modules/agent/policy.ts`).

- [ ] **Step 5: Run tests to confirm pass.** Run: `npm run test:server -- perceptionTools` — Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add server/modules/agent/tools/perceptionTools.ts server/modules/agent/tools/perceptionTools.test.ts
git commit -m "feat(agent): add read-only cross-page perception tools"
```

### Task 4: Perception authz boundary test

**Files:**
- Modify: `server/modules/agent/tools/perceptionTools.test.ts`

- [ ] **Step 1: Write the failing test** that a non-admin user without project access is rejected by the registry before `run`.

```ts
import { createAgentToolRegistry } from "../toolRegistry";

it("rejects perception for a project the user cannot access", async () => {
  const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });
  const context = {
    auth: { organization: { id: "org1" }, user: { id: "u2" }, roles: [{ roleId: "viewer", projectId: "other" }] },
    requestId: "r2",
    sessionId: "s2"
  } as any;
  await expect(registry.run("perception.getProjectOverview", context, { projectId: "p1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
```

- [ ] **Step 2: Run and confirm it fails or passes for the right reason.** Run: `npm run test:server -- perceptionTools` — Expected: PASS only if `authorize` already enforces scope; if it fails because the permission string is wrong, fix the tool's `permission` to match `policy.ts`, then re-run.

- [ ] **Step 3: Commit.**

```bash
git add server/modules/agent/tools/perceptionTools.test.ts
git commit -m "test(agent): assert perception authz boundary"
```

### Task 5: LangGraph perceive/answer agent

**Files:**
- Create: `server/modules/agent/xiaoze/perceptionAgent.ts`
- Create: `server/modules/agent/xiaoze/perceptionAgent.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add dependencies.** Run: `npm install @langchain/langgraph @langchain/openai @langchain/core` and record resolved versions. Expected: install succeeds, `package.json` updated.

- [ ] **Step 2: Write the failing test** that the agent calls a perception tool and returns grounded text, using an injected fake model that emits one tool call then a final answer.

```ts
import { describe, expect, it, vi } from "vitest";
import { createPerceptionAgent } from "./perceptionAgent";

it("answers grounded in a perception tool result", async () => {
  const runTool = vi.fn().mockResolvedValue({ summary: "Project p1: 12 parameters", data: {}, citations: [] });
  const fakeModel = makeFakeModelThatCalls("perception.getProjectOverview", { projectId: "p1" });
  const agent = createPerceptionAgent({ model: fakeModel, runTool, listTools: () => [{ name: "perception.getProjectOverview", description: "x", schema: {} }] });
  const result = await agent.run({ message: "summarize project p1", context: { projectId: "p1", pageKey: "parameters" } });
  expect(runTool).toHaveBeenCalledWith("perception.getProjectOverview", expect.objectContaining({ projectId: "p1" }));
  expect(result.text).toContain("12 parameters");
});
```

- [ ] **Step 3: Run and confirm fail.** Run: `npm run test:server -- perceptionAgent` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `createPerceptionAgent`** as a LangGraph `StateGraph` (or `createReactAgent`) whose tool node delegates to an injected `runTool(name, payload)` (which the endpoint binds to `ToolRegistry.run` under the request's auth context). The model is injected so tests use a fake and production uses `ChatOpenAI` configured against the OpenAI-compatible endpoint. The system prompt instructs: use only WiseEff perception tools, never claim a write happened, cite sources, answer "not permitted" if a tool returns FORBIDDEN.

- [ ] **Step 5: Run tests to confirm pass.** Run: `npm run test:server -- perceptionAgent` — Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add server/modules/agent/xiaoze/perceptionAgent.ts server/modules/agent/xiaoze/perceptionAgent.test.ts package.json package-lock.json
git commit -m "feat(agent): add langgraph perception/answer agent"
```

### Task 6: AG-UI endpoint with auth enforcement

**Files:**
- Create: `server/modules/agent/xiaoze/agUiEndpoint.ts`
- Create: `server/modules/agent/xiaoze/agUiEndpoint.test.ts`
- Modify: `server/app.ts` (register route under `/api/v1/agent/xiaoze`)
- Modify: `server/config/env.ts`, `.env.example`

- [ ] **Step 1: Write the failing test** that an unauthenticated request is rejected and an authenticated request emits an AG-UI `RUN_STARTED` ... `RUN_FINISHED` event sequence.

```ts
it("rejects unauthenticated AG-UI runs", async () => {
  const handler = createXiaozeAgUiHandler({ resolveAuth: async () => undefined, createAgent: () => ({ run: async () => ({ text: "" }) }) as any });
  await expect(handler({ headers: {}, body: { messages: [] } } as any)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
```

- [ ] **Step 2: Run and confirm fail.** Run: `npm run test:server -- agUiEndpoint` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement the endpoint** per the Task 1 spike decision: resolve auth via the existing auth resolver, build the `AgentToolExecutionContext`, bind `runTool` to `ToolRegistry.run` under that context, run the agent, and stream the minimal AG-UI event set. Reject when auth is absent with `UNAUTHORIZED`. Add `XIAOZE_RUNTIME_ENABLED`, `XIAOZE_MODEL`, and reuse `AGENT_API_BASE_URL`/`AGENT_API_KEY` for the model.

- [ ] **Step 4: Register the route** in `server/app.ts` next to `registerAgentRoutes`, gated by `XIAOZE_RUNTIME_ENABLED`.

- [ ] **Step 5: Run tests to confirm pass.** Run: `npm run test:server -- agUiEndpoint` — Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add server/modules/agent/xiaoze/agUiEndpoint.ts server/modules/agent/xiaoze/agUiEndpoint.test.ts server/app.ts server/config/env.ts .env.example
git commit -m "feat(agent): expose xiaoze perception over AG-UI with auth"
```

### Task 7: Frontend CopilotKit provider + page context

**Files:**
- Create: `src/features/agent/XiaozeProvider.tsx`
- Create: `src/features/agent/useXiaozePageContext.ts`
- Create: `src/features/agent/XiaozeProvider.test.tsx`
- Modify: `package.json`, `src/App.tsx`, `src/features/agent/UnifiedAgent.tsx`

- [ ] **Step 1: Add dependency.** Run: `npm install @copilotkit/react-core @ag-ui/client` and record resolved versions.

- [ ] **Step 2: Write the failing test** that `XiaozeProvider` renders children and that `useXiaozePageContext` registers context without throwing.

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { XiaozeProvider } from "./XiaozeProvider";

it("renders children inside the provider", () => {
  render(<XiaozeProvider agentUrl="/api/v1/agent/xiaoze"><div>child</div></XiaozeProvider>);
  expect(screen.getByText("child")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run and confirm fail.** Run focused frontend test for `XiaozeProvider` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `XiaozeProvider`** using `CopilotKit` from `@copilotkit/react-core/v2` with `selfManagedAgents={{ xiaoze: new HttpAgent({ url: agentUrl, headers: authHeaders }) }}`. Implement `useXiaozePageContext` wrapping `useAgentContext` to declare the current page's visible state (project, page key, on-screen records).

- [ ] **Step 5: Mount in `App.tsx`** behind a runtime flag (`VITE_XIAOZE_ENABLED`), and route `UnifiedAgent` page-context declaration through `useXiaozePageContext` (read-only).

- [ ] **Step 6: Run tests to confirm pass.** Run focused frontend test — Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/features/agent/XiaozeProvider.tsx src/features/agent/useXiaozePageContext.ts src/features/agent/XiaozeProvider.test.tsx src/App.tsx src/features/agent/UnifiedAgent.tsx package.json package-lock.json
git commit -m "feat(agent): wire CopilotKit xiaoze provider and page context"
```

### Task 8: Perception acceptance + coverage IDs

**Files:**
- Create: `e2e/acceptance/xiaoze-perception.acceptance.spec.ts`
- Modify: `docs/developer/user-operation-coverage-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md`

- [ ] **Step 1: Add requirement/operation IDs** `XIAOZE-PERCEPTION-001` (ask a grounded question on a page) and `XIAOZE-PERCEPTION-AUTHZ-001` (out-of-scope question returns a safe non-data answer) to the coverage docs.

- [ ] **Step 2: Write the acceptance spec** following `e2e/acceptance/agent.acceptance.spec.ts`: open a workflow page, open Xiaoze chat, ask a question, assert a grounded answer with a citation; then assert an out-of-scope project question does not leak data.

- [ ] **Step 3: Run the acceptance spec.** Run: `npm run test:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts` — Expected: PASS (use the deterministic/fake model path so the test is not live-model dependent).

- [ ] **Step 4: Commit.**

```bash
git add e2e/acceptance/xiaoze-perception.acceptance.spec.ts docs/developer/user-operation-coverage-matrix.md docs/developer/browser-acceptance-coverage-map.md
git commit -m "test(agent): add xiaoze perception acceptance and coverage IDs"
```

### Task 9: Verification And Docs

- [ ] **Step 1:** Run: `npm run test:server` — Expected: PASS.
- [ ] **Step 2:** Run focused frontend tests for `src/features/agent` — Expected: PASS.
- [ ] **Step 3:** Run: `npm run build` — Expected: PASS.
- [ ] **Step 4:** Update `docs/FRONTEND.md` (+ `docs/zh-CN/frontend.md`), `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/developer/environment-variables.md` (+ Chinese companion) for the perception surface and `XIAOZE_*` env.
- [ ] **Step 5:** Run: `npm run docs:check` — Expected: PASS.
- [ ] **Step 6:** Run: `git diff --check` — Expected: no whitespace errors. Commit docs.

```bash
git add docs ARCHITECTURE.md
git commit -m "docs: document xiaoze p0 perception surface and env"
```

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `docs/README.md`, `docs/FRONTEND.md` | Add Xiaoze perception surface pointer if it becomes a primary entry point. |
| Planning docs | Update | `docs/exec-plans/active/development-roadmap.md`, this plan | Link P0 and note P1/P2 follow-ups. |
| Product specs | Review | `docs/product-specs/product-spec.md` | Agent assistance section already allows summarize/search; review wording for Xiaoze. |
| Architecture docs | Update | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md` | Document AG-UI + LangGraph perception seam over the existing shell. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md` | Add perception acceptance gate and IDs. |
| Reliability/runbooks | Review | `docs/runbooks/agent-provider.md` | Note the new perception runtime flag; full ops in P2. |
| Security/governance docs | Update | `docs/SECURITY.md` | Record that perception tools are read-only and authz-bounded to the user's scope. |
| Frontend/design docs | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Document CopilotKit provider, page-context hook, and runtime flag. |
| Generated artifacts | Review | `docs/generated/` | Regenerate acceptance/operation evidence after Task 8. |
| References | Review | `docs/references/` | Add a compact Xiaoze/AG-UI reference if repeated agent work needs it. |
| Chinese developer docs | Update | `docs/zh-CN/frontend.md`, `docs/zh-CN/developer` env companion | Perception surface and env are developer-facing. |

## Documentation Update Gate

- `npm run docs:check` must pass before this plan is moved to completed.
- Every `Update` row above must be edited or explicitly recorded as unchanged with evidence; deferred items go to `docs/exec-plans/tech-debt-tracker.md`.
- The Pi removal deferred to P1 must be recorded in `docs/exec-plans/tech-debt-tracker.md` so it is not lost.
- Any Chinese companion not updated must record why no update was needed.

## UI Interaction Automation Review

P0 adds a new user-facing interaction: the Xiaoze chat surface and grounded answers.

- Affected acceptance specs: `e2e/acceptance/xiaoze-perception.acceptance.spec.ts` (new).
- Acceptance requirement IDs: `XIAOZE-PERCEPTION-001`, `XIAOZE-PERCEPTION-AUTHZ-001` (new; added in Task 8).
- Operation IDs: `XIAOZE-PERCEPTION-001` (new).
- Required action: add browser acceptance for asking a grounded question and for the authz-bounded non-leak case; preserve operation evidence generation.
- Required commands: `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:browser`, `npm run acceptance:evidence`.

## External Inputs Needed

- The OpenAI-compatible model name/endpoint Xiaoze should use in dev/staging.
- Confirmation of the execution-model assumption (carried into P1, not P0).
- Whether the perception chat is available to all roles in P0 or gated to a pilot role.
