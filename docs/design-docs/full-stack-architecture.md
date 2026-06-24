# WiseEff Full-Stack Architecture

> Chinese: [Chinese](../zh-CN/design-docs/full-stack-architecture.md)

WiseEff is a React/Vite frontend plus a TypeScript modular-monolith backend. The architecture keeps product behavior behind explicit ports and API seams so mock demos, local development, API-mode tests, and self-hosted deployments can coexist without treating mock data as production data.

## Frontend

The frontend contains route/application shell code, domain types and pure rules, application ports, mock implementations, HTTP implementations, components, pages, and tests. Pages should render state and call ports; durable business rules belong in domain/backend layers.

## Backend

The backend composes modules for auth, users, audit, parameters, logs, jobs, debugging, Agent, operations, observability, database, and HTTP foundations. Production writes follow authentication, authorization, validation, transaction, audit, and structured response/error rules.

The live Agent provider seam supports WiseEff HTTP and OpenAI-compatible formats via URL-backed transports (`AGENT_API_FORMAT=wiseeff` or `openai`). The redundant Pi provider was removed in P1 (TD-027). WiseEff owns tool execution, authorization, approval records, and audit for all Agent paths.

## Data

PostgreSQL is the source of truth. Object storage holds log/file bytes through a local or S3-compatible seam. Redis/BullMQ can provide durable queue delivery, while PostgreSQL remains authoritative for job state and audit.

## Agent And Device Boundaries

Agent providers produce plans and tool requests; WiseEff owns tool execution, approval, authorization, and audit. Safe provider evidence flows through provider metadata, `/health/ready`, pilot-readiness, `/metrics`, and trace fields without exposing keys or raw prompts. Device writes use simulator or HDC gateway seams and require guarded write behavior.

### Xiaoze P0 Perception + P1 Action

When `XIAOZE_RUNTIME_ENABLED=true`, the backend exposes `POST /api/v1/agent/xiaoze` as an AG-UI SSE endpoint. A LangGraph.js perceive/answer agent (LangChain `ChatOpenAI` against the OpenAI-compatible `AGENT_API_*` endpoint, or a deterministic fake model in tests) calls tools registered in the existing `ToolRegistry`. Read-only `perception.*` tools pass through `ToolRegistry.authorize` and run automatically; out-of-scope access returns `FORBIDDEN` and the agent surfaces a safe non-data answer.

P1 adds mutating `action.submitParameterChange` (`kind: mutating`, `requiresApproval: true`). The AG-UI runtime persists orchestrator tool-call + approval records, emits an AG-UI interrupt, and resumes only through `approveToolCall` / `rejectToolCall` with transactional re-authorization and audit `actorType=agent`. The frontend mounts CopilotKit V2 with `XiaozeApprovalCard` (`useInterrupt`) and low-risk frontend tools (`navigateTo`, `prefillParameterValue`). Device write guards remain outside Xiaoze in P1.

### Xiaoze P2 Planning

P2 replaces the single-turn loop with a LangGraph `StateGraph` planning loop: intent → perceive → plan → act → observe, looping until the plan completes or a step is rejected. A `MemorySaver` checkpointer keyed by `threadId` retains perceived context across mutating interrupts. After human approval, `agUiEndpoint` delegates resume to the planning agent via `Command({ resume })` so the graph continues from the suspended `act` node, observes execution results, and may proceed to further steps. Opt-in proactive suggestions call `POST /api/v1/agent/xiaoze/suggest` (read-only perception tools only), gated by `XIAOZE_PROACTIVE_ENABLED` and `VITE_XIAOZE_PROACTIVE_ENABLED` (default off). The frontend surfaces suggestions through `useXiaozeSuggestions` in `AgentInsightBar`. Process-local checkpointing is acceptable for P2 v1; durable Postgres checkpointing is tracked as TD-029.

## Operations

Operations modules expose liveness, readiness, metrics, pilot readiness, and release readiness. Self-hosted runtime uses separate web, API, worker, PostgreSQL, Redis, object storage, and reverse proxy services.
