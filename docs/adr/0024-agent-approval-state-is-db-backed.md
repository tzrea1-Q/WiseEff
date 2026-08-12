# ADR-0024: Agent approval state is DB-backed; request context flows through invocation config

- Status: Accepted
- Date: 2026-08-12

Every mutating Xiaoze tool call crosses one orchestrator-owned **Agent approval chain**. Its only state is the `agent_tool_calls` + `agent_approvals` rows. `beginApproval` records the tool-call and approval and raises the AG-UI interrupt; `resolveApproval` looks the tool call up from `agent_approvals` (via `getAgentApproval`), optionally replaces the payload with `editedArgs`, then re-authorizes and executes inside a transaction. There is no in-memory `pendingToolCalls` map, and per-request `{auth, requestId, sessionId, projectId}` plus the run event sink flow through LangGraph `config.configurable` on each `graph.invoke`, never through process-singleton slots.

This replaces the earlier duplicated `approvalBridge` seam, which kept the pending-tool-call map in process memory and carried the full `AuthContext` in resume payloads.

## Considered options

- **In-memory pending-tool-call map (the shipped `approvalBridge`)** — rejected. Production and self-hosted deployments run `XIAOZE_CHECKPOINTER=postgres` precisely because begin and resume can land on different processes; a per-process map is empty on the resuming replica, so an approval-with-edits silently executed the original payload.
- **Embed `AuthContext` in the `Command({ resume })` payload** — rejected. LangGraph persists resume values as checkpoint pending writes, so auth would sit at rest in PostgreSQL. Verified against `@langchain/langgraph@1.4.5`: checkpoint metadata is `{source, step, parents}` and `configurable` is never serialized, so request context belongs in `configurable`, not in graph state or resume payloads.
- **Move `beginApproval` into the graph `act` node** — rejected. LangGraph re-runs node bodies on resume, which would force hidden idempotence requirements onto the approval interface. `beginApproval` stays in the AG-UI endpoint after the graph returns the interrupt; `resolveApproval` stays in `actNode`. Both hit the same orchestrator interface.
- **Process-singleton execution-context / active-sink slots** — rejected. Overlapping requests through one registration-time factory could run tools under another request's auth and stream into another request's sink; per-invoke `configurable` isolates them.

## Consequences

- Approval correctness survives API restarts and multi-replica routing: begin and resolve read and write the same database rows, proven at the assembly seam, at a dual-orchestrator-instance seam, and in acceptance against a live API.
- `editedArgs` is a full payload replacement written to `agent_tool_calls.payload` before approval-time re-authorization, so the human approves and the system executes the same edited value.
- `AuthContext` never enters graph state, checkpoints, or resume payloads; resume commands carry only `{approvalId, decision, editedArgs, reason}`.
- Concurrent requests each execute tools under their own auth and stream into their own sink.
- The resume branch returns the approved turn as text only and does not replay run-step timeline events into the sink (recorded as TD-070).
