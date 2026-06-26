# WiseEff Full-Stack Architecture

> Chinese: [Chinese](../zh-CN/design-docs/full-stack-architecture.md)

WiseEff is a React/Vite frontend plus a TypeScript modular-monolith backend. The architecture keeps product behavior behind explicit ports and API seams so mock demos, local development, API-mode tests, and self-hosted deployments can coexist without treating mock data as production data.

## Frontend

The frontend contains route/application shell code, domain types and pure rules, application ports, mock implementations, HTTP implementations, components, pages, and tests. Pages should render state and call ports; durable business rules belong in domain/backend layers.

## Backend

The backend composes modules for auth, users, audit, parameters, logs, jobs, debugging, Agent, operations, observability, database, and HTTP foundations. Production writes follow authentication, authorization, validation, transaction, audit, and structured response/error rules.

The live Agent seam is Xiaoze only: CopilotKit/AG-UI on the frontend and LangGraph plus `ToolRegistry` on the backend. Live model calls use LangChain `ChatOpenAI` against the OpenAI-compatible `AGENT_API_*` endpoint unless `XIAOZE_DETERMINISTIC` is set. WiseEff owns tool execution, authorization, approval records, and audit for all Agent paths.

## Data

PostgreSQL is the source of truth. Object storage holds log/file bytes through a local or S3-compatible seam. Redis/BullMQ can provide durable queue delivery, while PostgreSQL remains authoritative for job state and audit.

## Agent And Device Boundaries

Xiaoze is the sole Agent. API mode always mounts the CopilotKit surface; mock mode has no Agent UI. The backend exposes `POST /api/v1/agent/xiaoze` as an AG-UI SSE endpoint backed by a LangGraph.js agent (LangChain `ChatOpenAI` against the OpenAI-compatible `AGENT_API_*` endpoint, or a deterministic fake model in tests). Tools registered in `ToolRegistry` govern authorization: read-only `perception.*` tools pass through `ToolRegistry.authorize` and run automatically; out-of-scope access returns `FORBIDDEN`.

Mutating `action.submitParameterChange` (`kind: mutating`, `requiresApproval: true`) persists orchestrator tool-call + approval records, emits an AG-UI interrupt, and resumes only through `approveToolCall` / `rejectToolCall` with transactional re-authorization and audit `actorType=agent`. The frontend mounts CopilotKit V2 with `XiaozeApprovalCard` (`useInterrupt`) and low-risk frontend tools (`navigateTo`, `prefillParameterValue`).

P2 adds a LangGraph `StateGraph` planning loop: intent → perceive → plan → act → observe, looping until the plan completes or a step is rejected. A `MemorySaver` checkpointer keyed by `threadId` retains perceived context across mutating interrupts. After human approval, `agUiEndpoint` delegates resume to the planning agent via `Command({ resume })`. Opt-in proactive suggestions call `POST /api/v1/agent/xiaoze/suggest` (read-only perception tools only), gated by `XIAOZE_PROACTIVE_ENABLED` and `VITE_XIAOZE_PROACTIVE_ENABLED` (default off). Process-local checkpointing is acceptable for P2 v1; durable Postgres checkpointing is tracked as TD-029.

Device writes use simulator or HDC gateway seams and require guarded write behavior.

## Operations

Operations modules expose liveness, readiness, metrics, pilot readiness, and release readiness. Self-hosted runtime uses separate web, API, worker, PostgreSQL, Redis, object storage, and reverse proxy services.
