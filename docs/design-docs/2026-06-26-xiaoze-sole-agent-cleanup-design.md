# Xiaoze as Sole Agent — WiseAgent Cleanup Design

> Chinese: [Chinese](../zh-CN/design-docs/2026-06-26-xiaoze-sole-agent-cleanup-design.md)

Date: 2026-06-26  
Status: Approved for implementation planning

## Background

WiseEff currently runs two parallel Agent stacks:

- **WiseAgent (M4)** — `UnifiedAgent` UI, `AgentGateway`, five REST routes under `/api/v1/agent/sessions/*`, and `AgentProvider.planTurn`.
- **Xiaoze** — CopilotKit/AG-UI UI, `/api/v1/agent/xiaoze`, LangGraph planning, shared `ToolRegistry` and orchestrator approval chain.

When Xiaoze is enabled, WiseAgent hides its FAB but M4 code, routes, config, tests, and docs remain. Product direction is to make **Xiaoze the only Agent** and remove legacy WiseAgent surface area entirely.

## Decisions (brainstorming outcomes)

| Topic | Decision |
| --- | --- |
| Mock runtime | **No Agent UI** in `VITE_WISEEFF_RUNTIME_MODE=mock` |
| M4 REST API | **Hard delete** five session routes; no deprecation period; no external consumers |
| Xiaoze vs M4 REST | Deleting M4 REST **does not affect Xiaoze**; approvals use `approvalBridge` → orchestrator internally |
| Feature flags | Remove `VITE_XIAOZE_ENABLED` and `XIAOZE_RUNTIME_ENABLED`; **no ops kill switch** |
| API mode | Xiaoze always mounted when `runtimeMode === 'api'` |
| Delivery | **Phase A behavior, Phase B delete dead code, Phase C docs/ops** |
| Scope | No change to Xiaoze capabilities, TD-029 checkpointing, or `AGENT_API_*` rename in this effort |

## Goals

- Xiaoze is the **only** Agent in API mode (chat, tools, approvals, threads).
- Remove WiseAgent UI, M4 session API, M4 provider stack, and related config/docs/tests.
- Mock mode shows **no** Agent FAB, panel, or API calls.
- Health/pilot-readiness gates probe Xiaoze LLM readiness instead of M4 `AgentProvider`.

## Non-goals

- Changing LangGraph planning behavior or tool catalog semantics.
- Durable Postgres checkpointing (TD-029).
- Renaming `AGENT_API_BASE_URL` / `AGENT_API_KEY` / `AGENT_MODEL` to Xiaoze-specific names (follow-up).
- Dropping `agent_sessions` table, `repository`, orchestrator approval methods, or `ToolRegistry`.
- Removing proactive suggestions flags (`XIAOZE_PROACTIVE_*`, `VITE_XIAOZE_PROACTIVE_*`).

## Target architecture

```
mock mode
  └─ No Agent UI, no Agent HTTP from frontend

api mode
  Frontend
    XiaozeProvider + CopilotKit (always, when runtimeMode === 'api')
    XiaozePageContextRegistrar (mounted from App.tsx, not UnifiedAgent)
  Backend
    POST /api/v1/agent/xiaoze (+ suggest + threads)
    ToolRegistry → tools/*
    approvalBridge → orchestrator.approveToolCall / rejectToolCall
    LangChain ChatOpenAI ← AGENT_API_* (+ optional XIAOZE_MODEL)

removed
  UnifiedAgent, AgentGateway, agentClient, mockAgentGateway, createAgentPlan (M4 actions)
  POST /api/v1/agent/sessions/*
  AgentProvider.planTurn, providerRegistry, liveProvider (M4-only)
  VITE_XIAOZE_ENABLED, XIAOZE_RUNTIME_ENABLED
  AGENT_PROVIDER, AGENT_API_FORMAT, AGENT_PROMPT_VERSION
```

## Shared infrastructure (must keep)

- `server/modules/agent/toolRegistry.ts` and `tools/*`
- `server/modules/agent/orchestrator.ts` — **approval + tool execution paths only** after slimming
- `server/modules/agent/repository.ts`, `policy.ts`, `types.ts` (tool names used by Xiaoze)
- `server/modules/agent/xiaoze/*` (all modules)
- `server/modules/agent/xiaoze/approvalBridge.ts`
- DB migrations `0008_m4_agent.sql`, `0010_*`, `0024_*`, `0025_*` (Xiaoze threads use `agent_sessions`)
- `AGENT_API_BASE_URL`, `AGENT_API_KEY`, `AGENT_MODEL`, `XIAOZE_MODEL`, `XIAOZE_DETERMINISTIC`, proactive flags
- `AgentInsightBar` + `.agent-insight-*` CSS (Xiaoze proactive UI)

## Phase A — Behavior switch

### Frontend

1. Mount `XiaozePageContextRegistrar` directly from `App.tsx` (same props as today’s `UnifiedAgent` xiaoze branch).
2. Mount `XiaozeProvider` only when `runtimeMode === 'api'` (remove `xiaozeEnabled` gate).
3. Stop rendering `UnifiedAgent` WiseAgent FAB/panel; delete `UnifiedAgent` in Phase B after registrar extraction.
4. Replace Logs `onAskAgent` handlers that click `.agent-fab` with Xiaoze open action.
5. Mock mode: assert no Agent FAB/panel in tests.

**Phase A exit criteria:** API mode shows only Xiaoze; mock mode shows no Agent; no user-facing WiseAgent strings in primary flows.

## Phase B — Delete dead code

Delete M4 frontend stack, five REST routes, M4 provider stack, env flags, WiseAgent CSS, M4 E2E (`test:m4`). Slim orchestrator to approval paths only. Always register Xiaoze routes. Update health checks.

**Phase B exit criteria:** `npm run build`, `npm run test:all`, `npm run test:server`, xiaoze acceptance pass; no production hits for `UnifiedAgent`, `/agent/sessions`, `AgentGateway`.

## Phase C — Docs and ops

Update FRONTEND, ARCHITECTURE, environment-variables (EN/zh-CN), QUALITY_SCORE, self-hosted `.env.example`, Docker compose, `selfhost:check`.

## Environment variables

**Remove:** `VITE_XIAOZE_ENABLED`, `XIAOZE_RUNTIME_ENABLED`, `AGENT_PROVIDER`, `AGENT_API_FORMAT`, `AGENT_PROMPT_VERSION`, `AGENT_PI_PROVIDER` (examples).

**Keep:** `AGENT_API_*` (LLM), `XIAOZE_MODEL`, `XIAOZE_DETERMINISTIC`, proactive flags, dev-only prompt debug.

## Success criteria

1. API mode: only Xiaoze entry; no WiseAgent UI/copy.
2. Mock mode: no Agent UI.
3. No `/api/v1/agent/sessions` in server or OpenAPI.
4. No `VITE_XIAOZE_ENABLED` / `XIAOZE_RUNTIME_ENABLED` in codebase or examples.
5. CI green without `test:m4`.

## Next step

After spec review approval, invoke **writing-plans** for `docs/exec-plans/active/` implementation plan with Documentation Update Gate (`npm run docs:check`).
