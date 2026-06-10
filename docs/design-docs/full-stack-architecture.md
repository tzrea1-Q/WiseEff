# WiseEff Full-Stack Architecture

> Chinese: [Chinese](../zh-CN/design-docs/full-stack-architecture.md)

WiseEff is a React/Vite frontend plus a TypeScript modular-monolith backend. The architecture keeps product behavior behind explicit ports and API seams so mock demos, local development, API-mode tests, and self-hosted deployments can coexist without treating mock data as production data.

## Frontend

The frontend contains route/application shell code, domain types and pure rules, application ports, mock implementations, HTTP implementations, components, pages, and tests. Pages should render state and call ports; durable business rules belong in domain/backend layers.

## Backend

The backend composes modules for auth, users, audit, parameters, logs, jobs, debugging, Agent, operations, observability, database, and HTTP foundations. Production writes follow authentication, authorization, validation, transaction, audit, and structured response/error rules.

The live Agent provider seam supports WiseEff HTTP, OpenAI-compatible, and Pi-backed formats. The Pi-backed path uses `@earendil-works/pi-ai` behind the backend provider adapter and maps model text/tool calls into the existing WiseEff plan shape; WiseEff still owns tool execution, authorization, approval records, and audit. Pi Coding Agent CLI, Pi filesystem tools, Pi shell tools, and project-local `.pi` extensions are not part of the WiseEff product runtime.

## Data

PostgreSQL is the source of truth. Object storage holds log/file bytes through a local or S3-compatible seam. Redis/BullMQ can provide durable queue delivery, while PostgreSQL remains authoritative for job state and audit.

## Agent And Device Boundaries

Agent providers produce plans and tool requests; WiseEff owns tool execution, approval, authorization, and audit. Safe provider evidence flows through provider metadata, `/health/ready`, pilot-readiness, `/metrics`, and trace fields without exposing keys or raw prompts. Device writes use simulator or HDC gateway seams and require guarded write behavior.

## Operations

Operations modules expose liveness, readiness, metrics, pilot readiness, and release readiness. Self-hosted runtime uses separate web, API, worker, PostgreSQL, Redis, object storage, and reverse proxy services.
