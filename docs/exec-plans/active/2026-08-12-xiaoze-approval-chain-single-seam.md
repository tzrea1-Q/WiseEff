# Xiaoze approval chain: one seam, DB-backed state, request-scoped context

> Status: **Active**
> Date: 2026-08-12
> Branch: `fix/xiaoze-approval-chain-single-seam`
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-12-xiaoze-approval-chain-single-seam.md`](../../zh-CN/exec-plans/active/2026-08-12-xiaoze-approval-chain-single-seam.md)

## Goal

Collapse the duplicated Xiaoze approval bridge into a single orchestrator-owned **Agent approval chain** (`beginApproval` / `resolveApproval`) whose only state is the `agent_tool_calls` + `agent_approvals` rows, and route per-request `{auth, requestId, sessionId, projectId}` plus the run event sink through LangGraph `config.configurable` instead of process-singleton mutable slots.

This fixes two shipped defects:

1. **Approval `editedArgs` silently dropped.** `registerXiaozeRoutes` builds one bridge for the endpoint (`agUiEndpoint.ts:1046`, `begin` writes its in-memory `pendingToolCalls` map) and `createXiaozeAgentFactory` builds a second bridge for the graph (`agUiEndpoint.ts:963`, `resume` reads its always-empty map), so an approval-with-edits executes the original payload — contradicting the SPIKE-P1 "full replacement" contract. The frontend does send `editedArgs` (`src/features/agent/xiaozeResumeBridge.ts`).
2. **Concurrent requests overwrite each other's execution context.** The planning agent is a registration-time singleton; `executionContextRef` (`agUiEndpoint.ts:964`) and `activeSink` (`planningGraph.ts:170`) are per-process slots, so overlapping requests can run tools under the other request's auth and stream into the other request's sink.

Secondary hardening: `Command({resume})` payloads no longer embed the full `AuthContext` (today it is serialized into LangGraph checkpoint pending writes when `XIAOZE_CHECKPOINTER=postgres`).

## Non-goals

- Resume-branch run-step streaming (the approved-turn timeline stays text-only; recorded as **TD-070**).
- Turn-stream consolidation, tool single-definition, shared client/server protocol package, dead-export cleanup beyond the approval seam (separate architecture-review candidates).
- Metrics/tracing wiring changes for the Xiaoze path (the bridge never wired them; unchanged).

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `fix/xiaoze-approval-chain-single-seam`; do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

Branch: `fix/xiaoze-approval-chain-single-seam`, checked out from the latest `main`.

## Design decisions (settled 2026-08-12)

- **D1 State location:** `resolveApproval` looks up `toolCallId` from `agent_approvals` via `getAgentApproval`; the in-memory `pendingToolCalls` map is deleted. Required for correctness: production/self-hosted deployments use `XIAOZE_CHECKPOINTER=postgres` precisely because begin and resume may land on different processes.
- **D2 Seam placement:** `beginApproval` stays in the AG-UI endpoint (after the graph returns the interrupt); `resolveApproval` stays in `actNode`. Both hit the same orchestrator interface. Moving begin into the node was rejected: LangGraph re-runs node bodies on resume, which would force hidden idempotence requirements onto the interface.
- **D3 Context channel:** request context and sink flow via `config.configurable` per `graph.invoke`. Verified against `@langchain/langgraph@1.4.5`: checkpoint metadata is `{source, step, parents}` only; `configurable` is never serialized. Auth must never enter graph state (checkpointed) or resume payloads (persisted as pending writes).
- **D4 Module shape:** `approvalBridge.ts` is deleted; the orchestrator exposes `beginApproval` (session ensure + record tool request + approval id) and `resolveApproval` (reject → `rejectToolCall`; approve → optional payload replacement → `approveToolCall`, so approval-time re-authorization covers the edited payload). `recordToolRequestForTest` is renamed to `recordToolRequest` and stays exported as the first-class entry (read tools execute immediately; mutating tools open the approval chain) — it is on the production path and tests legitimately seed through it.
- **D5 Naming:** glossary term **Agent approval chain** added to `CONTEXT.md`; ADR-0024 records "approval state is DB-backed; request context flows through invocation config, never module state".

## Tasks

1. `server/modules/agent/orchestrator.ts`: rename `recordToolRequestForTest` → `recordToolRequest`; add `beginApproval` / `resolveApproval` (types `ApprovalBeginInput/Result`, `ApprovalResolveInput/Result`); `editedArgs` replaces `agent_tool_calls.payload` (via `updateAgentToolCall`) before `approveToolCall` re-authorizes and executes.
2. Delete `server/modules/agent/xiaoze/approvalBridge.ts` and `approvalBridge.test.ts` (behavior moves under orchestrator tests).
3. `server/modules/agent/xiaoze/planningGraph.ts`: `PlanningResumeDecision` drops `auth`/`requestId`; nodes take `(state, config)`; `actNode` reads request context from `config.configurable` and calls `resolveApproval`; delete the `activeSink` slot (sink via config; `run()` reads `input.sink` directly for `runSteps`); run input gains `requestContext`.
4. `server/modules/agent/xiaoze/agUiEndpoint.ts`: factory drops `executionContextRef` (context passed through each `run`); `registerXiaozeRoutes` builds **one** tool registry and **one** orchestrator shared by the factory, the handler (`approvalChain.beginApproval`), and the suggest route; handler resume input minimized to `{approvalId, decision, editedArgs, reason}`.
5. Tests:
   - Extract the SQL-dispatching memory DB from `orchestrator.test.ts` into `server/modules/agent/testing/memoryAgentDb.ts`; extend it with tool-call payload updates and thread-persistence statements.
   - **Assembly-level regression** at the `registerXiaozeRoutes` seam (real router, deterministic model, parameters modules mocked): first POST → interrupt, second POST resume with `editedArgs` → the executed payload and the persisted `agent_tool_calls.payload` carry the edited value.
   - **Concurrency**: two interleaved runs with different auth through one factory; each tool call executes under its own auth and streams into its own sink.
   - **Dual-instance**: `beginApproval` on orchestrator instance A, `resolveApproval` with `editedArgs` on instance B over the same DB — encodes the multi-replica claim.
   - Update `planningGraph*.test.ts`, `agUiEndpoint.test.ts`, `eval/*` (scenario resume shape + `requestContext`), `durableCheckpointer.integration.test.ts` for the new shapes.
6. Acceptance: extend `e2e/acceptance/xiaoze-action.acceptance.spec.ts` approve flow with an `editedArgs` case asserting the resulting change request carries the edited value; add `XIAOZE-ACTION-EDITEDARGS-001` to `docs/developer/browser-acceptance-coverage-map.md` and `docs/developer/user-operation-coverage-matrix.md`.
7. Docs: ADR-0024; `CONTEXT.md` glossary term + ADR index (also backfill 0012/0020/0021); `ARCHITECTURE.md` §Backend/Xiaoze approval wording + `docs/zh-CN/root/ARCHITECTURE.md`; `docs/SECURITY.md` Xiaoze P1/P2 wording (+ zh companion if paired); `docs/PLANS.md` + `docs/zh-CN/PLANS.md` active-plan entries; TD-070 in `docs/exec-plans/tech-debt-tracker.md`.
8. Verify (see below), then move this plan to `completed/`.

## Success criteria

- Approve with `editedArgs` executes the edited payload — proven at the assembly seam, at the dual-orchestrator-instance seam, and in acceptance against a live API.
- Two concurrent runs with different auth each execute tools under their own auth context.
- `rg -n "pendingToolCalls|executionContextRef|activeSink|recordToolRequestForTest" server/ src/` returns nothing.
- Resume `Command` payloads contain no `AuthContext`.
- `npm run test:server` (agent module), `npm run build`, `npm run docs:check` green.

## Verification commands

```bash
npx vitest run server/modules/agent --config vitest.server.config.ts
npm run build
npm run docs:check
# with a live DB + API (acceptance evidence):
npx playwright test e2e/acceptance/xiaoze-action.acceptance.spec.ts
```

## Verification results (2026-08-12)

- `npx vitest run server/modules/agent --config vitest.server.config.ts`: 33 files green in a clean branch worktree (assembly editedArgs regression, concurrency isolation, dual-orchestrator multi-replica test included). With `DATABASE_URL` present, the live-postgres checkpointer durability test also ran and passed (cross-instance resume on the new resolver path).
- `npm run build` and `npm run docs:check`: green in a clean branch worktree (the developer's unrelated WIP in the shared worktree carries its own type error in `server/testing/testDatabase.ts` and broken links from an untracked draft doc; both pre-date/parallel this change).
- Live-API evidence (isolated DB `wiseeff_acceptance_xiaoze`, deterministic model, port 8799): first POST raised the interrupt; resume with `editedArgs targetValue=3600` **persisted the edited payload** (`agent_tool_calls.payload → 3600`, previously the original payload would have executed), approval row `approved`, audit `approval-requested` + `approval-execution-failed` (`actor_type=agent`).
- The tool execution itself failed with "Legacy parameter submission is retired after semantic identity cutover": `action.submitParameterChange` still submits the retired flat shape, so every approved Xiaoze write has been failing at execution since the cutover — a pre-existing defect recorded as **TD-078** (out of scope here; unit tests mock the parameters service and never saw it).
- `xiaoze-action.acceptance.spec.ts` cannot run against a post-cutover schema (its `beforeAll` filters on the dropped `project_parameter_value_id` column) — same drift family as TD-078; the new `XIAOZE-ACTION-EDITEDARGS-001` case follows the file's pattern minus the retired column and activates when the spec drift is repaired.

## Verification results (2026-08-12)

- `npx vitest run server/modules/agent --config vitest.server.config.ts`: 33 files green in a clean branch worktree (assembly editedArgs regression, concurrency isolation, dual-orchestrator multi-replica test included). With `DATABASE_URL` present, the live-postgres checkpointer durability test also ran and passed (cross-instance resume on the new resolver path).
- `npm run build` and `npm run docs:check`: green in a clean branch worktree (the shared developer worktree carries unrelated parallel WIP with its own type error and doc-link drafts; verified clean-tree instead).
- Live-API evidence (isolated DB `wiseeff_acceptance_xiaoze`, deterministic model, port 8799): first POST raised the interrupt; resume with `editedArgs targetValue=3600` **persisted the edited payload** (`agent_tool_calls.payload → 3600`; before this fix the original payload executed), approval row `approved`, audit `approval-requested` + `approval-execution-failed` (`actor_type=agent`).
- The tool execution itself failed with "Legacy parameter submission is retired after semantic identity cutover": `action.submitParameterChange` still submits the retired flat shape, so every approved Xiaoze write has been failing at execution since the cutover — a pre-existing defect recorded as **TD-078** (out of scope here; unit tests mock the parameters service and never saw it).
- `xiaoze-action.acceptance.spec.ts` cannot run against a post-cutover schema (its `beforeAll` filters on the dropped `project_parameter_value_id` column) — same drift family as TD-078; the new `XIAOZE-ACTION-EDITEDARGS-001` case follows the file's pattern minus the retired column and activates when the spec drift is repaired.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` module list — module set unchanged; approval wording updated (see Architecture row) |
| Planning | Update | This plan; `docs/PLANS.md` + `docs/zh-CN/PLANS.md`; zh companion plan |
| Domain / ADR | Update | `CONTEXT.md` (Agent approval chain term, ADR index backfill); new `docs/adr/0024-agent-approval-state-is-db-backed.md` |
| Product specs | No change | Approval UX and product behavior stated in specs are unchanged (edits now actually apply, matching the spec'd contract) |
| Architecture | Update | `ARCHITECTURE.md` (approval chain naming, no singleton context slots) + `docs/zh-CN/root/ARCHITECTURE.md` |
| Quality / testing | Update | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md` (`XIAOZE-ACTION-EDITEDARGS-001`) |
| Reliability / runbooks | Review | `docs/runbooks/agent-provider.md` — provider config unchanged; expect no change with evidence |
| Security / governance | Update | `docs/SECURITY.md` Xiaoze P1/P2 (begin/resolve naming; resume payloads carry no AuthContext) + zh companion if inventoried |
| Frontend / design docs | Review | `docs/FRONTEND.md` — client resume contract (`forwardedProps.command` / `resume[]`) unchanged; expect no change with evidence |
| Generated artifacts | Review | OpenAPI/route manifest — no route or schema change; expect no change |
| References | No change | `docs/references/` has no approval-chain notes |

## Documentation Update Gate

- [x] ADR-0024 committed (`docs/adr/0024-agent-approval-state-is-db-backed.md`) and linked from `CONTEXT.md` + `docs/adr/README.md` (renumbered from the draft's 0022 after parallel work claimed 0022/0023)
- [x] `CONTEXT.md` glossary states Agent approval chain; ADR index backfilled 0012/0020/0021 and lists 0024
- [x] `ARCHITECTURE.md` describes begin/resolve and DB-backed approval state; zh evidence: `docs/zh-CN/root/ARCHITECTURE.md` is a condensed map without the approval-chain sentence (no stale text), and the zh detail in `docs/zh-CN/design-docs/full-stack-architecture.md` was updated
- [x] `docs/SECURITY.md` + `docs/zh-CN/SECURITY.md` updated for begin/resolve and resume-payload hardening (Xiaoze P1/P2)
- [x] Coverage map + operation matrix list `XIAOZE-ACTION-EDITEDARGS-001`; acceptance spec updated (execution blocked by pre-existing spec/tool drift — TD-078)
- [x] TD-070 recorded (resume branch bypasses the run-step sink); TD-078 recorded (retired-shape tool submission found during live verification)
- [x] `docs/PLANS.md` EN + zh list this plan
- [x] `npm run docs:check` green in a clean branch worktree (2026-08-12); move to `completed/` after PR review
