# WiseEff Knowledge Base

Date: 2026-05-25

This directory is the repository knowledge base. `AGENTS.md` and `ARCHITECTURE.md` are short maps; the durable product, architecture, design, quality, reliability, security, and execution knowledge lives here.

## Reading Order

1. [Product Specs](product-specs/index.md): product goals, prototype behavior, MVP scope, and onboarding flows.
2. [Architecture](../ARCHITECTURE.md): top-level runtime and codebase map.
3. [Design Docs](design-docs/index.md): full-stack architecture, domain model, API contract, historical designs, testing, deployment, and security.
4. [Developer Docs](developer/README.md): local setup, environment variables, and verification matrix.
5. [API Docs](api/README.md): authentication, errors, examples, and OpenAPI contract usage.
6. [Runbooks](runbooks/README.md): manual acceptance, self-hosted runtime, self-hosted release/rollback, staging, backup/restore, rollback, monitoring, observability, incidents, HDC, Agent provider, and pilot operations.
7. [Frontend](FRONTEND.md): frontend structure, UI rules, runtime modes, and testing expectations.
8. [Plans](PLANS.md): how active and completed execution plans are managed.
9. [Quality Score](QUALITY_SCORE.md): current quality grades and verification gates.
10. [Reliability](RELIABILITY.md): operational, task, deploy, and rollback expectations.
11. [Security](SECURITY.md): identity, RBAC, user permission design, audit, Agent tools, device safety, and data protection.

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
- Runtime seams: local/S3-compatible object storage, dedicated log worker runner, Redis/BullMQ durable queue mode for log-analysis dispatch, simulator/HDC device gateway, deterministic/live Agent provider.
- Observability: M6.5 adds `GET /metrics`, `npm run observability:check`, self-hosted Prometheus config, alert rules, Grafana dashboards, and incident/observability runbooks. Target-environment scrape evidence still has to be collected before calling an environment observability-ready.
- Release state: M5 pilot-readiness gate is implemented; external staging, HDC device-lab, backup/restore, rollback, and live provider evidence must still be recorded before calling an environment pilot-ready.
- Self-hosted runtime: M6.1 adds `ops/self-hosted/`, `npm run selfhost:check`, and `npm run selfhost:smoke` for a single-Linux-server baseline. M6.3 adds S3-compatible self-hosted object storage guidance under `ops/self-hosted/storage/` plus `npm run restore:drill`, `npm run backup:drill`, and `npm run backup:check`. M6.4 adds Redis/BullMQ queue wiring and `npm run queue:check`; target Redis evidence is still required before calling a deployed environment queue-ready.
- Self-hosted release operations: M6.6 adds `npm run selfhost:release-gate`, `npm run capacity:gate`, `ops/self-hosted/releases/`, and [runbooks/release-rollback.md](runbooks/release-rollback.md) for release-candidate evidence, capacity thresholds, and rollback rehearsal tracking. Target capacity, rollback, synthetic acceptance, observability, queue, and HDC evidence remain pending until they are run against a non-customer target environment.
- Developer docs: `docs/zh-CN/` provides the Chinese developer onboarding and daily reference layer for the key architecture, runtime, quality, security, reliability, and planning topics.
- Manual acceptance: `docs/runbooks/manual-acceptance.md` provides the human checklist for product workflow acceptance, runtime gates, evidence capture, and Go/No-Go judgment.
- Documentation checks: `npm run docs:check` validates active plan governance, key doc entry points, local markdown links, and `.env.example` coverage.
