# WiseEff Knowledge Base

> Chinese: [Chinese](zh-CN/README.md)

Date: 2026-05-25

This directory is the repository knowledge base. `AGENTS.md` and `ARCHITECTURE.md` are short maps; the durable product, architecture, design, quality, reliability, security, and execution knowledge lives here.

Newcomers: start with the [Platform Overview](platform-overview.md) for capabilities, architecture, governance, and readiness boundaries.

Product users: start with the [User Guide](user-guide/README.md) for task guidance across all product workflows.

## Technical and Test Reading Paths

Use one maintained set of topic documents, with two entry points:

- **Engineering handover:** [Technical Compendium](design-docs/full-stack-architecture.md): 13 integrated chapters and 22 editable Mermaid diagrams covering architecture, interfaces, workflows, consistency, security, setup and recovery. Specialist references provide further contract detail.
- **Test design and execution planning:** [Testing Strategy and Design](design-docs/testing-strategy.md) → verification matrix → generated requirement/operation coverage → manual acceptance and run-specific evidence.

The technical page owns system and code relationships; the testing page owns risk/scenario design. Existing specialist pages retain schemas, permissions, commands and operational procedures. Update those owners and their Chinese companions rather than making a second handbook. Historical designs and generated results retain their identity and are not current implementation or fresh execution proof.

## Reading Order

For project demonstrations, use the [Chinese project introduction](presentations/project-introduction.zh-CN.md), with Mermaid diagrams and local application screenshots.

1. [Platform Overview](platform-overview.md): the newcomer map of capabilities, architecture, governance, readiness, and next reading steps.
2. [Product Specs](product-specs/index.md): product goals, prototype behavior, MVP scope, and onboarding flows.
3. [Architecture](../ARCHITECTURE.md): top-level runtime and codebase map.
4. [Design Docs](design-docs/index.md): full-stack architecture, domain model, API contract, historical designs, testing, deployment, and security.
5. [Developer Docs](developer/README.md): local setup, environment variables, and verification matrix.
6. [API Docs](api/README.md): authentication, errors, examples, and OpenAPI contract usage.
7. [Runbooks](runbooks/README.md): manual acceptance, self-hosted runtime, WSL validation, self-hosted release/rollback, staging, backup/restore, rollback, monitoring, observability, incidents, HDC, Agent provider, and pilot operations.
8. [Frontend](FRONTEND.md): frontend structure, UI rules, runtime modes, and testing expectations.
9. [Plans](PLANS.md): how active and completed execution plans are managed.
10. [Quality Score](QUALITY_SCORE.md): historical quality assessments, source-verified corrections, and links to current verification gates.
11. [Reliability](RELIABILITY.md): operational, task, deploy, and rollback expectations.
12. [Security](SECURITY.md): identity, RBAC, user permission design, audit, Agent tools, device safety, and data protection.

## Chinese Developer Docs

Chinese-speaking developers can start from [zh-CN/README.md](zh-CN/README.md) for a curated developer reading path. The Chinese layer covers architecture, frontend, backend/runtime, security/reliability, quality gates, and plan governance while linking back to the canonical detailed English documents.

## Directory Layout

