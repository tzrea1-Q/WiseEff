# Xiaoze P1 Action Spike — Interrupt / Approval Bridge

Date: 2026-06-24

## 1. Orchestrator session + pending approval (no auto-execute)

**Yes.** Reuse `createAgentOrchestrator` from `server/modules/agent/orchestrator.ts`:

| Function | Role in P1 |
| --- | --- |
| `startSession` | Creates `agent_sessions` row (generates id). For Xiaoze, prefer `createAgentSession` with AG-UI `threadId` as session id when missing. |
| `recordToolRequestForTest` | Persists `agent_tool_calls` (`status: requested` → `pending_approval`) and `agent_approvals` (`status: pending`) **without** executing when `requiresApproval: true`. |
| `approveToolCall` | Transaction: `toolRegistry.authorize` → `run` → audit `actorType=agent` → assistant message. |
| `rejectToolCall` | Marks approval/tool-call rejected; no mutation. |

Repository helpers: `createAgentSession`, `getAgentSession`, `createAgentToolCall`, `createAgentApproval`, `getAgentApproval`, `getAgentToolCall`, `updateAgentToolCall` (extend with optional `payload` for edited args).

`recordToolRequest` internally calls `createApprovalForToolCall` for approval-gated tools — same semantics the bridge must mirror.

## 2. AG-UI interrupt payload

On mutating interrupt from `perceptionAgent`:

1. `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` for frontend tool `xiaoze_approval` with `{ approvalId, toolCallId, toolName, payload, citations }`.
2. `CUSTOM` event `name: "on_interrupt"` with the same value (CopilotKit `useInterrupt` listens on this).
3. `RUN_FINISHED` with `outcome: { type: "interrupt", interrupts: [{ id: approvalId, reason: "tool_call", toolCallId, metadata: {...} }] }`.

Resume on the same `threadId`:

- CopilotKit: `forwardedProps.command.resume` + `interruptEvent` (from `useInterrupt` resolve).
- AG-UI native: `resume: [{ interruptId, status: "resolved"|"cancelled", payload: { approvalId, decision, editedArgs? } }]`.
- WiseEff frontend: `XiaozeHttpAgent` maps CopilotKit command resume into AG-UI `resume[]` using `interruptEvent.approvalId` as `interruptId` (must match `RUN_FINISHED outcome.interrupts[].id`).

Bridge maps `decision: "approve"|"reject"` → `approveToolCall` / `rejectToolCall`.

## 3. Authz on resume

**Always** `approveToolCall` / `rejectToolCall` — never call `ToolRegistry.run` directly from the AG-UI handler. `approveToolCall` re-runs `toolRegistry.authorize` inside a DB transaction before execution.

`editedArgs` is a **full replacement** of the tool-call payload: update `agent_tool_calls.payload` via `updateAgentToolCall({ payload: editedArgs })` before `approveToolCall`.

## 4. End-to-end sketch (15 lines)

```
User: "set fast-charge to 18A" → POST /api/v1/agent/xiaoze (threadId=T)
  → ensure agent_sessions row id=T
  → perceptionAgent loop → model calls action.submitParameterChange
  → interrupt branch (no runTool) → approvalBridge.begin
      → recordToolRequestForTest → agent_tool_calls pending_approval + agent_approvals pending
  → SSE: TOOL_CALL_* (xiaoze_approval) → CUSTOM on_interrupt → RUN_FINISHED outcome=interrupt
  → useInterrupt renders XiaozeApprovalCard (project/parameter/target + citations)
User approves (optionally edits target) → resolve → POST same thread with command.resume
  → approvalBridge.resume → update payload if editedArgs → approveToolCall (authz tx + submitParameterChanges + audit)
  → SSE: TEXT_MESSAGE_* result summary → RUN_FINISHED success
Reject path → rejectToolCall → no parameter mutation → safe acknowledgement text
Out-of-scope project → authorize fails at approveToolCall → FORBIDDEN message, no mutation
```
