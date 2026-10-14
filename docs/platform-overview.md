# WiseEff Platform Overview

> Chinese: [Chinese](zh-CN/platform-overview.md)

This overview is for external developers evaluating WiseEff or preparing to contribute. It takes about 15 minutes to read and explains what the platform does and how its parts fit together. Follow the links for contracts, procedures, and verification details.

## What WiseEff Is For

WiseEff brings engineering parameter changes, device debugging, log analysis, and reusable knowledge into one development workflow, with help from Xiaoze. The modules share organization, permission, approval, and audit rules. Engineers can investigate a problem, propose a change, validate the result, review it, and save the evidence. Assistant changes to devices or production data still require authorization and human approval.

## Capability Map

The table uses English names for the Chinese-first UI and includes each page's route. The pages and actions available to you depend on server-side permissions, organization membership, and project scope. See the [User Guide](user-guide/README.md) for steps and the [permission design](security/user-permission-design.md) for access rules.

| Domain | What you can do | Entry points and references |
| --- | --- | --- |
| Parameters | Manage canonical Definitions and Catalog releases, browse and compare project values, and make changes through drafts, submission, review, and merge. | Parameters (`/parameters`), Change review (`/parameter-review`), Parameter administration (`/parameter-admin`); [Catalog model and publication](design-docs/catalog-authoring-and-publication-control-plane.md). |
| Debugging | Read device nodes and write after authorization and safety checks. Prepare DTS reload candidates, inspect deployment runs and verification results, restore baselines, or promote changes to drafts. | Node debugging (`/node-debugging`), Parameter debugging (`/dts-reload`); [device lab runbook](runbooks/hdc-device-lab.md) and [DTS reload module](../server/modules/dts-reload/). |
| Logs | Upload logs, track analysis jobs, use domain-aware agent analysis, inspect evidence, and create knowledge drafts. Provider failure cannot be reported as full agent success. | Intelligent analysis (`/logs`), Dashboard (`/log-dashboard`), Log administration (`/log-admin`); [analysis operations](runbooks/log-analysis-llm.md). |
| Knowledge | Create and publish entries within an organization, keep immutable revisions, extract text from files, and check index health. Search returns published content only. | Knowledge (`/knowledge`), Knowledge administration (`/knowledge-admin`); [knowledge design](design-docs/2026-08-12-knowledge-base-design.md). |
| Xiaoze | In API mode, use contextual read tools, plan tasks, cite sources, and propose actions for human approval. Mock mode has no Agent UI. | An assistant shared across workflows, with no separate business page; [Agent architecture](../ARCHITECTURE.md) and [Agent provider runbook](runbooks/agent-provider.md). |
| Governance | Manage organization members and roles, approve registration and activation, inspect audits, and use platform controls and readiness checks. | Organization management (`/organization`), Audit center (`/audit`), Platform console (`/platform-console`); [organization design](design-docs/2026-08-19-organization-administration-design.md) and [security](SECURITY.md). |

The [operation coverage matrix](developer/user-operation-coverage-matrix.md) lists acceptance cases and evidence requirements for each workflow. Check the actual run results to determine whether the current acceptance run passed.

## Architecture At A Glance

```mermaid
flowchart TB
  UI[React / Vite / TypeScript frontend] --> Ports[Application ports]
  Ports --> Mock[Mock adapters: demos and tests only]
  Ports --> HTTP[API runtime: HTTP adapters]
  HTTP --> API[TypeScript API: modular monolith]
  API --> PG[(PostgreSQL: source of truth)]
  API --> Queue[Redis / BullMQ: durable log dispatch]
  Queue --> Worker[Log worker]
  Worker --> PG
  API --> Store[S3-compatible object store]
  Worker --> Store
  API --> Gateway[Device gateway / local bridge]
  Gateway --> Device[Device: HDC and other protocol adapters]
  API --> Xiaoze[Xiaoze: tools / planning / approval]
  Xiaoze --> PG
  Xiaoze --> LLM[Configured LLM provider]
```

The diagram shows the logical relationships between components; a deployment may enable only some adapters. See [Architecture](../ARCHITECTURE.md) and the [technical compendium](design-docs/full-stack-architecture.md) for the detailed topology. Frontend [runtime composition](../src/app/appRuntime.ts) selects HTTP or mock adapters for [application ports](../src/application/ports/). The [runtime policy](../src/infrastructure/http/runtimeMode.ts) defaults to API and rejects production mock builds.

PostgreSQL is the source of truth for business state, audit, approval, and job lifecycle records. Redis/BullMQ dispatches durable log jobs; a worker first claims the database job, then updates its progress or terminal state. Database polling remains available for local development and compensation. Object storage holds file artifacts. See the [self-hosted runtime](runbooks/self-hosted-runtime.md), [queue implementation](../server/modules/jobs/), and [log worker](../server/modules/logs/worker.ts) for how these components operate.

### Main Backend Module Groups

All module groups below are under [`server/modules/`](../server/modules/) and deploy as part of the same API. They do not require separate microservice deployments.

| Group | Responsibility |
| --- | --- |
| `auth`, `users`, `projects`, `audit` | Manage identity, organization and project scope, roles, and traceable audit records. |
| `parameters`, `parameter-*`, `catalog-*`, `dts` | Manage parameter values and governed changes, canonical identity, and Catalog publication and cutover; preserve DTS syntax. |
| `debugging`, `deviceBridge`, `dts-reload` | Connect device protocols, handle snapshots and readback, and manage the reload run lifecycle. |
| `logs`, `jobs` | Parse and analyze logs, claim and retry database jobs, dispatch queues, and check worker health. |
| `knowledge` | Manage entries and revisions, extract content, build indexes, and retrieve within the permitted scope. |
| `agent` | Provide Xiaoze tools, planning, and approval orchestration; integrate threads and checkpoints. |
| `operations`, `release-verification` | Check health and readiness, and assess release evidence. |
| `notifications`, `product-feedback` | Send workflow notifications and collect and triage internal beta feedback. |

## Where To Go Next

| Your goal | Start here |
| --- | --- |
| Set up development or evaluate deployment prerequisites | [README](../README.md) |
| Understand end-to-end architecture and consistency | [Technical compendium](design-docs/full-stack-architecture.md) |
| Integrate with the API | [API docs](api/README.md) |
| Understand why boundaries were chosen | [ADRs](adr/README.md) |
| Contribute a bounded, verified change | [CONTRIBUTING](../CONTRIBUTING.md) |
| Perform a product task with your role | [User Guide](user-guide/README.md) |
