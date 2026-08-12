# WiseEff Full-Stack Architecture

> Chinese: [Chinese](../zh-CN/design-docs/full-stack-architecture.md)

WiseEff is a React/Vite frontend plus a TypeScript modular-monolith backend. The architecture keeps product behavior behind explicit ports and API seams so mock demos, local development, API-mode tests, and self-hosted deployments can coexist without treating mock data as production data.

## Frontend

The frontend contains route/application shell code, domain types and pure rules, application ports, mock implementations, HTTP implementations, components, pages, and tests. Pages should render state and call ports; durable business rules belong in domain/backend layers.

**Parameter admin vs workbench:** `/parameter-admin` owns governance queues (spec review, identity mapping, module/driver mappings, project files/config sets). `/parameters` keeps everyday binding edits and submission; it does not host identity-mapping resolution UI after #199 — open tasks surface as publish blockers while Admins resolve in the admin.

**Project-scoped operations are deep-linked dialogs.** The four project views live at `/parameter-admin/projects/:projectId/{files|config-sets|structure|conflicts}` and present as a dialog over the project list, per ADR-0001. Routes own the address; `ProjectOperationsDialog` owns the presentation and rides the shared `ModalDialog` primitive. Short confirmations and forms also use that primitive; see `docs/FRONTEND.md` for the dialog, layout budget, and overlay-stacking contract.

## Backend

The backend composes modules for auth, users, audit, parameters, logs, jobs, debugging, dts-reload, Agent, operations, observability, database, and HTTP foundations. Production writes follow authentication, authorization, validation, transaction, audit, and structured response/error rules.

**DTS reload debugging** (`server/modules/dts-reload/`, UI `/dts-reload`) validates candidate library values on a real device by generating a `/plugin/` debug overlay, compiling it with the pinned `dtc`/`fdtoverlay` toolchain, deploying through the local device bridge, and capturing a reload snapshot. Debug values never mutate the parameter library (ADR-0019). Deploy runs in-request on the API process that holds the bridge WebSocket (ADR-0020) — it is not a BullMQ job. The reload snapshot records library baselines, on-device artifact integrity, optional kernel-log evidence, and behavioural verification outcomes when debug-node bindings exist (ADR-0021).

**Log analysis LLM** (`server/modules/logs/analyzer/`, P1 of the agent log-analysis plan) replaces the rule-based kernel behind the `LogAnalysisAdapter` seam with a single-shot LangChain `ChatOpenAI` call against the OpenAI-compatible `LOG_ANALYSIS_*` endpoint (deterministic stub when `LOG_ANALYSIS_DETERMINISTIC=true`). The worker parses logs with the bound log domain's declarative format profile, feeds prefilter signals plus a token-budgeted excerpt to the model, and enforces strict-JSON output with a grounding check that rejects references to nonexistent lines. Degradation is honest: transient provider failures retry, and exhausted retries, budget exhaustion, or ungrounded output fall back to the rules engine with `analysis_source="rules-fallback"` and a `degraded_reason` recorded on the report and surfaced in the UI. This path stays outside the Xiaoze stack (ADR-0022): read-only, no tools, no approval chain, with a behavior-layer eval (`npm run logs:eval`) gating CI.

The live conversational Agent seam is Xiaoze only: CopilotKit/AG-UI on the frontend and LangGraph plus `ToolRegistry` on the backend. Live model calls use LangChain `ChatOpenAI` against the OpenAI-compatible `AGENT_API_*` endpoint unless `XIAOZE_DETERMINISTIC` is set. WiseEff owns tool execution, authorization, approval records, and audit for all Agent paths.

## Data

PostgreSQL is the source of truth. Object storage holds log/file bytes through a local or S3-compatible seam. Redis/BullMQ can provide durable queue delivery, while PostgreSQL remains authoritative for job state and audit.

## Agent And Device Boundaries

Xiaoze is the sole Agent. API mode always mounts the CopilotKit surface; mock mode has no Agent UI. The backend exposes `POST /api/v1/agent/xiaoze` as an AG-UI SSE endpoint backed by a LangGraph.js agent (LangChain `ChatOpenAI` against the OpenAI-compatible `AGENT_API_*` endpoint, or a deterministic fake model in tests). Tools registered in `ToolRegistry` govern authorization: read-only `perception.*` tools pass through `ToolRegistry.authorize` and run automatically; out-of-scope access returns `FORBIDDEN`.

Mutating `action.submitParameterChange` (`kind: mutating`, `requiresApproval: true`) opens the orchestrator-owned Agent approval chain: `beginApproval` persists tool-call + approval records and emits an AG-UI interrupt, and the run resumes only through `resolveApproval` with transactional re-authorization and audit `actorType=agent`. Approval state is DB-backed (`agent_tool_calls` + `agent_approvals`), never process memory, and `editedArgs` replaces the payload before approval-time re-authorization (ADR-0024). The frontend mounts CopilotKit V2 with `XiaozeApprovalCard` (`useInterrupt`) and low-risk frontend tools (`navigateTo`, `prefillParameterValue`).

P2 adds a LangGraph `StateGraph` planning loop: intent → perceive → plan → act → observe, looping until the plan completes or a step is rejected. A checkpointer keyed by `threadId` retains perceived context across mutating interrupts; production and self-hosted deployments use `XIAOZE_CHECKPOINTER=postgres` (tables ensured by `npm run db:migrate`), while local dev/tests default to in-memory checkpointing. After human approval, `agUiEndpoint` delegates resume to the planning agent via `Command({ resume })` carrying only the approval decision; per-request auth context and the run event sink travel through per-invoke `config.configurable` and are never checkpointed (ADR-0024). Opt-in proactive suggestions call `POST /api/v1/agent/xiaoze/suggest` (read-only perception tools only), gated by `XIAOZE_PROACTIVE_ENABLED` and `VITE_XIAOZE_PROACTIVE_ENABLED` (default off). User-visible chat history remains separate (TD-030).

Device writes use simulator or HDC gateway seams and require guarded write behavior. DTS reload device writes additionally require `debugging:dts-reload`, `confirm-dts-reload` at deploy, a device lease, bridge capability negotiation for `debug.mountTarget` / `debug.pushFile` / `debug.readKernelLog`, and sensitive-node escalation (`parameter:edit-critical` / `confirm-sensitive-reload`) when rules match.

## Operations

Operations modules expose liveness, readiness, metrics, pilot readiness, and release readiness. Self-hosted runtime uses separate web, API, worker, PostgreSQL, Redis, object storage, and reverse proxy services.
