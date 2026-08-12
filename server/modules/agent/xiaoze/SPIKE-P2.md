# Xiaoze P2 Planning Spike — Checkpointer + StateGraph + Resume

Date: 2026-06-24

> **Superseded in part 2026-08-12:** `approvalBridge.begin/resume` became the orchestrator's `beginApproval` / `resolveApproval`; resume commands now carry only the approval decision, and per-request auth/sink flow through per-invoke `config.configurable` instead of module slots. See ADR-0024. Kept as historical spike evidence.

## 1. Checkpointer choice

**Decision: `MemorySaver` (process-local) for P2 v1.**

| Option | Pros | Cons |
| --- | --- | --- |
| `MemorySaver` | Zero schema change; matches LangGraph docs; sufficient for single-process pilot | Lost on restart; not shared across replicas |
| Postgres-backed | Durable; spec-aligned for production | New table + migration; more surface for P2 |

Postgres table sketch (deferred): `xiaoze_checkpoints(thread_id, checkpoint_id, state_json, updated_at)`.

Record tech debt **TD-029** (durable checkpointing) when shipping MemorySaver.

`createXiaozeCheckpointer()` wraps LangGraph `MemorySaver` for graph compile and exposes a thin `put`/`get` helper for auxiliary per-thread metadata used in unit tests.

## 2. StateGraph shape

**State:**

```typescript
{
  messages: unknown[];           // chat history (system, user, assistant, tool)
  plan: string[];                // human-readable plan steps
  step: number;                    // current plan step index
  perceivedCitations: Citation[]; // accumulated tool citations
  context: { projectId?, pageKey? };
  text?: string;                   // final assistant text
  interrupt?: { toolName, payload, citations }; // mutating HITL payload for agUiEndpoint
  pendingToolCall?: { id, name, args }; // in-flight model tool call
  turnCount: number;
}
```

**Nodes:**

| Node | Role |
| --- | --- |
| `intent` | Seed system prompt + user message; initialize plan from user goal |
| `perceive` | Model turn: may call read tools (auto-executed) |
| `plan` | Model decides next step; may propose mutating tool → route to `act` |
| `act` | Read tools execute inline; mutating → `interrupt({ toolName, payload })` then on resume call `approvalBridge.resume` |
| `observe` | Append act result to messages; increment step; loop to `plan` or finish |

**Edges:** `intent → perceive → plan → (read: perceive | mutating: act | done: END)`; `act → observe → plan` until `text` set or max turns.

## 3. Resume re-enters the graph

1. First POST `/api/v1/agent/xiaoze` with `threadId=T`: graph runs until `act` calls `interrupt()` → `GraphInterrupt` caught → `approvalBridge.begin()` (unchanged P1) → SSE `RUN_FINISHED outcome=interrupt`.
2. User approves → POST same `threadId=T` with `resume[]` / `forwardedProps.command` (via `xiaozeResumeBridge`).
3. `agUiEndpoint` invokes `agent.run({ threadId: T, resume: decision })` instead of one-shot `approvalBridge.resume`.
4. Graph loads checkpoint for `T`, `act` receives resume value from `interrupt()`, calls `approvalBridge.resume` (approve → orchestrator; reject → halt message).
5. `observe → plan` loop produces follow-up text referencing execution result (e.g. change request id).
6. SSE streams final `TEXT_MESSAGE_*` → `RUN_FINISHED success`.

Reject path: `approvalBridge.resume` with reject → observe sets halt text → END, no mutation.

## 4. Sketch (~20 lines)

```
POST xiaoze threadId=T message="project X charges slowly"
  → createPlanningAgent.run({ message, context, threadId: T })
  → graph: intent → perceive (perception.getProjectOverview) → plan → act
      → model calls action.submitParameterChange → interrupt({ toolName, payload })
  → catch GraphInterrupt → approvalBridge.begin → SSE interrupt (P1 unchanged)

POST xiaoze threadId=T resume={ approvalId, decision: approve }
  → agent.run({ threadId: T, resume })
  → graph.invoke(Command({ resume }), { configurable: { thread_id: T } })
  → act: interrupt returns resume → approvalBridge.resume → approveToolCall
  → observe → plan → final text "change request cr-1 created, track on review page"
  → SSE TEXT_MESSAGE → RUN_FINISHED success
```

Public contract preserved: `createPerceptionAgent` delegates to `createPlanningAgent`; `{ text, citations, interrupt? }` unchanged for P0/P1 callers.
