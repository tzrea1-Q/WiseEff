# Xiaoze General Agent Design

> Chinese: [Chinese](../../zh-CN/superpowers/specs/2026-06-24-xiaoze-agent-design.md)

Date: 2026-06-24
Status: Approved for implementation planning

## Context

WiseEff already ships a controlled, backend-orchestrated agent (WiseAgent / `UnifiedAgent`). Its architecture is sound but its capability is deliberately narrow:

- A clean seam exists: `Provider` (produces assistant text + tool requests) → `Orchestrator` (persists sessions/messages/traces, gates approvals) → `ToolRegistry` (the only path that executes business tools) → module services (server-enforced authz + audit).
- Only 9 tools exist, all **read** or **preparation** kind. The agent **cannot** perform mutating writes (merge, device write, rollback are explicitly excluded; `prepareRollback` returns a plan only).
- The default provider is `deterministic` (a rule engine, not an LLM); `live` (OpenAI-compatible HTTP / Pi `@earendil-works/pi-ai`) is optional and required in production.
- Security is enforced server-side: writes require authz + an approval record + audit. Frontend `canPerform` / disabled buttons are UX only.

The product vision is a general-purpose agent named **Xiaoze (小泽)** that can largely assist or even substitute for a user operating the platform. Xiaoze must have:

1. **Perception** — it can see everything the user can see, and summarize / answer questions over that information.
2. **Action** — it can perform every operation a user can perform through the frontend (e.g. submitting parameter changes).
3. **Intent and planning** — it recognizes user intent through dialogue, proactively perceives relevant information, and plans suggestions and actions. Example: the user says "project X charges slowly"; Xiaoze, grounded in current parameters and node information, recommends adjusting parameter X; after the user agrees, Xiaoze helps debug, modify, and submit the parameter change.

This is not an incremental tweak. The vision requires expanding the agent's capability boundary and execution model, which the current design intentionally forbids. The overriding constraint from the product owner is to **maximize reuse of mature open-source projects/frameworks and avoid reinventing wheels.**

## Terminology

| Term | Meaning |
| --- | --- |
| **Xiaoze (小泽)** | The new general-purpose agent; the product-facing name. Supersedes/extends the current WiseAgent. |
| **AG-UI** | Open, event-based Agent↔User Interaction protocol (by the CopilotKit team) that standardizes the agent/frontend boundary. |
| **CopilotKit** | Open-source React frontend stack that implements AG-UI client primitives (readable context, frontend actions, human-in-the-loop). |
| **Planning engine** | LangGraph.js graph that runs the plan-act-observe loop; implemented behind the existing `AgentProvider` seam. |
| **Perception tools** | New read-only backend tools that let Xiaoze pull any data the user is permitted to access across all pages. |
| **Orchestrator / ToolRegistry / Approval / Audit** | Existing backend agent infrastructure, reused as the system of record for execution, approval, and audit. |

## Decisions

- **Approach A** (AG-UI/CopilotKit frontend protocol + backend planning engine) is selected over a pure backend tool expansion (B) or a pure MCP tool bus (C). MCP may be layered on later as an optional capability-exposure surface.
- The **planning engine is LangGraph.js** (`@langchain/langgraph`), chosen for first-class human-in-the-loop interrupts, checkpointing/durability, and graph expressiveness for complex multi-branch tasks.
- The planning engine acts only as the **brain**; the existing Orchestrator remains the **system of record** for execution, approval, and audit. We do not throw away existing security assets.
- **Execution model (assumption, flagged for confirmation during planning):** Xiaoze **does execute** actions after user consent. High-risk writes (parameter merge/submit, device writes, rollback) remain gated by explicit human approval + audit, honoring the existing security model. Read/low-risk perception runs automatically after authz.
- **Perception is cross-page and permission-bounded:** Xiaoze perceives both the current page's live state and, through backend perception tools, any other page/domain data the **user's permissions** allow. Its perceivable scope equals the user's authorized scope — never more.
- Every Xiaoze action maps to an **explicitly registered tool or frontend action**, never free-form DOM clicking. This keeps actions controllable, auditable, and testable.
- The `deterministic` provider is retained as an offline test double; production continues to enforce a live provider.

## Goals

