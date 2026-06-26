# Xiaoze P0 Integration Spike

Date: 2026-06-24

## 1. WiseEffRouter SSE support

**Yes.** `RouteResponse` includes an SSE variant:

```ts
{ status: 200; sse: AsyncIterable<{ event: string; data: unknown }> }
```

`createHttpServer` (`server/shared/http/server.ts`) detects `"sse" in routeResponse`, sets `Content-Type: text/event-stream`, and writes `event:` / `data:` frames via `sendSse`. Existing precedent: `GET /api/v1/jobs/:jobId/events` in `server/modules/jobs/routes.ts`.

Route handlers return an async iterable; no raw `res` access required.

## 2. AG-UI transport decision

**Choice: (a) self-managed `HttpAgent` on the frontend → our own AG-UI SSE endpoint.**

Rationale: WiseEffRouter streams SSE natively; auth stays on the existing `getCurrentAuthContext` resolver (Bearer / `x-wiseeff-user` in dev). Option (b) (`CopilotRuntime` Node proxy) adds an extra hop without solving auth differently.

Frontend: `@copilotkit/react-core/v2` `CopilotKit` with `selfManagedAgents={{ xiaoze: new HttpAgent({ url, headers }) }}`.

Backend: `POST /api/v1/agent/xiaoze` returns `{ status: 200, sse: agUiEvents() }` when the database is available.

## 3. LangGraph ↔ AG-UI binding

**Choice: manual AG-UI event emission around a LangGraph `createReactAgent` run** (no `@ag-ui/langgraph` adapter in P0).

Rationale: P0 needs auth-injected `runTool` bound to `ToolRegistry.run` under the request context. A thin wrapper keeps the seam testable and avoids adapter version coupling. `@ag-ui/langgraph` can be evaluated in P1 if it cleanly accepts injected tools.

Minimal P0 event set (AG-UI `EventType` strings):

| Event | When |
| --- | --- |
| `RUN_STARTED` | Auth OK, agent run begins (`threadId`, `runId`) |
| `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` | Assistant answer chunks |
| `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` / `TOOL_CALL_RESULT` | Perception tool invocations |
| `RUN_FINISHED` | Successful completion |
| `RUN_ERROR` | Auth failure, tool FORBIDDEN, or agent error |

## 4. Package versions (resolved at install)

Install with package manager (no pinned guesses):

- Backend: `@langchain/langgraph`, `@langchain/openai`, `@langchain/core`, `@ag-ui/client`, `@ag-ui/core`
- Frontend: `@copilotkit/react-core`, `@ag-ui/client`

Model: LangChain `ChatOpenAI` → existing `AGENT_API_BASE_URL` / `AGENT_API_KEY`; tests inject a fake chat model.

## 5. End-to-end sketch (10 lines)

```
User opens /parameters → useXiaozePageContext({ pageKey, projectId, visibleRecords })
  → CopilotKit HttpAgent POST /api/v1/agent/xiaoze + Authorization header
  → resolveAuth → ToolRegistry + createPerceptionAgent(ChatOpenAI | fake)
  → LangGraph react agent calls perception.getProjectOverview via runTool
  → agUiEndpoint yields RUN_STARTED → TOOL_CALL_* → TEXT_MESSAGE_* → RUN_FINISHED (SSE)
  → CopilotKit renders grounded answer with citations in Xiaoze chat panel
Unauthorized request → UNAUTHORIZED before SSE (no data leak)
Out-of-scope project → ToolRegistry FORBIDDEN → agent answers "not permitted"
```
