# WiseEff Knowledge Base

Date: 2026-05-25

This directory is the repository knowledge base. `AGENTS.md` and `ARCHITECTURE.md` are short maps; the durable product, architecture, design, quality, reliability, security, and execution knowledge lives here.

## Reading Order

1. [Product Specs](product-specs/index.md): product goals, prototype behavior, MVP scope, and onboarding flows.
2. [Architecture](../ARCHITECTURE.md): top-level runtime and codebase map.
3. [Design Docs](design-docs/index.md): full-stack architecture, domain model, API contract, historical designs, testing, deployment, and security.
4. [Frontend](FRONTEND.md): frontend structure, UI rules, runtime modes, and testing expectations.
5. [Plans](PLANS.md): how active and completed execution plans are managed.
6. [Quality Score](QUALITY_SCORE.md): current quality grades and verification gates.
7. [Reliability](RELIABILITY.md): operational, task, deploy, and rollback expectations.
8. [Security](SECURITY.md): identity, RBAC, audit, Agent tools, device safety, and data protection.

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
  generated/
    db-schema.md
  product-specs/
    index.md
    product-spec.md
    prototype-functional-spec.md
    mvp-scope.md
    new-user-onboarding.md
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
- Runtime seams: local/S3-compatible object storage, dedicated log worker runner, simulator/HDC device gateway, deterministic/live Agent provider.
- Release state: M5 pilot-readiness gate is implemented; external staging, HDC device-lab, backup/restore, rollback, and live provider evidence must still be recorded before calling an environment pilot-ready.