- A user can converse with Xiaoze in any workflow page and get grounded summaries / answers over everything they are allowed to see (current page plus cross-page data).
- Xiaoze can carry out frontend-equivalent operations — including mutating writes such as submitting parameter changes — after explicit user approval, with full server-side authz and audit.
- Xiaoze recognizes intent, proactively perceives relevant data, proposes suggestions with citations, and executes approved multi-step tasks that can resume after interruption.
- The implementation reuses CopilotKit (frontend) and LangGraph.js (backend planning) instead of building bespoke perception/action/HITL infrastructure.
- All existing security guarantees (server-enforced authz, approval chain, audit `actorType=agent`, device write tokens/leases/snapshots) are preserved.

## Non-Goals

- Free-form DOM automation or letting the model click arbitrary UI elements.
- Bypassing any existing approval, authz, snapshot, lease, or readback guard.
- Replacing the existing Orchestrator / ToolRegistry / approval / audit infrastructure.
- A full MCP server exposure of all platform capabilities (deferred; optional later layer).
- Multi-agent (A2A) collaboration in this iteration.
- Removing the deterministic provider (kept as a test double).

## Architecture

Recommended approach: **AG-UI/CopilotKit frontend protocol + LangGraph.js planning engine, layered over the existing backend shell.**

```
┌─────────────────────────── Frontend (React/Vite) ───────────────────────────┐
│  CopilotKit Provider + Xiaoze chat panel                                      │
│   ├─ Perception: useCopilotReadable  → declares each page's visible state      │
│   ├─ Action:     useCopilotAction     → exposes frontend actions (reuse runtime)│
│   └─ Approval:   HITL interrupt UI    → in-UI confirmation for high-risk writes │
└───────────────────────────────│ AG-UI protocol (SSE event stream) │───────────┘
                                 ▼
┌─────────────────────── Backend (Node/TS modular monolith) ───────────────────┐
│  AG-UI runtime endpoint  (/api/v1/agent/ag-ui)  ← new, wraps existing gateway   │
│      ▼                                                                          │
│  Planning engine (LangGraph.js) —— implemented as a new AgentProvider           │
│      intent → perceive → suggest → (interrupt/approval) → act → observe loop     │
│      ▼ still wrapped by the existing shell ▼                                     │
│  Orchestrator (existing) → ToolRegistry (extended) → Approval (existing) → Audit │
│      ▼                                                                           │
│  parameter / log / debugging / audit module services (existing, authz enforced) │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Capability mapping

**① Perception (two channels)**

- **Current-page channel (live, fine-grained):** CopilotKit `useCopilotReadable` feeds Xiaoze the user's on-screen state (selected project, parameter draft being edited, current log conclusion, node readings). "Whatever the user can see, Xiaoze can see."
- **Cross-page channel (permission-scoped, global):** a new group of read-only **perception tools** on the backend lets Xiaoze proactively pull data from other pages/domains the user is permitted to access. Example: a user on the parameters page asks about "slow charging"; Xiaoze can proactively query node debugging info, historical log conclusions, and the review queue.
- **Unified permission boundary:** perception tools reuse the existing server-side authz (`requireAgentPermission` + project scope). Xiaoze's perceivable scope equals the user's authorized scope. Frontend `useCopilotReadable` only exposes what the user can actually see.

**② Action (frontend actions + backend tools)**

- **Frontend actions** (`useCopilotAction`, reusing existing runtime handlers): navigate to a page, pre-fill recommended values into a form, locate a parameter/node — low-risk UI orchestration.
- **Backend tools** (extending the existing `ToolRegistry`): the real writes — submit parameter changes, device node writes, rollback preparation/execution — classified by the existing `kind` (read / preparation / mutating).

**③ Intent and planning (plan-act-observe loop)**

- The planning engine upgrades the single-turn `planTurn` into a multi-step loop: recognize intent → proactively perceive (call perception tools) → produce suggestions → await user approval → execute write tools → observe results → report/continue.
- Proactive suggestions: on entering a page or detecting an anomaly, Xiaoze can surface a prompt via the existing `AgentInsightBar`.

## Data Flow (the "slow charging" example)

```
User (parameters page): "Project X charges slowly"
  → CopilotKit posts current-page readable state + prompt via AG-UI to backend
  → LangGraph: intent node classifies intent = diagnose + optimize
  → perceive node: calls perception tools (read current parameters + cross-page node/historical log data, authz-bounded)
  → suggest node: produces "recommend setting parameter X to Y" with citations (parameter/log/node references)
  → [interrupt] AG-UI pushes a HITL card to the frontend; waits for approve/edit
  User: approves
  → resume → act node: executes the mutating tool via Orchestrator → ToolRegistry
      (transaction re-checks authz + business state → write → audit actorType=agent)
  → observe node: reads back result/snapshot → reports "submitted, change request #123, track it on the review page"