```text
docs/
  design-docs/
    index.md
    core-beliefs.md
    full-stack-architecture.md
    domain-model.md
    api-contract.md
    ...
  exec-plans/
    active/
    completed/
    tech-debt-tracker.md
  developer/
    README.md
    local-development.md
    environment-variables.md
    verification-matrix.md
  api/
    README.md
    authentication.md
    errors.md
    examples.md
  security/
    README.md
    user-permission-design.md
    threat-model.md
    data-classification.md
    secrets-management.md
    audit-retention.md
  runbooks/
    README.md
    self-hosted-runtime.md
    wsl-linux-validation.md
    release-rollback.md
    manual-acceptance.md
    m5-commercial-pilot-readiness.md
    staging-deployment.md
    backup-restore.md
    rollback.md
    monitoring-alerting.md
    observability-operations.md
    incidents.md
    hdc-device-lab.md
    agent-provider.md
  generated/
    db-schema.md
  product-specs/
    index.md
    product-spec.md
    prototype-functional-spec.md
    mvp-scope.md
    new-user-onboarding.md
  zh-CN/
    README.md
    architecture.md
    frontend.md
    backend-runtime.md
    security-reliability.md
    quality-and-plans.md
    manual-acceptance.md
    m6-release-readiness.md
  references/
    design-system-reference-llms.txt
    nixpacks-llms.txt
    uv-llms.txt
    vite-react-llms.txt
    vitest-llms.txt
    node-postgres-llms.txt
  DESIGN.md
  FRONTEND.md
  PLANS.md
  PRODUCT_SENSE.md
  QUALITY_SCORE.md
  RELIABILITY.md
  SECURITY.md
```

## Status

This harness structure is the source of truth for WiseEff product, architecture, quality, security, reliability, and execution knowledge. The docs must move with implementation changes so future agents do not rely on chat history.

Current baseline:

- Frontend: React, Vite, TypeScript, mock runtime for demos/tests, and API runtime for productized flows.
- Backend: TypeScript modular-monolith API with auth, audit, parameters, logs, jobs, debugging, Agent, contracts, and operations modules.
- Data and contracts: PostgreSQL migrations, generated schema summary, committed OpenAPI artifact, and contract freshness check.
- Runtime seams: local/S3-compatible object storage, dedicated log worker runner, Redis/BullMQ durable queue mode for log-analysis dispatch, simulator/HDC device gateway, and Xiaoze LLM via `XIAOZE_LLM_API_BASE_URL`, `XIAOZE_LLM_MODEL`, and `XIAOZE_LLM_API_KEY` (or explicit deterministic mode).
- Observability: M6.5 adds `GET /metrics`, a private worker metrics endpoint, log-analysis terminal job duration/failure-reason counters, Xiaoze LLM readiness gauges, Agent approval/tool metrics, device gateway operation counters, HTTP route-template spans, debugging gateway spans, `npm run observability:check`, and a one-command self-hosted Prometheus/Grafana/Alertmanager profile with automatic dashboards and full service probes. Target-environment scrape, routing, dashboard, and trace-collector evidence still has to be collected before calling an environment observability-ready.
- Release state: M5 pilot-readiness gate is implemented; external staging, HDC device-lab, backup/restore, rollback, and live provider evidence must still be recorded before calling an environment pilot-ready.
- Self-hosted runtime: M6.1 adds `ops/self-hosted/`, `npm run selfhost:check`, and `npm run selfhost:smoke` for a single-Linux-server baseline. M6.3 adds S3-compatible self-hosted object storage guidance under `ops/self-hosted/storage/` plus `npm run restore:drill`, `npm run backup:drill`, and `npm run backup:check`. M6.4 adds Redis/BullMQ queue wiring and `npm run queue:check`; target restore and Redis evidence are still required before calling a deployed environment ready.
- Self-hosted release operations: M6.6 adds `npm run selfhost:release-gate`, `npm run capacity:gate`, `ops/self-hosted/releases/`, and [runbooks/release-rollback.md](runbooks/release-rollback.md) for release-candidate evidence, capacity thresholds, and rollback rehearsal tracking. Target identity, capacity, rollback, synthetic acceptance, observability, queue, and HDC evidence remain pending until they are run against a non-customer target environment.
- Developer docs: `docs/zh-CN/` provides the Chinese developer onboarding and daily reference layer for the key architecture, runtime, quality, security, reliability, and planning topics.
- Manual acceptance: `docs/runbooks/manual-acceptance.md` provides the human checklist for product workflow acceptance, runtime gates, evidence capture, and Go/No-Go judgment.
- Documentation checks: `npm run docs:check` validates active plan governance, key doc entry points, local markdown links, and `.env.example` coverage.