```

LangGraph's `interrupt` pauses before the act node; `checkpoint` makes multi-step tasks resumable — supporting complex tasks.

## Security and Approval Model

Reuses existing assets with no compromise:

- **Perception (read):** runs automatically after server-side authz; scope strictly equals the user's permissions.
- **Preparation:** generates drafts/plans/previews without changing production state; audited.
- **Mutating:** must create an approval record and wait for human approval; at approval time the existing Orchestrator re-checks authz + business state inside the transaction before executing.
- **High-risk device writes / rollback:** continue to require `confirmationToken` (`confirm-high-risk-write` / `confirm-rollback`) + device lease + pre-write snapshot + readback, consistent with `debugging/service.ts`. Xiaoze bypasses no guard.
- **Approval UI:** AG-UI HITL interrupt renders an in-UI confirmation card (approve / reject / edit parameters), writing back to the existing `agent_approvals` table; audited as `actorType: "agent"`.
- **Production enforcement:** continues to require `AGENT_PROVIDER=live`; mock is for frontend demos/tests only.

## Components and Boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| CopilotKit provider + Xiaoze panel | Declare readable context, expose frontend actions, render HITL approval UI | AG-UI protocol, existing runtime handlers, `AgentInsightBar` |
| AG-UI runtime endpoint | Translate AG-UI events ↔ backend agent turns; SSE streaming | Orchestrator |
| LangGraph planning engine (as `AgentProvider`) | Run intent→perceive→suggest→act→observe; interrupts; checkpoints | Existing OpenAI-compatible / Pi chat model endpoint; perception + action tools |
| Perception tools (new, read-only) | Cross-page, permission-bounded reads for grounding | Module services, `requireAgentPermission` |
| Extended ToolRegistry (mutating tools) | Execute frontend-equivalent writes under authz + approval | Module services, Orchestrator, Approval |
| Orchestrator / Approval / Audit (existing) | System of record for execution, approval, audit | DB (agent tables) |

Each unit communicates through well-defined interfaces (AG-UI events, the `AgentProvider` seam, the `ToolRegistry` contract) and can be tested independently.

## Reuse / New Dependencies

- **Reuse:** Orchestrator, ToolRegistry, `agent_approvals` approval chain, audit `actorType=agent`, the `AgentProvider` seam, `AgentInsightBar`, per-module service authz.
- **New (frontend):** `@copilotkit/react-core`, `@copilotkit/react-ui` (AG-UI client).
- **New (backend):** `@langchain/langgraph` and `@ag-ui/*` runtime adapter; LangGraph reuses the existing OpenAI-compatible / Pi endpoint as its chat model.

## Phasing

Each phase is independently shippable.

- **P0 Perception:** integrate CopilotKit + cross-page read-only perception tools + summarize/Q&A. Pure read, zero write risk, fast value.
- **P1 Action:** extend ToolRegistry mutating tools + frontend actions + wire AG-UI HITL approval into the existing approval chain.
- **P2 Planning:** LangGraph plan-act-observe graph + proactive suggestions + multi-step complex tasks + checkpoint resume.

## Testing Strategy

- Perception-tool authz unit tests (out-of-scope access must be rejected).
- HITL approval e2e following the existing `agent.acceptance.spec.ts` pattern.
- LangGraph graph node unit tests (intent/suggest nodes with an injectable fake chat model).
- End-to-end run of the "slow charging" scenario.
- Retain the deterministic provider as an offline test double.

## Open Questions

- Confirm the execution model assumption (Xiaoze executes after consent, with high-risk writes approval-gated) during implementation planning.
- Decide the precise initial set of mutating tools/frontend actions to expose in P1 (start minimal: parameter submit + a single low-risk frontend action).
- Decide whether proactive suggestions are opt-in per user/role.
